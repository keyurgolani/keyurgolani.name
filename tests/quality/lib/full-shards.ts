// quality:full's shards (#11): the nightly rotation and the release plan,
// sized with quality:pr's planner (lib/pr-shards.ts): its test groups, its
// measured weights, its split of a group too heavy for one worker, and its
// heaviest-first assignment. Nothing here weighs a test again.
//
// The caps. A night holds no more than FULL_SHARDS of the account's 20 job
// slots at once, 12, and a release candidate no more than RELEASE_PARALLEL
// (its rc-quality jobs' max-parallel together), 16, so other work keeps the
// rest: the nightly's scope in a 7-night cycle (lib/nightly-scope.ts). The
// nightly pauses while a release or an inventory run is in flight
// (ci/big-run.mjs), so the two never stand together.
//
// The nightly rotation. The complete plan is more than one night of
// FULL_SHARDS shards can run, so it runs over a cycle of N nights, the
// smallest of NIGHT_COUNTS (7, 14, 28, 56) whose every night fits
// NIGHTLY_CEILING at FULL_SHARDS shards (rotationFor), by the release's
// measured weights at its measured pace (row 151); each shard works N
// out from the plan, the same way, and prints it. The harness's specs and
// every perf cell run every night: the canary probe proves each night's
// scrub, and the timing trend stays whole. Every other test has a night of
// its own. A server's cell tests are split into BUCKETS buckets by a hash of
// each test (testBucket), and each bucket's night is a hash of its server
// and bucket, mod N (groupNight); a server's visual tests go with its
// bucket 0, and a bucket split into parts keeps its night. Four buckets a
// server even out the nights, which whole servers left too lumpy. So a
// cycle runs each cell test and visual test exactly once, a cell's tests on
// up to BUCKETS nights, and adding a test or a server, or a weight
// changing, never moves another test's night while N holds. The night of
// `date` runs night dayNumber(date) mod N. N is always 7 x 2^k, so nights
// nest: h mod 2N refines h mod N, and when the plan grows or shrinks across
// a step, each night splits in two or two merge into one, a bucket's night
// n becoming n or n + N. A test waits at most the largest N in effect
// between runs. A plan that needs more than
// MAX_NIGHTS fails every run before any test, naming its heaviest night.
//
// The release plan. Before a release, every group of the scope's plan runs, in the fewest
// shards that keep each within RELEASE_CEILING (releaseFor), RELEASE_PARALLEL
// at a time, so in waves; that ceiling is fitted to rc-quality's 120-minute
// timeout at the job's measured pace (fitReleaseCeiling, RELEASE_PACE), and
// the timeout stays. release.yml's rc-quality-plan works the count out
// (full-plan.ts) and hands it to the matrix. Release shards are dealt
// heaviest first, not by a hash, so the count needs no steps: unlike the
// nightly cycle, nothing nests across counts. A GitHub matrix makes at most
// MAX_RELEASE_SHARDS jobs, so the shards are split across RELEASE_JOBS, three
// rc-quality matrix jobs, each a run of consecutive shards no longer than that
// (releaseSlices), sized by its max-parallel so the three end together. A
// plan that needs more than MAX_RELEASE_PLAN, every job's matrix full, fails,
// naming its heaviest group.

import { createHash } from 'node:crypto';
import type { Plan } from '../cells';
import type { SummaryTest } from '../reporter';
import type { Engine } from './matrix';
import { parseShard } from '../../../ci/shards.mjs';
import {
  assignShards,
  CELL_SPEC,
  groupKey,
  loadDurations,
  planGroups,
  serverProject,
  SHARD_WORKERS,
  shardWall,
  splitGroups,
  type PrShard,
  type ShardDurations,
  type ShardGroup,
} from './pr-shards';
import { cellServer, serverId } from './server';
import type { PlanRecord } from './shards';
import { visualCells, VISUAL_VIEWPORTS } from './visual';

export const VISUAL_SPEC = 'visual.spec.ts';

/**
 * The nightly's cap: the most shard jobs of a night at once, and the nightly's shard count: 12, the
 * most jobs this repository's CI holds at once, so the account's 20 keep room for other work. The nightly's
 * scope runs in a 7-night cycle at 12 (nightly-scope.test.ts), and would at 16 too.
 */
export const FULL_SHARDS = 12;
/**
 * The release's rc-quality matrix jobs, by job id, each with its max-parallel: three, since one
 * matrix makes at most MAX_RELEASE_SHARDS jobs, at 6, 5 and 5 at once, 16 together (the
 * coordinator's sizing ruling, 2026-11-11), under the account's 20 job slots.
 */
