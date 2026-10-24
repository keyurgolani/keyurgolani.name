import { getDeploymentState } from '~/server/config-store';
import { servedPage } from '~/server/page-guard';
import { studioPolicy } from '~/server/studio-policy';
import { requireOwnerPage } from '~/server/studio-guard';
import { StudioShell } from '../_components/shell/studio-shell';

// /studio (#8, Slice 1): the Owner Studio shell. Under owner only, with a
// session: requireOwnerPage sends a request without one to sign-in before
// anything renders, so neither the shell nor the local journal it reads
// renders before authentication. The shell gets the page's CSRF token, for
// its commands, and what the deployment's CapabilityPolicy grants this
// session, which picks its tasks and its backend.

export const metadata = { title: 'Portfolio Studio' };

async function Studio() {
  const { authorized, csrfToken } = await requireOwnerPage('studio.view');
  const state = getDeploymentState();
  const policy = studioPolicy(state?.config.profile ?? 'owner', authorized.session);
  return <StudioShell csrfToken={csrfToken} policy={policy} />;
}

export default servedPage('/studio', Studio);
