import { getDeploymentState } from '~/server/config-store';
import { loadedOwnerModules } from '~/server/load-trace';
import { readiness } from '~/server/readiness';
import { served } from '~/server/route-guard';

export const dynamic = 'force-dynamic';

// Readiness (#1, item 19): 200 with `ready` or `degraded`, 503 when a check
// fails, and never a path, a value, or content.
export const GET = served('/api/ready', async () => {
  const { httpStatus, body } = await readiness(getDeploymentState(), {
    // The registry loads with the variant, on the first readiness check.
    variantLoads: async (variant) =>
      (await (await import('~/lib/registry')).loadVariantModule(variant)) !== null,
    loadedOwnerModules,
  });
  return Response.json(body, { status: httpStatus, headers: { 'cache-control': 'no-store' } });
});
