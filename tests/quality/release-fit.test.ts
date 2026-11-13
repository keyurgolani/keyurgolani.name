import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  FULL_FIXED,
  fitReleaseCeiling,
  RELEASE_CEILING,
  RELEASE_PACE,
  RELEASE_PARALLEL,
  RELEASE_TIMEOUT_MINUTES,
  releasePlan,
  releaseTimeoutMinutes,
  TIMEOUT_MARGIN,
} from './lib/full-shards';
import { CELL_SPEC, testKey } from './lib/pr-shards';
import {
  measuredPace,
  measuredRelease,
  releaseWallClock,
  timedGroups,
  type ReleaseTimes,
  type TimedTest,
} from './lib/release-fit';
import { runReleaseFit } from './release-fit';
import * as releaseFit from './lib/release-fit';

const RC2_RUN = fileURLToPath(new URL('./fixtures/release-run-42966517304.json', import.meta.url));

/** A CI Linux run's times, made up: twelve servers' cell tests, a cell's three viewports, and one harness spec. */
function times(overheadSeconds: number, pace?: number): ReleaseTimes {
  const tests: TimedTest[] = [];
  for (let server = 1; server <= 12; server += 1) {
    for (let cell = 0; cell < 80; cell += 1) {
      for (const [at, viewport] of ['390x844', '1024x768', '1440x900'].entries()) {
        const seconds = 20 + ((server * 31 + cell * 7 + at * 13) % 45);
        tests.push({
          project: `chromium s${server}`,
          file: CELL_SPEC,
          key: testKey(`cell-${server}-${cell}`, viewport, 'default', 'chromium'),
          seconds,
          ...(pace === undefined ? {} : { estimate: seconds / pace }),
        });
      }
    }
  }
  tests.push({ project: 'chromium harness', file: 'harness/menu.spec.ts', seconds: 280 });
  tests.push({ project: 'chromium harness', file: 'harness/menu.spec.ts', seconds: 140 });
  return { source: 'a made-up run', overheadSeconds, tests };
}

test("the release cap stays 120 minutes, 16 at a time across its three jobs, and the per-shard target is the one rc.2's release run measured fits to it: 6,668 s", () => {
  assert.equal(RELEASE_TIMEOUT_MINUTES, 120);
  assert.equal(releaseTimeoutMinutes(), RELEASE_TIMEOUT_MINUTES);
  assert.equal(RELEASE_PARALLEL, 16);
  assert.ok(RELEASE_PACE.source.trim().length > 0, 'RELEASE_PACE names its source');
  assert.equal(RELEASE_CEILING, fitReleaseCeiling(RELEASE_PACE));
  assert.equal(RELEASE_CEILING, 6668);
});

test("RELEASE_PACE is rc.2's release run 42966517304, fitted to its slowest shard: every shard's fixed part and estimate at that pace cover its measured job, and a shard at the ceiling keeps the 1.5x margin under 120 minutes", () => {
  const run = releaseFit.loadShardRun(RC2_RUN);
  assert.equal(run.run, '42966517304');
  assert.equal(run.shards.length, 89);
  const fitted = releaseFit.fitShardPace(run);
  // The fixed part is what each job took outside its run step, on the mean; the pace is the
  // slowest shard's measured time past it, per second of its estimate past FULL_FIXED, rounded up.
  assert.deepEqual(fitted, { overheadSeconds: 51, pace: 0.76 });
  assert.deepEqual(
    { overheadSeconds: RELEASE_PACE.overheadSeconds, pace: RELEASE_PACE.pace },
    fitted,
  );
  assert.match(RELEASE_PACE.source, /42966517304/);
  assert.match(RELEASE_PACE.source, /slowest/);
  // Fitted to the slowest, so it covers every shard the run had.
  for (const shard of run.shards) {
    const predicted =
      RELEASE_PACE.overheadSeconds + RELEASE_PACE.pace * (shard.estimate - FULL_FIXED);
    assert.ok(
      predicted >= shard.jobSeconds,
      `shard ${shard.shard}: ${predicted} < ${shard.jobSeconds}`,
    );
  }
  // A shard estimated at the ceiling takes, at that pace, no more than the cap over the margin.
  const usable = Math.floor((RELEASE_TIMEOUT_MINUTES * 60) / TIMEOUT_MARGIN);
  const atCeiling =
    RELEASE_PACE.overheadSeconds + RELEASE_PACE.pace * (RELEASE_CEILING - FULL_FIXED);
  assert.ok(atCeiling <= usable, `${atCeiling} > ${usable}`);
  assert.ok(atCeiling * TIMEOUT_MARGIN <= RELEASE_TIMEOUT_MINUTES * 60);
  // rc.2's own shards ran at most 40.1 minutes against the 80 its ceiling allowed.
  assert.equal(Math.max(...run.shards.map((shard) => shard.jobSeconds)), 2407);
});

