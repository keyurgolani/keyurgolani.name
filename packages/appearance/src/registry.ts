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
  PACK_KINDS,
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

/** One installed pack, as registry generation lists it in the metadata module. */
export type MetaPack =
  | {
      readonly kind: 'design-language';
      readonly packageName: string;
      readonly version: string;
      readonly manifest: DesignLanguageManifest;
    }
  | {
      readonly kind: 'color-scheme';
      readonly packageName: string;
      readonly version: string;
      readonly manifest: ColorSchemeManifest;
    }
  | {
      readonly kind: 'typography';
      readonly packageName: string;
      readonly version: string;
      readonly manifest: TypographyManifest;
    };

/**
 * What the registry reads from #5's metadata module (`registry.meta.ts`):
 * its `VARIANTS`, and the `PACKS` registry generation lists once it
 * registers the pack kinds (Slice 2). A module without `PACKS` registers no
 * pack.
 */
export interface AppearanceMeta {
  readonly VARIANTS: VariantRegistry;
  readonly PACKS?: readonly MetaPack[];
}

export interface RegisteredLanguage {
  readonly packageName: string;
  readonly version: string;
  readonly manifest: DesignLanguageManifest;
}

export interface RegisteredScheme {
  readonly packageName: string;
  readonly version: string;
  readonly manifest: ColorSchemeManifest;
  /** The base modes it has. A generator scheme has both, once generated. */
  readonly modes: readonly BaseMode[];
  /** The base sets, authored or derived with anchor-v1. Empty for a generator scheme. */
  readonly sets: { readonly light?: ColorTokens; readonly dark?: ColorTokens };
}

export interface RegisteredTypography {
  readonly packageName: string;
  readonly version: string;
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
}

const AXIS_BY_KIND: Readonly<Record<PackKind, PackAxis>> = {
  'design-language': 'designLanguage',
  'color-scheme': 'colorScheme',
  typography: 'typography',
};

/**
 * Indexes the metadata module's variants and packs by axis. It throws when
 * the build is broken: the fallback composition or a pack axis's
 * first-party fallback missing, two packs with one id on an axis, or a
 * fallback scheme without both base modes, which every display mode needs.
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
  for (const pack of meta.PACKS ?? []) {
    const axis = AXIS_BY_KIND[pack.kind];
    if (!axis) throw new Error(`The metadata module lists a pack of an unknown kind.`);
    const { id } = pack.manifest;
    if (packs[axis].has(id)) {
      throw new Error(`Two ${PACK_KINDS[axis]} packs register the id ${id}.`);
    }
    const base = { packageName: pack.packageName, version: pack.version };
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
    if (!entry) throw new Error(`This build registers no ${fallback}, the ${PACK_KINDS[axis]} fallback.`);
    if (entry.manifest.tier === 'research') {
      throw new Error(`The ${PACK_KINDS[axis]} fallback ${fallback} can't be a research pack.`);
    }
  }
  const fallbackScheme = packs.colorScheme.get(PLATFORM_DEFAULTS.colorScheme)!;
  if (fallbackScheme.modes.length < 2 || fallbackScheme.manifest.generator) {
    throw new Error('The color scheme fallback needs authored or anchored light and dark modes.');
  }
  return Object.freeze({ variants: meta.VARIANTS, packs });
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
