import 'server-only';
import { requireDeploymentConfig } from './config-store';
import { serves, type RoutePattern } from './routes';

// The guard every route handler method goes through (#1, item 13). This,
// not proxy.ts, is the authority. Pages and metadata routes use
// servedPage() from page-guard.ts.

const SERVED = Symbol.for('keyurgolani.portfolio.served-route');

/**
 * A route handler method that answers 404 unless the deployment's profile
 * serves `pattern`. Every method a route file exports is
 * `export const GET = served('<its pattern>', handler)`, and routes.test.ts
 * fails on any other form.
 */
export function served<Rest extends unknown[]>(
  pattern: RoutePattern,
  handler: (request: Request, ...rest: Rest) => Response | Promise<Response>,
): (request: Request, ...rest: Rest) => Promise<Response> {
  const guarded = async (request: Request, ...rest: Rest): Promise<Response> =>
    serves(requireDeploymentConfig().profile, pattern) ? handler(request, ...rest) : notFound();
  return Object.assign(guarded, { [SERVED]: pattern });
}

/** The pattern served() or servedPage() wrapped `value` with, or undefined. */
export function servedPattern(value: unknown): string | undefined {
  if (typeof value !== 'function') return undefined;
  return (value as { [SERVED]?: string })[SERVED];
}

function notFound(): Response {
  return new Response('Not found.', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
