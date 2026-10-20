import { renderVariant } from '~/lib/render-variant';
import { servedPage } from '~/server/page-guard';
import { getPublicView } from '~/server/public-view';
import { siteSelection } from '~/server/variant-selection';

export const dynamic = 'force-dynamic';

// The site's variant, in the color scheme and typography preset it selects.
export default servedPage('/', async function HomePage() {
  return renderVariant(siteSelection((await getPublicView()).site.appearance));
});
