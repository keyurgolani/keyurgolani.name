import { ThemeProvider, type ThemePreference, type VariantModule } from '@portfolio/kit';
import type { PublicPortfolio } from '@portfolio/schema';
import type { VariantSelection } from '~/server/variant-selection';

/**
 * A variant's page inside the theme provider its own manifest feeds. The
 * provider resolves the visitor's theme within the themes this variant
 * declares and sets `data-theme` on the document, so it wraps the variant
 * the page selects, which under /sample may not be the host's. It can't sit
 * in the root layout as well: the outer provider's effect runs last and
 * would overwrite `data-theme` with the host variant's resolution.
 */
export function variantTree(
  mod: VariantModule,
  portfolio: PublicPortfolio,
  selection: Pick<VariantSelection, 'colorScheme' | 'typography'>,
  displayMode: ThemePreference,
) {
  const Component = mod.default;
  return (
    <ThemeProvider defaultPreference={displayMode} supportedThemes={mod.manifest.themes}>
      <Component
        portfolio={portfolio}
        colorScheme={selection.colorScheme}
        typography={selection.typography}
      />
    </ThemeProvider>
  );
}
