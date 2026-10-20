// Next.js calls register() once per server process, before it handles a
// request. It validates the deployment configuration and the mounted
// portfolio, and exits the process on any fatal finding.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // next build loads this file to collect page data; nothing is served then,
  // and the build runs with no deployment configuration.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { registerDeployment } = await import('./server/register');
  registerDeployment();
}
