import type { VariantManifest } from '@portfolio/kit';
import type { AppearanceCatalog } from '@portfolio/schema';

// The interim appearance catalog (#4, item 14), built from the registered
// variants' manifests until #19's appearance registries replace it. Startup
// passes it to validatePublicationUnit() once the host loads site.yml.

/** The display modes the baseline variants' theme toggles offer. */
const DISPLAY_MODES: readonly string[] = ['system', 'light', 'dark'];

/**
 * Variant ids are the registered slugs; color scheme and typography ids are
 * the selected variant's, or unchecked when it declares none. Display modes
 * are system, light, and dark. Design languages and generator-backed color
 * schemes have no registry yet, so neither is checked.
 */
export function createAppearanceCatalog(manifests: readonly VariantManifest[]): AppearanceCatalog {
  const bySlug = new Map(manifests.map((manifest) => [manifest.slug, manifest]));
  const ids = (list: readonly { readonly id: string }[] | undefined) =>
    list && list.length > 0 ? list.map(({ id }) => id) : null;
  return {
    ids(axis, selection) {
      switch (axis) {
        case 'variant':
          return manifests.map(({ slug }) => slug);
        case 'colorScheme':
          return ids(bySlug.get(selection.variant)?.colorSchemes);
        case 'typography':
          return ids(bySlug.get(selection.variant)?.typographyPresets);
        case 'displayMode':
          return DISPLAY_MODES;
        case 'designLanguage':
          return null;
      }
    },
    generatorInput: () => undefined,
  };
}