export const RELEASE_JOBS: readonly { readonly id: string; readonly parallel: number }[] = [
  { id: 'rc-quality-1', parallel: 6 },
  { id: 'rc-quality-2', parallel: 5 },
  { id: 'rc-quality-3', parallel: 5 },
];
/** The release's cap: the most rc-quality shard jobs at once, its jobs' max-parallel together. */
export const RELEASE_PARALLEL = RELEASE_JOBS.reduce((sum, job) => sum + job.parallel, 0);
/** The cycle lengths the rotation takes, the smallest that fits: a week, doubled each time. */
export const NIGHT_COUNTS: readonly number[] = [7, 14, 28, 56];
/** The longest cycle: past eight weeks, the nightly needs more shards or a longer night instead. */
export const MAX_NIGHTS = NIGHT_COUNTS.at(-1)!;
/** How many buckets a server's cell tests are split into, each with a night of its own. */
export const BUCKETS = 4;
/** The most shards one rc-quality job takes: the most jobs a GitHub matrix makes. */
export const MAX_RELEASE_SHARDS = 256;
/** The most release shards: every rc-quality job's matrix full. */
export const MAX_RELEASE_PLAN = RELEASE_JOBS.length * MAX_RELEASE_SHARDS;

/**
 * The shards, 1 to `count`, each rc-quality job runs: consecutive runs, the first job's first, each
 * job's share in proportion to its max-parallel (so the three end together, waves of the same
 * length), the remainder to the first jobs, none past `cap`. A job's list may be empty, for a plan
 * of fewer shards than jobs: its job skips. Past every job's cap it throws.
 */
export function releaseSlices(
  count: number,
  jobs: readonly { readonly parallel: number }[] = RELEASE_JOBS,
  cap: number = MAX_RELEASE_SHARDS,
): number[][] {
  if (!Number.isInteger(count) || count < 1)
    throw new Error(`A release plan of ${count} shards can't be split.`);
  if (count > jobs.length * cap)
    throw new Error(
      `${count} release shards are more than ${jobs.length} jobs of ${cap} hold (MAX_RELEASE_PLAN).`,
    );
  const total = jobs.reduce((sum, job) => sum + job.parallel, 0);
  const sizes = jobs.map((job) => Math.min(cap, Math.floor((count * job.parallel) / total)));
  let left = count - sizes.reduce((sum, size) => sum + size, 0);
  for (let at = 0; left > 0; at = (at + 1) % jobs.length) {
    if (sizes[at]! < cap) {
      sizes[at] = sizes[at]! + 1;
      left -= 1;
    }
  }
  let next = 1;
  return sizes.map((size) => {
    const slice = Array.from({ length: size }, (_, at) => next + at);
    next += size;
    return slice;
  });
}
/**
 * A full shard job's fixed part, in seconds: quality-pr's (SHARD_FIXED, 95 s)
 * plus the reference variant's worktree, installed from its tarball and
 * built with the quality flags, about the 328 s CI's external-variant job
 * takes (run 40081904981).
 */
export const FULL_FIXED = 420;
/**
 * A visual test, in seconds: a page load, the fonts check, and a full-page
 * screenshot. No full run has timed one yet, since the nightly hasn't run;
 * this is a guess on the high side, to be measured from its first logs.
 */
export const VISUAL_SECONDS = 10;
/** A job's timeout over its estimate: the estimates run about 10% low (pr-shards.test.ts's recorded run). */
export const TIMEOUT_MARGIN = 1.5;
/** The longest GitHub lets a job on a hosted runner run. */
export const JOB_LIMIT_MINUTES = 360;
/**
 * quality-full's timeout-minutes: the bound for a night, which the cycle length is sized to: 120,
 * as rc-quality's (row 151, (b1)); it was 90.
 */
export const NIGHTLY_TIMEOUT_MINUTES = 120;
/**
 * rc-quality's and rc-preflight's preflight-quality's timeout-minutes, the release shard's cap. It
 * stays at 120 (the coordinator's release-path ruling, 2026-11-07): the shard target,
 * RELEASE_CEILING, is fitted to this cap, never the cap to the target. RELEASE_PARALLEL went from
 * 10 to 16 with the split into three jobs (the sizing ruling, 2026-11-11).
 */
export const RELEASE_TIMEOUT_MINUTES = 120;

/** A release shard job's measured pace, which RELEASE_CEILING is fitted to the cap at. */
export interface ReleasePace {
  /** Where the numbers come from: the run, its commit, and what was read. */
  readonly source: string;
  /** The job's fixed part on CI Linux, in seconds: its install, and the reference variant's worktree and build. */
  readonly overheadSeconds: number;
  /** The shard's measured test time on CI Linux per second of its estimate (shardWall at the release's weights). */
  readonly pace: number;
}

/**
 * The pace RELEASE_CEILING is fitted at: inventory run 43166869592 of the release scope (c′), at
 * its median shard (lib/release-fit.ts's fitMedianPace over
 * tests/quality/fixtures/inventory-run-43166869592.json, which release-fit.test.ts holds this to).
 * The release weights are that run's own measured means (shard-durations.json's release.targets),
 * so the pace is about 1 and a shard estimated at the ceiling takes 80 minutes at the median; the
 * 1.5x margin is the runners' spread, the slowest of its 486 shards at 1.5x the median pace and
 * its 90th percentile at 1.21x. Fitting a newer run sets these numbers and nothing else.
 */
