// quality:pr's shards (#11): `pnpm quality:pr -- --shard=<n>/<m>` runs one
// part of the PR plan, and `pnpm quality:merge` judges the parts whole, as
// it does quality:full's. Every shard plans the whole PR set, writes the
// same plan.json, and lists every project; this picks which of Playwright's
// test groups it runs.
//
// A group is what Playwright runs on one worker: one spec file in one
// project, and each project is one server (playwright.config.ts). Playwright's
// own --shard cuts the groups into runs of equal test counts, which splits
// the PR set badly: a perf test is one test of about 90 seconds, and a
// composition's skipped states are tests of none. So each group weighs what
// its tests took in CI (tests/quality/shard-durations.json), plus a server
// start, and is placed, heaviest first, on the lightest shard, a split
// group's part on the lightest without another part of its file
// (assignShards), the same way on every runner. The shards of one count always
// partition the groups, so they run every planned test exactly once
// between them.
//
// How many shards: the fewest, from 1 to MAX_SHARDS (and with a pack sweep,
// MAX_SHARDS and what the sweep alone needs, up to SWEEP_MAX_SHARDS, and for
// a sweep that alone needs more, up to CATALOG_MAX_SHARDS: shardLimit),
// whose slowest shard,
// its fixed part plus its groups on Playwright's two workers, stays within
// SHARD_CEILING (pickShardCount). CI's quality-pr-plan job works it out for
// each PR (pr-count.ts), and every shard is handed that count. A cell group
// too heavy for one worker's share of a shard is split first into parts,
// by cell, and a cell too heavy on its own by test (splitGroups), each part
// run through a grep of its tests' tags (playwright.config.ts), so a split
// moves tests between shards and never adds or drops one. A variant's
// sweep group (lib/sweep.ts) is one cell group whose cells are its changed
// packs, so it splits by pack, each pack's rows kept together.
//
// The weights: a skipped test none; a cell test that runs the default row's
// reload conditions (cells.ts) its viewport and row's mean, from `pack` when
// the cell's tuple names a pack other than the platform default on any axis
// (a tier sentinel, or since #20 a change-directed cell on any pack axis),
// else from `conditions`; any other cell test `plain`; a perf test `perf`;
// a harness spec its own total; a swept cell's test (lib/sweep.ts) its
// row's `sweep` weight, whatever else it is. They were measured from the list reporter's
// durations in quality-pr job logs (`gh api .../actions/jobs/<id>/logs`),
// each the mean of its tests: `pack` from the tier sentinels' nine cells in
// three runs (#20), the rest from #84's and #89's.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PACK_AXES, PLATFORM_DEFAULTS } from '../../../packages/appearance/src/index';
import { parseShard } from '../../../ci/shards.mjs';
import type { Plan } from '../cells';
import type { Engine } from './matrix';
import { perfCells } from './perf/plan';
import { APPEARANCE_STATE } from './state-fixtures';
import { cellServer, planServers, serverId } from './server';

/** The spec files a harness project runs. */
export const HARNESS_SPECS = ['harness.spec.ts', 'canary.spec.ts', 'a11y.spec.ts'] as const;
export const CELL_SPEC = 'cells.spec.ts';
export const PERF_SPEC = 'perf.spec.ts';

/** The project names playwright.config.ts gives: one harness project and one per server, per engine. */
export const harnessProject = (engine: string) => `${engine} harness`;
export const serverProject = (engine: string, id: string) => `${engine} ${id}`;

/** The slowest a shard may take, in seconds, its fixed part included. */
export const SHARD_CEILING = 300;
/** A shard job's fixed part: container, checkout, install, the quality host's build, and Playwright's start, about 95 s on #84 and #89. */
export const SHARD_FIXED = 95;
/** Playwright's workers in one shard (playwright.config.ts). */
export const SHARD_WORKERS = 2;
/** The most shards quality-pr-plan hands out: more only add parallel runners, and 12 fits the repository's concurrency beside the other jobs. */
export const MAX_SHARDS = 12;
/**
 * The most a PR with a pack sweep may take (shardLimit): MAX_SHARDS and the
 * shards the sweep alone needs, up to this. #20's catalog PRs, which change
 * dozens of packs at once, reach it. Nothing else does.
 */
