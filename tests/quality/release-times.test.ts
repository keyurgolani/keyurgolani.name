import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CELL_SPEC, testKey } from './lib/pr-shards';
import { loadTimes, measuredRelease } from './lib/release-fit';
import {
  durationSeconds,
  jobOverhead,
  logTests,
  p90,
  resultLine,
  runTimes,
  type ApiJob,
} from './lib/release-times';
import { runReleaseTimes } from './release-times';

// MADE UP, not a CI run: a jobs API response's shape and Playwright's line format, with invented
// times, so the adapter's reading is pinned before the first real run exists.
const at = (minute: number, second = 0) =>
  `2026-11-07T15:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}Z`;
const step = (name: string, from: [number, number], to: [number, number]) => ({
  name,
  started_at: at(...from),
  completed_at: at(...to),
});
function job(name: string, install: number, conclusion = 'success'): ApiJob {
  return {
    id: 1,
    name,
    conclusion,
    steps: [
      step('Set up job', [0, 0], [0, 5]),
      step('Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', [0, 5], [0, 15]),
      step('Install', [0, 15], [1, install]),
      step('pnpm store cache hit', [1, install], [1, install]),
      step('pnpm ci:build', [2, 0], [5, 0]),
      step("List the job's tests", [5, 0], [5, 30]),
      step("pnpm ci:quality-full --grep=<the job's grep> --retries=0", [5, 30], [50, 0]),
      step("Upload the job's tests", [50, 0], [50, 20]),
    ],
  };
}
const CELL =
  'composition:spatial-bento complete / spatial-bento/platform-neutral/warm-parchment/humanist-ui/dark';
const line = (n: number, project: string, file: string, title: string, time: string) =>
  `  ✓  ${n} [${project}] › ${file}:43:7 › ${title} (${time})`;
const LOG_A = [
  '2026-11-07T15:05:31.1234567Z Running 3 tests using 2 workers',
  `2026-11-07T15:05:40.0000000Z ${line(1, 'chromium 490d6d4f3e', CELL_SPEC, `${CELL} › 390x844 reduced-transparency › spatial-bento complete / at 390x844, reduced-transparency`, '12.3s')}`,
  line(
    2,
    'chromium 490d6d4f3e',
    CELL_SPEC,
    `${CELL} › 1440x900 default › spatial-bento complete / at 1440x900, default`,
    '1.5m',
  ),
  line(3, 'chromium harness', 'harness/menu.spec.ts', 'the menu opens', '850ms'),
  '  -  4 [chromium harness] › harness/menu.spec.ts:9:3 › a skipped test',
  '  3 passed (2.1m)',
].join('\n');
const LOG_B = line(
  1,
  'chromium 490d6d4f3e',
  CELL_SPEC,
  `${CELL} › 390x844 default › spatial-bento complete / at 390x844, default`,
  '20s',
);

test("Playwright's durations read as seconds, and anything else as none", () => {
  assert.equal(durationSeconds('850ms'), 0.85);
  assert.equal(durationSeconds('12.3s'), 12.3);
  assert.equal(durationSeconds('1.5m'), 90);
  assert.equal(durationSeconds('1m 3s'), null);
  assert.equal(durationSeconds('12.3'), null);
});

test("a result line gives its project, file, seconds, and a cell test's key; other lines are skipped; one that starts like a result and doesn't parse fails", () => {
  const tests = logTests(LOG_A, 'sb-1');
  assert.deepEqual(tests, [
    {
      project: 'chromium 490d6d4f3e',
      file: CELL_SPEC,
      key: testKey(CELL, '390x844', 'reduced-transparency', 'chromium'),
      seconds: 12.3,
    },
    {
      project: 'chromium 490d6d4f3e',
      file: CELL_SPEC,
      key: testKey(CELL, '1440x900', 'default', 'chromium'),
      seconds: 90,
    },
    { project: 'chromium harness', file: 'harness/menu.spec.ts', seconds: 0.85 },
  ]);
  assert.equal(resultLine('  3 passed (2.1m)', 'x'), null);
  // Plants: a result line with no time, one with a time Playwright never prints, a cell test with no row.
  assert.throws(
    () =>
      resultLine(
        `  ✓  5 [chromium s1] › ${CELL_SPEC}:43:7 › ${CELL} › 390x844 default › t`,
        'sb-1:9',
      ),
    /^Error: sb-1:9: a result line that doesn't parse/,
  );
  assert.throws(
    () =>
      resultLine(
        line(6, 'chromium s1', CELL_SPEC, `${CELL} › 390x844 default › t`, '1m 3s'),
        'sb-1:10',
      ),
    /a result line that doesn't parse/,
  );
  assert.throws(
    () => resultLine(line(7, 'chromium s1', CELL_SPEC, `${CELL} › 390x844 › t`, '3s'), 'sb-1:11'),
    /a cell test whose title isn't/,
  );
});

test("a job's fixed part sums its install, build, list, checkout, and upload steps, and a job missing a named step fails", () => {
  const { seconds, steps } = jobOverhead(job('rc1-evidence sb-1 (x)', 40));
  assert.deepEqual(
    steps.map((each) => each.name),
    [
      'Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
      'Install',
      'pnpm ci:build',
      "List the job's tests",
      "Upload the job's tests",
    ],
  );
  assert.equal(seconds, 10 + 85 + 180 + 30 + 20);
  // Plants: no build step, and a step with no completed_at.
  const noBuild = job('rc1-evidence sb-2 (x)', 40);
  assert.throws(
    () =>
      jobOverhead({
        ...noBuild,
        steps: noBuild.steps!.filter((each) => each.name !== 'pnpm ci:build'),
      }),
    /^Error: rc1-evidence sb-2 \(x\): 0 steps named "pnpm ci:build", not 1\.$/,
  );
  const open = job('rc1-evidence sb-3 (x)', 40);
  assert.throws(
    () =>
      jobOverhead({
        ...open,
        steps: open.steps!.map((each) =>
          each.name === 'Install' ? { ...each, completed_at: null } : each,
        ),
      }),
    /step "Install" has no readable started_at and completed_at/,
  );
});

