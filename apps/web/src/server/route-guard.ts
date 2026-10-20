import 'server-only';
import { getDeploymentConfig } from './config-store';
import { READY_PATH, STARTING, STARTING_HEADERS } from './ready-starting';
import { serves, type RoutePattern } from './routes';

// The guard every route handler method goes through (#1, item 13). This,
// not proxy.ts, is the authority. Pages and metadata routes use
// servedPage() from page-guard.ts.

const SERVED = Symbol.for('keyurgolani.portfolio.served-route');

/**
 * A route handler method that answers 404 unless the deployment's profile
 * serves `pattern`, and 503 before register() has stored the deployment, as
 * proxy.ts does: readiness's own `starting` body for /api/ready, plain text
 * for everything else. Every method a route file exports is
 * `export const GET = served('<its pattern>', handler)`, and routes.test.ts
 * fails on any other form.
 */
export function served<Rest extends unknown[]>(
  pattern: RoutePattern,
  handler: (request: Request, ...rest: Rest) => Response | Promise<Response>,
): (request: Request, ...rest: Rest) => Promise<Response> {
  const guarded = async (request: Request, ...rest: Rest): Promise<Response> => {
    const deployment = getDeploymentConfig();
    if (!deployment) {
      return pattern === READY_PATH
        ? Response.json(STARTING, { status: 503, headers: STARTING_HEADERS })
        : plain(503, 'Service unavailable.');
    }
    return serves(deployment.profile, pattern)
      ? handler(request, ...rest)
      : plain(404, 'Not found.');
  };
  return Object.assign(guarded, { [SERVED]: pattern });
}

/** The pattern served() or servedPage() wrapped `value` with, or undefined. */
export function servedPattern(value: unknown): string | undefined {
  if (typeof value !== 'function') return undefined;
  return (value as { [SERVED]?: string })[SERVED];
}

function plain(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
