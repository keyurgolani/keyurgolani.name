// The quality cells (#11, Slice 1, item 3). A cell is one (surface or
// composition, appearance tuple, route, state fixture), run over every
// viewport, preference row, and engine that applies. They come from the
// registries of the build under test (#5's variants with their routes and
// performanceTier, #19's packs) and from quality/surfaces/ and
// quality/units/, keeping only tuples the #19 resolver renders as asked:
//
// - Appearance rows: coverage.ts's covering array, each on the `complete`
//   fixture at the composition's first route.
// - Every other route and state fixture under the composition's published
//   default appearance, in each display mode.
// - Each registered surface's routes in each of its states.
//
// `pr` plans the sentinels: each composition's published default
// appearance, each tier fixture pack on the fallback composition, each
// state fixture, and each surface's default state, at every viewport in the
// default row, plus every other row once at 1440x900, on the first
// composition and on each tier pack's sentinel, so each tier's packs meet
// the contrast, focus, forced-colors, reduced-motion, and
// reduced-transparency rows on every PR (#11, Slice 2, the owner's [37]).
// `full` plans every cell in every row.
//
// The owner's [37] change-directed rule (11-4): a changed variant runs
// against every stable design language, and a changed language against
// every stable variant, each pair in the first tuple the resolver renders as
// asked, from the platform defaults on. lib/changes.ts maps a run's changed
// paths to the variants and languages they belong to. A PR plans those
// cells beside the sentinels, at every viewport in the default row and in
// every row at 1440x900, as the tier packs' sentinels run, and each cell
// names the axis that brought it in, so its failures do too. `full` plans
// them as if every variant and language changed, so the scheduled and
// release runs hold every pair a PR could. Stable languages are the
// shipping (non-fixture) design languages of the stable tier; variants
// carry no tier, so every registered non-fixture composition counts as
// stable. The 40-cell PR cap and its sentinel ordering wait in the backlog.

// First: readBuildMeta() loads the generated registry, which imports
// `server-only`; #73's shim resolves it to its empty module, as Next's
// server bundles do. The planner, the specs, the checklist, and their
// tests all read the registry through here.
import '../../apps/web/scripts/server-only.cjs';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parse, parseDocument } from 'yaml';
import {
  createAppearanceRegistry,
  DISPLAY_MODES,
  PLATFORM_DEFAULTS,
  resolveAppearance,
  type AppearanceMeta,
  type AppearanceRegistry,
} from '../../packages/appearance/src/index';
import { MISSING_VARIANT_ID } from '../../packages/variant-contract/src/ids';
import {
  contractFixture,
  type ContractFixture,
} from '../../packages/variant-contract/src/node/fixtures';
import type { Change, ChangeAxis } from './lib/changes';
import { pairwise, tupleKey, type Coverage, type Tuple } from './coverage';
import {
  DEFAULT_ROW,
  PREFERENCE_ROWS,
  VIEWPORTS,
  type PreferenceRow,
  type Viewport,
} from './lib/matrix';
import type {
  CellField,
  NotApplicable,
  PerformanceTier,
  Profile,
  Registrations,
  SurfaceRegistration,
} from './lib/registration';
import { APPEARANCE_STATE, STATE_FIXTURES, type StateFixture } from './lib/state-fixtures';

export type RunMode = 'pr' | 'full';

/** The fallback composition's id, which a site reaches by selecting a variant nothing registers. */
export const FALLBACK_ID = 'fallback';

/** The nine tier packs (#11, Slice 1, item 9), by id. */
const TIER_PACK = /^fixture-(?:language|scheme|typography)-(?:stable|extended|experimental)$/;

/** The registry metadata a quality build generated, with its fixture flags. */
export interface BuildMeta extends AppearanceMeta {
  readonly FIXTURE_FLAGS: Readonly<Record<string, boolean>>;
}

/** Reads the metadata module of the apps/web at `web`, as tests/variants/target.ts does. */
export function readBuildMeta(web: string): BuildMeta {
  // apps/web has no "type": "module", so its modules are CommonJS to Node.
  const require = createRequire(import.meta.url);
  return require(path.join(web, 'src', 'lib', 'generated', 'registry.meta.ts')) as BuildMeta;
}

export type CellKind = 'composition' | 'surface';

