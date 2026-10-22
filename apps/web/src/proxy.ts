import { NextResponse, type NextRequest } from 'next/server';
import { INDEXABLE, type Profile } from './server/capabilities';
import { getDeploymentConfig, isServable } from './server/config-store';
import { isPreviewPath, previewCsp, previewHeaders } from './server/preview-headers';
import { READY_PATH, STARTING, STARTING_HEADERS } from './server/ready-starting';
import { safeReturnTo, signInLocation } from './server/return-to';
import {
  encodesFixedSegment,
  listRoutes,
  resolveRoute,
  ROUTE_HEADER,
  routeAccess,
  spellsRouteFile,
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
// the table reads decoded but Next would hand to the views catch-all, and a
// missing path that is a route file's own path, as sent or decoded whole,
// such as /work/[slug] or /studio%2Fsign-in, which Next's file check finds.
//
// Every response under /preview and /preview-assets (#7), in any case or
// percent-encoding, gets the preview's own CSP with a fresh nonce, which goes
// on the request too, for the scripts and styles Next renders, and its
// noindex, no-referrer, and private, no-store headers, before startup
// included. Those requests reach Next without their Cookie header, so no
// preview route reads a session or a visitor's preference. A preview route
// this build doesn't serve, such as the dev fixture route outside `next
// dev`, answers as a path no route matches, in any spelling. Under the
// prefixes next.config.ts serves with Access-Control-Allow-Origin: *, only
// a GET or HEAD of a build asset, as Next serves them, and a route the table
// serves get past here; anything else there is the plain 404, so no page
// carries the header.
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
    // A preview's 503 keeps the preview's headers, with no origin to frame it.
    const early = isPreviewPath(request.nextUrl.pathname)
      ? previewHeaders(previewCsp(newNonce(), { mode: 'production' }))
      : {};
    return plain(503, 'Service unavailable.', requestId, early);
  }
  const { pathname, search, searchParams } = request.nextUrl;
  const extra: Record<string, string> = INDEXABLE[deployment.profile]
    ? {}
    : { 'x-robots-tag': 'noindex' };
  const studioPath = isStudioPath(pathname);
  const studio = studioPath && hasStudio(deployment.profile);
  const preview = isPreviewPath(pathname);
  const csp = studio
    ? studioCsp(newNonce(), deployment.mode)
    : preview
      ? previewCsp(newNonce(), { mode: deployment.mode, studioOrigin: deployment.origin })
      : undefined;
  if (studio && csp) {
    Object.assign(extra, STUDIO_RESPONSE_HEADERS, { 'content-security-policy': csp });
  }
  if (preview && csp) Object.assign(extra, previewHeaders(csp));

  // Only GET and HEAD load a page: any other method to a path no route
  // answers is the plain 404.
  const pageLoad = request.method === 'GET' || request.method === 'HEAD';
  const decision = resolveRoute(deployment.profile, pathname, searchParams);
  // Access-Control-Allow-Origin: * goes on everything next.config.ts matches
  // under these prefixes, so only a GET or HEAD of a build asset, as Next
  // serves them, and a route the table serves go on to Next. Every other
  // spelling, method, or path there gets this plain 404. A build asset that
  // doesn't exist still reaches the views catch-all's 404, the site's,
  // since nothing here knows which files exist.
  if (
    SHARED_ASSETS.test(decodedPath(pathname)) &&
    !(pageLoad && pathname.startsWith('/_next/static/')) &&
    decision.status !== 'served'
  ) {
    return plain(404, 'Not found.', requestId, extra);
  }
  if (decision.status === 'absent') {
    // A Studio page under a profile with none, and a preview route this
    // build doesn't serve, such as the dev fixture route outside `next dev`,
    // answer as a path no route matches.
    if ((preview || (studioPath && !studio)) && pageLoad) {
      return unknownPath(request, requestId, extra, { csp, preview });
    }
    return plain(404, 'Not found.', requestId, extra);
  }
  if (decision.status === 'missing' && !pageLoad) {
    return plain(404, 'Not found.', requestId, extra);
  }
  // A missing path that is a route file's own path, as sent or decoded
  // whole, such as /work/[slug] or /studio%2Fsign-in: Next's file check
  // finds the file before the afterFiles rewrite runs, and the views
  // catch-all answers with a 404 that needs JavaScript. The beforeFiles
  // rewrite comes first.
  if (decision.status === 'missing' && spellsRouteFile(pathname)) {
    return unknownPath(request, requestId, extra, { csp, preview });
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
    return unknownPath(request, requestId, extra, { csp, preview });
  }

  const headers = forwarded(request, requestId, { csp, preview });
  // The table's decision, in place of anything the client sent.
  headers.set(ROUTE_HEADER, decision.status);
  if (studio) headers.set(STUDIO_PATH_HEADER, `${pathname}${search}`);
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
 * The prefixes next.config.ts serves with Access-Control-Allow-Origin: *
 * (#7, Slice 1, item 6), in any case, as its header rules match them: the
 * build's assets, and the fonts, variant assets, and stylesheets #6 and #19
 * serve under /_portfolio, which an opaque preview frame loads cross-origin.
 */
const SHARED_ASSETS = /^\/(?:_next\/static|_portfolio)(?:\/|$)/i;

/** `pathname` percent-decoded, or as sent when it doesn't decode. */
function decodedPath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/**
 * The headers of the request Next routes: a fresh request ID, none of the
 * marks only proxy.ts may set, and `csp`, where a Studio or preview response
 * sends one, so Next reads its nonce. A preview's request goes on without
 * its Cookie header (#7, Slice 1, item 4), so no preview route can read the
 * session cookie or a visitor's preference.
 */
function forwarded(
  request: NextRequest,
  requestId: string,
  { csp, preview = false }: { readonly csp?: string; readonly preview?: boolean },
): Headers {
  const headers = new Headers(request.headers);
  headers.set('x-request-id', requestId);
  headers.delete(STUDIO_PATH_HEADER);
  headers.delete(NOT_FOUND_HEADER);
  headers.delete(ROUTE_HEADER);
  if (csp) headers.set('content-security-policy', csp);
  if (preview) headers.delete('cookie');
  return headers;
}

/**
 * A path the route table lists, answered as a path it doesn't list is:
 * Next's 404 page, through next.config.ts's rewrite, with the headers any
 * path gets. That's a Studio page under a profile with none, a route spelled
 * with a fixed segment percent-encoded, or a missing path that is a route
 * file's own. `csp`, for a Studio path under owner or a preview path, goes on
 * the request too, for the nonce on the page's scripts.
 */
function unknownPath(
  request: NextRequest,
  requestId: string,
  extra: Record<string, string>,
  options: { readonly csp?: string; readonly preview?: boolean },
): NextResponse {
  const headers = forwarded(request, requestId, options);
  headers.set(NOT_FOUND_HEADER, '1');
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
