// The scheduled cross-product (#20): every registered variant against
// every shipping design language, color scheme, and typography profile in
// every display mode. The whole registered product is too many tuples to
// load in a browser each night (tens of thousands per variant once the
// catalog ships), so it runs in two parts, each sharded the same way
// (CATALOG_SHARD=<n>/<m>, 1/1 by default):
//
// - the static smoke, `pnpm ci:catalog-static`: every tuple, in Node, with
//   no browser (static.ts): resolve, compile, the pack gates, and the
//   contrast table;
// - the browser smoke, `pnpm ci:catalog-full`: a deterministic wider sample
//   loaded under the demo profile, which reads each tuple from the query,
//   each with a screenshot. The sample holds every shipping pack at least
//   once per variant and per display mode (coverageSample), and a seeded
//   draw from the shard's own tuples fills each shard to its budget.
//
// #20 PR 3's sharded rehearsal (REHEARSAL, below) runs both parts wider,
// with stored resolved tokens and screenshots. Covering arrays stay
// deferred, so no part uses one.
//
// A tuple is in the cross-product when #19's resolver renders it as asked
// under demo: a single-mode scheme meets the modes it has. Shards take
// tuples round robin from one sorted list, so every tuple is in exactly one
// shard and each shard's share is even. Each part has a budget of tuples per
// shard (BUDGET), which the workflow's shard count and timeouts are sized
// from; a plan over it fails before anything runs, naming the budget,
// rather than timing out.

// First: readBuildMeta() loads the generated registry, which imports server-only.
import '../../apps/web/scripts/server-only.cjs';
import {
  createAppearanceRegistry,
  DISPLAY_MODES,
  PACK_AXES,
  QUERY_KEYS,
  resolveAppearance,
  type AppearanceRegistry,
  type GeneratedSchemes,
  type PackAxis,
} from '../../packages/appearance/src/index';
import { MISSING_VARIANT_ID } from '../../packages/variant-contract/src/ids';
import { accepts, FALLBACK_ID, type BuildMeta } from '../quality/cells';
import type { Tuple } from '../quality/coverage';

/** The viewport every smoke test runs at. */
export const VIEWPORT = { width: 1280, height: 800 } as const;

const KIND: Readonly<Record<PackAxis, string>> = {
  designLanguage: 'design-language',
  colorScheme: 'color-scheme',
  typography: 'typography',
};

export interface Shard {
  /** 1-based. */
  readonly index: number;
  readonly count: number;
}

/** CATALOG_SHARD as <n>/<m>, 1/1 when it's unset. It throws on anything else. */
export function readShard(value: string | undefined): Shard {
  if (value === undefined || value === '') return { index: 1, count: 1 };
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value);
  if (!match || Number(match[1]) > Number(match[2])) {
    throw new Error(
      `CATALOG_SHARD is ${value}, and it must be <n>/<m> with 1 <= n <= m, such as 2/4.`,
    );
  }
  return { index: Number(match[1]), count: Number(match[2]) };
}

/** The packs a build ships on `axis`: registered ones outside fixture packages, sorted. */
export function shippingPacks(meta: BuildMeta, axis: PackAxis): string[] {
  return (meta.PACKS ?? [])
    .filter((pack) => pack.kind === KIND[axis] && !pack.fixture)
    .map((pack) => pack.manifest.id)
    .sort();
}

/** Every registered composition outside a fixture package, the fallback composition included, sorted. */
export function registeredVariants(meta: BuildMeta): string[] {
  return meta.VARIANTS.map(({ manifest }) => manifest.id)
    .filter((id) => !id.startsWith('fixture-'))
    .sort();
}

/**
 * Whether the resolver renders `tuple` as asked under demo with `generated`
 * sets, as accepts() in tests/quality/cells.ts says with none: the same ids,
 * the asked mode, not pinned, and no diagnostic but the fallback
 * composition's own.
 */
function rendersWith(
  registry: AppearanceRegistry,
  tuple: Tuple,
  generated: GeneratedSchemes,
): boolean {
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
    profile: 'demo',
    registry,
    generated,
  });
  const same = (Object.keys(tuple) as (keyof Tuple)[]).every(
    (axis) => resolved.selection[axis] === tuple[axis],
  );
  const diagnostics = resolved.diagnostics.filter(
    (diagnostic) => !(tuple.variant === FALLBACK_ID && diagnostic.axis === 'variant'),
  );
  return same && !resolved.modeLocked && diagnostics.length === 0;
}

/**
 * The complete registered cross-product, as the resolver renders it under
 * demo, sorted. A generator scheme renders only from generated sets: with
 * `generated` (the reference records', #20 PR 3) it joins the static
 * smoke's cross-product, and with none, as in the browser, where no site
 * input reaches the demo, it doesn't.
 */
