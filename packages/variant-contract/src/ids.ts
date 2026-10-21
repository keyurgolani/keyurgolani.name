// Variant ids (#5, Slice 1): one grammar for every registry kind, a reserved
// set for the platform's own packages, and a scope prefix for everyone else's.

import { REGISTRY_ID_PATTERN } from '@portfolio/schema';

/** `^[a-z][a-z0-9-]{1,47}$`, the registry grammar #4's site document uses. */
export const VARIANT_ID_PATTERN = REGISTRY_ID_PATTERN;

/** The host's stand-in composition. It renders, but a site can't select it. */
export const FALLBACK_ID = 'fallback';

/** An id no package registers. Fixtures select it to reach the fallback composition. */
export const MISSING_VARIANT_ID = 'missing-variant';

/** The five approved compositions (#13 to #17). */
export const COMPOSITION_IDS = [
  'editorial-evidence',
  'kinetic-cosmos',
  'obsidian-atelier',
  'spatial-bento',
  'horizontal-cinema',
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
 * and the five composition ids belong to `@portfolio/*`, `missing-variant`
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
};