export const SWEEP_MAX_SHARDS = 16;
/**
 * The most a catalog-scale sweep may take. Only when the pack sweep alone
 * can't fit SWEEP_MAX_SHARDS, as when a PR brings #20's whole catalog, is
 * the most the fewest shards the plan fits, up to this. [37] keeps every
 * changed pack against every variant, so the sweep is never cut to fit.
 */
export const CATALOG_MAX_SHARDS = 48;
/**
 * quality-pr's max-parallel for a catalog-scale sweep, so it runs in waves
 * and PR CI keeps the account's other slots. Any other plan runs every
 * shard at once (pr-count.ts's shardOutputs).
 */
export const PR_PARALLEL = 10;
/** The most one group may weigh: a group runs on one worker, so it alone sets its shard's floor. */
export const GROUP_BUDGET = SHARD_CEILING - SHARD_FIXED;

export interface ShardDurations {
  /** A group's own cost: its worker's server start. */
  readonly group: number;
  readonly skipped: number;
  /** A cell test without the reload conditions. */
  readonly plain: number;
  readonly perf: number;
  /** Each harness spec's total, by its repository path. */
  readonly harness: Readonly<Record<string, number>>;
  /** A cell test with the reload conditions, by `<viewport> <row>`. */
  readonly conditions: Readonly<Record<string, number>>;
  /** The same on a cell whose tuple names a pack other than the platform default (#20). */
  readonly pack: Readonly<Record<string, number>>;
  /**
   * A composition's complete-state cell without the reload conditions, its
   * published default appearance, by `<viewport> <row>`: a full page's
   * checks, unlike the stand-in states and surfaces `plain` weighs.
   */
  readonly composition: Readonly<Record<string, number>>;
  /**
   * A swept cell's test (lib/sweep.ts), a changed pack on its variant's
   * sweep server without the reload conditions, by `<viewport> <row>`.
   */
  readonly sweep: Readonly<Record<string, number>>;
}

/** Whether a cell's tuple names a pack other than the platform default on any axis. */
export const onPack = (tuple: Readonly<Record<string, string>>) =>
  PACK_AXES.some((axis) => tuple[axis] !== PLATFORM_DEFAULTS[axis]);

export const DURATIONS_FILE = new URL('../shard-durations.json', import.meta.url);

export function loadDurations(): ShardDurations {
  return JSON.parse(readFileSync(DURATIONS_FILE, 'utf8')) as ShardDurations;
}

/** One Playwright test group, as a shard runs it. */
export interface ShardGroup {
  readonly project: string;
  /** The spec file, relative to tests/quality. */
  readonly file: string;
  /** Its planned cell tests' keys (cell, viewport, row, engine), none for a harness or perf group. */
  readonly tests: readonly string[];
  /** Each test's own weight, in the order of `tests`. */
  readonly costs?: readonly number[];
  readonly weight: number;
  /** A part of a split cell group, from 1: it runs only its `tests` of its project's cells.spec.ts. */
  readonly part?: number;
  /** A variant's sweep server's cell group, or a part of one (lib/sweep.ts). */
  readonly sweep?: true;
  /**
   * A sweep group's changed pack for each test, in the order of `tests`, as
   * `<axis>: <pack>` (`language: international-grid`), kept in its parts with
   * their `costs`, so a plan over the ceiling names the pack.
   */
  readonly packs?: readonly string[];
  /**
   * A cell group whose every test is a changed variant's directed cell (the
   * [37] rule's variant pairs), or a part of one: with the sweep's, the
   * PR's directed load, which shardLimit() makes room for. A cell a changed
   * pack also directs is a variant cell too; the directed load counts it once.
   */
  readonly variant?: true;
}

/** Whether a group is directed load: the pack sweep's, or a changed variant's. */
export const isDirected = (group: Pick<ShardGroup, 'sweep' | 'variant'>) =>
  group.sweep === true || group.variant === true;

export const groupKey = (group: Pick<ShardGroup, 'project' | 'file' | 'part'>) =>
  `${group.project} ${group.file}${group.part === undefined ? '' : ` #${group.part}`}`;
export const testKey = (cell: string, viewport: string, row: string, engine: string) =>
  JSON.stringify([cell, viewport, row, engine]);

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
};

