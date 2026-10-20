import { loadVariantModule } from '~/lib/registry';
import { servedPage } from '~/server/page-guard';
import { getPublicView } from '~/server/public-view';

export const dynamic = 'force-dynamic';

export default servedPage('/', async function HomePage() {
  const { portfolio, site } = await getPublicView();
  // The host's variant is fixed until the site document loads, so this only
  // fails when the build itself is broken. app/error.tsx renders the failure.
  const mod = await loadVariantModule(site.appearance.variant);
  if (!mod) throw new Error('The selected variant is not registered in this build.');

  const Component = mod.default;
  return (
    <Component
      portfolio={portfolio}
      colorScheme={site.appearance.colorScheme}
      typography={site.appearance.typography}
    />
  );
});
