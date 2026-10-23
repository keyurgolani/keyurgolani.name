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
// `full` plans every cell in every row. Slice 4 adds the 40-cell cap and
// change mapping.

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
  /** In the PR set. */
  readonly sentinel: boolean;
  /** Includes a fixture pack or variant, so it stays out of the zero-exception close run. */
  readonly fixture: boolean;
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
}

export function planCells({ meta, registrations, mode }: PlanInput): Plan {
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
    // A cell planned twice is a sentinel if either plan says so.
    cells.set(id, { ...cell, id, sentinel: cell.sentinel || existing?.sentinel === true });
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
  const selected = mode === 'full' ? ordered : ordered.filter((cell) => cell.sentinel);
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
          ((cell === firstDefault || cell.pack !== undefined) && viewport === VIEWPORTS[0]);
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
  };
}
