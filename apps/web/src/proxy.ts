import { NextResponse, type NextRequest } from 'next/server';
import { PREVIEW_STATUS, PREVIEW_STATUS_DOCUMENT, PREVIEW_STATUS_TYPE } from './preview/status';
import { INDEXABLE, type Profile } from './server/capabilities';
import { COMPILED_MODE } from './server/compiled-mode';
import {
  getDeploymentConfig,
  getDeploymentState,
  isServable,
  servableAgain,
} from './server/config-store';
import { isExperiencePath, REFERENCE_PATTERN, segmentFor } from './server/experience';
import { demoCsp, demoPagePath } from './server/demo-headers';
import { isPreviewPath, previewCsp, previewHeaders } from './server/preview-headers';
import { publicCsp } from './server/public-headers';
import { PORTFOLIO_FILES } from './server/portfolio-files';
import { READY_PATH, STARTING, STARTING_HEADERS } from './server/ready-starting';
import { unavailablePage } from './server/unavailable-page';
import { CONTENT_HEADER, EXPERIENCE_HEADER } from './server/route-header';
import { safeReturnTo, signInLocation } from './server/return-to';
import {
  encodesFixedSegment,
  listRoutes,
  resolveRoute,
  ROUTE_HEADER,
  routeAccess,
  splitPath,
  spellsRouteFile,
  type RouteDecision,
  type RouteEntry,
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
// the table reads decoded but Next matches as sent, and a missing path that
// is a route file's own path, as sent or decoded whole, such as
// /studio%2Fsign-in, which Next's file check finds.
//
// Every response under /preview and /preview-assets (#7), in any case or
// percent-encoding, gets the preview's own CSP with a fresh nonce, which goes
// on the request too, for the scripts and styles Next renders, and its
// noindex, no-referrer, and private, no-store headers, before startup
// included. Those requests reach Next without their Cookie header, so no
// preview route reads a session or a visitor's preference. Under a profile
// with no grant route, a preview route this build doesn't serve, such as the
// dev fixture route outside `next dev`, answers as a path no route matches,
// in any spelling. Under the prefixes next.config.ts serves with
// Access-Control-Allow-Origin: *, only a GET or HEAD of a build asset, or of
// exactly a path the registry wrote into public/_portfolio/, spelled as Next
// serves them, and a route the table serves get past here; anything else
// there is the plain 404.
//
// Under a profile that serves grant routes (owner, #7 Slice 2), this is
// where a grant path is checked, every request: only a GET or HEAD of a
// frame's document with Sec-Fetch-Dest: iframe, or of a draft-only asset
// with an image, video, audio, track, or font destination, or of a generated
// scheme's stylesheet (#20) with a style destination, for a grant the
// owner composition finds active, goes on to Next. Every other request under
// the preview prefixes, a path no grant route serves included, gets one
// status document, 404, under the preview's headers, whatever the reason,
// and a grant path never goes to sign-in: its grant is its authority, never
// a cookie. A preview route that isn't a grant's, the dev fixture route
// under `next dev`, goes on as any route does.
//
// With PORTFOLIO_PREVIEW_ORIGIN set (#7, Slice 4), a request whose Host
// header names that origin's host gets only what a frame loads: a path under
// the preview prefixes or the shared asset prefixes, in any case or
// percent-encoding, goes on as it would on the deployment's own origin, and
// everything else gets what a path no route matches gets, before anything
// else here. It fails closed: only a Host naming PORTFOLIO_ORIGIN's host
// gets the whole site, and any other, such as one a proxy in front rewrote,
// gets the health checks and the plain 404. The Host header decides this
// and nothing else.
//
// A path with a trailing slash gets a 308 to the path without it, as Next
// sent before next.config.ts turned its own off (#7): this one carries the
// headers its path gets, so a preview path's is private, no-store, and its
// answer never depends on a grant.
//
// A visitor page renders in the experience segment of the composition it
// shows (#6, Slice 2), one route per registered variant, which imports that
// variant alone, so the page's chunks hold no other variant's code. Once
// every check above has let a GET or HEAD of one through, this names its
// segment in x-portfolio-experience, from memory alone: segmentFor() reads
// the live composition config-store holds, and under demo, /sample's
// `variant` parameter. On a work's own page, a composition that leaves that
// page to the host gives way to the fallback composition (#10b).
// next.config.ts rewrites the request to /_experience/<id> and the path once
// Next has looked in public/, and drops nothing from its query. Any other method to a visitor page gets a 405,
// since the page exists for GET, and so does any other method to a
// read-only route, such as #10's /media. A request for an experience
// segment's own path, in any spelling and to any method, answers as a path
// no route matches, and a client's own x-portfolio-experience goes no
// further than here.
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
//
// Under demo (#9), the showroom at /, every path under /sample and
// /reference, and Demo Studio's paths get the demo policy from
// server/demo-headers.ts in place of the public one or Studio's: Studio's,
// with worker-src 'self' and form-action 'none', and frame-ancestors 'self'
// on /sample and /reference alone. A page of the read-only reference goes on marked
// x-portfolio-content: reference, so the site layout reads its view, and a
// client's own copy of that mark goes no further than here, on any route.
//
// A route no profile of this build serves, such as /_fixtures/appearance in
// a build without APPEARANCE_FIXTURES=1 (#19, Slice 3), answers as
// /no-such-page does too, in every profile: Next's 404 page for GET and
// HEAD, and the plain 404 for the rest.
export async function proxy(request: NextRequest): Promise<NextResponse> {
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
    // A preview's 503 keeps the preview's headers, with no origin to frame
    // it, and anything else's the public policy.
    const early = isPreviewPath(request.nextUrl.pathname)
      ? previewHeaders(previewCsp(newNonce(), { mode: 'production' }))
      : { 'content-security-policy': publicCsp(newNonce(), 'production') };
    return plain(503, 'Service unavailable.', requestId, early);
  }
  const { pathname, search, searchParams } = request.nextUrl;
  const extra: Record<string, string> = INDEXABLE[deployment.profile]
    ? {}
    : { 'x-robots-tag': 'noindex' };
  // Only GET and HEAD load a page: any other method to a path no route
  // answers is the plain 404.
  const pageLoad = request.method === 'GET' || request.method === 'HEAD';
  const preview = isPreviewPath(pathname);
  // On the preview origin (#7, Slice 4), only frames and what they load, and
  // on a host the deployment doesn't name, only the health checks.
  const host = hostOf(request, deployment.origin, deployment.previewOrigin);
  if (host === 'preview' && !preview && !sharedAsset(pathname)) {
    const policy = publicCsp(newNonce(), COMPILED_MODE);
    extra['content-security-policy'] = policy;
    return pageLoad
      ? unknownPath(request, requestId, extra, { csp: policy })
      : plain(404, 'Not found.', requestId, extra);
  }
  if (host === 'other' && !HEALTH_PATHS.has(pathname)) {
    extra['content-security-policy'] = publicCsp(newNonce(), COMPILED_MODE);
    return plain(404, 'Not found.', requestId, extra);
  }
  const studioPath = isStudioPath(pathname);
  const studio = studioPath && hasStudio(deployment.profile);
  // Under demo (#9), the showroom, the sample, the reference, and Demo Studio
  // get the demo policy, which only /sample's and /reference's let the demo's
  // own pages frame: Demo Studio's preview frame shows either.
  const demoPage =
    deployment.profile === 'demo' && !preview ? (studio ? 'studio' : demoPagePath(pathname)) : null;
  // Every other path, a Studio path under a profile with none among them,
  // gets the public site's policy (#6, item 8), its nonce on the request
  // too, so Next puts it on the scripts it renders.
  const csp = demoPage
    ? demoCsp(
        newNonce(),
        COMPILED_MODE,
        demoPage === 'sample' || demoPage === 'reference' ? "'self'" : "'none'",
      )
    : studio
      ? studioCsp(newNonce(), COMPILED_MODE, deployment.previewOrigin)
      : preview
        ? previewCsp(newNonce(), { mode: COMPILED_MODE, studioOrigin: deployment.origin })
        : publicCsp(newNonce(), COMPILED_MODE);
  if (studio) {
    Object.assign(extra, STUDIO_RESPONSE_HEADERS, { 'content-security-policy': csp });
  } else if (preview) {
    Object.assign(extra, previewHeaders(csp));
  } else {
    extra['content-security-policy'] = csp;
  }

  // Only next.config.ts's rewrite of a request marked below reaches an
  // experience segment (#6, Slice 2).
  const decision: RouteDecision = isExperiencePath(pathname)
    ? { status: 'missing' }
    : resolveRoute(deployment.profile, pathname, searchParams);
  // Access-Control-Allow-Origin: * goes on everything next.config.ts matches
  // under these prefixes, so only a GET or HEAD of a file Next serves there,
  // spelled as Next serves it, and a route the table serves go on to Next.
  // Every other spelling, method, or path there gets this plain 404, a
  // trailing slash's too, before the 308 below could name another path.
  // Under /_portfolio/ only a path the registry wrote goes on. A build asset
  // that doesn't exist still reaches a 404 page, the site's, since nothing
  // here knows which build files exist. A route the table serves there, such
  // as #20's generated schemes, gets the same 404 for a trailing slash: a
  // file has no path below it, and the 308 would name one.
  const sent = sentPath(request);
  const slashed = sent.length > 1 && sent.endsWith('/');
  if (
    sharedAsset(pathname) &&
    ((!(pageLoad && sharedFile(pathname)) && decision.status !== 'served') || slashed)
  ) {
    return plain(404, 'Not found.', requestId, extra);
  }

  // The 308 Next sent itself for a trailing slash, now with the path's headers.
  if (slashed) return trailingSlash(request, sent, requestId, extra);
  // A grant path, and everything else under the preview prefixes, under a
  // profile with grant routes: admitted on to Next, or the status document.
  if (preview && hasGrants(deployment.profile)) {
    const gated = await previewGate(request, decision, { pathname, requestId, extra, csp });
    if (gated) return gated;
  }
  // A route no profile of this build serves, as the route table marks it
  // (#19, Slice 3): a page load goes to the 404 page ahead of Next's file
  // check, and any other method gets the plain 404 below. A preview path's
  // gate above answers first under a profile with grant routes (#7).
  // A Studio route under a profile with Studio, such as #6's catalog fixture
  // in a build without its flag, keeps the no-store next.config.ts asks of
  // a Studio path, so it answers exactly as an unknown Studio path does.
  if (decision.status === 'absent' && decision.unknown && pageLoad) {
    return unknownPath(request, requestId, extra, { csp, preview, studioCaching: studio });
  }
  if (decision.status === 'absent') {
    // A Studio page the profile doesn't serve, and a preview route this
    // build doesn't serve, such as the dev fixture route outside `next dev`,
    // under a profile with no grant route, answer as a path no route
    // matches. Under one with grant routes, the gate above has answered.
    // Under a profile with Studio, as demo's /studio/sign-in is (#9), it
    // keeps the no-store next.config.ts asks of a Studio path.
    if ((preview || studioPath) && pageLoad) {
      return unknownPath(request, requestId, extra, { csp, preview, studioCaching: studio });
    }
    return plain(404, 'Not found.', requestId, extra);
  }
  if (decision.status === 'missing' && !pageLoad) {
    return plain(404, 'Not found.', requestId, extra);
  }
  // A missing path that is a route file's own path, as sent or decoded
  // whole, such as /studio%2Fsign-in: Next's file check finds the file
  // before the afterFiles rewrite runs. The beforeFiles rewrite comes first.
  if (decision.status === 'missing' && spellsRouteFile(pathname)) {
    return unknownPath(request, requestId, extra, { csp, preview });
  }
  // While nothing serves, the catalog reads once more before the 503, so a
  // publish from another process serves on the next request (#3): one read
  // for every request meanwhile, waited on for a second at most
  // (config-store's RECHECK_MS).
  if (decision.status === 'served' && decision.entry.visitor && !isServable()) {
    if (!(await servableAgain())) return unavailable(requestId, extra);
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
  // matched it decoded, but Next matches it as sent, so the entry's route
  // never answers it. It answers as a path no route matches. A Studio 404
  // under owner keeps its nonce: the request carries the policy, which Next
  // reads for the page's scripts.
  if (decision.status === 'served' && encodesFixedSegment(decision.entry.pattern, pathname)) {
    if (!pageLoad) return plain(404, 'Not found.', requestId, extra);
    return unknownPath(request, requestId, extra, { csp, preview });
  }

  // A visitor page exists for GET and HEAD, which go to its experience
  // segment, and so does a read-only route, such as #10's renditions.
  const experience = decision.status === 'served' && decision.entry.experience === true;
  const readOnly = decision.status === 'served' && decision.entry.readOnly === true;
  if ((experience || readOnly) && !pageLoad) return methodNotAllowed(requestId, extra);
  // A route handler that takes fewer methods than every one, as the table
  // lists them, such as POST /api/appearance (#19, Slice 4).
  const methods = decision.status === 'served' ? decision.entry.methods : undefined;
  if (methods && !(methods as readonly string[]).includes(request.method)) {
    return methodNotAllowed(requestId, extra, methods.join(', '));
  }

  const headers = forwarded(request, requestId, { csp, preview });
  // The table's decision, in place of anything the client sent.
  headers.set(ROUTE_HEADER, decision.status);
  if (studio) headers.set(STUDIO_PATH_HEADER, `${pathname}${search}`);
  if (decision.status === 'served' && experience) {
    // The segment next.config.ts rewrites the request to. The table read
    // the path, so its segments decode.
    const segment = segmentFor({
      profile: deployment.profile,
      pattern: decision.entry.pattern,
      segments: splitPath(pathname) ?? [],
      query: searchParams,
    });
    headers.set(EXPERIENCE_HEADER, segment);
    // The demo's read-only reference (#9): the layout reads its view.
    if (decision.entry.pattern === REFERENCE_PATTERN) headers.set(CONTENT_HEADER, 'reference');
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

/**
 * A visitor page (#6, Slice 2), or a read-only route such as #10's
 * renditions, asked for with a method other than GET or HEAD, or a route
 * handler with one its entry doesn't list: plain text, as an operation
 * called with the wrong method gets, with the methods it takes.
 */
function methodNotAllowed(
  requestId: string,
  extra: Record<string, string>,
  allow = 'GET, HEAD',
): NextResponse {
  return plain(405, 'Method not allowed.', requestId, { ...extra, allow });
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

/** Whether `profile` serves a route a preview grant authorizes, by the route table. */
const grantProfiles = new Map<Profile, boolean>();
function hasGrants(profile: Profile): boolean {
  let known = grantProfiles.get(profile);
  if (known === undefined) {
    known = listRoutes().some(
      (entry) => entry.grant !== undefined && routeAccess(profile, entry) !== 'absent',
    );
    grantProfiles.set(profile, known);
  }
  return known;
}

/**
 * What each kind of grant route may be loaded as, by Sec-Fetch-Dest (#7,
 * Slice 2, item 8). Only a generated scheme's stylesheet (#20) is a style
 * load: no other grant path admits one.
 */
const GRANT_DESTINATIONS: Readonly<Record<NonNullable<RouteEntry['grant']>, ReadonlySet<string>>> =
  {
    document: new Set(['iframe']),
    asset: new Set(['image', 'video', 'audio', 'track', 'font']),
    style: new Set(['style']),
  };

interface Gate {
  readonly pathname: string;
  readonly requestId: string;
  readonly extra: Record<string, string>;
  readonly csp?: string;
}

/**
 * A request under the preview prefixes, under a profile with grant routes:
 * on to Next when the grant route admits it, or the status document. A
 * preview route that isn't a grant's gets null, and is answered as any
 * route is.
 */
async function previewGate(
  request: NextRequest,
  decision: RouteDecision,
  { pathname, requestId, extra, csp }: Gate,
): Promise<NextResponse | null> {
  const entry = decision.status === 'served' ? decision.entry : undefined;
  if (entry && entry.grant === undefined) return null;
  if (!entry || !(await admits(request, entry, pathname))) return statusDocument(requestId, extra);
  const headers = forwarded(request, requestId, { csp, preview: true });
  headers.set(ROUTE_HEADER, decision.status);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('x-request-id', requestId);
  for (const [name, value] of Object.entries(extra)) response.headers.set(name, value);
  return response;
}

/**
 * Whether a grant route takes the request: a GET or HEAD, spelled as Next
 * routes it there, from the destination the route serves, for a grant the
 * owner composition finds active now. The check reads the grant and the
 * session it's bound to by digest, never a cookie, and never throws.
 */
async function admits(request: NextRequest, entry: RouteEntry, pathname: string): Promise<boolean> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  if (!entry.grant || encodesFixedSegment(entry.pattern, pathname)) return false;
  const destination = request.headers.get('sec-fetch-dest');
  if (destination === null || !GRANT_DESTINATIONS[entry.grant].has(destination)) return false;
  const grant = grantSegment(pathname);
  const previews = getDeploymentState()?.previews;
  if (grant === null || !previews) return false;
  // The port never throws; if it ever did, nothing is admitted.
  return previews.admit(grant).catch(() => false);
}

/** The grant a grant path names: its second segment, decoded as the route table reads it. */
function grantSegment(pathname: string): string | null {
  const segment = pathname.split('/').filter((part) => part !== '')[1];
  if (segment === undefined) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The status document (#7, Slice 2, item 8), under the preview's headers in `extra`. */
function statusDocument(requestId: string, extra: Record<string, string>): NextResponse {
  return new NextResponse(PREVIEW_STATUS_DOCUMENT, {
    status: PREVIEW_STATUS,
    headers: { 'content-type': PREVIEW_STATUS_TYPE, 'x-request-id': requestId, ...extra },
  });
}

/**
 * The path as the request sent it, before anything normalizes it, for the
 * trailing slash. Next answers a repeated slash or a backslash with its own
 * 308 before anything here runs.
 */
function sentPath(request: NextRequest): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return request.nextUrl.pathname;
  }
}

/**
 * The 308 to the path without its trailing slash, with the query, as Next
 * sent before next.config.ts turned its own off. Next writes the Location
 * on the request's own host as a path, and makes the body that path.
 */
function trailingSlash(
  request: NextRequest,
  sent: string,
  requestId: string,
  extra: Record<string, string>,
): NextResponse {
  const response = NextResponse.redirect(
    new URL(`${sent.slice(0, -1)}${request.nextUrl.search}`, request.url),
    308,
  );
  response.headers.set('x-request-id', requestId);
  for (const [name, value] of Object.entries(extra)) response.headers.set(name, value);
  return response;
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

/**
 * Whether `pathname` is a file Next serves under those prefixes, as it
 * spells them: a build asset under /_next/static/, or exactly a path the
 * registry wrote under public/_portfolio/ (#7), such as one of #19's
 * compiled packs. Any other spelling there, encoded, in another case, with
 * a trailing slash, or of a file the registry never wrote, is not one.
 */
function sharedFile(pathname: string): boolean {
  return (
    (pathname.startsWith('/_next/static/') && !pathname.endsWith('/')) ||
    PORTFOLIO_FILES.has(pathname)
  );
}

/** Whether `pathname`, decoded, is under one of the prefixes SHARED_ASSETS names, in any case. */
function sharedAsset(pathname: string): boolean {
  return SHARED_ASSETS.test(decodedPath(pathname));
}

/** The paths a request to a host the deployment doesn't name still reaches: the health checks. */
const HEALTH_PATHS: ReadonlySet<string> = new Set(['/api/health', READY_PATH]);

/**
 * Which host the request came to (#7, Slice 4), as its Host header
 * names it: the deployment's own, the preview origin's, or another. Without
 * a preview origin every host is the deployment's, as before. With one, it
 * fails closed: a host that's neither, such as one a proxy rewrote, is
 * another. That header decides this alone: nothing else here reads it.
 */
function hostOf(
  request: NextRequest,
  origin: string,
  previewOrigin: string | undefined,
): 'site' | 'preview' | 'other' {
  if (previewOrigin === undefined) return 'site';
  const host = request.headers.get('host');
  if (!host) return 'other';
  const names = (target: string) => {
    const url = new URL(target);
    try {
      return new URL(`${url.protocol}//${host}`).host === url.host;
    } catch {
      return false;
    }
  };
  if (names(previewOrigin)) return 'preview';
  return names(origin) ? 'site' : 'other';
}

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
 * marks only proxy.ts may set, the experience segment among them, and `csp`,
 * where a Studio or preview response sends one, so Next reads its nonce. A
 * policy the client sent never goes on (#7): Next would put its nonce on
 * every script, and a page's own read of the request's policy would take it
 * for this one. A preview's request goes on without its Cookie header (#7,
 * Slice 1, item 4), so no preview route can read the session cookie or a
 * visitor's preference.
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
  headers.delete(EXPERIENCE_HEADER);
  headers.delete(CONTENT_HEADER);
  headers.delete('content-security-policy');
  headers.delete('content-security-policy-report-only');
  if (csp) headers.set('content-security-policy', csp);
  if (preview) headers.delete('cookie');
  return headers;
}

/**
 * A path the route table lists, answered as a path it doesn't list is:
 * Next's 404 page, through next.config.ts's rewrite, with the headers any
 * path gets. That's a Studio page under a profile with none, a route no
 * profile of this build serves, a route spelled with a fixed segment
 * percent-encoded, or a missing path that is a route file's own. `csp`, for
 * a Studio path under owner or a preview path, goes on the request too, for
 * the nonce on the page's scripts.
 */
function unknownPath(
  request: NextRequest,
  requestId: string,
  extra: Record<string, string>,
  options: {
    readonly csp?: string;
    readonly preview?: boolean;
    /** Keep next.config.ts's Studio no-store in place of the unknown path's caching. */
    readonly studioCaching?: boolean;
  },
): NextResponse {
  const headers = forwarded(request, requestId, options);
  headers.set(NOT_FOUND_HEADER, '1');
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('x-request-id', requestId);
  if (!options.studioCaching) response.headers.set('cache-control', UNKNOWN_PATH_CACHE_CONTROL);
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
/** The static 503's page, in the fallback packs' boundary (server/unavailable-page.ts), under the response's own policy in `extra`. */
const UNAVAILABLE_PAGE = unavailablePage();

function unavailable(requestId: string, extra: Record<string, string>): NextResponse {
  return new NextResponse(UNAVAILABLE_PAGE, {
    status: 503,
    headers: {
      ...extra,
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
