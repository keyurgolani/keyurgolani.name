import { NextResponse, type NextRequest } from 'next/server';
import { getDeploymentConfig } from './server/config-store';
import { resolveRoute } from './server/routes';

// Defense in depth (#1, item 15). Each route checks its profile itself; this
// answers 404 before Next routes a request for a path the route table lists
// and the profile doesn't serve, and gives every request a fresh
// x-request-id, whatever the client sent. It decides from the route table
// and the capability matrix only, never from a route's name, and reads the
// frozen config register() stored.
export function proxy(request: NextRequest): NextResponse {
  const requestId = crypto.randomUUID();
  const deployment = getDeploymentConfig();
  if (!deployment) return plain(503, 'Service unavailable.', requestId);
  if (resolveRoute(deployment.profile, request.nextUrl.pathname).status === 'absent') {
    return plain(404, 'Not found.', requestId);
  }
  const headers = new Headers(request.headers);
  headers.set('x-request-id', requestId);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('x-request-id', requestId);
  return response;
}

function plain(status: number, text: string, requestId: string): NextResponse {
  return new NextResponse(text, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-request-id': requestId,
    },
  });
}

export const config = {
  // Static build assets never need a decision or a request ID.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
