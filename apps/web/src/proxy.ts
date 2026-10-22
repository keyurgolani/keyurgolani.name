import { NextResponse, type NextRequest } from 'next/server';
import { INDEXABLE, type Profile } from './server/capabilities';
import { getDeploymentConfig, isServable } from './server/config-store';
import { READY_PATH, STARTING, STARTING_HEADERS } from './server/ready-starting';
import { safeReturnTo, signInLocation } from './server/return-to';
import {
  encodesFixedSegment,
  listRoutes,
  resolveRoute,
  ROUTE_HEADER,
  routeAccess,
} from './server/routes';
import { readCookies, sessionCookieName } from './server/session-cookie';
import {
  isStudioPath,
  newNonce,
  NOT_FOUND_HEADER,
  STUDIO_PAGES,
  STUDIO_PATH_HEADER,
  STUDIO_RESPONSE_HEADERS,
  studioCsp,
} from './server/studio-headers';

// Defense in depth (#1, item 15). Each route checks its profile itself; this
// answers 404 before Next routes a request for a path the route table lists
// and the profile doesn't serve, and gives every request a fresh
// x-request-id, whatever the client sent. Under a profile crawlers may not
// index (demo, #1 item 17), every response says so, which is why there is no
// matcher: build assets and optimized images go through here too. It decides
// from the route table and the capability matrix only, never from a route's
// name, and reads the frozen config register() stored. While the catalog
// can't serve (#5, Slice 3), a visitor page gets a static 503 page, since a
// page can't set that status itself. A path no route renders (#5, Slice 4)
// goes on to Next marked missing, and next.config.ts sends it to the 404
// page; any method but GET and HEAD gets the plain 404 here. So does a route
// spelled with a fixed segment percent-encoded, such as /%66eed.xml, which
// the table reads decoded but Next would hand to the views catch-all.
//
// For Studio (#2), under a profile with a Studio page, it sends the nonce
// CSP, Referrer-Policy: same-origin, and Cross-Origin-Resource-Policy:
// same-origin on every /studio response, in any case or percent-encoding,
// as the route table reads the path, and tells the page which path was
// asked for. A Studio page the matrix gives only to a session, asked for with
// no session cookie at all, goes to sign-in here with a 303 before Next
// renders it. That only saves the render: it reads no session, and the
// page's own requireOwnerPage decides. Under a profile with no Studio page,
// every Studio path, in any case or spelling and to any method, answers as
// /no-such-page does: none of Studio's headers, Next's 404 page for GET and
// HEAD, and the plain 404 for the rest.
export function proxy(request: NextRequest): NextResponse {
  const requestId = crypto.randomUUID();
  const deployment = getDeploymentConfig();
  if (!deployment) {
    // Readiness answers its own `starting` body, as served() does.
    if (request.nextUrl.pathname === READY_PATH) {
      return NextResponse.json(STARTING, {
        status: 503,
        headers: { ...STARTING_HEADERS, 'x-request-id': requestId },
      });
    }
    return plain(503, 'Service unavailable.', requestId, {});
  }
  const { pathname, search, searchParams } = request.nextUrl;
  const extra: Record<string, string> = INDEXABLE[deployment.profile]
    ? {}
    : { 'x-robots-tag': 'noindex' };
  const studioPath = isStudioPath(pathname);
  const studio = studioPath && hasStudio(deployment.profile);
  const csp = studio ? studioCsp(newNonce(), deployment.mode) : undefined;
  if (csp) Object.assign(extra, STUDIO_RESPONSE_HEADERS, { 'content-security-policy': csp });

  // Only GET and HEAD load a page: any other method to a path no route
  // answers is the plain 404.
  const pageLoad = request.method === 'GET' || request.method === 'HEAD';
  const decision = resolveRoute(deployment.profile, pathname, searchParams);
  if (decision.status === 'absent') {
    if (studioPath && !studio && pageLoad) return unknownPath(request, requestId, extra);
    return plain(404, 'Not found.', requestId, extra);
  }
  if (decision.status === 'missing' && !pageLoad) {
    return plain(404, 'Not found.', requestId, extra);
  }
  if (decision.status === 'served' && decision.entry.visitor && !isServable()) {
    return unavailable(requestId);
  }
  if (
    decision.status === 'served' &&
    decision.entry.kind === 'page' &&
    decision.access === 'session' &&
    (request.method === 'GET' || request.method === 'HEAD') &&
    readCookies(request, sessionCookieName(deployment.origin)).length === 0
  ) {
    const location = signInLocation(null, safeReturnTo(`${pathname}${search}`));
    return seeOther(new URL(location, deployment.origin), requestId, extra);
  }
  // A fixed segment spelled percent-encoded, as in /%66eed.xml: the table
  // matched it decoded, but Next matches it as sent and would give the path
  // to the views catch-all, whose 404 needs JavaScript. It answers as a path
  // no route matches. A Studio 404 under owner keeps its nonce: the request
  // carries the policy, which Next reads for the page's scripts.
  if (decision.status === 'served' && encodesFixedSegment(decision.entry.pattern, pathname)) {
    if (!pageLoad) return plain(404, 'Not found.', requestId, extra);
    return unknownPath(request, requestId, extra, csp);
  }

  const headers = new Headers(request.headers);
  headers.set('x-request-id', requestId);
  headers.delete(STUDIO_PATH_HEADER);
  headers.delete(NOT_FOUND_HEADER);
  // The table's decision, in place of anything the client sent.
  headers.set(ROUTE_HEADER, decision.status);
  if (csp) {
    headers.set('content-security-policy', csp);
    headers.set(STUDIO_PATH_HEADER, `${pathname}${search}`);
  }
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('x-request-id', requestId);
  // A Studio path the table calls missing, under a profile with no Studio,
  // gets what any missing path gets, in place of next.config.ts's no-store.
  if (decision.status === 'missing' && studioPath && !studio) {
    response.headers.set('cache-control', UNKNOWN_PATH_CACHE_CONTROL);
  }
  for (const [name, value] of Object.entries(extra)) response.headers.set(name, value);
  return response;
}

