import { appearanceHealth } from '~/server/appearance-health';
import { getDeploymentState } from '~/server/config-store';
import { loadedOwnerModules } from '~/server/load-trace';
import { readiness } from '~/server/readiness';
import { served } from '~/server/route-guard';
import { variantHealth } from '~/server/variant-health';

export const dynamic = 'force-dynamic';

// Readiness (#1, item 19): 200 with `ready` or `degraded`, 503 when a check
// fails, and never a path, a value, or content.
export const GET = served('/api/ready', async () => {
  const { httpStatus, body } = await readiness(getDeploymentState(), {
    // The variant that renders loads on the first readiness check.
    variantHealth,
    appearanceHealth,
    loadedOwnerModules,
  });
  return Response.json(body, { status: httpStatus, headers: { 'cache-control': 'no-store' } });
});
