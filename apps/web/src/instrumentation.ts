import type { Instrumentation } from 'next';

// Next.js calls register() once per server process, before it handles a
// request. It validates the deployment configuration and the mounted
// portfolio, and on any fatal finding logs it and exits 1. startOrExit never
// rejects and imports nothing, so a refusal or an error can't leave the
// server running to answer requests with a 500.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // next build loads this file to collect page data; nothing is served then,
  // and the build runs with no deployment configuration.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { startOrExit } = await import('./server/start-or-exit');
  await startOrExit(async () => (await import('./server/register')).registerDeployment());
}

/**
 * Logs each error Next catches while handling a request (#1, item 21): its
 * digest, the request ID proxy.ts set, and the route pattern, from Next's
 * route path (`/sample/page` is `/sample`). Never the error, the URL, or
 * another header, which can carry a path or a secret.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const [{ log }, { patternOfRoutePath }] = await Promise.all([
    import('./server/log'),
    import('./server/routes'),
  ]);
  const digest =
    typeof error === 'object' && error !== null && 'digest' in error ? error.digest : undefined;
  const requestId = request.headers['x-request-id'];
  log({
    level: 'error',
    event: 'request.error',
    digest: typeof digest === 'string' ? digest : undefined,
    requestId: typeof requestId === 'string' ? requestId : undefined,
    route: patternOfRoutePath(context.routePath),
  });
};
