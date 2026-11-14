// The release plan at measured times (lib/full-shards.ts's RELEASE_PACE): what rc-quality's shards
// come to when each test takes the time a CI Linux run logged for it, and each shard job the fixed
// part it logged. rc-quality-plan sizes its shards by the release's p90 weights within
// RELEASE_CEILING; this works the same planner (releaseFor) over a times file instead, so its
// shards are what those times give, and reports:
//
// - the shard count, each shard's measured fixed part plus its workers' time, and the slowest;
// - the run's wall-clock at max-parallel RELEASE_PARALLEL, each shard starting in matrix order as a
//   slot frees, as GitHub starts a matrix's jobs, and its runner-minutes;
// - when the file gives each test's estimate too, the measured pace (seconds measured per second
//   estimated), and the per-shard target, fitReleaseCeiling(), that pace fits to the 120-minute cap.
//
// A times file is JSON:
//
//   { "source": "<run id, commit, and what was read>",
//     "overheadSeconds": <a shard job's fixed part>,
//     "tests": [{ "project": "<Playwright project>", "file": "<spec, relative to tests/quality>",
//                 "key": "<a cell test's key, testKey()>", "seconds": <measured>,
//                 "estimate": <optional: the plan's weight for it> }] }
//
// A cells.spec.ts test needs its key (a split keeps a cell's tests together); any other spec's
// tests make one whole group per project and file, as the planner groups them.

import { readFileSync } from 'node:fs';
import {
  FULL_FIXED,
  fitReleaseCeiling,
  RELEASE_PARALLEL,
  RELEASE_TIMEOUT_MINUTES,
  releaseFor,
  TIMEOUT_MARGIN,
  type ReleasePace,
} from './full-shards';
import { CELL_SPEC, shardWall, type PrShard, type ShardGroup } from './pr-shards';

export interface TimedTest {
  readonly project: string;
  readonly file: string;
  readonly key?: string;
  readonly seconds: number;
  readonly estimate?: number;
}

export interface ReleaseTimes {
  readonly source: string;
  readonly overheadSeconds: number;
  readonly tests: readonly TimedTest[];
}

/** `path`'s times file, checked: a source, a fixed part, and every test's place and time. */
export function loadTimes(path: string): ReleaseTimes {
  const times = JSON.parse(readFileSync(path, 'utf8')) as ReleaseTimes;
  if (typeof times.source !== 'string' || times.source.trim() === '') {
    throw new Error(`${path}: a times file names its source.`);
  }
  if (!(Number.isFinite(times.overheadSeconds) && times.overheadSeconds >= 0)) {
    throw new Error(`${path}: overheadSeconds is a shard job's fixed part, in seconds.`);
  }
  if (!Array.isArray(times.tests) || times.tests.length === 0) {
    throw new Error(`${path}: a times file has its tests.`);
  }
  times.tests.forEach((each, at) => {
    if (!each.project || !each.file || !(Number.isFinite(each.seconds) && each.seconds >= 0)) {
      throw new Error(`${path}: test ${at + 1} needs its project, file, and seconds.`);
    }
    if (each.file === CELL_SPEC && !each.key) {
      throw new Error(`${path}: test ${at + 1} is a cell test, so it needs its key.`);
    }
  });
  return times;
}

/** The times' test groups, weighed by their measured seconds: a cell group per project with each test's cost, any other spec whole. */
export function timedGroups(tests: readonly TimedTest[]): ShardGroup[] {
  const byFile = new Map<
    string,
    { project: string; file: string; tests: string[]; costs: number[] }
  >();
  for (const each of tests) {
    const at = `${each.project} ${each.file}`;
    const group = byFile.get(at) ?? {
      project: each.project,
      file: each.file,
      tests: [],
      costs: [],
    };
    if (each.file === CELL_SPEC) group.tests.push(each.key!);
    group.costs.push(each.seconds);
    byFile.set(at, group);
  }
  return [...byFile.values()].map(({ project, file, tests: keys, costs }) => {
    const weight = costs.reduce((sum, cost) => sum + cost, 0);
    return file === CELL_SPEC
      ? { project, file, tests: keys, costs, weight }
      : { project, file, tests: [], weight };
  });
}