export const RELEASE_PACE: ReleasePace = {
  source:
    "Inventory run 43166869592 (f5212efb5, the release scope (c′) whole, 614 shards at 2 workers), its 486 finished shards at the median: a 78 s fixed part (each job's time outside its run step, on the mean, from the Actions API's step times), and the median shard's time past it per second of its estimate past FULL_FIXED, each shard's estimate its groups as that run dealt them, at the release weights that run measured.",
  overheadSeconds: 78,
  pace: 1.018,
};

/**
 * The per-shard target a pace fits to `minutes`: the slowest a release shard may be estimated at,
 * in seconds, FULL_FIXED included. It's set so that the measured fixed part plus the shard's test
 * time at that pace stays within `minutes` over `margin`: at TIMEOUT_MARGIN's 1.5x, within 80 of
 * the 120 minutes, so 40 are to spare. It throws when the fixed part alone leaves no time.
 */
export function fitReleaseCeiling(
  { overheadSeconds, pace }: Pick<ReleasePace, 'overheadSeconds' | 'pace'>,
  minutes: number = RELEASE_TIMEOUT_MINUTES,
  margin: number = TIMEOUT_MARGIN,
): number {
  if (!(pace > 0)) throw new Error(`A release pace of ${pace} can't fit a shard.`);
  const usable = Math.floor((minutes * 60) / margin);
  if (overheadSeconds >= usable) {
    throw new Error(
      `A release shard's fixed part of ${overheadSeconds}s leaves no time within ${usable}s, ${minutes} minutes over a ${margin}x margin.`,
    );
  }
  return FULL_FIXED + Math.floor((usable - overheadSeconds) / pace);
}

/**
 * The slowest a release shard may be estimated at, in seconds, its fixed part included: the release
 * plan's per-shard target, which rc-quality-plan counts its shards by (releaseFor). It's
 * fitReleaseCeiling(RELEASE_PACE), the 120-minute cap (RELEASE_TIMEOUT_MINUTES) over
 * TIMEOUT_MARGIN at the pace measured on CI Linux: 5,058 s at the inventory run's median.
 */
export const RELEASE_CEILING = fitReleaseCeiling(RELEASE_PACE);
/**
 * The slowest a nightly shard may be estimated at, in seconds, its fixed part included: the night's
 * 120 minutes over TIMEOUT_MARGIN at the release's measured pace, as RELEASE_CEILING is fitted to
 * rc-quality's (row 151). A night is sized by the release's weights (releaseDurations()), the same
 * tests in the same image as a release shard; the PR's weights, which sized it before, run about
 * 4.5 times light for the full plan, so every night from 11-04 ran past its 90 minutes.
 */
export const NIGHTLY_CEILING = fitReleaseCeiling(RELEASE_PACE, NIGHTLY_TIMEOUT_MINUTES);
/**
 * The most one group may weigh, in seconds: it runs on one worker, after the shard's fixed part.
 * 3,180 s, what the old 90-minute night's ceiling left one worker. It stays under the nights'
 * higher ceiling: parts that size deal the nights and the release's shards evenly, and parts of a
 * whole worker's time leave nights lumpy past every cycle.
 */
export const FULL_GROUP_BUDGET = 3180;

/** A shard job's timeout-minutes, for a shard estimated at up to `ceiling` seconds. */
export const timeoutMinutes = (ceiling: number) => Math.ceil((ceiling * TIMEOUT_MARGIN) / 60);
/** rc-quality's timeout-minutes: the cap, which a fitted ceiling never moves. */
export const releaseTimeoutMinutes = () => RELEASE_TIMEOUT_MINUTES;

/**
 * The weights the release plan and the nightly size their shards by: `durations` with its
 * `release` block (shard-durations.json): its `targets`, each cell test's mean time by `<target>
 * <viewport> <row>` as an inventory run of the release scope measured it, and its `skipped`, which
 * a test of a measured key and a skipped test take first (testWeight()); and its p90s of
 * `conditions`, `pack` and `perf` from a candidate's preflight, over the PR weights, for any test
 * the inventory didn't time. A shard's estimate is then its fixed part and its workers' time at
 * those means, which the release ceiling holds to two-thirds of rc-quality's timeout
 * (TIMEOUT_MARGIN) at the run's median pace (RELEASE_PACE).
 */
export function releaseDurations(durations: ShardDurations = loadDurations()): ShardDurations {
  const release = durations.release;
  if (!release) return durations;
  return {
    ...durations,
    conditions: { ...durations.conditions, ...release.conditions },
    pack: { ...durations.pack, ...release.pack },
    perf: release.perf,
    ...(release.skipped === undefined ? {} : { skipped: release.skipped }),
    ...(release.targets === undefined ? {} : { targets: release.targets }),
  };
}

