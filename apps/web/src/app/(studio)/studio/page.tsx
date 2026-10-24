import dynamic from 'next/dynamic';
import { frameSandbox } from '~/lib/preview-frame';
import { getDeploymentState, requireDeploymentConfig } from '~/server/config-store';
import { demoStudioSetup } from '~/server/demo-studio';
import { servedPage } from '~/server/page-guard';
import { previewAppearanceOptions } from '~/server/preview-options';
import { signInLocation } from '~/server/return-to';
import { appearanceCatalog } from '~/server/studio-appearance';
import { studioPolicy } from '~/server/studio-policy';
import { requireDemoPage, requireOwnerPage } from '~/server/studio-guard';

// /studio (#8, Slice 1; #9): the Owner Studio shell under owner, and Demo
// Studio under demo. Under owner, with a session: requireOwnerPage sends a
// request without one to sign-in before anything renders, so neither the
// shell nor the local journal it reads renders before authentication. The
// shell gets the page's CSRF token, for its commands, and what the
// deployment's CapabilityPolicy grants this session, which picks its tasks
// and its backend. Under demo, with no session: requireDemoPage lets
// sandbox.view through, and Demo Studio gets the build's appearance catalog
// and the bundled sample, and keeps everything else in the visitor's
// browser. Each profile's shell is its own chunk, which the other's page
// never loads.

const StudioShell = dynamic(() =>
  import('../_components/shell/studio-shell').then((module) => module.StudioShell),
);
const DemoShell = dynamic(() =>
  import('../_components/demo-shell').then((module) => module.DemoShell),
);

export const metadata = { title: 'Portfolio Studio' };

async function Studio() {
  const owner =
    requireDeploymentConfig().profile === 'demo'
      ? requireDemoPage('sandbox.view')
      : await requireOwnerPage('studio.view');
  if (!owner) {
    return <DemoShell policy={studioPolicy('demo', null)} setup={await demoStudioSetup()} />;
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
    <StudioShell
      csrfToken={csrfToken}
      policy={policy}
      appearance={appearanceCatalog()}
      preview={preview}
    />
  );
}

export default servedPage('/studio', Studio);