/**
 * The run's wall-clock and runner time, in seconds, for shards taking `seconds` each: each starts,
 * in matrix order, on the first of `parallel` slots to free, as GitHub starts a matrix's jobs.
 */
export function releaseWallClock(
  seconds: readonly number[],
  parallel: number = RELEASE_PARALLEL,
): { readonly wall: number; readonly runner: number } {
  const slots = Array.from({ length: Math.min(parallel, Math.max(1, seconds.length)) }, () => 0);
  for (const each of seconds) {
    const free = slots.indexOf(Math.min(...slots));
    slots[free] = slots[free]! + each;
  }
  return { wall: Math.max(...slots), runner: seconds.reduce((sum, each) => sum + each, 0) };
}

/** The measured pace: seconds measured per second the plan estimates, over the tests that give both. */
export function measuredPace(tests: readonly TimedTest[]): number | null {
  const both = tests.filter((each) => each.estimate !== undefined && each.estimate > 0);
  if (both.length === 0) return null;
  const measured = both.reduce((sum, each) => sum + each.seconds, 0);
  const estimated = both.reduce((sum, each) => sum + each.estimate!, 0);
  return measured / estimated;
}

export interface MeasuredRelease {
  readonly count: number;
  readonly shards: readonly PrShard[];
  /** Each shard job's measured time, in seconds: the fixed part, and its workers' time. */
  readonly seconds: readonly number[];
  readonly slowest: number;
  /** The most a shard job may take and keep the margin: the cap over TIMEOUT_MARGIN. */
  readonly usable: number;
  readonly wall: number;
  readonly runner: number;
  readonly pace: number | null;
  /** The per-shard target the measured pace fits, when the times give it. */
  readonly ceiling: number | null;
}

/**
 * The release plan at `times`: the fewest shards whose measured fixed part plus workers' time stays
 * within the cap over the margin, by the planner rc-quality-plan runs, with its run's wall-clock at
 * `parallel` at once.
 */
export function measuredRelease(
  times: ReleaseTimes,
  parallel: number = RELEASE_PARALLEL,
  minutes: number = RELEASE_TIMEOUT_MINUTES,
): MeasuredRelease {
  // In measured seconds the pace is 1: a shard's estimate, FULL_FIXED plus its workers' time, is
  // within this ceiling exactly when its measured fixed part plus that time is within `usable`.
  const ceiling = fitReleaseCeiling({ overheadSeconds: times.overheadSeconds, pace: 1 }, minutes);
  const plan = releaseFor(timedGroups(times.tests), { group: 0 }, ceiling);
  const seconds = plan.shards.map((shard) => times.overheadSeconds + shardWall(shard.groups));
  const pace = measuredPace(times.tests);
  return {
    count: plan.count,
    shards: plan.shards,
    seconds,
    slowest: Math.max(...seconds),
    usable: Math.floor((minutes * 60) / TIMEOUT_MARGIN),
    ...releaseWallClock(seconds, parallel),
    pace,
    ceiling:
      pace === null
        ? null
        : fitReleaseCeiling({ overheadSeconds: times.overheadSeconds, pace }, minutes),
  };
}

/** The lines release-fit.ts prints for `release`. */
export function measuredLines(times: ReleaseTimes, release: MeasuredRelease): string[] {
  const hours = (seconds: number) => `${(seconds / 3600).toFixed(1)} h`;
  return [
    `[release-fit] ${times.source}`,
    `[release-fit] ${times.tests.length} tests, a ${Math.round(times.overheadSeconds)}s fixed part a shard: ${release.count} shards, the slowest ${Math.round(release.slowest)}s of ${release.usable}s (${RELEASE_TIMEOUT_MINUTES} minutes over ${TIMEOUT_MARGIN}x), ${Math.round(RELEASE_TIMEOUT_MINUTES * 60 - release.slowest)}s under the cap`,
    `[release-fit] at ${RELEASE_PARALLEL} at a time: about ${hours(release.wall)} of wall-clock, ${Math.round(release.runner / 60)} runner-minutes`,
    release.pace === null
      ? '[release-fit] no estimates in the file, so no pace or fitted ceiling'
      : `[release-fit] measured pace ${release.pace.toFixed(3)}s a second estimated: RELEASE_PACE { overheadSeconds: ${Math.round(times.overheadSeconds)}, pace: ${release.pace.toFixed(3)} } fits RELEASE_CEILING at ${release.ceiling}s (${FULL_FIXED}s fixed part included)`,
  ];
}