export interface Cell {
  /** Stable and unique: kind, target, state, route, and tuple. */
  readonly id: string;
  readonly kind: CellKind;
  /** The composition's registry id, or the surface's id. */
  readonly target: string;
  readonly owner: string;
  readonly profile: Profile;
  readonly performanceTier: PerformanceTier;
  readonly tuple: Tuple;
  /** The path the cell loads, its state's query included. */
  readonly path: string;
  /** The route it stands for, as failure records name it. */
  readonly route: string;
  readonly state: string;
  readonly expectedStatus: number;
  /** Why it can't run yet, when its state is a stand-in: its tests skip with this. */
  readonly pending?: string;
  /** The contract fixture whose pair the server reads. */
  readonly source: ContractFixture['name'];
  /** The tier pack the cell is the sentinel of, if any. */
  readonly pack?: string;
  /** The changed variants and languages that brought it in, by the [37] rule. */
  readonly changed?: readonly ChangedBy[];
  /** In the PR set. */
  readonly sentinel: boolean;
  /** Includes a fixture pack or variant, so it stays out of the zero-exception close run. */
  readonly fixture: boolean;
}

/** A changed variant or language a cell runs for. */
export interface ChangedBy {
  readonly axis: ChangeAxis;
  readonly id: string;
}

export interface PlannedTest {
  readonly cell: Cell;
  readonly viewport: Viewport;
  readonly row: PreferenceRow;
  /** Why it doesn't apply, when a registration or its state says so: it skips with this. */
  readonly skip?: string;
  /** Why it doesn't apply on an engine, by engine: the project running it skips with this. */
  readonly engineSkips: Readonly<Record<string, string>>;
  /**
   * Whether the default row's reload conditions (the content inventory,
   * reflow, and failed enhancement) run here. A full run plans them on
   * every cell; a PR run only on the first composition's default and each
   * tier pack's sentinel, leaving the other state fixtures to the full run.
   */
  readonly conditions: boolean;
}

export interface Plan {
  readonly mode: RunMode;
  readonly cells: readonly Cell[];
  readonly tests: readonly PlannedTest[];
  readonly coverage: Coverage;
  /** Every registered composition and surface, each of which must get results. */
  readonly targets: readonly { readonly kind: CellKind; readonly id: string }[];
  /** Every reason a planned test may skip with. */
  readonly reasons: readonly string[];
  /** The changed variants and languages the [37] rule planned cells for. */
  readonly changes: readonly Change[];
}

/** A tuple for `variant` with the platform's default packs, in `displayMode`. */
export function defaultTuple(variant: string, displayMode: string): Tuple {
  return {
    variant,
    designLanguage: PLATFORM_DEFAULTS.designLanguage,
    colorScheme: PLATFORM_DEFAULTS.colorScheme,
    typography: PLATFORM_DEFAULTS.typography,
    displayMode,
  };
}

/**
 * Whether the #19 resolver renders `tuple` as asked: the same ids on every
 * axis, the asked display mode, not pinned by the scheme, and no
 * diagnostic, but the fallback composition's own (a site can't select it,
 * and reaches it by selecting a variant nothing registers).
 */
export function accepts(registry: AppearanceRegistry, tuple: Tuple, profile: Profile): boolean {
  const resolved = resolveAppearance({
    published: tuple as never,
    visitorControls: {
      variant: 'locked',
      designLanguage: 'locked',
      colorScheme: 'locked',
      typography: 'locked',
      displayMode: 'locked',
    },
    motionPolicy: 'respect-os',
    profile,
    registry,
  });
  const same = (Object.keys(tuple) as (keyof Tuple)[]).every(
    (axis) => resolved.selection[axis] === tuple[axis],
  );
  const diagnostics = resolved.diagnostics.filter(
    (diagnostic) => !(tuple.variant === FALLBACK_ID && diagnostic.axis === 'variant'),
  );
  return same && !resolved.modeLocked && diagnostics.length === 0;
}

/** The fixture's site document, publishing `tuple`. */
export function siteTextFor(fixture: ContractFixture, tuple: Tuple): string {
  const document = parseDocument(readFileSync(fixture.files.site, 'utf8'));
  document.setIn(
    ['appearance', 'variant'],
    tuple.variant === FALLBACK_ID ? MISSING_VARIANT_ID : tuple.variant,
  );
  for (const axis of ['designLanguage', 'colorScheme', 'typography', 'displayMode'] as const) {
    document.setIn(['appearance', axis], tuple[axis]);
  }
  return document.toString();
}

