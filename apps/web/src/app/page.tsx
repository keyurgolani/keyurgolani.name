import { loadPortfolio } from '~/lib/portfolio';
import { findManifest, loadVariantModule, defaultManifest } from '~/lib/registry';
import { ErrorPage } from '~/components/error-page';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let loaded;
  try {
    loaded = await loadPortfolio();
  } catch (error) {
    return (
      <ErrorPage
        title="Portfolio could not be loaded"
        message={error instanceof Error ? error.message : String(error)}
      />
    );
  }

  const { portfolio } = loaded;
  const manifest = findManifest(portfolio.variant) ?? defaultManifest();
  const mod = await loadVariantModule(manifest.slug);

  if (!mod) {
    return (
      <ErrorPage
        title={`Variant "${manifest.slug}" failed to load`}
        message="The selected variant module could not be resolved. Try picking another variant at /variants."
      />
    );
  }

  const Component = mod.default;
  return (
    <Component
      portfolio={portfolio}
      colorScheme={portfolio.colorScheme}
      typography={portfolio.typography}
    />
  );
}
