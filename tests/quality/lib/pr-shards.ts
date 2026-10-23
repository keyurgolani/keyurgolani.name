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
// The weights: a skipped test none; a cell test that runs the default row's
// reload conditions (cells.ts) its viewport and row's mean; any other cell
// test `plain`; a perf test `perf`; a harness spec its own total. They were
// measured from the list reporter's durations in #84's and #89's quality-pr
// job logs (`gh api .../actions/jobs/<id>/logs`), each the mean of its tests.

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
  readonly weight: number;
}

export const groupKey = (group: Pick<ShardGroup, 'project' | 'file'>) =>
  `${group.project} ${group.file}`;
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
      let weight = durations.group;
      for (const test of own) {
        if (test.skip !== undefined || test.engineSkips[engine] !== undefined) {
          weight += durations.skipped;
        } else if (test.conditions) {
          weight += durations.conditions[`${test.viewport.id} ${test.row.id}`] ?? fallback;
        } else {
          weight += durations.plain;
        }
      }
      groups.push({
        project: serverProject(engine, id),
        file: CELL_SPEC,
        tests: own.map((test) => testKey(test.cell.id, test.viewport.id, test.row.id, engine)),
        weight,
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

/** The shard `text` (<n>/<m>) names, of the PR plan on `engines`. */
export function prShard(
  plan: Pick<Plan, 'cells' | 'tests' | 'targets'>,
  engines: readonly Engine[],
  text: string,
  durations?: ShardDurations,
): PrShard {
  const { index, count } = parseShard(text) as { index: number; count: number };
  return assignShards(planGroups(plan, engines, durations), count)[index - 1]!;
}

/** The spec files each project runs in `shard`: every project is listed, an unassigned one with none. */
export function shardFiles(shard: PrShard): Map<string, string[]> {
  const files = new Map<string, string[]>();
  for (const group of shard.groups) {
    files.set(group.project, [...(files.get(group.project) ?? []), group.file]);
  }
  return files;
}
