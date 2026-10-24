// What `pnpm catalog` reads and prints (#20): the catalog as one list of
// entries, every shipping pack, every pack the build left out, every held
// pack, and every Research record, each with its tier and provenance; a search over it
// with filters that read and write as a URL query; and the recipes, each
// applied as the ordinary axis ids it stands for, with a diagnostic for
// each id this build can't take. It's the smallest piece Verify needs. The
// headless catalog module, `@portfolio/appearance/catalog`, is deferred,
// so nothing here is a package export: Studio (#9) owns the catalog UI.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  APPEARANCE_AXES,
  AXIS_BY_KIND,
  AXIS_NAMES,
  ALLOWED_LICENSES,
  CATALOG_TIERS,
  PACK_AXES,
  parseSelection,
  QUERY_KEYS,
  serializeSelection,
  valueProblem,
  type AppearanceDiagnostic,
  type AppearanceRegistry,
  type BaseMode,
  type CatalogTier,
  type ExcludedPack,
  type PackAxis,
  type PackKind,
  type PackManifest,
  type ResearchRecord,
} from '@portfolio/appearance';
import { REGISTRY_ID_PATTERN, type AppearanceSelection } from '@portfolio/schema';

/** Where an entry stands in this build. */
export type EntryStatus = 'shipping' | 'excluded' | 'held' | 'research';
export const ENTRY_STATUSES: readonly EntryStatus[] = ['shipping', 'excluded', 'held', 'research'];

export interface CatalogEntry {
  readonly id: string;
  readonly axis: PackAxis;
  readonly name: string;
  readonly description: string;
  readonly tier: CatalogTier;
  readonly status: EntryStatus;
  readonly packageName: string;
  readonly version: string | null;
  readonly license: string;
  readonly source: { readonly name: string; readonly url: string | null };
  readonly attribution: string | null;
  /** The upstream copyright line, for a pack under an upstream license. */
  readonly copyright: string | null;
  readonly researchedAt: string;
  readonly maintainer: string | null;
  readonly derivation: string | null;
  /** The base modes it covers: a Research record's are the anchors it was researched with. */
  readonly modes: readonly BaseMode[];
  readonly lockedMode: BaseMode | null;
  readonly caveats: readonly string[];
  /** Why it isn't selectable: an excluded pack's reason, or a Research record's. */
  readonly reason: string | null;
}

export interface CatalogSources {
  readonly registry: AppearanceRegistry;
  /** The packs registry generation left out, with each one's manifest when it parses. */
  readonly excluded: readonly {
    readonly pack: ExcludedPack;
    readonly manifest: PackManifest | null;
  }[];
  /** Every Research record, as its package holds it. */
  readonly research: readonly { readonly packageName: string; readonly record: ResearchRecord }[];
  /** Every held pack (catalog-held.ts), with the reason its gate record gives. */
  readonly held?: readonly {
    readonly kind: PackKind;
    readonly packageName: string;
    readonly manifest: PackManifest;
    readonly reason: string;
  }[];
}

const TIER_ORDER = new Map(CATALOG_TIERS.map((tier, index) => [tier, index]));

function fromManifest(
  axis: PackAxis,
  manifest: PackManifest,
  packageName: string,
  status: EntryStatus,
  reason: string | null,
  modes: readonly BaseMode[],
): CatalogEntry {
  const { provenance } = manifest;
  return {
    id: manifest.id,
    axis,
    name: manifest.name,
    description: manifest.description,
    tier: manifest.tier,
    status,
    packageName,
    version: manifest.version,
    license: provenance.license,
    source: { name: provenance.source.name, url: provenance.source.url },
    attribution: provenance.attribution,
    copyright: provenance.copyright ?? null,
    researchedAt: provenance.researchedAt,
    maintainer: provenance.maintainer,
    derivation: provenance.derivation ?? null,
    modes,
    lockedMode: manifest.lockedMode ?? null,
    caveats: manifest.caveats,
    reason,
  };
}

