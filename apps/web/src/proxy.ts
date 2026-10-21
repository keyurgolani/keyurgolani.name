import { NextResponse, type NextRequest } from 'next/server';
import { INDEXABLE } from './server/capabilities';
import { getDeploymentConfig, isServable } from './server/config-store';
import { READY_PATH, STARTING, STARTING_HEADERS } from './server/ready-starting';
import { resolveRoute } from './server/routes';

// Defense in depth (#1, item 15). Each route checks its profile itself; this
// answers 404 before Next routes a request for a path the route table lists
// and the profile doesn't serve, and gives every request a fresh
// x-request-id, whatever the client sent. Under a profile crawlers may not
// index (demo, #1 item 17), every response says so, which is why there is no
// matcher: build assets and optimized images go through here too. It decides
// from the route table and the capability matrix only, never from a route's
// name, and reads the frozen config register() stored. While the catalog
// can't serve (#5, Slice 3), a visitor page gets a static 503 page, since a
// page can't set that status itself.
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
  const robots: Record<string, string> = INDEXABLE[deployment.profile]
    ? {}
    : { 'x-robots-tag': 'noindex' };
  const route = resolveRoute(deployment.profile, request.nextUrl.pathname);
  if (route.status === 'absent') {
    return plain(404, 'Not found.', requestId, robots);
  }
  if (route.status === 'served' && route.entry.visitor && !isServable()) {
    return unavailable(requestId);
  }
  const headers = new Headers(request.headers);
  headers.set('x-request-id', requestId);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('x-request-id', requestId);
  for (const [name, value] of Object.entries(robots)) response.headers.set(name, value);
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