test('the p90 is nearest rank', () => {
  assert.equal(p90([5]), 5);
  assert.equal(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 9);
  assert.equal(p90([10, 1, 3]), 10);
  assert.throws(() => p90([]), /No job/);
});

test("a run's times: overheadSeconds the p90 of the jobs' fixed parts, every job's tests once, and a job that didn't succeed, a missing log, or a test in two jobs fails unless it's left out by name", () => {
  const jobs = [
    job('rc1-evidence sb-1 (x)', 40),
    job('rc1-evidence sb-2 (x)', 50),
    job('variants', 0),
  ];
  const logs = new Map([
    ['rc1-evidence sb-1 (x)', LOG_A],
    ['rc1-evidence sb-2 (x)', LOG_B],
  ]);
  const { times, jobs: read } = runTimes({
    runs: [{ from: 'jobs-1.json', jobs }],
    logs,
    prefix: 'rc1-evidence',
  });
  assert.deepEqual(
    read.map((each) => [each.name, each.overhead, each.tests]),
    [
      ['rc1-evidence sb-1 (x)', 325, 3],
      ['rc1-evidence sb-2 (x)', 335, 1],
    ],
  );
  assert.equal(times.overheadSeconds, 335);
  assert.equal(times.tests.length, 4);
  assert.match(
    times.source,
    /^jobs-1\.json: 2 "rc1-evidence" jobs read; overheadSeconds is the p90/,
  );
  // Plants.
  const capped = [...jobs.slice(0, 1), job('rc1-evidence sb-2 (x)', 50, 'timed_out')];
  assert.throws(
    () => runTimes({ runs: [{ from: 'j', jobs: capped }], logs, prefix: 'rc1-evidence' }),
    /didn't succeed, so hold a part of their tests: rc1-evidence sb-2 \(x\) \(timed_out\)/,
  );
  const left = runTimes({
    runs: [{ from: 'j', jobs: capped }],
    logs: new Map([['rc1-evidence sb-1 (x)', LOG_A]]),
    prefix: 'rc1-evidence',
    exclude: new Map([['rc1-evidence sb-2 (x)', 'capped at 120; re-run in halves']]),
  });
  assert.match(
    left.times.source,
    /left out rc1-evidence sb-2 \(x\) \(capped at 120; re-run in halves\)/,
  );
  assert.throws(
    () =>
      runTimes({
        runs: [{ from: 'j', jobs }],
        logs: new Map([['rc1-evidence sb-1 (x)', LOG_A]]),
        prefix: 'rc1-evidence',
      }),
    /No log for rc1-evidence sb-2 \(x\)/,
  );
  assert.throws(
    () =>
      runTimes({
        runs: [{ from: 'j', jobs }],
        logs: new Map([
          ['rc1-evidence sb-1 (x)', LOG_A],
          ['rc1-evidence sb-2 (x)', LOG_A],
        ]),
        prefix: 'rc1-evidence',
      }),
    /is in rc1-evidence sb-1 \(x\) and rc1-evidence sb-2 \(x\)/,
  );
  assert.throws(
    () =>
      runTimes({
        runs: [{ from: 'j', jobs }],
        logs: new Map([...logs, ['rc1-evidence sb-9', '']]),
        prefix: 'rc1-evidence',
      }),
    /A log for a job not in the runs: rc1-evidence sb-9/,
  );
});

test('the script writes a times file release-fit reads, and fails on a log it can’t read', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'release-times-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const logs = path.join(dir, 'logs');
  mkdirSync(logs);
  writeFileSync(
    path.join(dir, 'jobs.json'),
    JSON.stringify({
      total_count: 2,
      jobs: [job('rc1-evidence sb-1 (x)', 40), job('rc1-evidence sb-2 (x)', 50)],
    }),
  );
  writeFileSync(path.join(logs, 'rc1-evidence sb-1 (x).txt'), LOG_A);
  writeFileSync(path.join(logs, 'rc1-evidence sb-2 (x).txt'), LOG_B);
  const out = path.join(dir, 'times.json');
  const lines: string[] = [];
  const failures: string[] = [];
  const args = ['--jobs', path.join(dir, 'jobs.json'), '--logs', logs, '--out', out];
  assert.equal(
    runReleaseTimes(
      args,
      (each) => lines.push(each),
      (each) => failures.push(each),
    ),
    0,
    failures.join('\n'),
  );
  assert.equal(
    lines.at(-2),
    '[release-times] 4 timed tests over 2 jobs; overheadSeconds 335 (p90)',
  );
  const times = loadTimes(out);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), times);
  const release = measuredRelease(times);
  assert.equal(release.count, 1);
  // One cell group of 122.3 s and the harness spec beside it on the other worker.
  assert.ok(Math.abs(release.slowest - (335 + 12.3 + 90 + 20)) < 1e-9, String(release.slowest));
  writeFileSync(
    path.join(logs, 'rc1-evidence sb-2 (x).txt'),
    `${LOG_B}\n  ✘  2 [chromium s1] › cells.spec.ts:1:1 › broken`,
  );
  assert.equal(
    runReleaseTimes(
      args,
      () => {},
      (each) => failures.push(each),
    ),
    1,
  );
  assert.match(failures.at(-1)!, /rc1-evidence sb-2 \(x\):2: a result line that doesn't parse/);
});
