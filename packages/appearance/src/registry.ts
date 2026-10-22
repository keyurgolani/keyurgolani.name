// The appearance registry (#19, Slice 1, item 3): the variants and packs a
// build registers, indexed by axis, from #5's generated metadata module. It
// replaces #4's interim AppearanceCatalog once the host wires it (Slice 4).
// Each scheme's base sets are derived once, here, so resolving a request
// only looks them up.

import {
  FALLBACK_ID,
  findVariant,
  type RegisteredVariant,
  type VariantRegistry,
} from '@portfolio/variant-contract';
import {
  ID_AXES,
  PACK_AXES,
  PACK_KIND_BY_AXIS,
  PLATFORM_DEFAULTS,
  type BaseMode,
  type IdAxis,
  type PackAxis,
  type PackKind,
} from './axes';
import { anchorV1 } from './derive';
import type { ColorSchemeManifest, DesignLanguageManifest, TypographyManifest } from './manifests';
import type { ColorTokens } from './tokens';
import { baseModes } from './validate-pack';

/** A compiled stylesheet registry generation wrote, where the host serves it from. */
export interface PackStylesheet {
  /** Such as /_portfolio/pack/warm-parchment.<sha256-12>.css. */
  readonly url: string;
  /** The hex SHA-256 of its bytes. */
  readonly sha256: string;
}

interface MetaPackBase {
  readonly packageName: string;
  readonly version: string;
  /** A test fixture, which registers only when APPEARANCE_FIXTURES=1 (Slice 2). */
  readonly fixture?: boolean;
  /** Its compiled stylesheet; null for a generator scheme, which compiles from what it generates. */
  readonly stylesheet?: PackStylesheet | null;
}

/** One installed pack, as registry generation lists it in the metadata module. */
export type MetaPack =
  | (MetaPackBase & {
      readonly kind: 'design-language';
      readonly manifest: DesignLanguageManifest;
    })
  | (MetaPackBase & {
      readonly kind: 'color-scheme';
      readonly manifest: ColorSchemeManifest;
    })
  | (MetaPackBase & {
      readonly kind: 'typography';
      readonly manifest: TypographyManifest;
    });

/**
 * What the registry reads from #5's metadata module (`registry.meta.ts`):
 * its `VARIANTS`, and the `PACKS` and `PLATFORM_STYLESHEET` registry
 * generation writes once it registers the pack kinds (Slice 2). A module
 * without `PACKS` registers no pack.
 */
export interface AppearanceMeta {
  readonly VARIANTS: VariantRegistry;
  readonly PACKS?: readonly MetaPack[];
  readonly PLATFORM_STYLESHEET?: PackStylesheet | null;
}

interface RegisteredPack {
  readonly packageName: string;
  readonly version: string;
  readonly fixture: boolean;
  readonly stylesheet: PackStylesheet | null;
}

export interface RegisteredLanguage extends RegisteredPack {
  readonly manifest: DesignLanguageManifest;
}

export interface RegisteredScheme extends RegisteredPack {
  readonly manifest: ColorSchemeManifest;
  /** The base modes it has. A generator scheme has both, once generated. */
  readonly modes: readonly BaseMode[];
  /** The base sets, authored or derived with anchor-v1. Empty for a generator scheme. */
  readonly sets: { readonly light?: ColorTokens; readonly dark?: ColorTokens };
}

export interface RegisteredTypography extends RegisteredPack {
  readonly manifest: TypographyManifest;
}

interface PackEntries {
  readonly designLanguage: RegisteredLanguage;
  readonly colorScheme: RegisteredScheme;
  readonly typography: RegisteredTypography;
}

export type PackEntry<A extends PackAxis = PackAxis> = PackEntries[A];

export interface AppearanceRegistry {
  /** Every registered variant, the fallback composition included. */
  readonly variants: VariantRegistry;
  /** Each pack axis's packs, by id. */
  readonly packs: { readonly [A in PackAxis]: ReadonlyMap<string, PackEntries[A]> };
  /** The platform stylesheet every boundary links, once registry generation has written it. */
  readonly platformStylesheet: PackStylesheet | null;
}

const AXIS_BY_KIND: Readonly<Record<PackKind, PackAxis>> = {
  'design-language': 'designLanguage',
  'color-scheme': 'colorScheme',
  typography: 'typography',
};

/**
 * Indexes the metadata module's variants and packs by axis. It throws when
 * the build is broken: the fallback composition or a pack axis's
 * first-party fallback missing, one id registered twice anywhere (ids are
 * global, across the variants and every pack axis), or a fallback scheme
 * without both base modes, which every display mode needs.
 */
