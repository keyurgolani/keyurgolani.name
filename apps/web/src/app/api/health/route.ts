import { requireDeploymentConfig } from '~/server/config-store';
import { served } from '~/server/route-guard';

export const dynamic = 'force-dynamic';

// Liveness (#1, item 19): the process answers. No I/O, so it never fails
// while the server runs; readiness is /api/ready.
export const GET = served('/api/health', () =>
  Response.json(
    { status: 'ok', profile: requireDeploymentConfig().profile },
    { headers: { 'cache-control': 'no-store' } },
  ),
);
