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
// start, and is placed, heaviest first, on the lightest shard (ci/shards.mjs's
// assign), the same way on every runner. The shards of one count always
// partition the groups, so they run every planned test exactly once
// between them.
//
// How many shards: the fewest, from 1 to MAX_SHARDS, whose slowest shard,
// its fixed part plus its groups on Playwright's two workers, stays within
// SHARD_CEILING (pickShardCount). CI's quality-pr-plan job works it out for
// each PR (pr-count.ts), and every shard is handed that count. A cell group
// too heavy for one worker's share of a shard is split first into parts,
// by cell, and a cell too heavy on its own by test (splitGroups), each part
// run through a grep of its tests' tags (playwright.config.ts), so a split
// moves tests between shards and never adds or drops one.
//
// The weights: a skipped test none; a cell test that runs the default row's
// reload conditions (cells.ts) its viewport and row's mean; any other cell
// test `plain`; a perf test `perf`; a harness spec its own total. They were
// measured from the list reporter's durations in #84's and #89's quality-pr
// job logs (`gh api .../actions/jobs/<id>/logs`), each the mean of its tests.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { assign, parseShard } from '../../../ci/shards.mjs';
import type { Plan } from '../cells';
import type { Engine } from './matrix';
import { perfCells } from './perf/plan';
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
/** The most shards quality-pr-plan hands out. */
export const MAX_SHARDS = 8;
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
}

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
}

export const groupKey = (group: Pick<ShardGroup, 'project' | 'file' | 'part'>) =>
  `${group.project} ${group.file}${group.part === undefined ? '' : ` #${group.part}`}`;
export const testKey = (cell: string, viewport: string, row: string, engine: string) =>
  JSON.stringify([cell, viewport, row, engine]);

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
};

/** Every test group the PR plan runs on `engines`, with its weight. */
export function planGroups(
  plan: Pick<Plan, 'cells' | 'tests' | 'targets'>,
  engines: readonly Engine[],
  durations: ShardDurations = loadDurations(),
): ShardGroup[] {
  const fallback = median(Object.values(durations.conditions));
  const perf = perfCells(plan);
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
    for (const { id } of planServers(plan)) {
      const own = plan.tests.filter((test) => serverId(cellServer(test.cell)) === id);
      const costs = own.map((test) => {
        if (test.skip !== undefined || test.engineSkips[engine] !== undefined) {
          return durations.skipped;
        }
        if (!test.conditions) return durations.plain;
        return durations.conditions[`${test.viewport.id} ${test.row.id}`] ?? fallback;
      });
      groups.push({
        project: serverProject(engine, id),
        file: CELL_SPEC,
        tests: own.map((test) => testKey(test.cell.id, test.viewport.id, test.row.id, engine)),
        costs,
        weight: costs.reduce((sum, cost) => sum + cost, durations.group),
      });
      const perfHere = perf.filter((cell) => serverId(cellServer(cell)) === id).length;
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
    const byCell = new Map<string, { tests: string[]; costs: number[]; weight: number }>();
    group.tests.forEach((key, at) => {
      const cell = cellOfTest(key);
      const entry = byCell.get(cell) ?? { tests: [], costs: [], weight: 0 };
      entry.tests.push(key);
      entry.costs.push(group.costs![at]!);
      entry.weight += group.costs![at]!;
      byCell.set(cell, entry);
    });
    // What goes into parts whole: each cell that fits a part, else each of its tests.
    const units = [...byCell.values()].flatMap((entry) =>
      durations.group + entry.weight <= budget
        ? [{ tests: entry.tests, weight: entry.weight }]
        : entry.tests.map((key, at) => ({ tests: [key], weight: entry.costs[at]! })),
    );
    const parts: { tests: string[]; weight: number }[] = [];
    for (const unit of units) {
      if (durations.group + unit.weight > budget) {
        const [cell, viewport, row] = JSON.parse(unit.tests[0]!) as string[];
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
      tests: part.tests,
      weight: part.weight,
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

/** The `count` shards of `groups`: a partition, heaviest group first onto the lightest shard. */
export function assignShards(groups: readonly ShardGroup[], count: number): PrShard[] {
  const byKey = new Map(groups.map((group) => [groupKey(group), group]));
  if (byKey.size !== groups.length) throw new Error('two test groups share a project and file');
  const weights = Object.fromEntries(groups.map((group) => [groupKey(group), group.weight]));
  return (assign([...byKey.keys()], weights, count) as { items: string[]; weight: number }[]).map(
    (shard, at) => ({
      index: at + 1,
      count,
      groups: shard.items.map((key) => byKey.get(key)!),
      weight: shard.weight,
    }),
  );
}

/** The longest a shard's workers take, placing its groups heaviest first on the freer worker. */
export function shardWall(groups: readonly ShardGroup[], workers: number = SHARD_WORKERS): number {
  const load = Array.from({ length: workers }, () => 0);
  for (const group of [...groups].sort((a, b) => b.weight - a.weight)) {
    const freer = load.indexOf(Math.min(...load));
    load[freer] = load[freer]! + group.weight;
  }
  return Math.max(...load);
}

/** About how long a shard job takes, in seconds: its fixed part, and its groups on its workers. */
export const shardEstimate = (shard: Pick<PrShard, 'groups'>) =>
  SHARD_FIXED + shardWall(shard.groups);

/**
 * The fewest shards, 1 to MAX_SHARDS, that keep every shard within
 * SHARD_CEILING, from `groups` as planGroups() weighs them, split first.
 * Needing more than MAX_SHARDS throws, naming the slowest shard's heaviest
 * group and about how long that shard would take.
 */
export function pickShardCount(
  groups: readonly ShardGroup[],
  durations: Pick<ShardDurations, 'group'> = loadDurations(),
): { readonly count: number; readonly slowest: number; readonly shards: PrShard[] } {
  const split = splitGroups(groups, GROUP_BUDGET, durations);
  let shards: PrShard[] = [];
  let slowest = 0;
  for (let count = 1; count <= MAX_SHARDS; count += 1) {
    shards = assignShards(split, count);
    slowest = Math.max(...shards.map(shardEstimate));
    if (slowest <= SHARD_CEILING) return { count, slowest, shards };
  }
  const worst = shards.reduce((a, b) => (shardEstimate(b) > shardEstimate(a) ? b : a));
  const heaviest = [...worst.groups].sort((a, b) => b.weight - a.weight)[0]!;
  throw new Error(
    `Even ${MAX_SHARDS} shards leave one at about ${Math.round(slowest)}s, over the ${SHARD_CEILING}s ceiling. Its heaviest group is ${groupKey(heaviest)}, at about ${Math.round(heaviest.weight)}s.`,
  );
}

/** The shard `text` (<n>/<m>) names, of the PR plan on `engines`, its groups split as pickShardCount() splits them. */
export function prShard(
  plan: Pick<Plan, 'cells' | 'tests' | 'targets'>,
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
 * those cell tests and its perf tests, as Playwright matches a test's title
 * and tags.
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
    `^(?=.*${server})(?=.*(?:${PERF_TAG}(?![\\w-])|@test-(?:${tags})(?![0-9a-f])))`,
  );
}
