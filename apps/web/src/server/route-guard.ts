import 'server-only';
import { requireDeploymentConfig } from './config-store';
import { serves, type RoutePattern } from './routes';

/**
 * Route handlers call this first with their own pattern and return what it
 * returns: a 404 unless the deployment's profile serves the route, else
 * null. This, not proxy.ts, is the authority, and routes.test.ts fails on a
 * route file that skips it. Pages use requireServed() from page-guard.ts.
 */
export function notServed(pattern: RoutePattern): Response | null {
  if (serves(requireDeploymentConfig().profile, pattern)) return null;
  return new Response('Not found.', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
