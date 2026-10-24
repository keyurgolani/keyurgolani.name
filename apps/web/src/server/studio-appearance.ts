import 'server-only';
import {
  axisFallback,
  DISPLAY_MODES,
  findPack,
  selectableIds,
  type AppearanceRegistry,
} from '@portfolio/appearance';
import type { AppearanceCatalog, CatalogAxis, CatalogOption } from '~/lib/studio/appearance';
import { APPEARANCE_REGISTRY } from '~/lib/appearance-registry';

// What the Appearance workspace may offer (#8, Slice 5 items 1 and 3), from
// the registry this build has: on each of the four id axes, the ids a site
// may select, as selectableIds() gives them, so the fallback composition and
// Research packs are never listed, and nothing this build doesn't register
// is either; and the display modes. Each option carries what the workspace
// shows before publish: its tier, provenance, performance, and what it
// means for access. Plain data, for the client, with no stylesheet and no
// manifest beyond what it names.

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

const kb = (bytes: number) => `${Math.round(bytes / 102.4) / 10} KB`;

function variantOptions(registry: AppearanceRegistry): CatalogOption[] {
  return selectableIds(registry, 'variant').map((id) => {
    const { manifest } = registry.variants.find((variant) => variant.manifest.id === id)!;
    return {
      id,
      name: manifest.name,
      description: manifest.promise,
      tier: null,
      provenance: manifest.provenance.sources.map(({ source }) => source).slice(0, 3),
      performance: manifest.budgets
        ? `${manifest.performanceTier} tier, up to ${kb(manifest.budgets.js ?? 0)} of script and ${kb(manifest.budgets.css ?? 0)} of layout CSS`
        : `${manifest.performanceTier} tier`,
      access:
        manifest.motionIntent === 'still'
          ? 'No motion.'
          : `Moves (${manifest.motionIntent}), and settles under reduced motion.`,
    };
  });
}

function packOptions(
  registry: AppearanceRegistry,
  axis: Exclude<CatalogAxis, 'variant' | 'displayMode'>,
): CatalogOption[] {
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
    };
  });
}

/** What the workspace offers on every axis, with each axis's fallback. */
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
      },
      {
        axis: 'colorScheme',
        label: AXIS_LABELS.colorScheme,
        fallback: fallback('colorScheme'),
        options: packOptions(registry, 'colorScheme'),
      },
      {
        axis: 'typography',
        label: AXIS_LABELS.typography,
        fallback: fallback('typography'),
        options: packOptions(registry, 'typography'),
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
        })),
      },
    ],
  };
}