/** What testWeight() reads of a planned test. */
export type WeighedTest = Pick<Plan['tests'][number], 'skip' | 'engineSkips' | 'conditions'> & {
  readonly cell: Pick<Plan['tests'][number]['cell'], 'kind' | 'state' | 'tuple' | 'sweep'>;
  readonly viewport: { readonly id: string };
  readonly row: { readonly id: string };
};

/**
 * About how long one planned cell test takes on `engine`: none skipped; a
 * swept cell's its row's `sweep` weight; a test with the reload conditions its row's measured mean, from `pack` on a
 * pack's tuple, else `conditions`; a composition's complete cell without
 * them `composition`'s; and any other, a stand-in state's or a surface's,
 * `plain`. A row with no measured weight takes `fallback`.
 */
export function testWeight(
  test: WeighedTest,
  engine: string,
  durations: ShardDurations,
  fallback: number = median(Object.values(durations.conditions)),
): number {
  if (test.skip !== undefined || test.engineSkips[engine] !== undefined) return durations.skipped;
  const key = `${test.viewport.id} ${test.row.id}`;
  if (test.cell.sweep) return durations.sweep[key] ?? fallback;
  if (!test.conditions) {
    return test.cell.kind === 'composition' && test.cell.state === APPEARANCE_STATE.id
      ? (durations.composition[key] ?? fallback)
      : durations.plain;
  }
  return (
    (onPack(test.cell.tuple) ? durations.pack[key] : undefined) ??
    durations.conditions[key] ??
    fallback
  );
}

/** The axes' names in a pack's description. */
const AXIS_NAMES: Readonly<Record<string, string>> = {
  designLanguage: 'language',
  colorScheme: 'scheme',
  typography: 'typography',
};

/** A swept cell's changed packs, as `<axis>: <pack>`, for a failure to name. */
export const changedPack = (
  changed: readonly { readonly axis: string; readonly id: string }[] | undefined,
) =>
  (changed ?? [])
    .filter((by) => by.axis !== 'variant')
    .map((by) => `${AXIS_NAMES[by.axis] ?? by.axis}: ${by.id}`)
    .join(', ');

/** Every test group the PR plan runs on `engines`, with its weight. */
export function planGroups(
  plan: Pick<Plan, 'cells' | 'tests' | 'targets' | 'mode'>,
  engines: readonly Engine[],
  durations: ShardDurations = loadDurations(),
): ShardGroup[] {
  const fallback = median(Object.values(durations.conditions));
  const perf = perfCells(plan);
  // Each server's tests and perf cells, found once: a server's id is a
  // hash, and a full plan holds tens of thousands of tests.
  const testsOf = new Map<string, Plan['tests'][number][]>();
  for (const test of plan.tests) {
    const id = serverId(cellServer(test.cell));
    const own = testsOf.get(id);
    if (own) own.push(test);
    else testsOf.set(id, [test]);
  }
  const perfOf = new Map<string, number>();
  for (const cell of perf) {
    const id = serverId(cellServer(cell));
    perfOf.set(id, (perfOf.get(id) ?? 0) + 1);
  }
  const groups: ShardGroup[] = [];
  for (const engine of engines) {
    for (const file of HARNESS_SPECS) {
      groups.push({
        project: harnessProject(engine),
        file,
        tests: [],
        weight: durations.group + (durations.harness[`tests/quality/${file}`] ?? fallback),
      });
    }
    for (const { id, server } of planServers(plan)) {
      const own = testsOf.get(id) ?? [];
      const costs = own.map((test) => testWeight(test, engine, durations, fallback));
      groups.push({
        project: serverProject(engine, id),
        file: CELL_SPEC,
        tests: own.map((test) => testKey(test.cell.id, test.viewport.id, test.row.id, engine)),
        costs,
        weight: costs.reduce((sum, cost) => sum + cost, durations.group),
        ...(server.sweep
          ? { sweep: true as const, packs: own.map((test) => changedPack(test.cell.changed)) }
          : {}),
        // A changed variant's own cells, none of them a sentinel the PR runs anyway.
        ...(!server.sweep &&
        own.length > 0 &&
        own.every(
          (test) =>
            !test.cell.sentinel && test.cell.changed?.some((by) => by.axis === 'variant') === true,
        )
          ? { variant: true as const }
          : {}),
      });
      const perfHere = perfOf.get(id) ?? 0;
      if (perfHere > 0) {
        groups.push({
          project: serverProject(engine, id),
          file: PERF_SPEC,
          tests: [],
          weight: durations.group + perfHere * durations.perf,
        });
      }
    }
  }
  return groups;
}

