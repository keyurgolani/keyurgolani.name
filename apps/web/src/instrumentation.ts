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