/** About how long a full shard job takes, in seconds: its fixed part, and its groups on its workers. */
export const fullEstimate = (shard: Pick<PrShard, 'groups'>) =>
  FULL_FIXED + shardWall(shard.groups);

/** Whether a group rotates (its cell or visual tests), or runs every night (the harness's and the perf cells'). */
export const rotates = (group: Pick<ShardGroup, 'file'>) =>
  group.file === CELL_SPEC || group.file === VISUAL_SPEC;

const hashOf = (text: string) => createHash('sha256').update(text).digest().readUInt32BE(0);

/** The server a project runs on, without its engine: its id, or `harness`. */
const serverOf = (project: string) => project.slice(project.indexOf(' ') + 1);

/** A planned test's bucket, from a hash of its cell, viewport, and row (its key without the engine). */
export function testBucket(key: string, buckets: number = BUCKETS): number {
  const [cell, viewport, row] = JSON.parse(key) as string[];
  return hashOf(JSON.stringify([cell, viewport, row])) % buckets;
}

/** A rotating group, with the bucket of its server's tests it holds. */
export interface NightGroup extends ShardGroup {
  readonly bucket: number;
}

/**
 * A rotating group's night, from 0: a hash of its server and bucket, mod
 * `nights` (`salt`, empty in the plan, rolls the draw again for a test).
 * Its file, weight, tests, and part never move it, and neither does the
 * rest of the plan. Doubling `nights` keeps it at night n or n + `nights`.
 */
export function groupNight(
  group: Pick<ShardGroup, 'project'> & { readonly bucket?: number },
  nights: number = NIGHT_COUNTS[0]!,
  salt = '',
): number {
  return hashOf(`${salt}${serverOf(group.project)}#${group.bucket ?? 0}`) % nights;
}

/**
 * Every test group the full plan runs on `engines`: quality:pr's groups
 * (planGroups), and each server's visual tests (lib/visual.ts's visualCells
 * at VISUAL_VIEWPORTS).
 */
export function fullGroups(
  plan: Pick<Plan, 'cells' | 'tests' | 'targets' | 'mode'>,
  engines: readonly Engine[],
  durations: ShardDurations = loadDurations(),
): ShardGroup[] {
  const groups = planGroups(plan, engines, durations);
  const visual = new Map<string, number>();
  for (const cell of visualCells(plan)) {
    const id = serverId(cellServer(cell));
    visual.set(id, (visual.get(id) ?? 0) + VISUAL_VIEWPORTS.length);
  }
  for (const engine of engines) {
    for (const [id, tests] of [...visual].sort(([a], [b]) => (a < b ? -1 : 1))) {
      groups.push({
        project: serverProject(engine, id),
        file: VISUAL_SPEC,
        tests: [],
        weight: durations.group + tests * VISUAL_SECONDS,
      });
    }
  }
  return groups;
}

/** The slowest of `shards`, and its heaviest group. */
function slowestOf(shards: readonly PrShard[]) {
  const worst = shards.reduce((a, b) => (fullEstimate(b) > fullEstimate(a) ? b : a));
  const heaviest = [...worst.groups].sort((a, b) => b.weight - a.weight)[0]!;
  return { estimate: fullEstimate(worst), heaviest };
}

/**
 * `groups` as the nightly runs them: each server's cell group in its
 * buckets (testBucket), each bucket a part of the group, split again into
 * parts when too heavy for one worker, every part numbered in turn; the
 * visual groups in bucket 0; and the every-night groups as they are, split
 * when too heavy.
 */
export function bucketGroups(
  groups: readonly ShardGroup[],
  durations: Pick<ShardDurations, 'group'> = loadDurations(),
  buckets: number = BUCKETS,
): NightGroup[] {
  const parts = new Map<string, number>();
  const numbered = (group: ShardGroup, bucket: number): NightGroup => {
    const key = `${group.project} ${group.file}`;
    const part = (parts.get(key) ?? 0) + 1;
    parts.set(key, part);
    return { ...group, part, bucket };
  };
  return groups.flatMap((group): NightGroup[] => {
    if (group.file !== CELL_SPEC || !group.costs) {
      return splitGroups([group], FULL_GROUP_BUDGET, durations).map((each) => ({
        ...each,
        bucket: 0,
      }));
    }
    const byBucket = new Map<number, { tests: string[]; costs: number[] }>();
    group.tests.forEach((key, at) => {
      const bucket = testBucket(key, buckets);
      const entry = byBucket.get(bucket) ?? { tests: [], costs: [] };
      entry.tests.push(key);
      entry.costs.push(group.costs![at]!);
      byBucket.set(bucket, entry);
    });
    return [...byBucket]
      .sort(([a], [b]) => a - b)
      .flatMap(([bucket, { tests, costs }]) =>
        splitGroups(
          [
            {
              project: group.project,
              file: group.file,
              tests,
              costs,
              weight: costs.reduce((sum, cost) => sum + cost, durations.group),
            },
          ],
          FULL_GROUP_BUDGET,
          durations,
        ).map((each) => numbered(each, bucket)),
      );
  });
}