export function crossProduct(meta: BuildMeta, generated?: GeneratedSchemes): Tuple[] {
  const registry = createAppearanceRegistry(meta);
  const tuples: Tuple[] = [];
  const [languages, schemes, typographies] = PACK_AXES.map((axis) => shippingPacks(meta, axis)) as [
    string[],
    string[],
    string[],
  ];
  for (const variant of registeredVariants(meta)) {
    for (const designLanguage of languages) {
      for (const colorScheme of schemes) {
        for (const typography of typographies) {
          for (const displayMode of DISPLAY_MODES) {
            const tuple = { variant, designLanguage, colorScheme, typography, displayMode };
            const generatedScheme =
              generated !== undefined &&
              registry.packs.colorScheme.get(colorScheme)?.manifest.generator !== undefined;
            if (
              generatedScheme
                ? rendersWith(registry, tuple, generated)
                : accepts(registry, tuple, 'demo')
            )
              tuples.push(tuple);
          }
        }
      }
    }
  }
  return tuples;
}

/** The tuples one shard runs: every m-th, from its n-th on. */
export function shardTuples(tuples: readonly Tuple[], shard: Shard): Tuple[] {
  return tuples.filter((_, index) => index % shard.count === shard.index - 1);
}

/** The page a tuple loads under demo: the composition's first route, with the tuple in the query. */
export function tuplePath(tuple: Tuple): string {
  const query = new URLSearchParams({
    [QUERY_KEYS.variant]: tuple.variant === FALLBACK_ID ? MISSING_VARIANT_ID : tuple.variant,
    [QUERY_KEYS.designLanguage]: tuple.designLanguage,
    [QUERY_KEYS.colorScheme]: tuple.colorScheme,
    [QUERY_KEYS.typography]: tuple.typography,
    [QUERY_KEYS.displayMode]: tuple.displayMode,
  });
  return `/?${query}`;
}

/** A tuple as failure records name it: designLanguage/colorScheme/typography/displayMode. */
export const recordTuple = (tuple: Tuple) =>
  `${tuple.designLanguage}/${tuple.colorScheme}/${tuple.typography}/${tuple.displayMode}`;

/**
 * The pack a smoke failure names (#20): one pack, never the pair. An axis
 * that rendered something else than asked is its own pack's; otherwise the
 * first pack, in axis order, that isn't the platform default; else the
 * variant, which is no pack.
 */
export function blamed(
  tuple: Tuple,
  defaults: Readonly<Record<PackAxis, string>>,
  mismatched: readonly PackAxis[] = [],
): { readonly axis: PackAxis | 'variant'; readonly pack?: string } {
  const axis = mismatched[0] ?? PACK_AXES.find((each) => tuple[each] !== defaults[each]);
  return axis ? { axis, pack: tuple[axis] } : { axis: 'variant' };
}

/**
 * The rates the budgets are sized from (#20), each measured, with where.
 * Each shard's log prints its own rate (static-smoke.ts, and Playwright's
 * duration), so a scheduled run's numbers can replace these.
 */
export const MEASURED = {
  /**
   * Static smoke tuples a second, plan and resolve included. Measured at
   * 22,800 a second over 30,000 tuples (three variants, 10 languages, 25
   * schemes, 10 profiles) on a developer machine, and taken at 5,000 for a
   * slower CI runner.
   */
  staticTuplesPerSecond: 5000,
  /**
   * Browser smoke seconds a tuple: a load and its checks, which quality-pr's
   * plain cell tests took 2.4 seconds for in CI (shard-durations.json's
   * `plain`), and a screenshot.
   */
  browserSecondsPerTuple: 3,
  /**
   * A shard job's fixed part, in seconds: container, checkout, install,
   * build:registry, and a production build, as quality-pr's shards took
   * about 95 seconds for theirs on #84 and #89.
   */
  fixedSeconds: 95,
} as const;

/** The minutes a shard's steps get at budget, before the 2x margin: the static part's and the browser part's. */
const STEP_MINUTES = { static: 2, browser: 12 } as const;

/**
 * Tuples per shard each part takes: what its step's minutes hold at the
 * measured rate. A shard job's timeout is twice its fixed part and both
 * steps at budget (shardTimeoutMinutes), so a run at budget has a 2x margin.
 */
export const BUDGET = {
  staticPerShard: Math.floor(STEP_MINUTES.static * 60 * MEASURED.staticTuplesPerSecond),
  browserPerShard: Math.floor((STEP_MINUTES.browser * 60) / MEASURED.browserSecondsPerTuple),
} as const;

