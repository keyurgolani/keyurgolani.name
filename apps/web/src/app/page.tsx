import { renderComposition } from '~/lib/render-composition';
import { requireDeploymentConfig } from '~/server/config-store';
import { servedPage } from '~/server/page-guard';
import { getPublicView } from '~/server/public-view';

export const dynamic = 'force-dynamic';

// The site's variant, or the fallback composition when this build doesn't
// register it.
export default servedPage('/', async function HomePage() {
  return renderComposition({
    view: await getPublicView(),
    route: { route: 'home' },
    basePath: '',
    origin: requireDeploymentConfig().origin,
  });
});