/** The cell a test key names. */
const cellOfTest = (key: string) => (JSON.parse(key) as string[])[0]!;

/**
 * `groups`, with each cell group heavier than `budget` split into parts, in
 * the plan's order, each as full as fits. A cell's tests stay together when
 * the cell fits a part on its own; a heavier cell, such as a tier sentinel's
 * nine rows, goes test by test. Each test is in exactly one part. A test that
 * alone weighs more than `budget`, or a harness or perf group that does,
 * can't be split, so it throws, naming it and what it weighs.
 */
export function splitGroups(
  groups: readonly ShardGroup[],
  budget: number = GROUP_BUDGET,
  durations: Pick<ShardDurations, 'group'> = loadDurations(),
): ShardGroup[] {
  return groups.flatMap((group): ShardGroup[] => {
    if (group.weight <= budget) return [group];
    if (group.file !== CELL_SPEC || !group.costs) {
      throw new Error(
        `${groupKey(group)} takes about ${Math.round(group.weight)}s, over the ${budget}s one worker has in a shard, and only a cell group splits.`,
      );
    }
    // Each cell's tests, by their place in the group.
    const byCell = new Map<string, { tests: number[]; weight: number }>();
    group.tests.forEach((key, at) => {
      const cell = cellOfTest(key);
      const entry = byCell.get(cell) ?? { tests: [], weight: 0 };
      entry.tests.push(at);
      entry.weight += group.costs![at]!;
      byCell.set(cell, entry);
    });
    // What goes into parts whole: each cell that fits a part, else each of its tests.
    const units = [...byCell.values()].flatMap((entry) =>
      durations.group + entry.weight <= budget
        ? [entry]
        : entry.tests.map((at) => ({ tests: [at], weight: group.costs![at]! })),
    );
    const parts: { tests: number[]; weight: number }[] = [];
    for (const unit of units) {
      if (durations.group + unit.weight > budget) {
        const [cell, viewport, row] = JSON.parse(group.tests[unit.tests[0]!]!) as string[];
        throw new Error(
          `The test ${cell} at ${viewport}, ${row} alone takes about ${Math.round(durations.group + unit.weight)}s on ${group.project}, over the ${budget}s one worker has in a shard.`,
        );
      }
      const last = parts.at(-1);
      if (last && last.weight + unit.weight <= budget) {
        last.tests.push(...unit.tests);
        last.weight += unit.weight;
      } else {
        parts.push({ tests: [...unit.tests], weight: durations.group + unit.weight });
      }
    }
    return parts.map((part, at) => ({
      project: group.project,
      file: group.file,
      part: at + 1,
      tests: part.tests.map((each) => group.tests[each]!),
      weight: part.weight,
      // A sweep's part keeps each test's weight and pack, so a plan over the ceiling names it.
      ...(group.sweep
        ? {
            sweep: true as const,
            costs: part.tests.map((each) => group.costs![each]!),
            ...(group.packs ? { packs: part.tests.map((each) => group.packs![each]!) } : {}),
          }
        : {}),
      ...(group.variant ? { variant: true as const } : {}),
    }));
  });
}

export interface PrShard {
  readonly index: number;
  readonly count: number;
  readonly groups: readonly ShardGroup[];
  /** About how long its tests take, in seconds, on one worker. */
  readonly weight: number;
}

/**
 * The `count` shards of `groups`: a partition, heaviest group first onto
 * the lightest shard (then the lowest index), as ci/shards.mjs's assign()
 * places items, except that a split group's part goes to the lightest
 * shard holding no other part of its file while one is left. Two parts of
 * one file on one shard run one after another on one worker (shardWall),
 * so a group split N ways spreads over N shards.
 */