/**
 * `groups` (bucketed already) in `nights` nights of `shards` shards each:
 * each rotating group on its own night (groupNight), and every every-night
 * group on every night, each night's dealt heaviest first into its shards.
 */
export function rotationSlices(
  groups: readonly NightGroup[],
  nights: number = NIGHT_COUNTS[0]!,
  shards: number = FULL_SHARDS,
  salt = '',
): PrShard[][] {
  const nightly = groups.filter((group) => !rotates(group));
  const rotating = groups.filter(rotates);
  return Array.from({ length: nights }, (_, night) =>
    assignShards(
      [...nightly, ...rotating.filter((group) => groupNight(group, nights, salt) === night)],
      shards,
    ),
  );
}

export interface NightlyPlan {
  readonly nights: number;
  /** Each night's shards, in night order. */
  readonly slices: readonly (readonly PrShard[])[];
  /** The slowest shard of any night, in seconds. */
  readonly slowest: number;
}

/**
 * The rotation over `nights` nights, each of which must keep every shard
 * within NIGHTLY_CEILING, or it throws, naming the first night that
 * doesn't, its load, and its slowest shard's heaviest group.
 */
export function nightlyPlan(
  groups: readonly ShardGroup[],
  durations: Pick<ShardDurations, 'group'> = loadDurations(),
  shards: number = FULL_SHARDS,
  nights: number = NIGHT_COUNTS[0]!,
  salt = '',
): NightlyPlan {
  return fittedNights(bucketGroups(groups, durations), shards, nights, salt);
}

/** `bucketed`'s rotation over `nights` nights, or it throws, naming the first night over its budget. */
function fittedNights(
  bucketed: readonly NightGroup[],
  shards: number,
  nights: number,
  salt: string,
): NightlyPlan {
  const slices = rotationSlices(bucketed, nights, shards, salt);
  for (const [at, slice] of slices.entries()) {
    const { estimate, heaviest } = slowestOf(slice);
    if (estimate > NIGHTLY_CEILING) {
      const load = slice.reduce((sum, shard) => sum + shard.weight, 0);
      throw new Error(
        `Night ${at + 1} of ${nights} holds about ${Math.round(load)}s of tests, and leaves a shard at about ${Math.round(estimate)}s, over the ${NIGHTLY_CEILING}s ceiling. Its heaviest group is ${groupKey(heaviest)}, at about ${Math.round(heaviest.weight)}s.`,
      );
    }
  }
  return { nights, slices, slowest: Math.max(...slices.flat().map(fullEstimate)) };
}

/**
 * The rotation the plan runs: the smallest of NIGHT_COUNTS whose every night
 * fits. Past MAX_NIGHTS it throws, naming that cycle's heaviest night.
 */
export function rotationFor(
  groups: readonly ShardGroup[],
  durations: Pick<ShardDurations, 'group'> = loadDurations(),
  shards: number = FULL_SHARDS,
  salt = '',
): NightlyPlan {
  const bucketed = bucketGroups(groups, durations);
  let failure = '';
  for (const nights of NIGHT_COUNTS) {
    try {
      return fittedNights(bucketed, shards, nights, salt);
    } catch (error) {
      // fittedNights throws only a night over its budget: the groups were split already.
      failure = (error as Error).message;
    }
  }
  throw new Error(
    `Even ${MAX_NIGHTS} nights don't fit, past the longest cycle (MAX_NIGHTS): ${failure}`,
  );
}

/** The release plan in `shards` shards, each within `ceiling` (RELEASE_CEILING), or it throws. */
export function releasePlan(
  groups: readonly ShardGroup[],
  durations: Pick<ShardDurations, 'group'> = loadDurations(),
  shards: number,
  ceiling: number = RELEASE_CEILING,
): { readonly shards: PrShard[]; readonly slowest: number } {
  const assigned = assignShards(splitGroups(groups, FULL_GROUP_BUDGET, durations), shards);
  const { estimate, heaviest } = slowestOf(assigned);
  if (estimate > ceiling) {
    throw new Error(
      `The release plan in ${shards} shards leaves a shard at about ${Math.round(estimate)}s, over the ${ceiling}s ceiling. Its heaviest group is ${groupKey(heaviest)}, at about ${Math.round(heaviest.weight)}s.`,
    );
  }
  return { shards: assigned, slowest: estimate };
}

