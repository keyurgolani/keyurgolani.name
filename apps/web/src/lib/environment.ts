import type { DisplayMode, MotionPolicy } from '@portfolio/schema';

// The environment a preview renders under (#7, Slice 4, item 5): the display
// mode, contrast, motion, and enhancement it sets on the presentation
// boundary, under the names #19 keeps. The server renders a grant's with the
// frame's first paint, and the preview agent sets it again for each
// `environment` message, both through environmentAttributes(), which #19
// grows into its resolver. It imports nothing at run time, so the agent's
// chunk carries no schema. A public page renders in its visitor's own
// environment, and sets none.

/** What the published site gives a preview's environment to start from. */
export interface EnvironmentSelection {
  /** The display mode the site publishes, which an override of `system` keeps. */
  readonly displayMode: DisplayMode;
  /** The site's motion policy: under `reduce`, nothing an override says raises motion. */
  readonly motionPolicy: MotionPolicy;
}

/** A preview's environment as Studio's controls set it, a grant holds it, and `environment` sends it. */
export interface EnvironmentOverride {
  readonly displayMode?: DisplayMode;
  readonly contrast?: 'system' | 'more';
  readonly motion?: 'system' | 'reduce';
  readonly enhancement?: 'on' | 'off';
}

/** The environment's attributes on the presentation boundary. */
export interface EnvironmentAttributes {
  readonly 'data-display-mode': DisplayMode;
  readonly 'data-contrast': 'system' | 'more';
  readonly 'data-motion': 'full' | 'reduced';
  readonly 'data-enhancement': 'on' | 'off';
}

/** Every attribute environmentAttributes() sets, in its order. */
export const ENVIRONMENT_ATTRIBUTES = [
  'data-display-mode',
  'data-contrast',
  'data-motion',
  'data-enhancement',
] as const satisfies readonly (keyof EnvironmentAttributes)[];

/** What a site that publishes nothing else gives an environment: the system's own display mode and motion. */
export const DEFAULT_SELECTION: EnvironmentSelection = Object.freeze({
  displayMode: 'system',
  motionPolicy: 'respect-os',
});

/**
 * The attributes `override` puts on a boundary whose site publishes
 * `selection`. A display mode of `system` keeps the published one. Motion
 * only reduces: `reduced` when the override or the site's policy says so,
 * and `full` otherwise, which the reader's own reduced-motion setting still
 * reduces, since nothing styles against `full`.
 */
export function environmentAttributes(
  selection: EnvironmentSelection,
  override: EnvironmentOverride,
): EnvironmentAttributes {
  const displayMode =
    override.displayMode !== undefined && override.displayMode !== 'system'
      ? override.displayMode
      : selection.displayMode;
  const reduced = override.motion === 'reduce' || selection.motionPolicy === 'reduce';
  return {
    'data-display-mode': displayMode,
    'data-contrast': override.contrast ?? 'system',
    'data-motion': reduced ? 'reduced' : 'full',
    'data-enhancement': override.enhancement ?? 'on',
  };
}

/** What a view's site publishes for its environment. */
export function environmentSelection(site: {
  readonly appearance: { readonly displayMode: DisplayMode };
  readonly motionPolicy: MotionPolicy;
}): EnvironmentSelection {
  return { displayMode: site.appearance.displayMode, motionPolicy: site.motionPolicy };
}
