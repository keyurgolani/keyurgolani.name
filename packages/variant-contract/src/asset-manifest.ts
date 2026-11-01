import type { Budgets } from './budgets';
import type { PERFORMANCE_TIERS } from './manifest-schema';

// ASSET_MANIFEST (#6, Slice 2, item 4): what each registered unit, a variant
// or one of #19's appearance packs, ships to the browser, as registry
// generation lists it in the server-only metadata module and in
// apps/web/src/lib/generated/asset-manifest.json, which Node tools read in
// its place. The host links a unit's stylesheet from here, and #6's trace
// and budget checks read it to tell one unit's files from another's.

/** The kinds of unit: a variant, and #19's three pack kinds. */
export const UNIT_KINDS = ['variant', 'design-language', 'color-scheme', 'typography'] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

/** A file a unit ships, where the host serves it. */
export interface AssetFileRef {
  /** Such as /_portfolio/asset/<sha256-12>.png. */
  readonly url: string;
  readonly bytes: number;
  /** The hex SHA-256 of its bytes. */
  readonly sha256: string;
}

/** A catalog still, with the pixel size its file has, for a plate's <img> width and height. */
export interface StillRef extends AssetFileRef {
  readonly width: number;
  readonly height: number;
}

/** A unit's one stylesheet, with its size gzipped at level 9, as #6's budgets count it. */
export interface StylesheetRef extends AssetFileRef {
  readonly gzipBytes: number;
}

/** An enhancement a variant declares, keyed `<variant id>/<id>` in the host's loaders. */
export interface UnitEnhancement {
  readonly id: string;
  /** The subpath of the package's exports it loads from, such as ./enhancements/orbit. */
  readonly export: string;
  readonly requires: readonly string[];
}

export interface AssetUnit {
  readonly kind: UnitKind;
  readonly id: string;
  readonly packageName: string;
  /** From the package's package.json. */
  readonly version: string;
  /** From a `portfolio.fixture: true` package its flag admitted. */
  readonly fixture: boolean;
  /** A variant's runtime tier. Packs have none. */
  readonly performanceTier?: (typeof PERFORMANCE_TIERS)[number];
  /** Its compiled stylesheet: a variant's, or a pack's. Null for a pack whose CSS is generated. */
  readonly stylesheet: StylesheetRef | null;
  /** A typography pack's font files. */
  readonly fonts: readonly AssetFileRef[];
  /** The images a variant's stylesheet names, copied by content hash. */
  readonly images: readonly AssetFileRef[];
  /** A variant's catalog stills (#6, item 1), as its manifest lists them, the largest first. */
  readonly stills: readonly StillRef[];
  readonly enhancements: readonly UnitEnhancement[];
  /**
   * The budgets its manifest declares (#6), as written: `pnpm check:budgets`
   * holds a kind left out to the ceiling of the unit's tier or axis.
   */
  readonly budgets: Budgets;
}

/** Every registered unit, variants first, then packs by kind, each sorted by id. */
export type AssetManifest = readonly AssetUnit[];

/** The unit of `kind` with `id`, if this build registers one. */
export function findUnit(
  manifest: AssetManifest,
  kind: UnitKind,
  id: string,
): AssetUnit | undefined {
  return manifest.find((unit) => unit.kind === kind && unit.id === id);
}