/**
 * The fewest release shards any plan of `groups` could fit: a shard within
 * RELEASE_CEILING holds at most its workers' time after its fixed part, so
 * fewer than this can't hold the plan's whole weight, split as releasePlan()
 * splits it.
 */
export function releaseFloor(
  groups: readonly ShardGroup[],
  durations: Pick<ShardDurations, 'group'> = loadDurations(),
  ceiling: number = RELEASE_CEILING,
): number {
  const weight = splitGroups(groups, FULL_GROUP_BUDGET, durations).reduce(
    (sum, group) => sum + group.weight,
    0,
  );
  return Math.max(1, Math.ceil(weight / (SHARD_WORKERS * (ceiling - FULL_FIXED))));
}

/**
 * The release plan the plan runs: the fewest shards that keep each within
 * RELEASE_CEILING, so one fewer leaves a shard over it. It tries each count
 * up from releaseFloor(), below which none can fit. Past MAX_RELEASE_PLAN
 * it throws, naming the heaviest group.
 */
export function releaseFor(
  groups: readonly ShardGroup[],
  durations: Pick<ShardDurations, 'group'> = loadDurations(),
  ceiling: number = RELEASE_CEILING,
): { readonly count: number; readonly shards: PrShard[]; readonly slowest: number } {
  let failure = '';
  for (
    let count = Math.min(releaseFloor(groups, durations, ceiling), MAX_RELEASE_PLAN);
    count <= MAX_RELEASE_PLAN;
    count += 1
  ) {
    try {
      return { count, ...releasePlan(groups, durations, count, ceiling) };
    } catch (error) {
      failure = (error as Error).message;
      if (!/^The release plan in \d+ shards/.test(failure)) throw error;
    }
  }
  throw new Error(
    `Even ${MAX_RELEASE_PLAN} release shards don't fit (MAX_RELEASE_PLAN, ${RELEASE_JOBS.length} jobs of ${MAX_RELEASE_SHARDS}): ${failure}`,
  );
}

const NIGHT = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The days from 1970-01-01 to `night`, a UTC date as YYYY-MM-DD. */
export function dayNumber(night: string): number {
  const match = NIGHT.exec(night);
  const time = match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
  // A day past its month's end rolls over, so it reads back as another date.
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== night) {
    throw new Error(`A night is a UTC date, YYYY-MM-DD, not ${night}.`);
  }
  return time / 86_400_000;
}

/** Which night of the cycle, from 0, the night of `night` is. */
export const nightSlice = (night: string, nights: number = NIGHT_COUNTS[0]!) =>
  dayNumber(night) % nights;

/** The night `days` after `night`. */
const addDays = (night: string, days: number) =>
  new Date((dayNumber(night) + days) * 86_400_000).toISOString().slice(0, 10);

/**
 * The plan's fingerprint: its planned tests, hashed. Two nights with the
 * same fingerprint ran slices of one plan, so their rotations line up.
 */
export function planFingerprint(plan: Pick<Plan, 'tests'>): string {
  const keys = plan.tests
    .map((test) => JSON.stringify([test.cell.id, test.viewport.id, test.row.id]))
    .sort();
  return createHash('sha256').update(keys.join('\n')).digest('hex').slice(0, 16);
}

/** What a night's slice is, as plan.json keeps it: the night, which of how many, and every cell's night. */
export interface NightSlice {
  readonly night: string;
  /** From 1. */
  readonly index: number;
  readonly nights: number;
  /** The plan the rotation is of (planFingerprint). */
  readonly fingerprint: string;
  /** The cells whose tests it runs, by id, in the plan's order. */
  readonly cells: readonly string[];
  /** Every planned cell's nights, from 1, by id: the nights its tests run on, at most BUCKETS. */
  readonly rotation: Readonly<Record<string, readonly number[]>>;
}

/** The cell a test key names. */
const cellOf = (key: string) => (JSON.parse(key) as string[])[0]!;

/** The cells a slice's shards run tests of. */
export function sliceCellIds(shards: readonly PrShard[]): Set<string> {
  return new Set(
    shards.flatMap((shard) => shard.groups.flatMap((group) => group.tests.map(cellOf))),
  );
}

/** The projects a run's shards list: every project any of them runs a group of. */
export function runProjects(shards: readonly PrShard[]): Set<string> {
  return new Set(shards.flatMap((shard) => shard.groups.map((group) => group.project)));
}

/**
 * Each planned cell's nights, from 1, in the plan's order: every night one
 * of its tests runs on. A test in two nights means a group lost its night:
 * that throws, so every test of a cell runs once a cycle.
 */
