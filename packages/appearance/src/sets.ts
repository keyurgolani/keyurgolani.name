// Every color set a scheme renders (#19, Slice 2, items 1 and 2), which the
// compiler writes and the gate checks, so the two can't disagree: the base
// sets, and a high-contrast set per polarity, authored or high-contrast-v1's.

import type { BaseMode } from './axes';
import { highContrastV1 } from './derive';
import type { ColorTokens } from './tokens';

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
 * authored one or high-contrast-v1's. A dark-only scheme also gets a light
 * high-contrast set, which print uses, since print is always light.
 */
export function schemeSets(
  base: { readonly light?: ColorTokens; readonly dark?: ColorTokens },
  authored: { readonly light?: ColorTokens; readonly dark?: ColorTokens } = {},
): SchemeSets {
  if (!base.light && !base.dark)
    throw new TypeError('A scheme renders from at least one base set.');
  const sets: { -readonly [N in ColorSetName]?: ColorTokens } = {};
  if (base.light) sets.light = base.light;
  if (base.dark) sets.dark = base.dark;
  sets['high-contrast-light'] = authored.light ?? highContrastV1(base, 'light');
  if (base.dark) sets['high-contrast-dark'] = authored.dark ?? highContrastV1(base, 'dark');
  return sets;
}

/** The set print renders: the light one, or the light high-contrast one for a scheme without it. */
export function printSet(sets: SchemeSets, highContrast: boolean): ColorSetName {
  return highContrast || !sets.light ? 'high-contrast-light' : 'light';
}
