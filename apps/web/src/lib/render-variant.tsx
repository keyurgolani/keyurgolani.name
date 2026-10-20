import { getPublicView } from '~/server/public-view';
import type { VariantSelection } from '~/server/variant-selection';
import { loadVariantModule } from './registry';

/** The public view of the live portfolio in a registered variant, as `/` and `/sample` render it. */
export async function renderVariant(selection: VariantSelection) {
  const { portfolio } = await getPublicView();
  // Pages pass only registered variants, so this fails only when the build
  // itself is broken. app/error.tsx renders the failure.
  const mod = await loadVariantModule(selection.variant);
  if (!mod) throw new Error('The selected variant is not registered in this build.');
  const Component = mod.default;
  return (
    <Component
      portfolio={portfolio}
      colorScheme={selection.colorScheme}
      typography={selection.typography}
    />
  );
}
