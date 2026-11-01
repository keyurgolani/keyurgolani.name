// What a variant may credit of the page's appearance (contract 2.1,
// input.appearance): the resolved color scheme, design language, and
// typography, each as its id and display name. The host and Studio's local
// frame both build it here, from one resolution and one registry, so the
// input is the same on the server and in the visitor's browser.

import type { RenderAppearance } from '@portfolio/variant-contract';
import { findPack, type AppearanceRegistry } from './registry';
import type { ResolvedAppearance } from './resolve';

/**
 * The packs `appearance` renders, by id and name: what renders, never what
 * was asked for, so an axis that fell back credits its fallback. A pack the
 * registry doesn't hold, which resolution never selects, is named by its id.
 */
export function appearanceCredits(
  registry: AppearanceRegistry,
  appearance: ResolvedAppearance,
): RenderAppearance {
  const { colorScheme, designLanguage, typography } = appearance.selection;
  return {
    scheme: {
      id: colorScheme,
      name: findPack(registry, 'colorScheme', colorScheme)?.manifest.name ?? colorScheme,
    },
    language: {
      id: designLanguage,
      name: findPack(registry, 'designLanguage', designLanguage)?.manifest.name ?? designLanguage,
    },
    typography: {
      id: typography,
      name: findPack(registry, 'typography', typography)?.manifest.name ?? typography,
    },
  };
}
