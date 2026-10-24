// Every color set a scheme renders (#19, Slice 2, items 1 and 2), which the
// compiler writes and the gate checks, so the two can't disagree: the base
// sets, and a high-contrast set per polarity, authored or derived: by
// high-contrast-v2 for an anchor-v2 scheme (#20 PR 2c), else by
// high-contrast-v1.

import type { BaseMode } from './axes';
import { anchorV2, highContrastV2 } from './anchor-v2';
import { anchorV1, highContrastV1, type Anchors } from './derive';
import type { ColorTokens } from './roles';

/** How a scheme's anchors become its sets: #19's anchor-v1, or anchor-v2 (#20 PR 2c). */
export type SchemeDerivation = 'anchor-v1' | 'anchor-v2';
export const SCHEME_DERIVATIONS: readonly SchemeDerivation[] = ['anchor-v1', 'anchor-v2'];

/** One base set from its anchors, by the scheme's derivation. */
export function deriveBaseSet(
  derivation: SchemeDerivation,
  anchors: Anchors,
  mode: BaseMode,
): ColorTokens {
  return derivation === 'anchor-v2' ? anchorV2(anchors, mode) : anchorV1(anchors, mode);
}

/**
 * The high-contrast set of `polarity` a scheme derives: high-contrast-v2's
 * for an anchor-v2 scheme, else high-contrast-v1's, which authored and
 * generated sets get too.
 */
export function deriveHighContrastSet(
  base: { readonly light?: ColorTokens; readonly dark?: ColorTokens },
  polarity: BaseMode,
  derivation?: SchemeDerivation,
): ColorTokens {
  return derivation === 'anchor-v2'
    ? highContrastV2(base, polarity)
    : highContrastV1(base, polarity);
}

/** A rendered set's name: a base mode, or the high-contrast set of one polarity. */
export type ColorSetName = 'light' | 'dark' | 'high-contrast-light' | 'high-contrast-dark';

export const COLOR_SET_NAMES: readonly ColorSetName[] = [
  'light',
  'dark',
  'high-contrast-light',
  'high-contrast-dark',
];

export type SchemeSets = { readonly [N in ColorSetName]?: ColorTokens };

/** Whether the set is a high-contrast one, which the gate holds to 7:1 and 4.5:1. */
export function isHighContrastSet(name: ColorSetName): boolean {
  return name === 'high-contrast-light' || name === 'high-contrast-dark';
}

/** The polarity a set paints: light or dark. */
export function setPolarity(name: ColorSetName): BaseMode {
  return name === 'light' || name === 'high-contrast-light' ? 'light' : 'dark';
}

/**
 * The sets a scheme renders. A base mode brings its high-contrast set, the
 * authored one or the one its derivation derives. A dark-only scheme also
 * gets a light high-contrast set, which print uses, since print is always
 * light.
 */
export function schemeSets(
  base: { readonly light?: ColorTokens; readonly dark?: ColorTokens },
  authored: { readonly light?: ColorTokens; readonly dark?: ColorTokens } = {},
  derivation?: SchemeDerivation,
): SchemeSets {
  if (!base.light && !base.dark)
    throw new TypeError('A scheme renders from at least one base set.');
  const sets: { -readonly [N in ColorSetName]?: ColorTokens } = {};
  if (base.light) sets.light = base.light;
  if (base.dark) sets.dark = base.dark;
  sets['high-contrast-light'] = authored.light ?? deriveHighContrastSet(base, 'light', derivation);
  if (base.dark)
    sets['high-contrast-dark'] = authored.dark ?? deriveHighContrastSet(base, 'dark', derivation);
  return sets;
}

/** The set print renders: the light one, or the light high-contrast one for a scheme without it. */
export function printSet(sets: SchemeSets, highContrast: boolean): ColorSetName {
  return highContrast || !sets.light ? 'high-contrast-light' : 'light';
}