/** The work routes a fixture serves: /work/<slug> for each public work with a case study and a slug. */
export function workRoutes(fixture: ContractFixture): string[] {
  const portfolio = parse(readFileSync(fixture.files.portfolio, 'utf8')) as {
    works?: { slug?: string; caseStudy?: unknown; visibility?: string }[];
  };
  return (portfolio.works ?? [])
    .filter((work) => work.slug && work.caseStudy !== undefined && work.visibility !== 'private')
    .map((work) => `/work/${work.slug}`)
    .sort();
}

/** The cells' id for a tuple: its values, joined. */
const tupleLabel = (tuple: Tuple) => tupleKey(tuple);

/** Whether a test's fields equal every field the exclusion names. */
function excludes(
  exclusion: NotApplicable,
  fields: Readonly<Partial<Record<CellField, string>>>,
): boolean {
  return Object.entries(exclusion.match).every(
    ([key, value]) => fields[key as CellField] === value,
  );
}

export interface PlanInput {
  readonly meta: BuildMeta;
  readonly registrations: Registrations;
  readonly mode: RunMode;
  /** The variants and languages a PR changes (lib/changes.ts). `full` plans every one. */
  readonly changes?: readonly Change[];
}

/** The [37] rule's pairs: each changed variant with each stable language, each changed language with each stable variant. */
export function changePairs(
  changes: readonly Pick<Change, 'axis' | 'id'>[],
  stable: { readonly variants: readonly string[]; readonly designLanguages: readonly string[] },
): { readonly variant: string; readonly designLanguage: string; readonly by: ChangedBy }[] {
  return changes.flatMap((change) =>
    change.axis === 'variant'
      ? stable.designLanguages.map((designLanguage) => ({
          variant: change.id,
          designLanguage,
          by: { axis: change.axis, id: change.id },
        }))
      : stable.variants.map((variant) => ({
          variant,
          designLanguage: change.id,
          by: { axis: change.axis, id: change.id },
        })),
  );
}

