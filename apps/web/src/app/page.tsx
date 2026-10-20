import { loadVariantModule } from '~/lib/registry';
import { getLive } from '~/server/catalog';
import { HOST_APPEARANCE } from '~/server/host-defaults';
import { servedPage } from '~/server/page-guard';

export const dynamic = 'force-dynamic';

export default servedPage('/', async function HomePage() {
  const { portfolio } = (await getLive()).unit;
  // The host's variant is fixed until the site document loads, so this only
  // fails when the build itself is broken. app/error.tsx renders the failure.
  const mod = await loadVariantModule(HOST_APPEARANCE.variant);
  if (!mod) throw new Error('The selected variant is not registered in this build.');

  // No scheme or typeset: the variant renders its own defaults.
  const Component = mod.default;
  return <Component portfolio={portfolio} />;
});