export function cellRotation(
  plan: Pick<Plan, 'cells'>,
  slices: readonly (readonly PrShard[])[],
): Record<string, number[]> {
  const nightOf = new Map<string, number>();
  const nights = new Map<string, Set<number>>();
  slices.forEach((slice, at) => {
    for (const key of slice.flatMap((shard) => shard.groups.flatMap((group) => group.tests))) {
      const other = nightOf.get(key);
      if (other !== undefined && other !== at + 1) {
        throw new Error(`The test ${key} runs on nights ${other} and ${at + 1}.`);
      }
      nightOf.set(key, at + 1);
      const cell = cellOf(key);
      nights.set(cell, (nights.get(cell) ?? new Set()).add(at + 1));
    }
  });
  return Object.fromEntries(
    plan.cells.flatMap((cell) => {
      const own = nights.get(cell.id);
      return own === undefined ? [] : [[cell.id, [...own].sort((a, b) => a - b)] as const];
    }),
  );
}

/** What a night runs of the plan: its planned tests, as [cell, viewport, row] keys, and its visual cells. */
export interface Tonight {
  readonly tests: ReadonlySet<string>;
  readonly visual: ReadonlySet<string>;
}

export interface FullShard {
  readonly shard: PrShard;
  /** The projects every shard of the run lists. */
  readonly projects: ReadonlySet<string>;
  readonly slice: NightSlice | null;
  /** A night's tests and visual cells, which its plan record holds it to; null for the release plan. */
  readonly tonight: Tonight | null;
  /** The slowest shard of the plan, in seconds. */
  readonly slowest: number;
}

/**
 * The shard `shard` (<n>/<m>, or null for all of them on one machine) of the
 * full plan on `engines`: the night's slice's with `night`, in m shards,
 * else the release plan's, in m shards. Each throws when its plan is over
 * its budget. With no `durations`, both size by releaseDurations().
 */
export function fullShard(
  plan: Pick<Plan, 'cells' | 'tests' | 'targets' | 'mode'>,
  engines: readonly Engine[],
  shard: string | null,
  night: string | null,
  durations?: ShardDurations,
): FullShard {
  const parsed = shard ? (parseShard(shard) as { index: number; count: number }) : null;
  // A release shard and a night both plan by the release's measured weights (releaseDurations(),
  // row 151 for the night), unless the caller hands them their own.
  const weights = durations ?? releaseDurations();
  const groups = fullGroups(plan, engines, weights);
  const pick = (shards: readonly PrShard[]): PrShard =>
    parsed
      ? shards[parsed.index - 1]!
      : {
          index: 1,
          count: 1,
          groups: shards.flatMap((each) => each.groups),
          weight: shards.reduce((sum, each) => sum + each.weight, 0),
        };
  if (night === null) {
    // A shard of the count rc-quality-plan worked out, or on one machine, the count that fits.
    const release = parsed
      ? releasePlan(groups, weights, parsed.count)
      : releaseFor(groups, weights);
    return {
      shard: pick(release.shards),
      projects: runProjects(release.shards),
      slice: null,
      tonight: null,
      slowest: release.slowest,
    };
  }
  const rotation = rotationFor(groups, weights, parsed?.count ?? FULL_SHARDS);
  const at = nightSlice(night, rotation.nights);
  const slice = rotation.slices[at]!;
  const cells = sliceCellIds(slice);
  const visualProjects = new Set(
    slice
      .flatMap((shard) => shard.groups)
      .filter((group) => group.file === VISUAL_SPEC)
      .map((group) => group.project),
  );
  const tonight: Tonight = {
    tests: new Set(
      slice
        .flatMap((shard) => shard.groups.flatMap((group) => group.tests))
        .map((key) => JSON.stringify((JSON.parse(key) as string[]).slice(0, 3))),
    ),
    visual: new Set(
      visualCells(plan)
        .filter((cell) =>
          engines.some((engine) =>
            visualProjects.has(serverProject(engine, serverId(cellServer(cell)))),
          ),
        )
        .map((cell) => cell.id),
    ),
  };
  return {
    shard: pick(slice),
    projects: runProjects(slice),
    tonight,
    slice: {
      night,
      index: at + 1,
      nights: rotation.nights,
      fingerprint: planFingerprint(plan),
      cells: plan.cells.filter((cell) => cells.has(cell.id)).map((cell) => cell.id),
      rotation: cellRotation(plan, rotation.slices),
    },
    slowest: rotation.slowest,
  };
}

/**
 * A night's plan record (plan.json): only its cell tests and visual tests,
 * the targets with a test tonight that runs, and the slice. The perf cells
 * stay whole, since every night runs them, so perf-coverage still holds
 * each listed target to one. The merge then judges the night's shards
 * whole against it, as it judges a release's against the whole plan.
 */
