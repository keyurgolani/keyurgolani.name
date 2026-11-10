// Variant ids (#5, Slice 1): one grammar for every registry kind, a reserved
// set for the platform's own packages, and a scope prefix for everyone else's.

import { FALLBACK_VARIANT_ID, REGISTRY_ID_PATTERN } from '@portfolio/schema/ids';

/** `^[a-z][a-z0-9-]{1,47}$`, the registry grammar #4's site document uses. */
export const VARIANT_ID_PATTERN = REGISTRY_ID_PATTERN;

/** The host's stand-in composition. It renders, but a site can't select it. */
export const FALLBACK_ID = FALLBACK_VARIANT_ID;

/** An id no package registers. Fixtures select it to reach the fallback composition. */
export const MISSING_VARIANT_ID = 'missing-variant';

/**
 * The approved first-party compositions: #13 to #17, then the redesign's, in
 * the order they registered. `pnpm register-variant` adds each one here and to
 * FIRST_PARTY_PINS.
 */
export const COMPOSITION_IDS = [
  'editorial-evidence',
  'kinetic-cosmos',
  'obsidian-atelier',
  'spatial-bento',
  'horizontal-cinema',
  'swiss-signal',
  'raw-grid',
  'shell',
  'terra-field',
  'aurora-glass',
  'singular',
  'mission-control',
  'schematic',
  'flux',
  'chapters',
] as const;

/** Ids only `@portfolio/*` packages may take. */
export const RESERVED_IDS: readonly string[] = [FALLBACK_ID, ...COMPOSITION_IDS];

/** The scope of the platform's own packages. */
export const FIRST_PARTY_SCOPE = 'portfolio';

/** The scope of an npm package name, such as `acme` for `@acme/ocean`, or null when it has none. */
export function packageScope(packageName: string): string | null {
  const match = /^@([^/]+)\/[^/]+$/.exec(packageName);
  return match ? match[1]! : null;
}

export interface IdProblem {
  readonly code: 'manifest.id-reserved' | 'manifest.id-prefix';
  readonly message: string;
  readonly expected: string;
  readonly remedy: string;
}

/**
 * What rule `id` breaks for the package `packageName`, if any. `fallback`
 * and the composition ids belong to `@portfolio/*`, `missing-variant`
 * never registers, and a package under another scope starts its id with the
 * scope: `@acme/ocean` is `acme-ocean`.
 */
export function idProblem(id: string, packageName: string): IdProblem | null {
  const scope = packageScope(packageName);
  if (id === MISSING_VARIANT_ID) {
    return {
      code: 'manifest.id-reserved',
      message: `${MISSING_VARIANT_ID} is the id fixtures select to reach the fallback composition, so no package registers it.`,
      expected: 'any other id',
      remedy: 'Pick another id.',
    };
  }
  if (scope === FIRST_PARTY_SCOPE) return null;
  if (RESERVED_IDS.includes(id)) {
    return {
      code: 'manifest.id-reserved',
      message: `${id} is reserved for the platform's own @${FIRST_PARTY_SCOPE}/* packages.`,
      expected: scope ? `an id starting with ${scope}-` : 'an id that is not reserved',
      remedy: scope ? `Use ${scope}-${id} or another ${scope}- id.` : 'Pick another id.',
    };
  }
  if (scope !== null && !id.startsWith(`${scope}-`)) {
    return {
      code: 'manifest.id-prefix',
      message: `A package under @${scope} starts its variant id with ${scope}-, which keeps most scopes' ids apart. Prefixes can still collide, such as @acme with @acme-ocean, and registry generation refuses two packages with one id.`,
      expected: `an id starting with ${scope}-`,
      remedy: `Rename the id to ${scope}-${id}, or another ${scope}- id.`,
    };
  }
  return null;
}

/**
 * Values each first-party composition must declare, so the catalog's runtime
 * tier and motion class stay what the design approved.
 */
export const FIRST_PARTY_PINS: Readonly<
  Record<string, { readonly performanceTier: string; readonly motionIntent: string }>
> = {
  'editorial-evidence': { performanceTier: 'light', motionIntent: 'still' },
  'kinetic-cosmos': { performanceTier: 'medium', motionIntent: 'kinetic' },
  'obsidian-atelier': { performanceTier: 'light', motionIntent: 'subtle' },
  'spatial-bento': { performanceTier: 'heavy', motionIntent: 'adaptive' },
  'horizontal-cinema': { performanceTier: 'medium', motionIntent: 'directed' },
  'swiss-signal': { performanceTier: 'light', motionIntent: 'subtle' },
  'raw-grid': { performanceTier: 'medium', motionIntent: 'subtle' },
  shell: { performanceTier: 'light', motionIntent: 'subtle' },
  'terra-field': { performanceTier: 'light', motionIntent: 'subtle' },
  'aurora-glass': { performanceTier: 'medium', motionIntent: 'adaptive' },
  singular: { performanceTier: 'light', motionIntent: 'directed' },
  'mission-control': { performanceTier: 'medium', motionIntent: 'subtle' },
  schematic: { performanceTier: 'light', motionIntent: 'subtle' },
  flux: { performanceTier: 'medium', motionIntent: 'kinetic' },
  chapters: { performanceTier: 'light', motionIntent: 'directed' },
};

/**
 * The `animation` budget each first-party composition declares (K-4 c), as
 * RB ruling R3 counts it: infinite animations and recurring timers count,
 * finite and scroll-driven animations don't. `count` is exact, unless
 * `atMost`; every composition here not given one declares 0. The ten new
 * compositions are listed before they register, so each lands on its
 * approved count.
 */
export const FIRST_PARTY_ANIMATIONS: Readonly<
  Record<string, { readonly count: number; readonly atMost?: true }>
> = {
  fallback: { count: 0 },
  'editorial-evidence': { count: 0 },
  'kinetic-cosmos': { count: 3 },
  'obsidian-atelier': { count: 0 },
  'spatial-bento': { count: 1 },
  'horizontal-cinema': { count: 0 },
  'swiss-signal': { count: 0 },
  // Its sky and its bead.
  'aurora-glass': { count: 2 },
  // The ticker.
  'raw-grid': { count: 1 },
  schematic: { count: 0 },
  'terra-field': { count: 0 },
  shell: { count: 0 },
  // Finite reveals only.
  singular: { count: 0 },
  // The minute clock.
  'mission-control': { count: 1 },
  chapters: { count: 0 },
  // Its blobs, at most (K-4 e).
  flux: { count: 3, atMost: true },
};