export function assignShards(groups: readonly ShardGroup[], count: number): PrShard[] {
  const byKey = new Map(groups.map((group) => [groupKey(group), group]));
  if (byKey.size !== groups.length) throw new Error('two test groups share a project and file');
  const shards = Array.from({ length: count }, () => ({
    groups: [] as ShardGroup[],
    files: new Set<string>(),
    weight: 0,
  }));
  const ordered = [...byKey.values()].sort(
    (a, b) => b.weight - a.weight || groupKey(a).localeCompare(groupKey(b)),
  );
  const lightest = (among: typeof shards) =>
    among.reduce((best, shard) => (shard.weight < best.weight ? shard : best));
  for (const group of ordered) {
    const file = `${group.project} ${group.file}`;
    const free = group.part === undefined ? shards : shards.filter((each) => !each.files.has(file));
    const shard = lightest(free.length > 0 ? free : shards);
    shard.groups.push(group);
    shard.files.add(file);
    shard.weight += group.weight;
  }
  return shards.map((shard, at) => ({
    index: at + 1,
    count,
    groups: shard.groups,
    weight: Math.round(shard.weight),
  }));
}

/** The longest a shard's workers take, placing its groups heaviest first on the freer worker. */
export function shardWall(groups: readonly ShardGroup[], workers: number = SHARD_WORKERS): number {
  // One project's spec file runs on one worker (fullyParallel is off), so a
  // split group's parts on one shard run one after another: they weigh together.
  const byFile = new Map<string, number>();
  for (const group of groups) {
    const key = `${group.project} ${group.file}`;
    byFile.set(key, (byFile.get(key) ?? 0) + group.weight);
  }
  const load = Array.from({ length: workers }, () => 0);
  for (const weight of [...byFile.values()].sort((a, b) => b - a)) {
    const freer = load.indexOf(Math.min(...load));
    load[freer] = load[freer]! + weight;
  }
  return Math.max(...load);
}

/** About how long a shard job takes, in seconds: its fixed part, and its groups on its workers. */
export const shardEstimate = (shard: Pick<PrShard, 'groups'>) =>
  SHARD_FIXED + shardWall(shard.groups);

/** The fewest shards, 1 to `max`, that hold `split` within SHARD_CEILING, and the last tried. */
function fewestShards(
  split: readonly ShardGroup[],
  max: number,
): {
  readonly fits: boolean;
  readonly count: number;
  readonly slowest: number;
  readonly shards: PrShard[];
} {
  let shards: PrShard[] = [];
  let slowest = 0;
  for (let count = 1; count <= max; count += 1) {
    shards = assignShards(split, count);
    slowest = Math.max(...shards.map(shardEstimate));
    if (slowest <= SHARD_CEILING) return { fits: true, count, slowest, shards };
  }
  return { fits: false, count: max, slowest, shards };
}

/** The fewest shards `groups` alone need, up to `max` (and that many past it), or 0 for none. */
function shardsAlone(
  groups: readonly ShardGroup[],
  durations: Pick<ShardDurations, 'group'>,
  max: number = SWEEP_MAX_SHARDS,
): { readonly count: number; readonly fits: boolean } {
  if (groups.length === 0) return { count: 0, fits: true };
  const alone = fewestShards(splitGroups(groups, GROUP_BUDGET, durations), max);
  return { count: alone.fits ? alone.count : max, fits: alone.fits };
}

/**
 * The most shards `groups` may take: MAX_SHARDS, plus the fewest the PR's
 * directed load alone needs, up to SWEEP_MAX_SHARDS. The directed load is
 * the pack sweep's groups (lib/sweep.ts) and a changed variant's
 * (isDirected), split and placed as the whole plan's are. The undirected
 * base keeps its usual MAX_SHARDS' worth, and the directed load brings its
 * own on top. Only directed groups count toward `directedShards`, so
 * nothing else raises it. `sweepShards` and `variantShards` say what each
 * part alone needs, for the log.
 *
 * A catalog-scale sweep: when the pack sweep can't fit SWEEP_MAX_SHARDS,
 * alone or with the rest of the plan but the changed variants' groups, the
 * most is CATALOG_MAX_SHARDS, so the count is the fewest the plan fits, up
 * to that. Only sweep load steps it up: a changed variant's load never
 * does, and by itself it still fails past SWEEP_MAX_SHARDS. Once the sweep
 * has stepped the plan up, the changed variants share the larger limit.
 */