/** A catalog-full shard job's timeout-minutes: its fixed part and both steps at budget, twice over. */
export function shardTimeoutMinutes(): number {
  const seconds =
    MEASURED.fixedSeconds +
    BUDGET.staticPerShard / MEASURED.staticTuplesPerSecond +
    BUDGET.browserPerShard * MEASURED.browserSecondsPerTuple;
  return Math.ceil((2 * seconds) / 60);
}

/** The message a plan over its budget fails with, before anything runs. */
export function overBudget(
  part: 'static' | 'browser',
  shard: Shard,
  needed: number,
  budget: number,
  why: string,
): string {
  return `catalog-full plan exceeds ${budget} tuples per shard: the ${part} smoke's shard ${shard.index} of ${shard.count} ${why} ${needed}. Add shards to scheduled.yml's catalog-full matrix, or measure the rate again and raise BUDGET in tests/catalog/plan.ts.`;
}

/** The tuples a shard's static smoke checks: its share of every tuple, within budget. */
export function staticPlan(
  tuples: readonly Tuple[],
  shard: Shard,
  budget: number = BUDGET.staticPerShard,
): Tuple[] {
  const mine = shardTuples(tuples, shard);
  if (mine.length > budget)
    throw new Error(overBudget('static', shard, mine.length, budget, 'holds'));
  return mine;
}

const key = (tuple: Tuple) =>
  `${tuple.variant}/${tuple.designLanguage}/${tuple.colorScheme}/${tuple.typography}/${tuple.displayMode}`;

/** Tuples sorted by key, each key built once. */
function byKey(tuples: readonly Tuple[]): Tuple[] {
  return tuples
    .map((tuple) => [key(tuple), tuple] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, tuple]) => tuple);
}

/**
 * Every shipping pack at least once per variant and per display mode: for
 * each variant and mode, the fewest tuples, chosen greedily from the
 * cross-product, that between them hold each language, scheme, and profile
 * the cross-product has there. Sorted, and the same each time.
 *
 * Each pick is the first tuple, in key order, that shows the most packs
 * still unshown. No tuple shows more than one pack per axis still open, so
 * the scan stops at the first that shows that many. It's linear in the
 * cross-product per pick, which kept the unit job inside its timeout at
 * 2d's 35 languages (#20).
 */
export function coverageSample(tuples: readonly Tuple[]): Tuple[] {
  const groups = new Map<string, Tuple[]>();
  for (const tuple of tuples) {
    const at = `${tuple.variant}\0${tuple.displayMode}`;
    const group = groups.get(at);
    if (group) group.push(tuple);
    else groups.set(at, [tuple]);
  }
  const chosen: Tuple[] = [];
  for (const group of groups.values()) {
    const sorted = byKey(group);
    const unshown = PACK_AXES.map((axis) => new Set(sorted.map((tuple) => tuple[axis])));
    const open = () => unshown.filter((packs) => packs.size > 0).length;
    for (let most = open(); most > 0; most = open()) {
      let best = sorted[0]!;
      let gain = -1;
      for (const tuple of sorted) {
        let shows = 0;
        PACK_AXES.forEach((axis, at) => {
          if (unshown[at]!.has(tuple[axis])) shows += 1;
        });
        if (shows > gain) {
          best = tuple;
          gain = shows;
          if (gain === most) break;
        }
      }
      PACK_AXES.forEach((axis, at) => unshown[at]!.delete(best[axis]));
      chosen.push(best);
    }
  }
  return byKey(chosen);
}

/** The browser sample's seed, so a night's sample is the one a rerun gets. CATALOG_SEED overrides it. */
export const SAMPLE_SEED = 20;

/** CATALOG_SEED as a non-negative integer, SAMPLE_SEED when it's unset. It throws on anything else. */
export function readSeed(value: string | undefined): number {
  if (value === undefined || value === '') return SAMPLE_SEED;
  if (!/^\d{1,9}$/.test(value)) {
    throw new Error(`CATALOG_SEED is ${value}, and it must be a non-negative integer, such as 20.`);
  }
  return Number(value);
}

/** `count` of `pool`, drawn by a seeded shuffle (mulberry32), in pool order. */
export function seededDraw(pool: readonly Tuple[], count: number, seed: number): Tuple[] {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const indexes = pool.map((_, index) => index);
  const take = Math.min(count, pool.length);
  for (let at = 0; at < take; at += 1) {
    const pick = at + Math.floor(random() * (indexes.length - at));
    [indexes[at], indexes[pick]] = [indexes[pick]!, indexes[at]!];
  }
  return indexes
    .slice(0, take)
    .sort((a, b) => a - b)
    .map((index) => pool[index]!);
}

