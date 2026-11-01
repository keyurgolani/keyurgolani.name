// The three roles K-2 added to token contract 1, which stays contract 1
// since they're additive: every derivation works them out from a set's other
// roles, so anchor-v1, anchor-v2, both high-contrast derivations, authored
// sets, and generated ones all have them, and no other role moves:
//
// - on-emphasis: black or white, whichever contrasts more with emphasis.
//   One of the two always reaches 4.58:1 on any color, so text on an
//   emphasis fill reads at body size whatever the hue.
// - focus-inverse: the focus color on an inverse ground, text-primary: the
//   accent, or the first 2% mix of it toward the canvas that reaches the
//   set's focus-inverse target on text-primary plus anchor-v1's 0.1
//   headroom, else the canvas, which text-primary already reads on. The
//   target is FOCUS_TARGETS' 4.5:1 for a scheme pack (lead A, 11-01, with
//   focus), 4.5:1 in a high-contrast set, and 3.5:1 for a generator at
//   version 1 (GENERATOR_V1_FOCUS_TARGETS), which stays where it shipped.
//   The gate holds the pair to FOCUS_INVERSE_TARGETS, 3.5:1 (4.5:1 in high
//   contrast): above the 3:1 non-text floor, since a ring at 3:1 on a dark
//   scheme's cream inverse ground reads soft.
// - surface-lit: a lit surface, lighter than surface-prominent, that
//   text-primary reads on at 4.95:1 (the textured text target) or better.
//   With dark text it's the lighter of canvas and surface-prominent mixed
//   halfway to white; with light text, surface-prominent mixed toward
//   text-primary by the largest of 12%, 10%, ... 2% that keeps 4.95:1 plus
//   the headroom, else the first step up that's lighter and keeps 4.95:1
//   (in OKLCH lightness, 0.002 at a time, then one channel at a time), else
//   surface-prominent, which the gate fails, as it fails any surface-lit
//   that isn't lighter. A high-contrast set's is its canvas, which the gate
//   and validation hold too.

import { contrast, lightness, luminance, mix, WHITE, withLightness } from './color';
import type { ColorRole, ColorTokens } from './roles';
import { FOCUS_TARGETS, HEADROOM, onColor, towardText, type FocusTargets } from './solve';

/** The roles K-2 added, in COLOR_ROLES order. */
export const DERIVED_ROLES = ['on-emphasis', 'focus-inverse', 'surface-lit'] as const;
export type DerivedRole = (typeof DERIVED_ROLES)[number];

/** A set without the roles K-2 added: every other role, as a set before K-2 had them. */
export type CoreColorTokens = Readonly<Omit<Record<ColorRole, string>, DerivedRole>>;

/**
 * The gate's floor for focus-inverse on text-primary, and in a high-contrast
 * set, which a high-contrast set also derives to. A base set derives to its
 * FocusTargets' focusInverse, at or above the floor.
 */
export const FOCUS_INVERSE_TARGETS = Object.freeze({ base: 3.5, highContrast: 4.5 });

/** What text-primary reads on surface-lit at: the textured text target. */
export const SURFACE_LIT_TEXT = 4.95;