export function shardLimit(
  groups: readonly ShardGroup[],
  durations: Pick<ShardDurations, 'group'> = loadDurations(),
): {
  readonly max: number;
  readonly directedShards: number;
  readonly sweepShards: number;
  readonly variantShards: number;
  readonly catalogScale: boolean;
  readonly reason: string | null;
} {
  const sweep = shardsAlone(
    groups.filter((group) => group.sweep),
    durations,
    CATALOG_MAX_SHARDS,
  );
  const sweepAlone = !sweep.fits || sweep.count > SWEEP_MAX_SHARDS;
  // A sweep that fits by itself may not with the base beside it; the changed variants don't count.
  const withBase =
    !sweepAlone &&
    sweep.count > 0 &&
    !fewestShards(
      splitGroups(
        groups.filter((group) => !group.variant),
        GROUP_BUDGET,
        durations,
      ),
      SWEEP_MAX_SHARDS,
    ).fits;
  const catalogScale = sweepAlone || withBase;
  const directed = shardsAlone(
    groups.filter(isDirected),
    durations,
    catalogScale ? CATALOG_MAX_SHARDS : SWEEP_MAX_SHARDS,
  );
  const sweepShards = catalogScale ? sweep.count : Math.min(sweep.count, SWEEP_MAX_SHARDS);
  const variantShards = shardsAlone(
    groups.filter((group) => group.variant),
    durations,
  ).count;
  if (directed.count === 0) {
    return {
      max: MAX_SHARDS,
      directedShards: 0,
      sweepShards,
      variantShards,
      catalogScale,
      reason: null,
    };
  }
  if (catalogScale) {
    const why = sweepAlone
      ? `the pack sweep alone needs ${sweep.fits ? sweep.count : `more than ${CATALOG_MAX_SHARDS}`} shards, more than ${SWEEP_MAX_SHARDS}`
      : `the pack sweep alone needs ${sweep.count} shards, and with the rest of the plan but the changed variants more than ${SWEEP_MAX_SHARDS}`;
    return {
      max: CATALOG_MAX_SHARDS,
      directedShards: directed.count,
      sweepShards,
      variantShards,
      catalogScale,
      reason: `a catalog-scale sweep: ${why}, so the most is ${CATALOG_MAX_SHARDS}`,
    };
  }
  const max = Math.min(SWEEP_MAX_SHARDS, MAX_SHARDS + directed.count);
  const needs = directed.fits
    ? `${directed.count} shard(s)`
    : `more than ${SWEEP_MAX_SHARDS} shards`;
  return {
    max,
    directedShards: directed.count,
    sweepShards,
    variantShards,
    catalogScale,
    reason: `the directed groups alone need ${needs} (the pack sweep's ${sweepShards}, the changed variants' ${variantShards}), so the most is ${max}`,
  };
}

/** A sweep group's or part's heaviest test's changed pack, as `<axis>: <pack>`, or null for another group. */
function heaviestPack(group: ShardGroup): string | null {
  if (!group.sweep || !group.packs || group.packs.length === 0) return null;
  let at = 0;
  (group.costs ?? []).forEach((cost, each) => {
    if (cost > group.costs![at]!) at = each;
  });
  return group.packs[at] || null;
}

/** Why `groups` can't fit `max` shards: the slowest shard, its heaviest group and, for a sweep's, its pack, and `about`. */
function overCeiling(
  max: number,
  { slowest, shards }: { readonly slowest: number; readonly shards: readonly PrShard[] },
  about: string | null,
): Error {
  const worst = shards.reduce((a, b) => (shardEstimate(b) > shardEstimate(a) ? b : a));
  const heaviest = [...worst.groups].sort((a, b) => b.weight - a.weight)[0]!;
  const pack = heaviestPack(heaviest);
  return new Error(
    `Even ${max} shards leave one at about ${Math.round(slowest)}s, over the ${SHARD_CEILING}s ceiling${about ? ` (${about})` : ''}. Its heaviest group is ${groupKey(heaviest)}, at about ${Math.round(heaviest.weight)}s${pack ? `, its heaviest changed pack ${pack}` : ''}.`,
  );
}

/**
 * The fewest shards, 1 to shardLimit()'s most, that keep every shard
 * within SHARD_CEILING, from `groups` as planGroups() weighs them, split
 * first. The undirected base, every group outside the directed load, must
 * fit MAX_SHARDS on its own, so directed load never makes room for
 * anything else. Needing more throws,
 * naming the slowest shard's heaviest group and about how long that shard
 * would take.
 */
