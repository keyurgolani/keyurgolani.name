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
// appearance, each tier fixture pack on the fallback composition (from a
// covering array over the platform defaults and the tier packs alone, so
// the sentinels don't grow with #20's catalog), each
// state fixture, and each surface's default state, at every viewport in the
// default row, plus every other row once at 1440x900, on the first
// composition and on each tier pack's sentinel, so each tier's packs meet
// the contrast, focus, forced-colors, reduced-motion, and
// reduced-transparency rows on every PR (#11, Slice 2, the owner's [37]).
// `full` plans every cell in every row.
//
// The owner's [37] change-directed rule (11-4): a changed variant runs
// against every stable design language, on its default scheme and
// typography, and a changed pack, a language, or since #20 a color scheme
// or typography profile, against every registered variant, each pair in
// the first tuple the resolver renders as asked, from the platform
// defaults on. A generator scheme pairs with nothing: it renders only
// from a site's input. lib/changes.ts
// maps a run's changed paths to the variants and packs they belong to. A PR
// plans a changed variant's cells beside the sentinels, at every viewport
// in the default row and in every row at 1440x900, as the tier packs'
// sentinels run, and a changed pack's in the pack sweep (lib/sweep.ts): on
// one server per variant, in the [37] rule's five checks at 1440x900. It
// fails a plan that leaves out any changed pack, variant, and check
// (coverage.ts's sweepCoverage). Each cell names the axis and the pack
// that brought it in, so its failures do too. `full` plans them as if every variant and pack changed, so the
// scheduled and release runs hold every pair a PR could. A stable language
// is a shipping (non-fixture) one of the stable tier, and a shipping pack a
// registered one outside a fixture package, in any tier; variants carry no
// tier, so every registered non-fixture composition counts. The 40-cell
// PR cap and its sentinel ordering wait in the backlog.

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
  AXIS_NAMES,
  createAppearanceRegistry,
  DISPLAY_MODES,
  PACK_AXES,
  PLATFORM_DEFAULTS,
  resolveAppearance,
  type AppearanceMeta,
  type AppearanceRegistry,
  type PackAxis,
} from '../../packages/appearance/src/index';
import { MISSING_VARIANT_ID } from '../../packages/variant-contract/src/ids';
import {
  contractFixture,
  type ContractFixture,
} from '../../packages/variant-contract/src/node/fixtures';
import type { Change, ChangeAxis } from './lib/changes';
import { pairwise, sweepCoverage, tupleKey, type Coverage, type Tuple } from './coverage';
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
import { SWEEP_VIEWPORT, sweeps, type SweepCheck } from './lib/sweep';

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
  /** `session` for a surface that needs a #2 test session: its page loads signed in. */
  readonly auth?: 'session';
  /**
   * Why a Studio surface needs its script by design, when it does: without
   * it, its cells check its honest state, and their report says why.
   */
  readonly requiresScript?: string;
  /**
   * Which cells cover a surface's frame, when it declares `framed`: its
   * contrast sampler and its keyboard walk leave the frame's document to them.
   */
  readonly framed?: string;
  /** True on the one cell a surface's perfState names: its first route in that state. */
  readonly perfState?: true;
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
  /**
   * In a PR, a changed pack's pair with a variant runs in the pack sweep
   * (lib/sweep.ts): one test on its variant's sweep server, its tuple
   * applied by the visitor's cookie, running the [37] rows at 1440x900.
   */
  readonly sweep?: boolean;
  /** In the PR set. */
  readonly sentinel: boolean;
  /** Includes a fixture pack or variant, so it stays out of the zero-exception close run. */
  readonly fixture: boolean;
}

/** A changed variant or language a cell runs for. */
export interface ChangedBy {
  readonly axis: ChangeAxis;
  readonly id: string;
  /** For a changed variant, the stable design language the cell runs it against (#20). */
  readonly pack?: { readonly axis: PackAxis; readonly id: string };
}

/** The annotation that says why a cell's page requires script, in its report. */
export const REQUIRES_SCRIPT_ANNOTATION = 'requires-script';
/** The annotation that says what a framed cell's checks left to its frame's own cells, and why. */
export const FRAMED_ANNOTATION = 'framed';