export function sliceRecord(
  record: PlanRecord,
  plan: Pick<Plan, 'cells'>,
  slice: NightSlice,
  engines: readonly string[],
  tonight: Tonight,
): PlanRecord {
  const planned = record.planned.filter((test) =>
    tonight.tests.has(JSON.stringify([test.cell, test.viewport, test.row])),
  );
  const runs = new Set(
    planned
      .filter((test) => test.skip === null && engines.some((engine) => !test.engineSkips[engine]))
      .map((test) => test.cell),
  );
  const targets = new Set(
    plan.cells.filter((cell) => runs.has(cell.id)).map((cell) => `${cell.kind}:${cell.target}`),
  );
  return {
    ...record,
    cells: new Set(planned.map((test) => test.cell)).size,
    tests: planned.length,
    planned,
    targets: record.targets.filter((target) => targets.has(`${target.kind}:${target.id}`)),
    ...(record.visual
      ? { visual: record.visual.filter((each) => tonight.visual.has(each.cell)) }
      : {}),
    slice,
  };
}

/** A cell's turns, seen from a night: the last night the rotation scheduled it, tonight included, and the next. */
export function rotationNights(
  slice: Pick<NightSlice, 'night' | 'index' | 'nights'>,
  at: number,
): { readonly last: string; readonly next: string } {
  const back = (slice.index - at + slice.nights) % slice.nights;
  const ahead = (at - slice.index + slice.nights) % slice.nights || slice.nights;
  return { last: addDays(slice.night, -back), next: addDays(slice.night, ahead) };
}

/** Why a night's report can't say when a cell outside its slice last passed. */
export const LAST_PASSED_UNREAD =
  "Only tonight's tests are judged here, and a cell's tests run on up to four nights of the cycle, so tonight's result is of tonight's tests, and lastPassed is tonight's only for a cell whose every test ran tonight, else unknown. When a cell outside tonight's slice last passed is in an earlier night's reports-quality-verdict artifact, and reading another run's artifact needs actions: read, which quality-verdict doesn't hold. scheduledLast is the last night the rotation scheduled the cell, which is no proof that it ran or passed then, and the rotation is this fingerprint's plan's.";

/** A cell's line in a night's rotation report. */
export interface RotationCell {
  readonly cell: string;
  /** Its nights of the cycle, from 1: those its tests run on. */
  readonly nights: readonly number[];
  /** Tonight's result: its tests' outcomes tonight together, or null when none of them ran tonight. */
  readonly tonight: 'passed' | 'failed' | 'skipped' | 'not run' | null;
  /** The night it last passed, as far as this run knows: tonight, or null when it can't say. */
  readonly lastPassed: string | null;
  /** The last night the rotation scheduled it, tonight included: not proof that it ran or passed. */
  readonly scheduledLast: string;
  /** The next night the rotation schedules it. */
  readonly scheduledNext: string;
}

export interface RotationReport {
  readonly night: string;
  readonly slice: number;
  readonly nights: number;
  readonly fingerprint: string;
  /** The nights of the cycle tonight is in, first and last. */
  readonly cycle: { readonly from: string; readonly to: string };
  readonly cells: readonly RotationCell[];
  readonly note: string;
}

/**
 * The night's rotation report, which quality-verdict writes to
 * reports/quality/rotation.json: which night of the cycle ran, the plan's
 * fingerprint, and for each cell, tonight's result from the joined summary,
 * when it last passed as far as this run can tell, and the nights the
 * rotation last scheduled it and schedules it next.
 */
export function rotationReport(
  slice: NightSlice,
  tests: readonly Pick<SummaryTest, 'cell' | 'kind' | 'outcome'>[],
): RotationReport {
  const results = new Map<string, string[]>();
  for (const test of tests) {
    if (!test.cell || (test.kind !== 'cell' && test.kind !== 'visual')) continue;
    results.set(test.cell, [...(results.get(test.cell) ?? []), test.outcome]);
  }
  const tonight = new Set(slice.cells);
  const result = (cell: string): RotationCell['tonight'] => {
    const outcomes = results.get(cell) ?? [];
    if (outcomes.length === 0) return 'not run';
    if (outcomes.some((outcome) => outcome !== 'expected' && outcome !== 'skipped'))
      return 'failed';
    return outcomes.every((outcome) => outcome === 'skipped') ? 'skipped' : 'passed';
  };
  const first = addDays(slice.night, -(slice.index - 1));
  return {
    night: slice.night,
    slice: slice.index,
    nights: slice.nights,
    fingerprint: slice.fingerprint,
    cycle: { from: first, to: addDays(first, slice.nights - 1) },
    cells: Object.entries(slice.rotation).map(([cell, nights]) => {
      const ran = tonight.has(cell) ? result(cell) : null;
      const turns = nights.map((at) => rotationNights(slice, at));
      return {
        cell,
        nights,
        tonight: ran,
        // Only when every one of its tests ran tonight, on its only night.
        lastPassed:
          ran === 'passed' && nights.length === 1 && nights[0] === slice.index ? slice.night : null,
        scheduledLast: turns
          .map((turn) => turn.last)
          .sort()
          .at(-1)!,
        scheduledNext: turns.map((turn) => turn.next).sort()[0]!,
      };
    }),
    note: LAST_PASSED_UNREAD,
  };
}
