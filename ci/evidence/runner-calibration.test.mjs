import assert from 'node:assert/strict';
import test from 'node:test';
import { atReference, compare, markdown, median, oneJob, spread } from './runner-calibration.mjs';

// The calibration evidence's report: what it reads from a job's summary.json, and that a target the
// runners read apart only by their speed reads the same at the reference's speed.

/** A summary.json holding one perf test whose loads ran on a runner `slower` times the base. */
const summaryOn = (slower, target = 'composition:raw-grid') => ({
  tests: [
    { title: 'not a perf test', outcome: 'expected' },
    {
      title: `${target} …`,
      outcome: 'expected',
      perf: {
        target,
        sample: {
          runs: Array.from({ length: 5 }, () => ({
            calibrationMs: 400 * slower,
            tbtMs: 150 * slower - 50 + (120 * slower - 50),
            idleTaskMs: 300 * slower,
            blockingTasks: [150 * slower, 120 * slower],
          })),
        },
      },
    },
  ],
});

test('a job reads every perf test of its summary.json, and nothing else', () => {
  const job = oneJob(summaryOn(1), 'a');
  assert.equal(job.job, 'a');
  assert.equal(job.targets.length, 1);
  assert.equal(job.targets[0].target, 'composition:raw-grid');
  assert.equal(job.targets[0].loads.length, 5);
  assert.deepEqual(oneJob({ tests: [] }, 'b').targets, []);
});

test('at the reference speed, each long task is scaled before the 50 ms cut, as the gate reads it', () => {
  assert.deepEqual(atReference({ calibrationMs: 800, blockingTasks: [90], idleTaskMs: 600 }, 400), {
    tbtMs: 0,
    idleTaskMs: 300,
  });
  assert.deepEqual(atReference({ calibrationMs: 800, blockingTasks: [300], idleTaskMs: 0 }, 400), {
    tbtMs: 100,
    idleTaskMs: 0,
  });
  assert.deepEqual(atReference({ calibrationMs: null, blockingTasks: [300], idleTaskMs: 1 }, 400), {
    tbtMs: null,
    idleTaskMs: null,
  });
});

test('runners that differ only in speed read apart raw and together at the reference speed', () => {
  const result = compare([
    oneJob(summaryOn(1), 'a'),
    oneJob(summaryOn(2), 'b'),
    oneJob(summaryOn(1.5), 'c'),
  ]);
  assert.equal(result.referenceMs, 600, 'the median calibration over every load');
  assert.deepEqual(
    result.runners.map((runner) => runner.calibrationMs),
    [400, 800, 600],
  );
  const [target] = result.targets;
  assert.ok(target.tbtSpread.raw > 2, `raw TBT spreads ${target.tbtSpread.raw}`);
  assert.equal(target.tbtSpread.ref, 1, 'and at the reference speed it reads the same');
  assert.equal(target.idleSpread.raw, 2);
  assert.equal(target.idleSpread.ref, 1);
  assert.match(
    markdown(result),
    /Reference \(the median calibration over every load of every job\): \*\*600 ms\*\*/,
  );
  assert.match(markdown(result), /\| composition:raw-grid \| [\d.]+ \| 1 \| 2 \| 1 \|/);
});

test('the median and the spread', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([null, Number.NaN]), null);
  assert.equal(spread([100, 200]), 2);
  assert.equal(spread([100]), null);
});