/** The catalog: every entry, sorted by axis, then tier, then name. */
export function catalogEntries(sources: CatalogSources): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const axis of PACK_AXES) {
    for (const pack of sources.registry.packs[axis].values()) {
      const modes = 'modes' in pack ? pack.modes : pack.manifest.modes;
      entries.push(fromManifest(axis, pack.manifest, pack.packageName, 'shipping', null, modes));
    }
  }
  for (const { pack, manifest } of sources.excluded) {
    const axis = AXIS_BY_KIND[pack.kind];
    if (manifest) {
      entries.push(
        fromManifest(axis, manifest, pack.packageName, 'excluded', pack.reason, manifest.modes),
      );
    }
  }
  for (const { kind, packageName, manifest, reason } of sources.held ?? []) {
    entries.push(
      fromManifest(AXIS_BY_KIND[kind], manifest, packageName, 'held', reason, manifest.modes),
    );
  }
  for (const { packageName, record } of sources.research) {
    entries.push({
      id: record.id,
      axis: AXIS_BY_KIND[record.kind],
      name: record.name,
      description: record.reason,
      tier: 'research',
      status: 'research',
      packageName,
      version: null,
      license: record.license,
      source: record.source,
      attribution: null,
      copyright: null,
      researchedAt: record.researchedAt,
      maintainer: null,
      derivation: null,
      modes: (['light', 'dark'] as const).filter((mode) => record.anchors?.[mode]),
      lockedMode: null,
      caveats: [],
      reason: record.reason,
    });
  }
  return entries.sort(
    (a, b) =>
      PACK_AXES.indexOf(a.axis) - PACK_AXES.indexOf(b.axis) ||
      TIER_ORDER.get(a.tier)! - TIER_ORDER.get(b.tier)! ||
      a.name.localeCompare(b.name, 'en') ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** A search: words to match, and filters, each optional. */
export interface CatalogQuery {
  /** Words every match contains, in its id, name, description, or source. */
  readonly text?: string;
  readonly axis?: PackAxis;
  readonly tier?: CatalogTier;
  readonly status?: EntryStatus;
  /** A license state or SPDX identifier, matched exactly. */
  readonly license?: string;
  /** A base mode the entry covers. */
  readonly mode?: BaseMode;
}

/** The licenses the license filter takes: the allowlist, and a Research record's `unverified`. */
const LICENSE_FILTERS: readonly string[] = [...ALLOWED_LICENSES, 'unverified'];

/** The query keys, in the order serializeCatalogQuery() writes them. Axes take the selection's own keys. */
const CATALOG_QUERY_KEYS = ['q', 'axis', 'tier', 'status', 'license', 'mode'] as const;
const AXIS_BY_QUERY_KEY = new Map<string, PackAxis>(
  PACK_AXES.map((axis) => [QUERY_KEYS[axis], axis]),
);

/** The entries `query` matches, in catalog order. */
export function searchCatalog(
  entries: readonly CatalogEntry[],
  query: CatalogQuery,
): CatalogEntry[] {
  const words = (query.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (query.axis && entry.axis !== query.axis) return false;
    if (query.tier && entry.tier !== query.tier) return false;
    if (query.status && entry.status !== query.status) return false;
    if (query.license && entry.license !== query.license) return false;
    if (query.mode && !entry.modes.includes(query.mode)) return false;
    const haystack =
      `${entry.id} ${entry.name} ${entry.description} ${entry.source.name}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * The query as a URL query, `q=...&axis=scheme&tier=stable`, in key order,
 * leaving out what's unset. The axis takes the selection's query key.
 */
export function serializeCatalogQuery(query: CatalogQuery): string {
  const params = new URLSearchParams();
  const text = query.text?.trim().replace(/\s+/g, ' ');
  if (text) params.set('q', text);
  if (query.axis) params.set('axis', QUERY_KEYS[query.axis]);
  if (query.tier) params.set('tier', query.tier);
  if (query.status) params.set('status', query.status);
  if (query.license) params.set('license', query.license);
  if (query.mode) params.set('mode', query.mode);
  return params.toString();
}

export type ParsedCatalogQuery =
  | { readonly ok: true; readonly query: CatalogQuery }
  | { readonly ok: false; readonly problem: string };

/** The query a URL query carries. Any key given twice, an unknown key, or a value a filter can't take is refused, never dropped. */
export function parseCatalogQuery(text: string): ParsedCatalogQuery {
  const params = new URLSearchParams(text.startsWith('?') ? text.slice(1) : text);
  const query: { -readonly [K in keyof CatalogQuery]: CatalogQuery[K] } = {};
  for (const key of new Set(params.keys())) {
    if (!(CATALOG_QUERY_KEYS as readonly string[]).includes(key)) {
      return {
        ok: false,
        problem: `${key} isn't a catalog filter: use ${CATALOG_QUERY_KEYS.join(', ')}.`,
      };
    }
    const values = params.getAll(key);
    if (values.length > 1) return { ok: false, problem: `${key} is given ${values.length} times.` };
    const value = values[0]!;
    switch (key) {
      case 'q':
        query.text = value;
        break;
      case 'axis': {
        const axis =
          AXIS_BY_QUERY_KEY.get(value) ?? (PACK_AXES as readonly string[]).find((a) => a === value);
        if (!axis) {
          return {
            ok: false,
            problem: `axis is ${value}: use ${[...AXIS_BY_QUERY_KEY.keys()].join(', ')}.`,
          };
        }
        query.axis = axis as PackAxis;
        break;
      }
      case 'tier':
        if (!(CATALOG_TIERS as readonly string[]).includes(value)) {
          return { ok: false, problem: `tier is ${value}: use ${CATALOG_TIERS.join(', ')}.` };
        }
        query.tier = value as CatalogTier;
        break;
      case 'status':
        if (!(ENTRY_STATUSES as readonly string[]).includes(value)) {
          return { ok: false, problem: `status is ${value}: use ${ENTRY_STATUSES.join(', ')}.` };
        }
        query.status = value as EntryStatus;
        break;
      case 'license':
        if (!LICENSE_FILTERS.includes(value)) {
          return {
            ok: false,
            problem: `license is ${value}: use ${LICENSE_FILTERS.join(', ')}. A pack under any other license is excluded: find it with status=excluded.`,
          };
        }
        query.license = value;
        break;
      case 'mode':
        if (value !== 'light' && value !== 'dark') {
          return { ok: false, problem: `mode is ${value}: use light or dark.` };
        }
        query.mode = value;
        break;
    }
  }
  return { ok: true, query };
}

