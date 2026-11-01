import 'server-only';
import {
  axisFallback,
  DISPLAY_MODES,
  findPack,
  selectableIds,
  type AppearanceRegistry,
} from '@portfolio/appearance';
import { compositionStatus, PENDING_LABEL } from '@portfolio/variant-contract/status';
import type {
  AppearanceCatalog,
  CatalogAxis,
  CatalogOption,
  SchemeAnchors,
  Specimen,
} from '~/lib/studio/appearance';
import { APPEARANCE_REGISTRY } from '~/lib/appearance-registry';
import { ASSET_MANIFEST } from '~/lib/generated/registry.meta';
import {
  typeStillsByPack,
  typeStyleOf,
  withoutFamilies,
  type TypeStillRecord,
  type TypeStills,
} from '~/lib/studio/type-stills';
import typeStillRecord from '../../studio-stills/type/stills.json' with { type: 'json' };

// What the Appearance workspace may offer (#8, Slice 5 items 1 and 3), from
// the registry this build has: on each of the four id axes, the ids a site
// may select, as selectableIds() gives them, so the fallback composition and
// Research packs are never listed, and nothing this build doesn't register
// is either; and the display modes. Each option carries what the workspace
// shows before publish: its tier, provenance, performance, and what it
// means for access, and, for a composition, whether it's ready to pick or
// still in progress (A2), which the picker shows disabled. Plain data, for
// the client, with no manifest beyond what it names: a pack's specimen, which
// its picker draws it with, and the URL of its compiled stylesheet, which a
// preview frame swaps in place (#7).

const AXIS_LABELS: Readonly<Record<CatalogAxis, string>> = {
  variant: 'Composition',
  designLanguage: 'Design language',
  colorScheme: 'Color scheme',
  typography: 'Typography',
  displayMode: 'Display mode',
};

const MODE_LABELS: Readonly<Record<string, string>> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  'high-contrast': 'High contrast',
};

const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback;

const HEX = /^#[0-9a-fA-F]{3,8}$/;

function anchors(value: unknown): SchemeAnchors | null {
  const set = (value ?? {}) as Record<string, unknown>;
  const [canvas, ink, accent, secondary] = ['canvas', 'text', 'accent', 'secondary'].map((key) =>
    text(set[key]),
  );
  if (![canvas, ink, accent].every((each) => HEX.test(each!))) return null;
  return {
    canvas: canvas!,
    text: ink!,
    accent: accent!,
    secondary: HEX.test(secondary!) ? secondary! : accent!,
  };
}

/** What a pack's picker draws it with, from its manifest's own values. */
/** A texture token, as the specimen draws it. */
function textureOf(value: string): 'none' | 'lines' | 'dots' | 'pattern' {
  if (value === 'none' || value === '') return 'none';
  if (value.startsWith('repeating-linear-gradient')) return 'lines';
  if (value.startsWith('radial-gradient')) return 'dots';
  return 'pattern';
}

