import { HOST_SITE } from '~/server/host-defaults';
import { getPublicView } from '~/server/public-view';
import type { VariantSelection } from '~/server/variant-selection';
import { loadVariantModule } from './registry';
import { variantTree } from './variant-tree';

/**
 * The public view of the live portfolio in a registered variant, as `/` and
 * `/sample` render it, inside that variant's theme provider.
 */
export async function renderVariant(selection: VariantSelection) {
  const { portfolio } = await getPublicView();
  // Pages pass only registered variants, so this fails only when the build
  // itself is broken. app/error.tsx renders the failure.
  const mod = await loadVariantModule(selection.variant);
  if (!mod) throw new Error('The selected variant is not registered in this build.');
  // The host's display mode is one the kit's provider knows; a site's may not
  // be until #19 maps the appearance axes.
  return variantTree(mod, portfolio, selection, HOST_SITE.appearance.displayMode);
}