export function pickShardCount(
  groups: readonly ShardGroup[],
  durations: Pick<ShardDurations, 'group'> = loadDurations(),
): {
  readonly count: number;
  readonly slowest: number;
  readonly shards: PrShard[];
  /** The fewest shards the directed load alone needs, 0 without any, and each part's. */
  readonly directedShards: number;
  readonly sweepShards: number;
  readonly variantShards: number;
  /** Whether the pack sweep alone needs more than SWEEP_MAX_SHARDS, so the most is CATALOG_MAX_SHARDS. */
  readonly catalogScale: boolean;
  /** The most the count could be, and why it's over MAX_SHARDS, or null. */
  readonly max: number;
  readonly reason: string | null;
} {
  const limit = shardLimit(groups, durations);
  if (limit.directedShards > 0) {
    const base = fewestShards(
      splitGroups(
        groups.filter((group) => !isDirected(group)),
        GROUP_BUDGET,
        durations,
      ),
      MAX_SHARDS,
    );
    if (!base.fits) throw overCeiling(MAX_SHARDS, base, 'the undirected base, alone');
  }
  const picked = fewestShards(splitGroups(groups, GROUP_BUDGET, durations), limit.max);
  if (!picked.fits) throw overCeiling(limit.max, picked, limit.reason);
  return { ...picked, ...limit };
}

/** The shard `text` (<n>/<m>) names, of the PR plan on `engines`, its groups split as pickShardCount() splits them. */
export function prShard(
  plan: Pick<Plan, 'cells' | 'tests' | 'targets' | 'mode'>,
  engines: readonly Engine[],
  text: string,
  durations: ShardDurations = loadDurations(),
): PrShard {
  const { index, count } = parseShard(text) as { index: number; count: number };
  const split = splitGroups(planGroups(plan, engines, durations), GROUP_BUDGET, durations);
  return assignShards(split, count)[index - 1]!;
}

/** The spec files each project runs in `shard`: every project is listed, an unassigned one with none. */
export function shardFiles(shard: PrShard): Map<string, string[]> {
  const files = new Map<string, string[]>();
  for (const group of shard.groups) {
    const own = files.get(group.project) ?? [];
    if (!own.includes(group.file)) own.push(group.file);
    files.set(group.project, own);
  }
  return files;
}

/** The tag perf tests carry, so a project whose cell group is split still runs them. */
export const PERF_TAG = '@perf';
/** The same for visual tests, which only quality:full runs (lib/full-shards.ts). */
export const VISUAL_TAG = '@visual';

/** The tag a cell test carries, by its cell, viewport, and row, so a shard can run some of a project's tests and not the rest. */
export const testTag = (cell: string, viewport: string, row: string) =>
  `@test-${createHash('sha256')
    .update(JSON.stringify([cell, viewport, row]))
    .digest('hex')
    .slice(0, 12)}`;

/** The cell tests each project with a split cell group runs in `shard`, by test key. A project left out runs its cell group whole, or not at all. */
export function shardTests(shard: PrShard): Map<string, string[]> {
  const tests = new Map<string, string[]>();
  for (const group of shard.groups) {
    if (group.part === undefined) continue;
    tests.set(group.project, [...(tests.get(group.project) ?? []), ...group.tests]);
  }
  return tests;
}

/**
 * A server project's grep: its server's tests, and with `tests` (keys), only
 * those cell tests and its perf and visual tests, as Playwright matches a
 * test's title and tags. Which perf and visual files run is the project's
 * testMatch.
 */
export function projectGrep(id: string, tests?: readonly string[]): RegExp {
  const server = `@server-${id}(?![0-9a-f])`;
  if (tests === undefined) return new RegExp(server);
  const tags = tests
    .map((key) => {
      const [cell, viewport, row] = JSON.parse(key) as string[];
      return testTag(cell!, viewport!, row!).slice('@test-'.length);
    })
    .join('|');
  return new RegExp(
    `^(?=[\\s\\S]*${server})(?=[\\s\\S]*(?:${PERF_TAG}(?![\\w-])|${VISUAL_TAG}(?![\\w-])|@test-(?:${tags})(?![0-9a-f])))`,
  );
}
