import {
  createAppearanceRegistry,
  registryStylesheets,
  type AppearanceRegistry,
  type AppearanceStylesheets,
} from '@portfolio/appearance';
import { EXCLUDED_PACKS } from './generated/excluded-packs';
import { PACKS, PLATFORM_STYLESHEET, VARIANTS } from './generated/registry.meta';

// The appearance registries this build has (#19, Slice 4): every variant,
// and every design language, color scheme, and typography pack registry
// generation registered, with their compiled stylesheets, and the packs it
// left out with their reasons (#20), so selecting one falls back and says
// why. Startup and `pnpm config:validate` check a site's appearance against
// it, and every document boundary resolves against it. The metadata module
// is server-only, so this module is too.

/** What this build registers on every appearance axis. */
export const APPEARANCE_REGISTRY: AppearanceRegistry = createAppearanceRegistry({
  VARIANTS,
  PACKS,
  PLATFORM_STYLESHEET,
  EXCLUDED_PACKS,
});

/** Where the platform's and each pack's compiled stylesheet is served. */
export const APPEARANCE_STYLESHEETS: AppearanceStylesheets =
  registryStylesheets(APPEARANCE_REGISTRY);
