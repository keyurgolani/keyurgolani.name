import { getDeploymentState } from '~/server/config-store';
import { served } from '~/server/route-guard';

export const dynamic = 'force-dynamic';

// The Studio transport (#1, item 11): the only route that runs operations.
// Every method reaches the dispatcher, so even a method no operation takes
// gets the error envelope and `Cache-Control: no-store`.
async function dispatch(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  // served() read the config, so register() has stored the state.
  const state = getDeploymentState()!;
  return state.dispatch(request, (await params).name);
}

export const GET = served('/api/studio/[name]', dispatch);
export const HEAD = served('/api/studio/[name]', dispatch);
export const POST = served('/api/studio/[name]', dispatch);
export const PUT = served('/api/studio/[name]', dispatch);
export const PATCH = served('/api/studio/[name]', dispatch);
export const DELETE = served('/api/studio/[name]', dispatch);
export const OPTIONS = served('/api/studio/[name]', dispatch);
