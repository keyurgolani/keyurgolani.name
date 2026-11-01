import { appearancePreference } from '~/server/appearance-preference';
import { requireDeploymentConfig } from '~/server/config-store';
import { served } from '~/server/route-guard';

export const dynamic = 'force-dynamic';

// The visitor's appearance preference (#19, Slice 4), under owner and
// read-only: server/appearance-preference.ts. POST alone; proxy.ts answers
// any other method with a 405, as the route table lists it.
export const POST = served('/api/appearance', (request) =>
  appearancePreference(request, { origin: requireDeploymentConfig().origin }),
);