export function planCells({ meta, registrations, mode, changes = [] }: PlanInput): Plan {
  const registry = createAppearanceRegistry(meta);
  const variants = meta.VARIANTS.map(({ manifest }) => manifest).filter(
    (manifest) => !manifest.id.startsWith('fixture-'),
  );
  const packIds = (kind: string) =>
    (meta.PACKS ?? [])
      .filter((pack) => pack.kind === kind && (!pack.fixture || TIER_PACK.test(pack.manifest.id)))
      .map((pack) => pack.manifest.id);
  const tierPacks = (meta.PACKS ?? [])
    .filter((pack) => pack.fixture && TIER_PACK.test(pack.manifest.id))
    .map((pack) => ({
      axis: (
        {
          'design-language': 'designLanguage',
          'color-scheme': 'colorScheme',
          typography: 'typography',
        } as const
      )[pack.kind],
      id: pack.manifest.id,
    }));

  const coverage = pairwise({
    values: {
      variant: variants.map((manifest) => manifest.id),
      designLanguage: packIds('design-language'),
      colorScheme: packIds('color-scheme'),
      typography: packIds('typography'),
      displayMode: [...DISPLAY_MODES],
    },
    accepts: (tuple) => accepts(registry, tuple, 'read-only'),
    fallbackVariant: FALLBACK_ID,
    fixturePacks: tierPacks,
  });
  // Each tier pack's sentinel: the first row it meets the fallback composition in.
  const sentinels = new Map<string, string[]>();
  for (const { axis, id } of [...tierPacks].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const row = coverage.rows.find((each) => each.variant === FALLBACK_ID && each[axis] === id)!;
    sentinels.set(tupleKey(row), [...(sentinels.get(tupleKey(row)) ?? []), id]);
  }

  const cells = new Map<string, Cell>();
  const add = (cell: Omit<Cell, 'id'>) => {
    const id = `${cell.kind}:${cell.target} ${cell.state} ${cell.path} ${tupleLabel(cell.tuple)}`;
    const existing = cells.get(id);
    // A cell planned twice is a sentinel if either plan says so, and keeps every reason it was planned for.
    const changed = [...(existing?.changed ?? []), ...(cell.changed ?? [])].filter(
      (by, index, all) =>
        all.findIndex((other) => other.axis === by.axis && other.id === by.id) === index,
    );
    cells.set(id, {
      ...cell,
      id,
      sentinel: cell.sentinel || existing?.sentinel === true,
      pack: cell.pack ?? existing?.pack,
      changed: changed.length > 0 ? changed : undefined,
    });
  };
  const fixtureIn = (tuple: Tuple) =>
    tuple.variant.startsWith('fixture-') ||
    [tuple.designLanguage, tuple.colorScheme, tuple.typography].some((id) =>
      id.startsWith('fixture-'),
    );

  for (const manifest of variants) {
    const first = '/';
    const base = {
      kind: 'composition' as const,
      target: manifest.id,
      owner: manifest.id === FALLBACK_ID ? '#5' : `the ${manifest.id} composition`,
      profile: 'read-only' as const,
      performanceTier: manifest.performanceTier,
    };
    // Appearance rows: the covering array on `complete` at the first route.
    for (const tuple of coverage.rows.filter((row) => row.variant === manifest.id)) {
      const packs = sentinels.get(tupleKey(tuple)) ?? [];
      add({
        ...base,
        tuple,
        path: first,
        route: first,
        state: APPEARANCE_STATE.id,
        expectedStatus: APPEARANCE_STATE.status,
        source: APPEARANCE_STATE.source,
        pack: packs.length > 0 ? packs.join(' ') : undefined,
        sentinel: packs.length > 0,
        fixture: fixtureIn(tuple),
      });
    }
    // Every other route and state under the published default appearance, in each display mode.
    const routes = [first, ...workRoutes(contractFixture(APPEARANCE_STATE.source))];
    for (const displayMode of DISPLAY_MODES) {
      const tuple = defaultTuple(manifest.id, displayMode);
      if (!accepts(registry, tuple, 'read-only')) continue;
      const sentinel = displayMode === 'system';
      for (const route of routes) {
        add({
          ...base,
          tuple,
          path: route,
          route,
          state: APPEARANCE_STATE.id,
          expectedStatus: APPEARANCE_STATE.status,
          source: APPEARANCE_STATE.source,
          sentinel: sentinel && route === first,
          fixture: false,
        });
      }
      for (const state of STATE_FIXTURES.filter(
        (each: StateFixture) => each !== APPEARANCE_STATE,
      )) {
        const at = state.path ?? first;
        add({
          ...base,
          tuple,
          path: at,
          route: at,
          state: state.id,
          expectedStatus: state.status,
          source: state.source,
          pending: state.pending,
          // Each state's sentinel is on the first composition only.
          sentinel: sentinel && manifest === variants[0],
          fixture: false,
        });
      }
    }
  }

  // The [37] rule's cells: every changed variant against every stable
  // language, and every changed language against every stable variant.
  const stablePacks = (kind: string) =>
    (meta.PACKS ?? [])
      .filter((pack) => pack.kind === kind && !pack.fixture && pack.manifest.tier === 'stable')
      .map((pack) => pack.manifest.id)
      .sort();
  const preferred = (kind: string, platform: string) => [
    ...new Set([platform, ...stablePacks(kind), ...packIds(kind).sort()]),
  ];
  const schemes = preferred('color-scheme', PLATFORM_DEFAULTS.colorScheme);
  const typographies = preferred('typography', PLATFORM_DEFAULTS.typography);
  const modes = ['system', ...DISPLAY_MODES.filter((each) => each !== 'system')];
  const languageIds = new Set(
    (meta.PACKS ?? [])
      .filter((pack) => pack.kind === 'design-language' && pack.manifest.tier !== 'research')
      .map((pack) => pack.manifest.id),
  );
  const directed: readonly Change[] =
    mode === 'full'
      ? [
          ...variants.map((manifest) => ({ axis: 'variant' as const, id: manifest.id, paths: [] })),
          ...packIds('design-language')
            .filter((id) => languageIds.has(id))
            .sort()
            .map((id) => ({ axis: 'designLanguage' as const, id, paths: [] })),
        ]
      : changes.filter((change) =>
          change.axis === 'variant'
            ? variants.some((manifest) => manifest.id === change.id)
            : languageIds.has(change.id),
        );
  for (const { variant, designLanguage, by } of changePairs(directed, {
    variants: variants.map((manifest) => manifest.id),
    designLanguages: stablePacks('design-language'),
  })) {
    const manifest = variants.find((each) => each.id === variant)!;
    let tuple: Tuple | undefined;
    search: for (const displayMode of modes) {
      for (const colorScheme of schemes) {
        for (const typography of typographies) {
          const candidate = { variant, designLanguage, colorScheme, typography, displayMode };
          if (accepts(registry, candidate, 'read-only')) {
            tuple = candidate;
            break search;
          }
        }
      }
    }
    if (!tuple) {
      throw new Error(
        `The ${by.axis === 'variant' ? 'changed variant' : 'changed design language'} ${by.id} meets ${by.axis === 'variant' ? `the stable design language ${designLanguage}` : `the stable variant ${variant}`} in no tuple the resolver renders as asked, so the [37] rule can't run it.`,
      );
    }
    add({
      kind: 'composition',
      target: variant,
      owner: variant === FALLBACK_ID ? '#5' : `the ${variant} composition`,
      profile: 'read-only',
      performanceTier: manifest.performanceTier,
      tuple,
      path: '/',
      route: '/',
      state: APPEARANCE_STATE.id,
      expectedStatus: APPEARANCE_STATE.status,
      source: APPEARANCE_STATE.source,
      sentinel: false,
      fixture: fixtureIn(tuple),
      changed: [by],
    });
  }

  for (const surface of registrations.surfaces) {
    const tuple = defaultTuple(FALLBACK_ID, 'system');
    surface.routes.forEach((route, routeIndex) => {
      surface.stateFixtures.forEach((state, stateIndex) => {
        const query = new URLSearchParams(state.query).toString();
        add({
          kind: 'surface',
          target: surface.id,
          owner: surface.owner,
          profile: surface.profile,
          performanceTier: surface.performanceTier,
          tuple,
          path: query ? `${route}?${query}` : route,
          route,
          state: state.id,
          expectedStatus: state.status,
          source: APPEARANCE_STATE.source,
          sentinel: routeIndex === 0 && stateIndex === 0,
          fixture: false,
        });
      });
    });
  }

  const exclusionsFor = (cell: Cell): readonly NotApplicable[] => {
    if (cell.kind === 'surface') {
      return registrations.surfaces.find(
        (surface: SurfaceRegistration) => surface.id === cell.target,
      )!.notApplicable;
    }
    // A composition's unit, and the unit of each pack its tuple names.
    const ids = [
      cell.target,
      cell.tuple.designLanguage,
      cell.tuple.colorScheme,
      cell.tuple.typography,
    ];
    return registrations.units
      .filter((unit) => ids.includes(unit.id))
      .flatMap((unit) => unit.notApplicable);
  };

  const ordered = [...cells.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const selected =
    mode === 'full' ? ordered : ordered.filter((cell) => cell.sentinel || cell.changed);
  const firstDefault = selected.find(
    (cell) =>
      cell.kind === 'composition' &&
      cell.target === variants[0]?.id &&
      cell.state === APPEARANCE_STATE.id &&
      cell.path === '/' &&
      tupleKey(cell.tuple) === tupleKey(defaultTuple(cell.target, 'system')),
  );
  const tests: PlannedTest[] = [];
  for (const cell of selected) {
    for (const viewport of VIEWPORTS) {
      for (const row of PREFERENCE_ROWS) {
        const planned =
          mode === 'full' ||
          row === DEFAULT_ROW ||
          ((cell === firstDefault || cell.pack !== undefined || cell.changed !== undefined) &&
            viewport === VIEWPORTS[0]);
        if (!planned) continue;
        const fields = { route: cell.route, state: cell.state, viewport: viewport.id, row: row.id };
        const exclusions = exclusionsFor(cell);
        const exclusion = exclusions.find(
          (each) => each.match.engine === undefined && excludes(each, fields),
        );
        const engineSkips: Record<string, string> = {};
        for (const each of exclusions) {
          const { engine, ...rest } = each.match;
          if (engine !== undefined && excludes({ ...each, match: rest }, fields)) {
            engineSkips[engine] ??= each.reason;
          }
        }
        tests.push({
          cell,
          viewport,
          row,
          skip: cell.pending ?? exclusion?.reason,
          engineSkips,
          conditions: mode === 'full' || cell === firstDefault || cell.pack !== undefined,
        });
      }
    }
  }

  const reasons = new Set<string>();
  for (const state of STATE_FIXTURES) if (state.pending) reasons.add(state.pending);
  for (const surface of registrations.surfaces)
    for (const { reason } of surface.notApplicable) reasons.add(reason);
  for (const unit of registrations.units)
    for (const { reason } of unit.notApplicable) reasons.add(reason);

  return {
    mode,
    cells: selected,
    tests,
    coverage,
    targets: [
      ...variants.map((manifest) => ({ kind: 'composition' as const, id: manifest.id })),
      ...registrations.surfaces.map((surface) => ({ kind: 'surface' as const, id: surface.id })),
    ],
    reasons: [...reasons].sort(),
    changes: directed,
  };
}