/** What a framed cell's report says the contrast sampler and the focus walk left inside its frame. */
export function framedNote(cell: Pick<Cell, 'framed'>, leftOut: number) {
  return {
    type: FRAMED_ANNOTATION,
    description: `${leftOut} contrast item${leftOut === 1 ? '' : 's'} and the focus walk inside the frame left to its composition cells: ${cell.framed}`,
  };
}

/**
 * What a cell's report says of the cell itself, before any check runs: why
 * its no-JavaScript and failed-enhancement checks read its honest state.
 */
export function cellAnnotations(cell: Cell): { type: string; description: string }[] {
  return cell.requiresScript === undefined
    ? []
    : [{ type: REQUIRES_SCRIPT_ANNOTATION, description: cell.requiresScript }];
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
  /** The checks the plan must hold each changed pack and variant to (lib/sweep.ts's SWEEP_CHECKS). */
  readonly sweepChecks?: readonly SweepCheck[];
}

/**
 * The [37] rule's pairs: each changed variant with each stable design
 * language, and each changed pack, on any axis since #20, with each
 * registered variant. A variant's pair names the language it meets, so its
 * failures name that pack too.
 */
export function changePairs(
  changes: readonly Pick<Change, 'axis' | 'id'>[],
  targets: {
    readonly variants: readonly string[];
    /** The stable design languages a changed variant meets, one cell each. */
    readonly languages: readonly string[];
  },
): {
  readonly variant: string;
  readonly axis: PackAxis;
  readonly pack: string;
  readonly by: ChangedBy;
}[] {
  return changes.flatMap((change) =>
    change.axis === 'variant'
      ? targets.languages.map((pack) => ({
          variant: change.id,
          axis: 'designLanguage' as const,
          pack,
          by: {
            axis: change.axis,
            id: change.id,
            pack: { axis: 'designLanguage' as const, id: pack },
          },
        }))
      : targets.variants.map((variant) => ({
          variant,
          axis: change.axis as PackAxis,
          pack: change.id,
          by: { axis: change.axis, id: change.id },
        })),
  );
}

