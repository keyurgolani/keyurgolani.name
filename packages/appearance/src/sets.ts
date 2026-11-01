// Every color set a scheme renders (#19, Slice 2, items 1 and 2), which the
// compiler writes and the gate checks, so the two can't disagree: the base
// sets, and a high-contrast set per polarity, authored or derived: by
// high-contrast-v2 for an anchor-v2 scheme (#20 PR 2c), else by
// high-contrast-v1.

import type { BaseMode } from './axes';
import { anchorV2, categoricalFor, highContrastV2, type AnchorsV2 } from './anchor-v2';
import { withDerivedRoles, type DerivedRole, type CoreColorTokens } from './derived-roles';
import { anchorV1, highContrastV1, type Anchors } from './derive';
import { GENERATOR_V1_FOCUS_TARGETS } from './solve';
import type { ColorTokens } from './roles';

/** How a scheme's anchors become its sets: #19's anchor-v1, or anchor-v2 (#20 PR 2c). */
export type SchemeDerivation = 'anchor-v1' | 'anchor-v2';
export const SCHEME_DERIVATIONS: readonly SchemeDerivation[] = ['anchor-v1', 'anchor-v2'];

/** One base set from its anchors, by the scheme's derivation. */
export function deriveBaseSet(
  derivation: SchemeDerivation,
  anchors: Anchors | AnchorsV2,
  mode: BaseMode,
): ColorTokens {
  return derivation === 'anchor-v2' ? anchorV2(anchors, mode) : anchorV1(anchors, mode);
}

/** A scheme's anchors by mode, as its manifest gives them. */
export type SchemeAnchors = { readonly light?: AnchorsV2; readonly dark?: AnchorsV2 };

/**
 * The high-contrast set of `polarity` a scheme derives: high-contrast-v2's
 * for an anchor-v2 scheme, its categorical walk started from the scheme's
 * categorical anchors when it has them, else high-contrast-v1's, which
 * authored and generated sets get too.
 */
export function deriveHighContrastSet(
  base: { readonly light?: ColorTokens; readonly dark?: ColorTokens },
  polarity: BaseMode,
  derivation?: SchemeDerivation,
  anchors?: SchemeAnchors,
): ColorTokens {
  return derivation === 'anchor-v2'
    ? highContrastV2(base, polarity, undefined, categoricalFor(anchors, polarity))
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
 * A set as a manifest or a generated record may give it: every role but the
 * three K-2 added, and those if it has its own, which it may leave out.
 */
export type AuthoredTokens = CoreColorTokens & Partial<Record<DerivedRole, string>>;

/**
 * The sets a scheme renders. A base mode brings its high-contrast set, the
 * authored one or the one its derivation derives. A dark-only scheme also
 * gets a light high-contrast set, which print uses, since print is always
 * light. An authored or generated set without the roles K-2 added gets
 * them derived from its others, as a derived set does.
 */
export function schemeSets(
  base: { readonly light?: AuthoredTokens; readonly dark?: AuthoredTokens },
  authored: { readonly light?: AuthoredTokens; readonly dark?: AuthoredTokens } = {},
  derivation?: SchemeDerivation,
  anchors?: SchemeAnchors,
): SchemeSets {
  if (!base.light && !base.dark)
    throw new TypeError('A scheme renders from at least one base set.');
  const complete = {
    light: base.light && withDerivedRoles(base.light, false),
    dark: base.dark && withDerivedRoles(base.dark, false),
  };
  const sets: { -readonly [N in ColorSetName]?: ColorTokens } = {};
  if (complete.light) sets.light = complete.light;
  if (complete.dark) sets.dark = complete.dark;
  sets['high-contrast-light'] = authored.light
    ? withDerivedRoles(authored.light, true)
    : deriveHighContrastSet(complete, 'light', derivation, anchors);
  if (complete.dark)
    sets['high-contrast-dark'] = authored.dark
      ? withDerivedRoles(authored.dark, true)
      : deriveHighContrastSet(complete, 'dark', derivation, anchors);
  return sets;
}

/**
 * The sets a generator scheme renders: schemeSets() over its generated sets,
 * with the roles K-2 added worked out to GENERATOR_V1_FOCUS_TARGETS where a
 * stored record leaves them out, so a generated scheme renders the
 * focus-inverse its generator, at version 1, made (compose()), not a scheme
 * pack's. Every reader of a generated scheme's sets goes through here.
 */
export function generatedSchemeSets(tokens: {
  readonly light: AuthoredTokens;
  readonly dark: AuthoredTokens;
  readonly highContrast?: { readonly light: AuthoredTokens; readonly dark: AuthoredTokens };
}): SchemeSets {
  return schemeSets(
    {
      light: withDerivedRoles(tokens.light, false, GENERATOR_V1_FOCUS_TARGETS),
      dark: withDerivedRoles(tokens.dark, false, GENERATOR_V1_FOCUS_TARGETS),
    },
    tokens.highContrast,
  );
}

/** The set print renders: the light one, or the light high-contrast one for a scheme without it. */
export function printSet(sets: SchemeSets, highContrast: boolean): ColorSetName {
  return highContrast || !sets.light ? 'high-contrast-light' : 'light';
}
