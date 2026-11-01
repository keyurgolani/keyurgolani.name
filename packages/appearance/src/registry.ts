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
import { withDerivedRoles } from './derived-roles';
import { deriveBaseSet } from './sets';
import type { ColorSchemeManifest, DesignLanguageManifest, TypographyManifest } from './manifests';
import type { ColorTokens } from './tokens';
import { AXIS_BY_KIND, baseModes } from './validate-pack';

/** A file registry generation wrote into the pack directory, where the host serves it from. */
export interface PackFileRef {
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
  readonly stylesheet?: PackFileRef | null;
  /** The font files a typography profile ships, which its stylesheet's @font-face rules load. */
  readonly fonts?: readonly PackFileRef[];
  /**
   * The URL of the one font a page under a typography profile preloads,
   * one of `fonts`: its body face's Latin file at the body's weight. A
   * profile with no such face, and every other pack, has none.
   */
  readonly preload?: string;
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
  readonly PLATFORM_STYLESHEET?: PackFileRef | null;
  /**
   * The packs registry generation found and left out (#20), each with its
   * reason, such as a license no pack may ship under. None registers, and
   * selecting one falls back on its axis with that reason.
   */
  readonly EXCLUDED_PACKS?: readonly ExcludedPack[];
  /**
   * The retired packs' ids (LANG-1), each an alias of the pack that
   * replaced it, from its package's `retired/<id>/retired.json`. None
   * registers or ships; a selection that names one renders its survivor.
   */
  readonly PACK_ALIASES?: readonly PackAlias[];
}

/**
 * A retired pack's id, kept so no stored or linked selection breaks: it
 * reads everywhere as `aliasOf`, a pack the build registers on the same axis.
 */
export interface PackAlias {
  readonly kind: PackKind;
  /** The retired id. */
  readonly id: string;
  /** The survivor's id. */
  readonly aliasOf: string;
  readonly packageName: string;
  /**
   * What looked different under the survivor at the merge, as a clause the
   * notice ends with, such as "at the merge, its icon strokes became
   * slightly thinner", or null when it looked the same then.
   */
  readonly change: string | null;
  /**
   * Whether the survivor's look has changed since the merge (LANG-2). A
   * survivor may evolve and its aliases follow it, so the notice then says
   * so and makes no claim of sameness. Absent reads as false.
   */
  readonly changedSinceMerge?: boolean;
}

/** A pack registry generation left out of the build, and why. */
export interface ExcludedPack {
  readonly kind: PackKind;
  readonly id: string;
  readonly packageName: string;
  readonly reason: string;
  /**
   * `owner-acceptance` for an image-derived scheme waiting on the owner
   * (#20 PR 3): left out on purpose until the owner accepts it, so
   * check:appearance reports it instead of failing on it.
   */
  readonly awaiting?: 'owner-acceptance';
}

interface RegisteredPack {
  readonly packageName: string;
  readonly version: string;
  readonly fixture: boolean;
  readonly stylesheet: PackFileRef | null;
  readonly fonts: readonly PackFileRef[];
}

export interface RegisteredLanguage extends RegisteredPack {
  readonly manifest: DesignLanguageManifest;
}

export interface RegisteredScheme extends RegisteredPack {
  readonly manifest: ColorSchemeManifest;
  /** The base modes it has. A generator scheme has both, once generated. */
  readonly modes: readonly BaseMode[];
  /** The base sets, authored or derived from anchors by the manifest's derivation. Empty for a generator scheme. */
  readonly sets: { readonly light?: ColorTokens; readonly dark?: ColorTokens };
}