const TIER_LABELS: Readonly<Record<CatalogTier, string>> = {
  stable: 'Stable',
  extended: 'Extended',
  experimental: 'Experimental',
  research: 'Research',
};

/** The search results, one line each, grouped under their axis and tier. */
export function formatResults(entries: readonly CatalogEntry[]): string[] {
  const lines: string[] = [];
  let group = '';
  for (const entry of entries) {
    const heading = `${AXIS_NAMES[entry.axis]}, ${TIER_LABELS[entry.tier]}`;
    if (heading !== group) {
      if (group) lines.push('');
      lines.push(`${heading[0]!.toUpperCase()}${heading.slice(1)}:`);
      group = heading;
    }
    const flags = [
      entry.lockedMode ? `${entry.lockedMode} only` : null,
      entry.status === 'shipping' ? null : entry.status,
    ].filter(Boolean);
    lines.push(
      `  ${entry.id}  ${entry.name}  (${entry.license}${flags.length > 0 ? `; ${flags.join('; ')}` : ''})`,
    );
  }
  return lines;
}

/** One entry's provenance, tier, and whether it can be selected, for `pnpm catalog show`. */
export function formatEntry(entry: CatalogEntry): string[] {
  const lines = [
    `${entry.name} (${entry.id})`,
    `  Axis: ${AXIS_NAMES[entry.axis]}, in ${entry.packageName}`,
    `  Tier: ${TIER_LABELS[entry.tier]}`,
    `  Status: ${
      entry.status === 'shipping'
        ? 'shipping, selectable in this build'
        : entry.status === 'excluded'
          ? `excluded from this build: ${entry.reason}`
          : entry.status === 'held'
            ? `held, never registered or selectable until it passes its gate: ${entry.reason}`
            : `Research, never registered, selectable, published, exported, or bundled: ${entry.reason}`
    }`,
  ];
  if (entry.version) lines.push(`  Version: ${entry.version}`);
  lines.push(
    `  Source: ${entry.source.name}${entry.source.url ? `, ${entry.source.url}` : ', no canonical URL'}`,
    `  License: ${entry.license}`,
  );
  if (entry.attribution) lines.push(`  Attribution: ${entry.attribution}`);
  if (entry.copyright) lines.push(`  Copyright: ${entry.copyright}`);
  lines.push(`  Researched: ${entry.researchedAt}`);
  if (entry.maintainer) lines.push(`  Maintainer: ${entry.maintainer}`);
  if (entry.derivation) lines.push(`  Derivation: ${entry.derivation}`);
  lines.push(
    `  Modes: ${entry.modes.join(' and ') || 'none recorded'}${entry.lockedMode ? `, locked to ${entry.lockedMode}` : ''}`,
  );
  for (const caveat of entry.caveats) lines.push(`  Caveat: ${caveat}`);
  if (entry.status === 'shipping') lines.push(`  Description: ${entry.description}`);
  return lines;
}

/**
 * What an id this catalog doesn't ship gets: a Research record's or an
 * excluded pack's reason, or, for an id it has never heard of, the
 * resolver's own diagnostic on each pack axis, as selecting it would.
 */