function specimenOf(
  axis: Exclude<CatalogAxis, 'variant' | 'displayMode'>,
  manifest: unknown,
  modes: readonly string[] | null,
  stills: ReadonlyMap<string, TypeStills> = new Map(),
): Specimen | null {
  const fields = (manifest ?? {}) as Record<string, unknown>;
  if (axis === 'colorScheme') {
    const sets = (fields.anchors ?? {}) as Record<string, unknown>;
    const swatches = Array.isArray(fields.swatches)
      ? fields.swatches.filter((each): each is string => typeof each === 'string' && HEX.test(each))
      : [];
    return {
      kind: 'scheme',
      light: anchors(sets.light),
      dark: anchors(sets.dark),
      swatches,
      modes: modes ?? [],
    };
  }
  if (axis === 'typography') {
    const roles = (fields.roles ?? {}) as Record<string, Record<string, unknown> | undefined>;
    const display = text(roles.display?.['font-family'], 'inherit');
    const selfHosted = Array.isArray(fields.fontAssets) && fields.fontAssets.length > 0;
    // Studio's document names no web font (P-5): a self-hosted pack's stacks come without the
    // families it ships, so a row with no still, as a third party's, sets its name in the
    // fallback stack, and no thumbnail or chip asks for the pack's files.
    const hosted = selfHosted
      ? (fields.fontAssets as readonly unknown[]).flatMap((asset) => {
          const family = (asset as { family?: unknown } | null)?.family;
          return typeof family === 'string' ? [family] : [];
        })
      : [];
    return {
      kind: 'type',
      display: withoutFamilies(display, hosted),
      body: withoutFamilies(text(roles.body?.['font-family'], 'inherit'), hosted),
      displayWeight: text(roles.display?.['font-weight'], '600'),
      style: typeStyleOf(display),
      source: selfHosted ? 'self-hosted' : 'system',
      // What the preview loads once the pack is chosen: the font files it ships, 0 for system fonts.
      fontBytes: selfHosted
        ? (ASSET_MANIFEST.find(
            (unit) => unit.kind === 'typography' && unit.id === text(fields.id),
          )?.fonts.reduce((sum, font) => sum + font.bytes, 0) ?? 0)
        : 0,
      // A system font never has a still: it renders differently on every platform (P-5).
      stills: selfHosted ? (stills.get(text(fields.id)) ?? null) : null,
    };
  }
  const tokens = (fields.tokens ?? {}) as Record<string, unknown>;
  return {
    kind: 'language',
    radiusControl: text(tokens['radius-control'], '0'),
    radiusCard: text(tokens['radius-card'], '0'),
    borderControl: text(tokens['border-control'], '1px solid'),
    borderCard: text(tokens['border-card'], '1px solid'),
    shadowCard: text(tokens['shadow-card'], 'none'),
    backdropBlur: text(tokens['backdrop-blur'], '0px'),
    controlHeight: text(tokens['control-height'], '2.5rem'),
    surfacePadding: text(tokens['space-surface-inline'], '1rem'),
    texture: textureOf(text(tokens.texture, 'none')),
    // A flat surface is one colour twice; an angle or a mix lights it.
    material: /^linear-gradient\(var\(--[a-z-]+\), var\(--[a-z-]+\)\)$/.test(
      text(tokens['surface-material'], '').replace(/\s+/g, ' '),
    )
      ? 'flat'
      : 'gradient',
  };
}

const kb = (bytes: number) => `${Math.round(bytes / 102.4) / 10} KB`;

/**
 * Each self-hosted typography pack's two stills (P-5), from the record `pnpm stills:type`
 * committed, at the URLs registry generation serves them at: Studio's own assets, which
 * only Studio's pages request.
 */
function typeStills(registry: AppearanceRegistry): ReadonlyMap<string, TypeStills> {
  const names: Record<string, { name: string; style: ReturnType<typeof typeStyleOf> }> = {};
  for (const id of selectableIds(registry, 'typography')) {
    const { manifest } = findPack(registry, 'typography', id)!;
    const roles = (manifest as { roles?: Record<string, Record<string, unknown> | undefined> })
      .roles;
    names[id] = { name: manifest.name, style: typeStyleOf(text(roles?.display?.['font-family'])) };
  }
  return typeStillsByPack(typeStillRecord as TypeStillRecord, names);
}

const READY = { status: 'ready', statusLabel: null } as const;
/**
 * `ids` in the order their manifests give Studio (`studio.order`, lowest first), and those
 * with none after them, as they came, which is the registry's order. The host names no
 * composition: each says where it sits.
 */
export function inCompositionOrder(
  ids: readonly string[],
  orderOf: (id: string) => number | undefined,
): string[] {
  const rank = (id: string) => orderOf(id) ?? Number.POSITIVE_INFINITY;
  return ids
    .map((id, index) => ({ id, index, rank: rank(id) }))
    .sort((left, right) =>
      left.rank === right.rank ? left.index - right.index : left.rank < right.rank ? -1 : 1,
    )
    .map(({ id }) => id);
}

/** A composition's still for Compare's grid: the smallest at 720px or wider, else the largest. */
function stillOf(id: string): CatalogOption['still'] {
  const unit = ASSET_MANIFEST.find((each) => each.kind === 'variant' && each.id === id);
  const stills = [...(unit?.stills ?? [])].sort((a, b) => a.width - b.width);
  const still = stills.find(({ width }) => width >= 720) ?? stills.at(-1);
  return still ? { url: still.url, width: still.width, height: still.height } : null;
}