/**
 * A release run's shards as its jobs measured them, beside the estimate rc-quality-plan gave each
 * (tests/quality/fixtures/release-run-<id>.json): each job's time, its run step's time, and the
 * sum of its tests' per-key p90 weights. The jobs' times come from the Actions API's job and step
 * timestamps, so no artifact or log is read.
 */
export interface ShardRun {
  readonly source: string;
  readonly run: string;
  readonly commit: string;
  readonly shards: readonly {
    readonly shard: number;
    readonly estimate: number;
    readonly jobSeconds: number;
    readonly runSeconds: number;
  }[];
}

/** `path`'s release run file, checked: its source, and every shard's estimate and times. */
export function loadShardRun(path: string): ShardRun {
  const run = JSON.parse(readFileSync(path, 'utf8')) as ShardRun;
  if (typeof run.source !== 'string' || run.source.trim() === '')
    throw new Error(`${path}: a run file names its source.`);
  if (!Array.isArray(run.shards) || run.shards.length === 0)
    throw new Error(`${path}: a run file has its shards.`);
  for (const each of run.shards) {
    for (const field of ['estimate', 'jobSeconds', 'runSeconds'] as const) {
      if (!(Number.isFinite(each[field]) && each[field] >= 0))
        throw new Error(
          `${path}: shard ${each.shard} needs its ${field.replace('Seconds', ' time')}.`,
        );
    }
    if (!(each.estimate > FULL_FIXED))
      throw new Error(`${path}: shard ${each.shard}'s estimate is within its fixed part.`);
  }
  return run;
}

/**
 * The pace a release run measured, fitted to its slowest shard: the fixed part is each job's time
 * outside its run step, on the mean (setup, checkout, install; the reference variant's build is in
 * the run step, so it counts as test time here, on the safe side), and the pace the most any shard
 * took past that per second of its estimate past FULL_FIXED, rounded up to a thousandth. So at
 * that pace every shard of the run is covered, and the ceiling it fits holds the 1.5x margin for
 * the slowest of them.
 */
export function fitShardPace(run: ShardRun): Pick<ReleasePace, 'overheadSeconds' | 'pace'> {
  const overheadSeconds = Math.round(
    run.shards.reduce((sum, each) => sum + (each.jobSeconds - each.runSeconds), 0) /
      run.shards.length,
  );
  const slowest = Math.max(
    ...run.shards.map((each) => (each.jobSeconds - overheadSeconds) / (each.estimate - FULL_FIXED)),
  );
  return { overheadSeconds, pace: Math.ceil(slowest * 1000) / 1000 };
}

/**
 * The pace a run measured at its median shard, for weights measured from that same run (each key's
 * mean time, shard-durations.json's release.targets): the fixed part as fitShardPace takes it, and
 * the pace the median shard took past it per second of its estimate past FULL_FIXED, rounded up to
 * a thousandth. A shard estimated at the ceiling then takes the cap over the margin at the median,
 * and the margin is the room for the runners' spread around it, which `spread` gives: the median,
 * 90th percentile and most of each shard's pace over the fitted one.
 */
export function fitMedianPace(run: ShardRun): Pick<ReleasePace, 'overheadSeconds' | 'pace'> & {
  readonly spread: { readonly p50: number; readonly p90: number; readonly max: number };
} {
  const overheadSeconds = Math.round(
    run.shards.reduce((sum, each) => sum + (each.jobSeconds - each.runSeconds), 0) /
      run.shards.length,
  );
  const paces = run.shards
    .map((each) => (each.jobSeconds - overheadSeconds) / (each.estimate - FULL_FIXED))
    .sort((a, b) => a - b);
  const at = (share: number) =>
    paces[Math.min(paces.length - 1, Math.floor(paces.length * share))]!;
  const pace = Math.ceil(at(0.5) * 1000) / 1000;
  const over = (value: number) => Math.round((value / pace) * 100) / 100;
  return {
    overheadSeconds,
    pace,
    spread: { p50: over(at(0.5)), p90: over(at(0.9)), max: over(paces.at(-1)!) },
  };
}