export function unavailable(
  registry: AppearanceRegistry,
  entries: readonly CatalogEntry[],
  id: string,
): string[] {
  const known = entries.filter((entry) => entry.id === id);
  if (known.length > 0) return known.flatMap(formatEntry);
  if (!REGISTRY_ID_PATTERN.test(id)) return [`${id} isn't a pack id.`];
  return PACK_AXES.map((axis) => {
    const problem = valueProblem(registry, axis, id, {
      variant: '',
      designLanguage: '',
      colorScheme: '',
      typography: '',
      displayMode: 'system',
    });
    return `${AXIS_NAMES[axis]}: ${problem ? `${problem.code}, ${id} ${problem.message}` : 'registered'}`;
  });
}

/** One recipe: a shortcut to five ordinary axis values. */
const RecipeSchema = z
  .object({
    id: z.string().regex(REGISTRY_ID_PATTERN),
    name: z.string().min(1).max(60),
    description: z.string().min(1).max(300),
    selection: z
      .object({
        variant: z.string().regex(REGISTRY_ID_PATTERN),
        designLanguage: z.string().regex(REGISTRY_ID_PATTERN),
        colorScheme: z.string().regex(REGISTRY_ID_PATTERN),
        typography: z.string().regex(REGISTRY_ID_PATTERN),
        displayMode: z.enum(['system', 'light', 'dark', 'high-contrast']),
      })
      .strict(),
  })
  .strict();

const RecipesFileSchema = z
  .object({ recipesVersion: z.literal(1), recipes: z.array(RecipeSchema).min(1).max(32) })
  .strict();

export type Recipe = z.infer<typeof RecipeSchema>;

/** The recipes file, beside the catalog lock. */
export const RECIPES_FILE = 'packages/appearance/appearance-recipes.json';

/** The recipes, checked: each id once. It throws on a malformed file. */
export function readRecipes(root: string, file = RECIPES_FILE): Recipe[] {
  const parsed = RecipesFileSchema.parse(JSON.parse(readFileSync(path.join(root, file), 'utf8')));
  const ids = new Set<string>();
  for (const recipe of parsed.recipes) {
    if (ids.has(recipe.id)) throw new Error(`${file} lists the recipe ${recipe.id} twice.`);
    ids.add(recipe.id);
  }
  return parsed.recipes;
}

export interface AppliedRecipe {
  readonly recipe: Recipe;
  /** The five ordinary axis values it persists, as they are. */
  readonly selection: Recipe['selection'];
  /** The selection's query, as the preference cookie and the demo URL carry it. */
  readonly query: string;
  /** Each value this build can't take, on its axis, as the resolver says it. */
  readonly diagnostics: readonly AppearanceDiagnostic[];
}

/**
 * A recipe applied: the axis ids it stands for, nothing else, serialized
 * as any selection is. Which of them this build can't take is reported,
 * per axis; whether a recipe is offered at all is Studio's (deferred).
 */
export function applyRecipe(registry: AppearanceRegistry, recipe: Recipe): AppliedRecipe {
  const selection = recipe.selection;
  const current = selection as AppearanceSelection;
  const diagnostics = APPEARANCE_AXES.flatMap((axis) => {
    const problem = valueProblem(registry, axis, selection[axis], current);
    return problem ? [problem] : [];
  });
  return { recipe, selection, query: serializeSelection(selection), diagnostics };
}

/** Whether a query reads back as the selection it was written from. */
export function roundTrips(applied: AppliedRecipe): boolean {
  const read = parseSelection(applied.query);
  return APPEARANCE_AXES.every((axis) => read[axis] === applied.selection[axis]);
}

/** A recipe's lines for `pnpm catalog recipe`. */
export function formatRecipe(applied: AppliedRecipe): string[] {
  const { recipe, selection, query, diagnostics } = applied;
  const lines = [
    `${recipe.name} (${recipe.id}): ${recipe.description}`,
    ...APPEARANCE_AXES.map((axis) => `  ${AXIS_NAMES[axis]}: ${selection[axis]}`),
    `  Query: ${query}`,
  ];
  if (diagnostics.length === 0) lines.push('  Every value is one this build takes.');
  for (const { axis, code, message } of diagnostics) {
    lines.push(
      `  Unavailable, ${axis ? AXIS_NAMES[axis] : 'selection'}: ${code}, ${selection[axis as keyof typeof selection]} ${message}`,
    );
  }
  return lines;
}
