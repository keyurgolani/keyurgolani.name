import { renderVariant } from '~/lib/render-variant';
import { servedPage } from '~/server/page-guard';
import { getPublicView } from '~/server/public-view';

export const dynamic = 'force-dynamic';

// The site's variant, in the color scheme and typography preset it selects.
export default servedPage('/', async function HomePage() {
  const { appearance } = (await getPublicView()).site;
  return renderVariant({
    variant: appearance.variant,
    colorScheme: appearance.colorScheme,
    typography: appearance.typography,
  });
});