export function planCells({
  meta,
  registrations,
  mode,
  changes = [],
  sweepChecks,
}: PlanInput): Plan {
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

  // A PR's covering array holds the platform defaults and the tier packs
  // alone, so its sentinel rows don't grow with #20's catalog: there, a real
  // pack's rendered coverage is the [37] rule's directed cells, and every
  // pack's static gates run in check:appearance. `full` covers every pack.
  const covered = (kind: string, platform: string) =>
    mode === 'full'
      ? packIds(kind)
      : packIds(kind).filter((id) => id === platform || TIER_PACK.test(id));
  const coverage = pairwise({
    values: {
      variant: variants.map((manifest) => manifest.id),
      designLanguage: covered('design-language', PLATFORM_DEFAULTS.designLanguage),
      colorScheme: covered('color-scheme', PLATFORM_DEFAULTS.colorScheme),
      typography: covered('typography', PLATFORM_DEFAULTS.typography),
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
        all.findIndex(
          (other) =>
            other.axis === by.axis &&
            other.id === by.id &&
            other.pack?.axis === by.pack?.axis &&
            other.pack?.id === by.pack?.id,
        ) === index,
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
  // design language, on its default scheme and typography, and every
  // changed pack, a language, a scheme, or a profile since #20, against
  // every registered variant. A shipping pack is a registered one outside
  // a fixture package, in any tier: no Research record registers. A
  // generator scheme renders as asked only from a site's input, which a
  // cell has none of, so no pair takes one (#20): check:appearance's pack
  // gates are its PR check.
  const generated = new Set(
    (meta.PACKS ?? [])
      .filter(
        (pack) =>
          pack.kind === 'color-scheme' && 'generator' in pack.manifest && pack.manifest.generator,
      )
      .map((pack) => pack.manifest.id),
  );
  const shippingPacks = (kind: string) =>
    (meta.PACKS ?? [])
      .filter((pack) => pack.kind === kind && !pack.fixture && !generated.has(pack.manifest.id))
      .map((pack) => pack.manifest.id)
      .sort();
  const stablePacks = (kind: string) =>
    (meta.PACKS ?? [])
      .filter((pack) => pack.kind === kind && !pack.fixture && pack.manifest.tier === 'stable')
      .map((pack) => pack.manifest.id)
      .sort();
  const preferred = (kind: string, platform: string) => [
    ...new Set([platform, ...stablePacks(kind), ...packIds(kind).sort()]),
  ];
  const others = {
    designLanguage: preferred('design-language', PLATFORM_DEFAULTS.designLanguage),
    colorScheme: preferred('color-scheme', PLATFORM_DEFAULTS.colorScheme),
    typography: preferred('typography', PLATFORM_DEFAULTS.typography),
  };
  const modes = ['system', ...DISPLAY_MODES.filter((each) => each !== 'system')];
  const shipping = {
    designLanguage: shippingPacks('design-language'),
    colorScheme: shippingPacks('color-scheme'),
    typography: shippingPacks('typography'),
  } as const satisfies Record<PackAxis, readonly string[]>;
  const registered = (axis: PackAxis, id: string) =>
    registry.packs[axis].has(id) && !generated.has(id);
  const directed: readonly Change[] =
    mode === 'full'
      ? [
          ...variants.map((manifest) => ({ axis: 'variant' as const, id: manifest.id, paths: [] })),
          ...PACK_AXES.flatMap((axis) =>
            shipping[axis].map((id) => ({ axis, id, paths: [] as string[] })),
          ),
        ]
      : changes.filter((change) =>
          change.axis === 'variant'
            ? variants.some((manifest) => manifest.id === change.id)
            : registered(change.axis, change.id),
        );
  for (const { variant, axis, pack, by } of changePairs(directed, {
    variants: variants.map((manifest) => manifest.id),
    languages: stablePacks('design-language'),
  })) {
    const manifest = variants.find((each) => each.id === variant)!;
    // The pair's pack on its axis, and the first tuple around it the resolver renders as asked.
    const choices = { ...others, [axis]: [pack] };
    let tuple: Tuple | undefined;
    search: for (const displayMode of modes) {
      for (const designLanguage of choices.designLanguage) {
        for (const colorScheme of choices.colorScheme) {
          for (const typography of choices.typography) {
            const candidate = { variant, designLanguage, colorScheme, typography, displayMode };
            if (accepts(registry, candidate, 'read-only')) {
              tuple = candidate;
              break search;
            }
          }
        }
      }
    }
    if (!tuple) {
      throw new Error(
        `The ${by.axis === 'variant' ? `changed variant ${by.id}` : `changed ${AXIS_NAMES[by.axis]} ${by.id}`} meets ${by.axis === 'variant' ? `the stable ${AXIS_NAMES[axis]} ${pack}` : `the variant ${variant}`} in no tuple the resolver renders as asked, so the [37] rule can't run it.`,
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
          ...(surface.auth === 'session' ? { auth: 'session' as const } : {}),
          ...(surface.requiresScript ? { requiresScript: surface.requiresScript.reason } : {}),
          ...(surface.framed ? { framed: surface.framed.reason } : {}),
          ...(routeIndex === 0 && surface.perfState === state.id
            ? { perfState: true as const }
            : {}),
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
  const selected = (
    mode === 'full' ? ordered : ordered.filter((cell) => cell.sentinel || cell.changed)
  ).map((cell) => (sweeps(cell, mode) ? { ...cell, sweep: true } : cell));
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
        // A swept cell is one test at the sweep's viewport, which runs the [37] rows itself.
        const planned = cell.sweep
          ? viewport === SWEEP_VIEWPORT && row === DEFAULT_ROW
          : mode === 'full' ||
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
          // A change-directed cell too: a changed variant or language is where
          // content-inventory and failed-enhancement regressions show.
          // The sweep's five checks need no reload conditions.
          conditions:
            mode === 'full' ||
            cell === firstDefault ||
            cell.pack !== undefined ||
            (cell.changed !== undefined && !cell.sweep),
        });
      }
    }
  }

  // Every changed pack against every variant, in each of the [37] checks: a pair or a check the plan left out fails it.
  const { missing } = sweepCoverage({
    changes: directed.filter((change) => change.axis !== 'variant'),
    variants: variants.map((manifest) => manifest.id),
    tests,
    ...(sweepChecks ? { checks: sweepChecks } : {}),
  });
  if (missing.length > 0) {
    throw new Error(
      `The PR plan leaves out ${missing.length} changed pack, variant, and check triple(s) the [37] rule directs, first ${missing[0]}.`,
    );
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
