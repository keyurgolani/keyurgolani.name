// The five appearance values (#19): four independent axes plus the display
// mode, which resolves within the selected color scheme and isn't an axis of
// its own. Every list here is in axis order, the order the resolver applies
// visitor values in.

import {
  DisplayModeSchema,
  type AppearanceAxis,
  type AppearanceSelection,
  type DisplayMode,
  type VisitorControls,
} from '@portfolio/schema';

export const APPEARANCE_AXES = [
  'variant',
  'designLanguage',
  'colorScheme',
  'typography',
  'displayMode',
] as const satisfies readonly AppearanceAxis[];

/** The axes appearance packs fill, one pack kind each. */
export const PACK_AXES = ['designLanguage', 'colorScheme', 'typography'] as const;
export type PackAxis = (typeof PACK_AXES)[number];

/** The id axes: the variant and the three pack axes. */
export const ID_AXES = ['variant', ...PACK_AXES] as const;
export type IdAxis = (typeof ID_AXES)[number];

/** The `portfolio.kind` a pack package declares, by axis. */
export const PACK_KINDS = {
  designLanguage: 'design-language',
  colorScheme: 'color-scheme',
  typography: 'typography',
} as const satisfies Record<PackAxis, string>;
export type PackKind = (typeof PACK_KINDS)[PackAxis];

/** system, light, dark, and high-contrast, as the site document allows them. */
export const DISPLAY_MODES: readonly DisplayMode[] = DisplayModeSchema.options;

/** The two base modes a color scheme's token sets come in. */
export type BaseMode = 'light' | 'dark';

/**
 * What a deployment shows when its site document names nothing else, and
 * each pack axis's fallback: an unregistered pack renders the first-party
 * pack on its axis. `editorial-evidence` registers with #13; until then the
 * variant axis falls back to #5's fallback composition like any other
 * unregistered variant.
 */
export const PLATFORM_DEFAULTS = Object.freeze({
  variant: 'editorial-evidence',
  designLanguage: 'platform-neutral',
  colorScheme: 'warm-parchment',
  typography: 'humanist-ui',
  displayMode: 'system',
} as const satisfies AppearanceSelection);

/**
 * Visitors may pick the color scheme and the display mode for themselves;
 * the owner's variant, design language, and typography stay as published.
 */
export const DEFAULT_VISITOR_CONTROLS = Object.freeze({
  variant: 'locked',
  designLanguage: 'locked',
  colorScheme: 'selectable',
  typography: 'locked',
  displayMode: 'selectable',
} as const satisfies VisitorControls);

/**
 * The query keys of the demo profile's URL and of the preference cookie, the
 * reviewed prototype's. /sample already reads `variant`.
 */
export const QUERY_KEYS = Object.freeze({
  variant: 'variant',
  designLanguage: 'language',
  colorScheme: 'scheme',
  typography: 'type',
  displayMode: 'mode',
} as const satisfies Record<AppearanceAxis, string>);

/** Each axis as messages name it. */
export const AXIS_NAMES: Readonly<Record<AppearanceAxis, string>> = {
  variant: 'variant',
  designLanguage: 'design language',
  colorScheme: 'color scheme',
  typography: 'typography profile',
  displayMode: 'display mode',
};

export function isPackAxis(axis: AppearanceAxis): axis is PackAxis {
  return (PACK_AXES as readonly string[]).includes(axis);
}

export function isDisplayMode(value: unknown): value is DisplayMode {
  return typeof value === 'string' && (DISPLAY_MODES as readonly string[]).includes(value);
}