function variantOptions(registry: AppearanceRegistry): CatalogOption[] {
  const manifestOf = (id: string) =>
    registry.variants.find((variant) => variant.manifest.id === id)!.manifest;
  const ids = inCompositionOrder(
    selectableIds(registry, 'variant'),
    (id) => manifestOf(id).studio?.order,
  );
  return ids.map((id) => {
    const manifest = manifestOf(id);
    const status = compositionStatus(id);
    return {
      id,
      still: stillOf(id),
      name: manifest.name,
      description: manifest.promise,
      signature: manifest.studio?.signature ?? null,
      tier: null,
      // Never a composition's provenance sources: the picker shows the owner its description (B2).
      provenance: [],
      performance: manifest.budgets
        ? `${manifest.performanceTier} tier, up to ${kb(manifest.budgets.js ?? 0)} of script and ${kb(manifest.budgets.css ?? 0)} of layout CSS`
        : `${manifest.performanceTier} tier`,
      access:
        manifest.motionIntent === 'still'
          ? 'No motion.'
          : `Moves (${manifest.motionIntent}), and settles under reduced motion.`,
      ...(status === 'pending' ? { status, statusLabel: PENDING_LABEL } : READY),
    };
  });
}

function packOptions(
  registry: AppearanceRegistry,
  axis: Exclude<CatalogAxis, 'variant' | 'displayMode'>,
): CatalogOption[] {
  const stills = axis === 'typography' ? typeStills(registry) : undefined;
  return selectableIds(registry, axis).map((id) => {
    const entry = findPack(registry, axis, id)!;
    const { manifest } = entry;
    const modes = 'modes' in entry ? (entry.modes as readonly string[]) : null;
    return {
      id,
      name: manifest.name,
      description: manifest.description,
      tier: manifest.tier,
      provenance: [
        `${manifest.provenance.source.name}, ${manifest.provenance.license}`,
        ...manifest.caveats,
      ],
      performance: manifest.budgets
        ? `${kb(manifest.budgets.css ?? 0)} of CSS${(manifest.budgets.font ?? 0) > 0 ? ` and ${kb(manifest.budgets.font ?? 0)} of fonts` : ''}`
        : null,
      access: modes
        ? modes.length >= 2
          ? 'Light and dark modes, each through the contrast gate.'
          : `Only a ${modes[0] ?? 'single'} mode: a visitor's other choice shows it too.`
        : null,
      ...READY,
      specimen: specimenOf(axis, manifest, modes, stills),
      stylesheet: entry.stylesheet?.url ?? null,
      family: 'family' in manifest && typeof manifest.family === 'string' ? manifest.family : null,
    };
  });
}

/**
 * The axis's retired ids, each with its survivor (LANG-1): never an option,
 * only how Studio reads a stored value that names one.
 */
function aliasesOf(
  registry: AppearanceRegistry,
  axis: Exclude<CatalogAxis, 'variant' | 'displayMode'>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...(registry.aliases?.[axis].values() ?? [])].map(({ id, aliasOf }) => [id, aliasOf]),
  );
}

/** What the workspace offers on every axis, with each axis's fallback and its retired ids. */
export function appearanceCatalog(
  registry: AppearanceRegistry = APPEARANCE_REGISTRY,
): AppearanceCatalog {
  const fallback = (axis: Exclude<CatalogAxis, 'displayMode'>) => axisFallback(axis);
  return {
    axes: [
      {
        axis: 'variant',
        label: AXIS_LABELS.variant,
        fallback: fallback('variant'),
        options: variantOptions(registry),
      },
      {
        axis: 'designLanguage',
        label: AXIS_LABELS.designLanguage,
        fallback: fallback('designLanguage'),
        options: packOptions(registry, 'designLanguage'),
        aliases: aliasesOf(registry, 'designLanguage'),
      },
      {
        axis: 'colorScheme',
        label: AXIS_LABELS.colorScheme,
        fallback: fallback('colorScheme'),
        options: packOptions(registry, 'colorScheme'),
        aliases: aliasesOf(registry, 'colorScheme'),
      },
      {
        axis: 'typography',
        label: AXIS_LABELS.typography,
        fallback: fallback('typography'),
        options: packOptions(registry, 'typography'),
        aliases: aliasesOf(registry, 'typography'),
      },
      {
        axis: 'displayMode',
        label: AXIS_LABELS.displayMode,
        fallback: 'system',
        options: DISPLAY_MODES.map((mode) => ({
          id: mode,
          name: MODE_LABELS[mode] ?? mode,
          description: null,
          tier: null,
          provenance: [],
          performance: null,
          access:
            mode === 'high-contrast'
              ? "The scheme's high-contrast tokens, for visitors who need more contrast."
              : mode === 'system'
                ? "Follows each visitor's own light or dark setting."
                : null,
          ...READY,
        })),
      },
    ],
  };
}
