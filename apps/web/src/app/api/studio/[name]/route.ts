import { getDeploymentState } from '~/server/config-store';
import { notServed } from '~/server/route-guard';

export const dynamic = 'force-dynamic';

// The Studio transport (#1, item 11): the only route that runs operations.
// Every method reaches the dispatcher, so even a method no operation takes
// gets the error envelope and `Cache-Control: no-store`.
async function handle(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const absent = notServed('/api/studio/[name]');
  if (absent) return absent;
  // notServed() read the config, so register() has stored the state.
  const state = getDeploymentState()!;
  return state.dispatch(request, (await params).name);
}

export {
  handle as GET,
  handle as HEAD,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
  handle as OPTIONS,
};
