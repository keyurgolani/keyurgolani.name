import assert from 'node:assert/strict';
import test from 'node:test';
import { loadThresholds, type Thresholds } from '../../../../quality/thresholds';
import { GOOD_RUN } from '../../meta/perf-cases';
import { releaseProblems, timingResult, type PerfRun } from './samples';

// Row 141 (runner-normalised timing): the release gate read the hosted runner's CPU as much as the
// code. With perf tests isolated, one commit read raw-grid tbtMs 248 in a preflight and 143 in its
// own push run, and Kinetic Cosmos's idleTaskMs 302 isolated and 616 on rc.2's release run. Each
// load now runs a fixed calibration workload under the lab's CPU throttle just before it
// (calibrationMs), and the CPU-bound metrics are judged at the reference runner's speed: each long
// task scaled by calibration.referenceMs / calibrationMs before TBT's 50 ms cut, and the idle
// window's task time scaled the same way. These hold that: the same work passes on a slow runner
// and a fast one, a real regression fails on either, and a load with no calibration fails closed.

const base = loadThresholds();
const REFERENCE_MS = 400;
const thresholds = {
  ...base,
  timing: {
    ...base.timing,
    calibration: {
      ...(base.timing as { calibration?: object }).calibration,
      referenceMs: REFERENCE_MS,
    },
  },
} as Thresholds;

/** A load of the same page on a runner `slower` times the reference's speed. */
const on = (slower: number, tasks: readonly number[], idleMs: number): PerfRun =>
  ({
    ...GOOD_RUN,
    calibrationMs: REFERENCE_MS * slower,
    blockingTasks: tasks.map((ms) => ms * slower),
    // What the gate read before: TBT and idle work at the runner's own speed.
    tbtMs: tasks.reduce((total, ms) => total + Math.max(0, ms * slower - 50), 0),
    idleTaskMs: idleMs * slower,
  }) as PerfRun;

const five = (run: PerfRun) => [run, run, run, run, run];
const row = (runs: readonly PerfRun[], metric: 'tbtMs' | 'idleTaskMs', tier = 'medium' as const) =>
  timingResult(runs, tier, thresholds).rows.find((each) => each.metric === metric)!;
const over = (runs: readonly PerfRun[], tier = 'medium' as const) =>
  releaseProblems(timingResult(runs, tier, thresholds), thresholds)
    .filter((problem) => problem.rule === 'timing-over')
    .map((problem) => problem.message.split("'")[0]);

test('the same work passes on a slow runner and a fast one: TBT and idle work are read at the reference speed (row 141)', () => {
  // Two long tasks of 150 and 120 ms and 300 ms of idle work, at the reference speed: TBT 170.
  const fast = five(on(1, [150, 120], 300));
  const slow = five(on(2, [150, 120], 300));
  assert.equal(slow[0]!.tbtMs, 440, "the slow runner's raw TBT, over tbtMs's 220 release limit");
  assert.equal(slow[0]!.idleTaskMs, 600, "and its raw idle work, over medium's 550");
  for (const [name, runs] of [
    ['fast', fast],
    ['slow', slow],
  ] as const) {
    assert.equal(row(runs, 'tbtMs').median, 170, `${name}: TBT at the reference speed`);
    assert.equal(row(runs, 'idleTaskMs').median, 300, `${name}: idle work at the reference speed`);
    assert.deepEqual(over(runs), [], `${name}: nothing over its release limit`);
  }
  // The scaling comes before the 50 ms cut: a 90 ms task on a runner twice as slow is 40 ms of
  // blocking at the reference speed, not 130 / 2 = 65.
  assert.equal(row(five(on(2, [90], 0)), 'tbtMs').median, 40);
});

test('a real regression fails on either runner, and the raw readings stay in the row (row 141)', () => {
  // Three long tasks of 160 ms each at the reference speed: TBT 330, over 220 on any runner.
  for (const slower of [0.6, 1, 2]) {
    const runs = five(on(slower, [160, 160, 160], 300));
    assert.equal(row(runs, 'tbtMs').median, 330, `${slower}x: TBT at the reference speed`);
    assert.deepEqual(over(runs), ['tbtMs'], `${slower}x: tbtMs over its release limit`);
    const tbt = row(runs, 'tbtMs') as { rawValues?: readonly (number | null)[] };
    assert.deepEqual(
      tbt.rawValues,
      runs.map((run) => run.tbtMs),
      'the raw TBT, as measured',
    );
  }
  // The runner's speed is reported beside the rows: each load's calibration and their median.
  const result = timingResult(five(on(2, [150], 300)), 'medium', thresholds) as {
    runner?: {
      calibrationMs: readonly (number | null)[];
      factor: number | null;
      referenceMs: number;
    };
  };
  assert.deepEqual(result.runner, {
    calibrationMs: [800, 800, 800, 800, 800],
    factor: 2,
    referenceMs: REFERENCE_MS,
  });
});

test("a load with no calibration fails closed: TBT and idle work don't come, and the rest are read as before (row 141)", () => {
  const runs = five(on(1, [150, 120], 300));
  const uncalibrated = [...runs.slice(1), { ...runs[0]!, calibrationMs: null } as PerfRun];
  assert.deepEqual(row(uncalibrated, 'tbtMs').values.at(-1), null);
  assert.deepEqual(row(uncalibrated, 'idleTaskMs').values.at(-1), null);
  assert.equal(row(uncalibrated, 'tbtMs').median, 170, 'the median of the four that came');
  const problems = releaseProblems(timingResult(uncalibrated, 'medium', thresholds), thresholds);
  assert.deepEqual(
    problems.map((problem) => `${problem.rule} ${problem.message.split(' ')[0]}`),
    ['timing-missing tbtMs', 'timing-missing idleTaskMs'],
  );
  // LCP, CLS and memory aren't scaled: no calibration leaves them as measured.
  const lcp = timingResult(uncalibrated, 'medium', thresholds).rows.find(
    (r) => r.metric === 'lcpMs',
  )!;
  assert.deepEqual(
    lcp.values,
    uncalibrated.map((run) => run.lcpMs),
  );
});

test('with no reference measured yet, every metric is read as measured, and the runner is still reported (row 141)', () => {
  const unmeasured = {
    ...thresholds,
    timing: {
      ...thresholds.timing,
      calibration: { ...thresholds.timing.calibration, referenceMs: null },
    },
  } as Thresholds;
  // A fractional reading, as a real load's idle work is: read as measured, it's left as it came.
  const runs = five({ ...on(2, [150, 120], 300), idleTaskMs: 371.6519999999999 } as PerfRun);
  const result = timingResult(runs, 'medium', unmeasured);
  const idle = result.rows.find((each) => each.metric === 'idleTaskMs')!;
  assert.deepEqual(idle.values, idle.rawValues, 'idle work as measured, unrounded');
  assert.equal(idle.values[0], 371.6519999999999);
  const tbt = result.rows.find((each) => each.metric === 'tbtMs')!;
  assert.equal(tbt.calibrated, false);
  assert.equal(tbt.median, 440, 'TBT as this runner measured it');
  assert.deepEqual(tbt.values, tbt.rawValues);
  assert.deepEqual(result.runner, {
    calibrationMs: [800, 800, 800, 800, 800],
    factor: null,
    referenceMs: null,
  });
  // The repository's own file: no reference until a CI run has measured one, and it says which.
  const { referenceMs, measuredBy } = base.timing.calibration;
  assert.equal(
    referenceMs === null,
    measuredBy === '',
    'a reference names the run that measured it',
  );
});