/**
 * The tuples a shard's browser smoke loads: its share of the coverage
 * sample, then a seeded draw from its share of every other tuple, up to
 * budget. Every tuple it loads takes a screenshot.
 */
export function browserPlan(
  tuples: readonly Tuple[],
  shard: Shard,
  budget: number = BUDGET.browserPerShard,
  seed: number = SAMPLE_SEED,
): Tuple[] {
  const coverage = coverageSample(tuples);
  const mine = shardTuples(coverage, shard);
  if (mine.length > budget) {
    throw new Error(
      overBudget(
        'browser',
        shard,
        mine.length,
        budget,
        'needs, to show every pack once per variant and display mode,',
      ),
    );
  }
  const covered = new Set(coverage.map(key));
  const pool = shardTuples(tuples, shard).filter((tuple) => !covered.has(key(tuple)));
  return [...mine, ...seededDraw(pool, budget - mine.length, seed + shard.index)];
}

/**
 * #20 PR 3's sharded cross-product rehearsal (catalog-rehearsal.yml), which
 * a pull request asks for by changing tests/catalog/rehearsal.json in its
 * head commit, and the owner can ask for again before a release. It runs
 * the scheduled job's two parts wider: the static smoke over every tuple,
 * generated schemes included through their reference records, storing
 * every tuple's resolved tokens, and the browser smoke over a wider sample,
 * each screenshot a JPEG; and one more shard of every primitive state, in
 * every shipping language and profile, on the appearance fixtures page.
 * plan.test.ts holds catalog-rehearsal.yml's matrix and timeouts, and
 * rehearsal.json when it's there, to these.
 */
export const REHEARSAL = {
  /** Shards of the two parts. */
  shards: 8,
  /** Static smoke tuples a shard checks: its share of every tuple, about 14,300 at 8 shards. */
  staticPerShard: 20_000,
  /**
   * Browser smoke tuples a shard loads: the coverage sample (70 a shard at 35
   * languages) and a seeded draw. 136 keeps a shard at 17 minutes, so the
   * state shard's 172 pages still fit under the cap.
   */
  browserPerShard: 136,
  seed: SAMPLE_SEED,
  /** The screenshots' JPEG quality, so 1,088 of them stay near 100 MB. */
  jpegQuality: 80,
  /** The state shard's fixed part: the fixture host's own build, on top of a shard's. */
  statesBuildSeconds: 240,
  /** What every job may take together, at the jobs' timeouts: the cost signed off. */
  capRunnerMinutes: 180,
} as const;

/** Whether CATALOG_PLAN asks for the rehearsal: `rehearsal`, or unset for the nightly plan. It throws on anything else. */
export function readPlan(value: string | undefined): 'nightly' | 'rehearsal' {
  if (value === undefined || value === '' || value === 'nightly') return 'nightly';
  if (value === 'rehearsal') return 'rehearsal';
  throw new Error(`CATALOG_PLAN is ${value}, and it must be nightly or rehearsal.`);
}

/** The budgets a plan takes per shard. */
export const planBudget = (plan: 'nightly' | 'rehearsal') =>
  plan === 'rehearsal'
    ? { static: REHEARSAL.staticPerShard, browser: REHEARSAL.browserPerShard }
    : { static: BUDGET.staticPerShard, browser: BUDGET.browserPerShard };

/** A rehearsal shard job's timeout-minutes: its fixed part and both parts at its budget, twice over. */
export function rehearsalTimeoutMinutes(): number {
  const seconds =
    MEASURED.fixedSeconds +
    REHEARSAL.staticPerShard / MEASURED.staticTuplesPerSecond +
    REHEARSAL.browserPerShard * MEASURED.browserSecondsPerTuple;
  return Math.ceil((2 * seconds) / 60);
}

/** The state shard's pages: every shipping language, then every profile, in each display mode. */
export function statesPlan(meta: BuildMeta): {
  readonly axis: 'designLanguage' | 'typography';
  readonly id: string;
  readonly displayMode: string;
}[] {
  const pages: { axis: 'designLanguage' | 'typography'; id: string; displayMode: string }[] = [];
  for (const axis of ['designLanguage', 'typography'] as const) {
    for (const id of shippingPacks(meta, axis)) {
      for (const displayMode of DISPLAY_MODES) pages.push({ axis, id, displayMode });
    }
  }
  return pages;
}

/** The state shard job's timeout-minutes: the fixture host's build, a fixed part, and its pages, twice over. */
export function statesTimeoutMinutes(pages: number): number {
  const seconds =
    MEASURED.fixedSeconds + REHEARSAL.statesBuildSeconds + pages * MEASURED.browserSecondsPerTuple;
  return Math.ceil((2 * seconds) / 60);
}