export interface RegisteredTypography extends RegisteredPack {
  readonly manifest: TypographyManifest;
  /** The URL of the one font a page under it preloads, when it ships one to preload. */
  readonly preload?: string;
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
  readonly platformStylesheet: PackFileRef | null;
  /** Each pack axis's excluded packs, by id: none registers. A registry built by hand may leave it out. */
  readonly excluded?: { readonly [A in PackAxis]: ReadonlyMap<string, ExcludedPack> };
  /** Each pack axis's retired ids, by id: none registers. A registry built by hand may leave it out. */
  readonly aliases?: { readonly [A in PackAxis]: ReadonlyMap<string, PackAlias> };
}

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
      fonts: pack.fonts ?? [],
    };
    if (pack.kind === 'color-scheme') {
      packs.colorScheme.set(id, { ...base, manifest: pack.manifest, ...schemeSets(pack.manifest) });
    } else if (pack.kind === 'design-language') {
      packs.designLanguage.set(id, { ...base, manifest: pack.manifest });
    } else {
      packs.typography.set(id, {
        ...base,
        manifest: pack.manifest,
        ...(pack.preload ? { preload: pack.preload } : {}),
      });
    }
  }
  for (const axis of PACK_AXES) {
    const fallback = PLATFORM_DEFAULTS[axis];
    const entry = packs[axis].get(fallback);
    if (!entry)
      throw new Error(
        `This build registers no ${fallback}, the ${PACK_KIND_BY_AXIS[axis]} fallback.`,
      );
  }
  const excluded = {
    designLanguage: new Map<string, ExcludedPack>(),
    colorScheme: new Map<string, ExcludedPack>(),
    typography: new Map<string, ExcludedPack>(),
  };
  for (const pack of meta.EXCLUDED_PACKS ?? []) {
    const axis = AXIS_BY_KIND[pack.kind];
    if (!axis) throw new Error('The metadata module excludes a pack of an unknown kind.');
    if (owners.has(pack.id)) {
      throw new Error(
        `The id ${pack.id} is both registered and excluded, and an id names one thing.`,
      );
    }
    excluded[axis].set(pack.id, pack);
  }
  const aliases = {
    designLanguage: new Map<string, PackAlias>(),
    colorScheme: new Map<string, PackAlias>(),
    typography: new Map<string, PackAlias>(),
  };
  for (const alias of meta.PACK_ALIASES ?? []) {
    const axis = AXIS_BY_KIND[alias.kind];
    if (!axis) throw new Error('The metadata module retires a pack of an unknown kind.');
    if (owners.has(alias.id) || excluded[axis].has(alias.id)) {
      throw new Error(
        `The id ${alias.id} is both retired and ${owners.has(alias.id) ? 'registered' : 'excluded'}, and an id names one thing.`,
      );
    }
    if (PACK_AXES.some((other) => aliases[other].has(alias.id))) {
      throw new Error(`The id ${alias.id} is retired twice.`);
    }
    // A survivor is a registered pack, never another alias, so no alias chains. Registry
    // generation refuses an alias whose survivor isn't registered; a registry built from
    // fewer packs, as a test or a plan does, leaves that alias out, so its id is one this
    // registry doesn't register and its axis falls back.
    if (packs[axis].has(alias.aliasOf)) aliases[axis].set(alias.id, alias);
  }
  const fallbackScheme = packs.colorScheme.get(PLATFORM_DEFAULTS.colorScheme)!;
  if (fallbackScheme.modes.length < 2 || fallbackScheme.manifest.generator) {
    throw new Error('The color scheme fallback needs authored or anchored light and dark modes.');
  }
  return Object.freeze({
    variants: meta.VARIANTS,
    packs,
    excluded,
    aliases,
    platformStylesheet: meta.PLATFORM_STYLESHEET ?? null,
  });
}

/**
 * The alias `id` is on `axis`, when it's a retired pack's id (LANG-1). Every
 * reader that takes a stored or linked id asks this, and only this, through
 * canonicalId().
 */
export function aliasOf(
  registry: AppearanceRegistry,
  axis: IdAxis,
  id: string,
): PackAlias | undefined {
  return axis === 'variant' ? undefined : registry.aliases?.[axis].get(id);
}

/** `id` as it renders on `axis`: its survivor when it's a retired pack's id, else itself. */
export function canonicalId(registry: AppearanceRegistry, axis: IdAxis, id: string): string {
  return aliasOf(registry, axis, id)?.aliasOf ?? id;
}

/** Why registry generation left the pack `id` names on `axis` out of this build, if it did. */
export function exclusionOf(
  registry: AppearanceRegistry,
  axis: PackAxis,
  id: string,
): ExcludedPack | undefined {
  return registry.excluded?.[axis].get(id);
}

function schemeSets(manifest: ColorSchemeManifest): Pick<RegisteredScheme, 'modes' | 'sets'> {
  const modes = baseModes(manifest);
  if (manifest.generator) return { modes, sets: {} };
  const sets: { light?: ColorTokens; dark?: ColorTokens } = {};
  for (const mode of modes) {
    const anchors = manifest.anchors?.[mode];
    // An authored set gets the roles K-2 added from its others where it leaves them out.
    sets[mode] = anchors
      ? deriveBaseSet(manifest.derivation!, anchors, mode)
      : withDerivedRoles(manifest[mode]!, false);
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
 * variants other than the fallback composition, or registered packs. A
 * Research record and an excluded pack never register (#20).
 */
export function selectableIds(registry: AppearanceRegistry, axis: IdAxis): string[] {
  if (axis === 'variant') {
    return registry.variants
      .map(({ manifest }) => manifest.id)
      .filter((id) => id !== FALLBACK_ID)
      .sort();
  }
  return [...registry.packs[axis].values()].map(({ manifest }) => manifest.id).sort();
}