test('a run file without its shards, or a shard without its estimate, fails to fit', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'release-run-'));
  try {
    const file = path.join(dir, 'run.json');
    writeFileSync(file, JSON.stringify({ source: 'x', run: '1', commit: 'a', shards: [] }));
    assert.throws(() => releaseFit.loadShardRun(file), /has its shards/);
    writeFileSync(
      file,
      JSON.stringify({
        source: 'x',
        run: '1',
        commit: 'a',
        shards: [{ shard: 1, jobSeconds: 9, runSeconds: 8 }],
      }),
    );
    assert.throws(() => releaseFit.loadShardRun(file), /shard 1 needs its estimate/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a pace fits the target to the cap over the margin: a slower pace or a longer fixed part lowers it, and one that leaves no time throws', () => {
  const usable = Math.floor((RELEASE_TIMEOUT_MINUTES * 60) / TIMEOUT_MARGIN);
  assert.equal(usable, 4800);
  assert.equal(fitReleaseCeiling({ overheadSeconds: 600, pace: 1.25 }), FULL_FIXED + 3360);
  assert.equal(fitReleaseCeiling({ overheadSeconds: 600, pace: 0.8 }), FULL_FIXED + 5250);
  assert.ok(fitReleaseCeiling({ overheadSeconds: 900, pace: 1 }) < RELEASE_CEILING);
  assert.throws(
    () => fitReleaseCeiling({ overheadSeconds: usable, pace: 1 }),
    /leaves no time within 4800s/,
  );
  assert.throws(() => fitReleaseCeiling({ overheadSeconds: 600, pace: 0 }), /can't fit a shard/);
});

test("given each test's measured time and a shard job's fixed part, the release plan's every shard stays within the 120-minute cap over the 1.5x margin, in the fewest shards that do, every test once, and its wall-clock at max-parallel 16 is its shards in matrix order", () => {
  const run = times(600);
  const release = measuredRelease(run);
  assert.equal(release.usable, 4800);
  assert.ok(release.count > RELEASE_PARALLEL, 'more shards than slots, so the run goes in waves');
  for (const [at, seconds] of release.seconds.entries()) {
    assert.ok(seconds <= release.usable, `shard ${at + 1} at ${Math.round(seconds)}s`);
    assert.ok(seconds <= RELEASE_TIMEOUT_MINUTES * 60 - 2400, 'a 40-minute margin under the cap');
  }
  // The fewest that fit: one fewer leaves a shard over the target.
  const ceiling = fitReleaseCeiling({ overheadSeconds: run.overheadSeconds, pace: 1 });
  assert.throws(
    () => releasePlan(timedGroups(run.tests), { group: 0 }, release.count - 1, ceiling),
    /^Error: The release plan in \d+ shards leaves a shard/,
  );
  // Every cell test once, and the harness spec whole on one shard.
  const keys = release.shards.flatMap((shard) => shard.groups.flatMap((group) => group.tests));
  assert.deepEqual(
    keys.sort(),
    run.tests
      .filter((each) => each.file === CELL_SPEC)
      .map((each) => each.key!)
      .sort(),
  );
  assert.equal(
    release.shards.flatMap((shard) => shard.groups).filter((group) => group.file !== CELL_SPEC)
      .length,
    1,
  );
  // The run: 16 at a time, each shard taking the next free slot in matrix order.
  assert.deepEqual(
    { wall: release.wall, runner: release.runner },
    releaseWallClock(release.seconds, RELEASE_PARALLEL),
  );
  assert.ok(release.wall >= release.slowest);
  assert.ok(release.wall <= Math.ceil(release.count / RELEASE_PARALLEL) * release.slowest);
  assert.equal(release.pace, null);
  assert.equal(release.ceiling, null);
});

test('the wall-clock starts each shard in matrix order on the first slot to free, and counts every shard’s runner time', () => {
  assert.deepEqual(releaseWallClock([10, 10, 10], 2), { wall: 20, runner: 30 });
  assert.deepEqual(releaseWallClock([50, 10, 10, 10], 2), { wall: 50, runner: 80 });
  assert.deepEqual(releaseWallClock([10, 10, 50], 2), { wall: 60, runner: 70 });
  assert.deepEqual(releaseWallClock([30], RELEASE_PARALLEL), { wall: 30, runner: 30 });
});

test("with the plan's estimates in the times file, the measured pace fits the target that release-fit prints, and a malformed file fails", (t) => {
  const run = times(600, 1.25);
  assert.ok(Math.abs(measuredPace(run.tests)! - 1.25) < 1e-9);
  const release = measuredRelease(run);
  assert.equal(release.ceiling, fitReleaseCeiling({ overheadSeconds: 600, pace: release.pace! }));
  const dir = mkdtempSync(path.join(tmpdir(), 'release-fit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'times.json');
  writeFileSync(file, JSON.stringify(run));
  const lines: string[] = [];
  const errors: string[] = [];
  assert.equal(
    runReleaseFit(
      [file],
      (line) => lines.push(line),
      (line) => errors.push(line),
    ),
    0,
  );
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.match(
    lines[1]!,
    new RegExp(
      `: ${release.count} shards, the slowest \\d+s of 4800s \\(120 minutes over 1\\.5x\\)`,
    ),
  );
  assert.match(
    lines[2]!,
    /^\[release-fit\] at 16 at a time: about \d+\.\d h of wall-clock, \d+ runner-minutes$/,
  );
  assert.match(
    lines[3]!,
    new RegExp(`pace: 1\\.250 \\} fits RELEASE_CEILING at ${release.ceiling}s`),
  );
  const bad = path.join(dir, 'bad.json');
  writeFileSync(
    bad,
    JSON.stringify({ ...run, tests: [{ project: 'chromium s1', file: CELL_SPEC, seconds: 3 }] }),
  );
  assert.equal(
    runReleaseFit(
      [bad],
      () => {},
      (line) => errors.push(line),
    ),
    1,
  );
  assert.match(errors.at(-1)!, /test 1 is a cell test, so it needs its key/);
  assert.equal(
    runReleaseFit(
      [],
      () => {},
      (line) => errors.push(line),
    ),
    1,
  );
});
