import { getPublicView } from '~/server/public-view';
import type { VariantSelection } from '~/server/variant-selection';
import { loadVariantModule } from './registry';
import { startingTheme } from './starting-theme';
import { variantTree } from './variant-tree';

/**
 * The public view of the live portfolio in a registered variant, as `/` and
 * `/sample` render it, inside that variant's theme provider: the site's
 * display mode as the visitor's starting theme, and its motion policy.
 */
export async function renderVariant(selection: VariantSelection) {
  const { portfolio, site } = await getPublicView();
  // Startup refuses a site whose variant isn't registered, and /sample passes
  // only registered ones, so this fails only when the build itself is broken.
  // app/error.tsx renders the failure.
  const mod = await loadVariantModule(selection.variant);
  if (!mod) throw new Error('The selected variant is not registered in this build.');
  return variantTree(mod, portfolio, selection, {
    displayMode: startingTheme(site.appearance.displayMode),
    motionPolicy: site.motionPolicy,
  });
}