export function createAppearanceRegistry(meta: AppearanceMeta): AppearanceRegistry {
  if (!findVariant(meta.VARIANTS, FALLBACK_ID)) {
    throw new Error('This build registers no fallback composition.');
  }
  const packs = {
    designLanguage: new Map<string, RegisteredLanguage>(),
    colorScheme: new Map<string, RegisteredScheme>(),
    typography: new Map<string, RegisteredTypography>(),
  };
  /** What registers each id so far: 'variant', or a pack kind. */
  const owners = new Map<string, string>(
    meta.VARIANTS.map(({ manifest }) => [manifest.id, 'variant']),
  );
  for (const pack of meta.PACKS ?? []) {
    const axis = AXIS_BY_KIND[pack.kind];
    if (!axis) throw new Error(`The metadata module lists a pack of an unknown kind.`);
    const { id } = pack.manifest;
    const owner = owners.get(id);
    if (owner === pack.kind) throw new Error(`Two ${pack.kind} packs register the id ${id}.`);
    if (owner) {
      const first = owner === 'variant' ? 'A variant' : `A ${owner} pack`;
      throw new Error(
        `${first} and a ${pack.kind} pack both register the id ${id}, and an id names one thing.`,
      );
    }
    owners.set(id, pack.kind);
    const base = {
      packageName: pack.packageName,
      version: pack.version,
      fixture: pack.fixture === true,
      stylesheet: pack.stylesheet ?? null,
    };
    if (pack.kind === 'color-scheme') {
      packs.colorScheme.set(id, { ...base, manifest: pack.manifest, ...schemeSets(pack.manifest) });
    } else if (pack.kind === 'design-language') {
      packs.designLanguage.set(id, { ...base, manifest: pack.manifest });
    } else {
      packs.typography.set(id, { ...base, manifest: pack.manifest });
    }
  }
  for (const axis of PACK_AXES) {
    const fallback = PLATFORM_DEFAULTS[axis];
    const entry = packs[axis].get(fallback);
    if (!entry)
      throw new Error(
        `This build registers no ${fallback}, the ${PACK_KIND_BY_AXIS[axis]} fallback.`,
      );
    if (entry.manifest.tier === 'research') {
      throw new Error(
        `The ${PACK_KIND_BY_AXIS[axis]} fallback ${fallback} can't be a research pack.`,
      );
    }
  }
  const fallbackScheme = packs.colorScheme.get(PLATFORM_DEFAULTS.colorScheme)!;
  if (fallbackScheme.modes.length < 2 || fallbackScheme.manifest.generator) {
    throw new Error('The color scheme fallback needs authored or anchored light and dark modes.');
  }
  return Object.freeze({
    variants: meta.VARIANTS,
    packs,
    platformStylesheet: meta.PLATFORM_STYLESHEET ?? null,
  });
}

function schemeSets(manifest: ColorSchemeManifest): Pick<RegisteredScheme, 'modes' | 'sets'> {
  const modes = baseModes(manifest);
  if (manifest.generator) return { modes, sets: {} };
  const sets: { light?: ColorTokens; dark?: ColorTokens } = {};
  for (const mode of modes) {
    const anchors = manifest.anchors?.[mode];
    sets[mode] = anchors ? anchorV1(anchors, mode) : manifest[mode]!;
  }
  return { modes, sets };
}

/** The pack `id` names on `axis`, if this build registers one. */
export function findPack<A extends PackAxis>(
  registry: AppearanceRegistry,
  axis: A,
  id: string,
): PackEntries[A] | undefined {
  return (registry.packs[axis] as ReadonlyMap<string, PackEntries[A]>).get(id);
}

/** The registered variant `id` names, unless it's the fallback composition, which can't be selected. */
export function findSelectableVariant(
  registry: AppearanceRegistry,
  id: string,
): RegisteredVariant | undefined {
  return id === FALLBACK_ID ? undefined : findVariant(registry.variants, id);
}

/** Whether `id` names something selectable on `axis`: a registered variant, or a registered pack. */
export function isRegistered(registry: AppearanceRegistry, axis: IdAxis, id: string): boolean {
  return axis === 'variant'
    ? findSelectableVariant(registry, id) !== undefined
    : findPack(registry, axis, id) !== undefined;
}

/** The id axes other than `axis` that register `id`. */
export function otherAxes(registry: AppearanceRegistry, axis: IdAxis, id: string): IdAxis[] {
  return ID_AXES.filter((other) => other !== axis && isRegistered(registry, other, id));
}

/** The axis's fallback: #5's fallback composition, or the first-party pack. */
export function axisFallback(axis: IdAxis): string {
  return axis === 'variant' ? FALLBACK_ID : PLATFORM_DEFAULTS[axis];
}

/**
 * The ids a site or visitor may select on `axis`, sorted: registered
 * variants other than the fallback composition, or registered packs other
 * than Research ones.
 */
export function selectableIds(registry: AppearanceRegistry, axis: IdAxis): string[] {
  if (axis === 'variant') {
    return registry.variants
      .map(({ manifest }) => manifest.id)
      .filter((id) => id !== FALLBACK_ID)
      .sort();
  }
  return [...registry.packs[axis].values()]
    .filter(({ manifest }) => manifest.tier !== 'research')
    .map(({ manifest }) => manifest.id)
    .sort();
}
