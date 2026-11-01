import { frameSandbox } from '~/lib/preview-frame';
import { getDeploymentState, requireDeploymentConfig } from '~/server/config-store';
import { demoStudioSetup } from '~/server/demo-studio';
import { servedPage } from '~/server/page-guard';
import { previewAppearanceOptions } from '~/server/preview-options';
import { signInLocation } from '~/server/return-to';
import { appearanceCatalog } from '~/server/studio-appearance';
import { studioPolicy } from '~/server/studio-policy';
import { requireDemoPage, requireOwnerPage } from '~/server/studio-guard';
import { StudioEntry } from '../_components/studio-entry';

// /studio (#8, Slice 1; #9): the Owner Studio shell under owner, and Demo
// Studio under demo. Under owner, with a session: requireOwnerPage sends a
// request without one to sign-in before anything renders, so neither the
// shell nor the local journal it reads renders before authentication. The
// shell gets the page's CSRF token, for its commands, and what the
// deployment's CapabilityPolicy grants this session, which picks its tasks
// and its backend. Under demo, with no session: requireDemoPage lets
// sandbox.view through, and Demo Studio gets the build's appearance catalog
// and the bundled sample, and keeps everything else in the visitor's
// browser. StudioEntry renders the profile's shell, each through a client
// import() of its own, so each profile's /studio loads its own shell's
// chunks and none of the other's.

export const metadata = { title: 'Portfolio Studio' };

async function Studio() {
  const owner =
    requireDeploymentConfig().profile === 'demo'
      ? requireDemoPage('sandbox.view')
      : await requireOwnerPage('studio.view');
  if (!owner) {
    return (
      <StudioEntry
        profile="demo"
        policy={studioPolicy('demo', null)}
        setup={await demoStudioSetup()}
      />
    );
  }
  const { authorized, csrfToken } = owner;
  const state = getDeploymentState();
  const policy = studioPolicy(state?.config.profile ?? 'owner', authorized.session);
  const config = requireDeploymentConfig();
  const previewOrigin = config.previewOrigin ?? null;
  // The Appearance workspace's preview, as /studio/preview decides it: only for a session that may preview.
  const preview = policy.allowed.includes('preview.grant')
    ? {
        sandbox: frameSandbox(config.profile, previewOrigin, true),
        previewOrigin,
        appearanceOptions: previewAppearanceOptions(),
        signIn: signInLocation('session_ended', '/studio#appearance'),
      }
    : null;
  return (
    <StudioEntry
      profile="owner"
      csrfToken={csrfToken}
      policy={policy}
      appearance={appearanceCatalog()}
      preview={preview}
    />
  );
}

export default servedPage('/studio', Studio);
