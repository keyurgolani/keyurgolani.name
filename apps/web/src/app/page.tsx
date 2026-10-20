import { loadVariantModule } from '~/lib/registry';
import { getLive } from '~/server/catalog';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const { portfolio } = (await getLive()).unit;
  // Startup refuses a document whose variant isn't registered, so this only
  // fails when the build itself is broken. app/error.tsx renders the failure.
  const mod = await loadVariantModule(portfolio.variant);
  if (!mod) throw new Error('The selected variant is not registered in this build.');

  const Component = mod.default;
  return (
    <Component
      portfolio={portfolio}
      colorScheme={portfolio.colorScheme}
      typography={portfolio.typography}
    />
  );
}