/** Whether `profile` serves a Studio page, by the route table. */
const studioProfiles = new Map<Profile, boolean>();
function hasStudio(profile: Profile): boolean {
  let known = studioProfiles.get(profile);
  if (known === undefined) {
    known = listRoutes().some(
      (entry) =>
        entry.kind === 'page' &&
        STUDIO_PAGES.test(entry.pattern) &&
        routeAccess(profile, entry) !== 'absent',
    );
    studioProfiles.set(profile, known);
  }
  return known;
}

/**
 * What Next sends with its 404 page for a path no route matches, in place of
 * the no-store next.config.ts asks of a Studio path, which Next keeps when
 * it renders the page through the rewrite.
 */
const UNKNOWN_PATH_CACHE_CONTROL = 'private, no-cache, no-store, max-age=0, must-revalidate';

/**
 * A path the route table lists, answered as a path it doesn't list is:
 * Next's 404 page, through next.config.ts's rewrite, with the headers any
 * path gets. That's a Studio page under a profile with none, or a route
 * spelled with a fixed segment percent-encoded. `csp`, for a Studio path
 * under owner, goes on the request too, for the nonce on the page's scripts.
 */
function unknownPath(
  request: NextRequest,
  requestId: string,
  extra: Record<string, string>,
  csp?: string,
): NextResponse {
  const headers = new Headers(request.headers);
  headers.set('x-request-id', requestId);
  headers.delete(STUDIO_PATH_HEADER);
  headers.delete(ROUTE_HEADER);
  headers.set(NOT_FOUND_HEADER, '1');
  if (csp) headers.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('x-request-id', requestId);
  response.headers.set('cache-control', UNKNOWN_PATH_CACHE_CONTROL);
  for (const [name, value] of Object.entries(extra)) response.headers.set(name, value);
  return response;
}

function plain(
  status: number,
  text: string,
  requestId: string,
  extra: Record<string, string>,
): NextResponse {
  return new NextResponse(text, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-request-id': requestId,
      ...extra,
    },
  });
}

/**
 * The page visitors get while the catalog can't serve: static HTML, with no
 * validation text, path, or Studio link, which crawlers are asked to come
 * back for rather than index.
 */
const UNAVAILABLE_PAGE = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<meta name="robots" content="noindex">',
  '<title>Temporarily unavailable</title>',
  '</head>',
  '<body>',
  '<main>',
  '<h1>Temporarily unavailable</h1>',
  '<p>This site is being updated. Try again in a few minutes.</p>',
  '</main>',
  '</body>',
  '</html>',
  '',
].join('\n');

function unavailable(requestId: string): NextResponse {
  return new NextResponse(UNAVAILABLE_PAGE, {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': '120',
      'x-robots-tag': 'noindex',
      'x-request-id': requestId,
    },
  });
}

/** A 303 to `location`, which is on the canonical origin, never the request's Host. */
function seeOther(location: URL, requestId: string, extra: Record<string, string>): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: {
      location: location.href,
      'cache-control': 'no-store',
      'x-request-id': requestId,
      ...extra,
    },
  });
}
