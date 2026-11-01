import { requireDeploymentConfig } from '~/server/config-store';
import { localCatalog } from '~/server/local-catalog';
import { servedPage } from '~/server/page-guard';
import { requestNonce } from '~/server/request-nonce';
import { requireDemoPage } from '~/server/studio-guard';
import { LocalPreview } from '../../_local/local-preview';

export const dynamic = 'force-dynamic';

// /preview/local (#7, Slice 6; #9): Demo Studio's local preview frame, under
// demo alone, with no session. The page hands the frame what this build
// registers and the origin that may frame it, and nothing else: the
// document it renders comes from Studio over the frame's port.
export default servedPage('/preview/local', async function LocalPreviewPage() {
  requireDemoPage('sandbox.view');
  return (
    <LocalPreview
      catalog={localCatalog()}
      studioOrigin={requireDeploymentConfig().origin}
      nonce={await requestNonce()}
    />
  );
});
