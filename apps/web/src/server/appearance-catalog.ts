import { DisplayModeSchema, type AppearanceCatalog } from '@portfolio/schema';

// The interim appearance catalog (#4, item 14, rewritten by #5, Slice 3,
// item 8) until #19's appearance registries replace it. Startup passes it to
// validatePublicationUnit() once the host loads site.yml. It names no
// variant: whether the selection is registered is the contract's
// validateSelection to say. Design languages, color schemes, typography
// presets, and generator-backed schemes have no registry yet.

/** Every display mode the site document allows: system, light, dark, and high-contrast. */
const DISPLAY_MODES: readonly string[] = DisplayModeSchema.options;

/** Display modes are checked; every other axis, and every appearance input, goes unchecked. */
export function createAppearanceCatalog(): AppearanceCatalog {
  return {
    ids: (axis) => (axis === 'displayMode' ? DISPLAY_MODES : null),
    generatorInput: () => undefined,
  };
}