function surfaceLit(set: CoreColorTokens): string {
  const text = set['text-primary'];
  const prominent = set['surface-prominent'];
  if (luminance(text) < luminance(set.canvas)) {
    const base = luminance(set.canvas) >= luminance(prominent) ? set.canvas : prominent;
    return mix(base, WHITE, 50);
  }
  const lit = (candidate: string, target: number) =>
    contrast(text, candidate) >= target && luminance(candidate) > luminance(prominent);
  // The largest 2% step that keeps the headroom.
  for (let percent = 12; percent >= 2; percent -= 2) {
    const candidate = mix(prominent, text, percent);
    if (lit(candidate, SURFACE_LIT_TEXT + HEADROOM)) return candidate;
  }
  // Else the first step up in OKLCH lightness, 0.002 at a time, about one hex step,
  // that's lighter and reaches the target itself; else none does, and the gate fails
  // the set, since surface-prominent itself isn't lit.
  const from = lightness(prominent);
  for (let step = 1; step <= 50; step += 1) {
    const candidate = withLightness(prominent, from + 0.002 * step);
    if (lit(candidate, SURFACE_LIT_TEXT)) return candidate;
    if (contrast(text, candidate) < SURFACE_LIT_TEXT) break;
  }
  // Last, the least lighter colors there are: one channel up a step or two, blue
  // first, whose luminance weight is the least, then red, then green.
  const rgb = [1, 3, 5].map((at) => Number.parseInt(prominent.slice(at, at + 2), 16));
  for (const delta of [1, 2]) {
    for (const channel of [2, 0, 1]) {
      if (rgb[channel]! + delta > 255) continue;
      const raised = rgb.map((value, at) => (at === channel ? value + delta : value));
      const candidate = `#${raised.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
      if (lit(candidate, SURFACE_LIT_TEXT)) return candidate;
    }
  }
  return prominent;
}

/**
 * `set`'s three derived roles, worked out from its other roles as the file
 * comment says: a base set's focus-inverse to `targets`, a scheme pack's
 * unless a caller names another (a generator's frozen ones).
 */
export function derivedRoles(
  set: CoreColorTokens,
  highContrast: boolean,
  targets: FocusTargets = FOCUS_TARGETS,
): Readonly<Record<DerivedRole, string>> {
  const limit = highContrast ? FOCUS_INVERSE_TARGETS.highContrast : targets.focusInverse;
  return {
    'on-emphasis': onColor(set.emphasis),
    'focus-inverse': towardText(set.accent, set.canvas, [set['text-primary']], limit, 2),
    'surface-lit': highContrast ? set.canvas : surfaceLit(set),
  };
}

/**
 * `set` with the roles K-2 added, in COLOR_ROLES order: worked out from the
 * other roles, to `targets` for a base set, unless `set` gives them
 * already, as an authored set may. A set that gives all three is returned
 * as it is, the same object.
 */
export function withDerivedRoles(
  set: CoreColorTokens & Partial<Record<DerivedRole, string>>,
  highContrast: boolean,
  targets: FocusTargets = FOCUS_TARGETS,
): ColorTokens {
  if (DERIVED_ROLES.every((role) => set[role] !== undefined)) return set as ColorTokens;
  const derived = derivedRoles(set, highContrast, targets);
  return {
    ...set,
    'on-emphasis': set['on-emphasis'] ?? derived['on-emphasis'],
    'focus-inverse': set['focus-inverse'] ?? derived['focus-inverse'],
    'surface-lit': set['surface-lit'] ?? derived['surface-lit'],
  };
}

/** `set` without the roles K-2 added, as a store keeps it: rendering works them out again. */
export function coreRoles(set: ColorTokens): CoreColorTokens {
  return Object.fromEntries(
    Object.entries(set).filter(([role]) => !(DERIVED_ROLES as readonly string[]).includes(role)),
  ) as unknown as CoreColorTokens;
}

/**
 * A generator's sets as a draft stores them: each without the roles K-2
 * added, so a scheme stored before K-2 and the same scheme generated now
 * are the same entry, and saving a draft raises no change. Rendering
 * (DerivedSchemeSchema, generatedSets) works the three out again.
 */
export function storedTokens<
  T extends {
    readonly light: ColorTokens;
    readonly dark: ColorTokens;
    readonly highContrast?: { readonly light: ColorTokens; readonly dark: ColorTokens };
  },
>(tokens: T) {
  return {
    light: coreRoles(tokens.light),
    dark: coreRoles(tokens.dark),
    ...(tokens.highContrast && {
      highContrast: {
        light: coreRoles(tokens.highContrast.light),
        dark: coreRoles(tokens.highContrast.dark),
      },
    }),
  };
}
