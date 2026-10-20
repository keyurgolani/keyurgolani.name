import { ThemeProvider, type ThemePreference, type VariantModule } from '@portfolio/kit';
import type { MotionPolicy, PublicPortfolio } from '@portfolio/schema';
import type { VariantSelection } from '~/server/variant-selection';

/** What the site document says about the page around the variant. */
export interface PageSettings {
  /** The visitor's starting theme: the site's display mode. */
  readonly displayMode: ThemePreference;
  readonly motionPolicy: MotionPolicy;
}

/**
 * A variant's page inside the theme provider its own manifest feeds. The
 * provider resolves the visitor's theme within the themes this variant
 * declares and sets `data-theme` on the document, so it wraps the variant
 * the page selects, which under /sample may not be the site's. It can't sit
 * in the root layout as well: the outer provider's effect runs last and
 * would overwrite `data-theme` with the site variant's resolution. The
 * variant gets the site's motion policy through VariantProps.
 */
export function variantTree(
  mod: VariantModule,
  portfolio: PublicPortfolio,
  selection: Pick<VariantSelection, 'colorScheme' | 'typography'>,
  { displayMode, motionPolicy }: PageSettings,
) {
  const Component = mod.default;
  return (
    <ThemeProvider defaultPreference={displayMode} supportedThemes={mod.manifest.themes}>
      <Component
        portfolio={portfolio}
        colorScheme={selection.colorScheme}
        typography={selection.typography}
        motionPolicy={motionPolicy}
      />
    </ThemeProvider>
  );
}
