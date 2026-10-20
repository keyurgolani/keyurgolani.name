// What the contract reports (#5, Slice 1). A manifest's records are about the
// package, so registry generation (Slice 3) adds the package, its version,
// and the manifest's path. The publication-unit records are #4 Diagnostics.

export type ManifestSeverity = 'error' | 'warning';

/** One finding in a manifest.json. */
export interface ManifestDiagnostic {
  readonly code: ManifestCode;
  readonly severity: ManifestSeverity;
  /** JSON pointer into the manifest; '' is the whole manifest. */
  readonly pointer: string;
  readonly message: string;
  /** What the rule wants there, when that's short. */
  readonly expected?: string;
  /** What the manifest has there, when that's short. */
  readonly actual?: string;
  /** What to do about it. */
  readonly remedy: string;
}

/** Every code validateManifest() raises, with its severity. */
export const MANIFEST_CODES = {
  'manifest.invalid': 'error',
  'manifest.missing': 'error',
  'manifest.unknown-key': 'error',
  'manifest.duplicate': 'error',
  'manifest.unknown-ref': 'error',
  'contract.unsupported': 'error',
  'contract.newer': 'error',
  'schemas.unsupported': 'error',
  'token-contract.mismatch': 'error',
  'id.reserved': 'error',
  'id.prefix': 'error',
  'first-party.pin': 'error',
  'kinds.overlap': 'error',
  'route.reserved-segment': 'error',
  'route.conflict': 'error',
  'controls.appearance': 'error',
  'controls.migration-gap': 'error',
  'enhancement.missing-export': 'error',
  'key-binding.reserved': 'error',
  'provenance.note-required': 'error',
  'appearance.unknown-recipe': 'warning',
} as const satisfies Record<string, ManifestSeverity>;

export type ManifestCode = keyof typeof MANIFEST_CODES;

/**
 * Every code the publication-unit validators raise, with its #4 severity.
 * Startup treats `variant.unavailable` and `controls.*` as warnings (Slice 3),
 * and #3's publish rejects them.
 */
export const UNIT_CODES = {
  'variant.unavailable': 'blocks-publish',
  'controls.invalid': 'blocks-publish',
  'controls.stale': 'blocks-publish',
  'controls.dangling-ref': 'blocks-publish',
  'route.unknown': 'warning',
  'route.required': 'warning',
} as const;

export type UnitCode = keyof typeof UNIT_CODES;

/** A JSON pointer for a path, escaping `~` and `/` as RFC 6901 says. */
export function toPointer(path: readonly (string | number)[]): string {
  return path.map((part) => `/${String(part).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
}
