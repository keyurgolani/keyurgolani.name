import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadThresholds } from '../../../../quality/thresholds';
import { planCells, readBuildMeta } from '../../cells';
import { loadRegistrations } from '../registration';
import { KIND_CHECKS } from '../checks';
import { GOOD_RUN } from '../../meta/perf-cases';
import type { SummaryTest } from '../../reporter';
import { budgetResults, BUDGETS_GATED_BY } from './budgets';
import { cumulativeShift, LAB_VIEWPORT, PERF_PROBE, totalBlockingTime } from './measure';
import { PERF_KIND, perfCells, perfCoverage } from './plan';
import {
  ceilingFor,
  median,
  perfFindings,
  releaseProblems,
  TIMING_METRICS,
  timingResult,
  type PerfRun,
  type PerfSample,
} from './samples';
import { TIMING_GATE, timingFailures, timingMarkdown, timingTrend } from './timing';

// The performance gates (#11, 11-3). quality:meta's perf, timing, and
// budgets cases hold each gate to a known-bad and a known-good input; these
// hold the pieces under them.

const thresholds = loadThresholds();
const WEB = fileURLToPath(new URL('../../../../apps/web/', import.meta.url));

const STILL: PerfSample['static'] = {
  status: 200,
  lcp: GOOD_RUN.lcp,
  canvasLed: false,
  frameCallbacks: 0,
  layoutCount: 0,
};
const five = (run: PerfRun = GOOD_RUN) => [run, run, run, run, run];

test('every ceiling comes from quality/thresholds.json, by tier where it has one', () => {
  for (const tier of ['light', 'medium', 'heavy'] as const) {
    assert.equal(ceilingFor('lcpMs', tier), thresholds.vitals.lcpMs);
    assert.equal(ceilingFor('cls', tier), thresholds.vitals.cls);
    assert.equal(ceilingFor('tbtMs', tier), thresholds.vitals.tbtMs);
    assert.equal(ceilingFor('idleTaskMs', tier), thresholds.idle.taskDurationMs[tier]);
    assert.equal(ceilingFor('heapMiB', tier), thresholds.memory.heapMiB[tier]);
    assert.equal(ceilingFor('growthMiB', tier), thresholds.memory.growthMiB);
  }
  const lowered = { ...thresholds, vitals: { ...thresholds.vitals, lcpMs: 1000 } };
  assert.equal(ceilingFor('lcpMs', 'light', lowered), 1000);
});

test('the median is the middle load, or the mean of the middle two, whatever the order', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([7]), 7);
  assert.throws(() => median([]), /no values/);
});

test('a timing result takes each metric over every load, and one stalled load leaves the median alone', () => {
  const stalled = timingResult(
    [GOOD_RUN, { ...GOOD_RUN, lcpMs: 9000, tbtMs: 3000 }, GOOD_RUN, GOOD_RUN, GOOD_RUN],
    'light',
  );
  assert.deepEqual(
    stalled.rows.map((row) => row.metric),
    [...TIMING_METRICS],
  );
  const lcp = stalled.rows.find((row) => row.metric === 'lcpMs')!;
  assert.equal(lcp.median, 900);
  assert.equal(lcp.overCeiling, false);
  assert.equal(lcp.releaseLimit, 2750);
  assert.ok(lcp.spread! > 1, 'the spread shows the stall');
  assert.deepEqual(releaseProblems(stalled), []);

  const over = timingResult(five({ ...GOOD_RUN, idleTaskMs: 54 }), 'light');
  const idle = over.rows.find((row) => row.metric === 'idleTaskMs')!;
  assert.equal(idle.overCeiling, true, '54 ms is over the light 50 ms');
  assert.equal(idle.overRelease, false, 'and within 10% of it');
  // The same work is well within medium's 500 ms.
  assert.equal(
    timingResult(five({ ...GOOD_RUN, idleTaskMs: 54 }), 'medium').rows.find(
      (row) => row.metric === 'idleTaskMs',
    )!.overCeiling,
    false,
  );
});

test('the deterministic rules: an LCP entry on every load, a canvas-led LCP element, and a still static load', () => {
  assert.deepEqual(perfFindings({ static: STILL, runs: five() }), []);
  const rules = (sample: Pick<PerfSample, 'static' | 'runs'>) =>
    perfFindings(sample).map((finding) => `${finding.rule} ${finding.preferenceMode}`);
  assert.deepEqual(rules({ static: { ...STILL, lcp: null }, runs: five() }), [
    'lcp-entry reduced-motion',
  ]);
  assert.deepEqual(
    rules({ static: STILL, runs: [...five().slice(1), { ...GOOD_RUN, lcp: null }] }),
    ['lcp-entry default'],
  );
  // An LCP element that left the document, on a page without a canvas, is still an entry.
  const removed: PerfRun = { ...GOOD_RUN, lcp: { ...GOOD_RUN.lcp!, kind: 'removed' } };
  assert.deepEqual(rules({ static: STILL, runs: five(removed) }), []);
  assert.deepEqual(rules({ static: STILL, runs: five({ ...removed, canvasLed: true }) }), [
    'lcp-element default',
  ]);
  assert.deepEqual(
    rules({ static: { ...STILL, frameCallbacks: 1, layoutCount: 2 }, runs: five() }),
    ['frame-callbacks reduced-motion', 'layout-count reduced-motion'],
  );
  // The window and the limit are the thresholds file's.
  const looser = {
    ...thresholds,
    reducedMotion: { ...thresholds.reducedMotion, rafCallbacks: 5 },
  };
  assert.deepEqual(
    perfFindings({ static: { ...STILL, frameCallbacks: 5 }, runs: five() }, looser),
    [],
  );
});

test('CLS is the largest session window, and TBT counts only the time past 50 ms from FCP to the window end', () => {
  assert.equal(
    cumulativeShift([
      { value: 0.05, startTime: 100, hadRecentInput: false },
      { value: 0.05, startTime: 600, hadRecentInput: false },
      { value: 0.5, startTime: 700, hadRecentInput: true },
      { value: 0.08, startTime: 3000, hadRecentInput: false },
    ]),
    0.1,
  );
  assert.equal(cumulativeShift([]), 0);
  assert.equal(
    totalBlockingTime(
      [
        { startTime: 0, duration: 200 }, // FCP at 100 splits it: 100 counted, 50 blocking.
        { startTime: 300, duration: 120 }, // 70 blocking.
        { startTime: 400, duration: 40 }, // Not long enough.
        { startTime: 6000, duration: 300 }, // Past the window.
      ],
      100,
      5000,
    ),
    120,
  );
});

test('the probe is one self-contained script, and the lab viewport is the phone the refined body names', () => {
  assert.equal(LAB_VIEWPORT, '390x844');
  assert.doesNotThrow(() => new Function(PERF_PROBE));
  for (const type of ['largest-contentful-paint', 'layout-shift', 'longtask', 'paint']) {
    assert.ok(PERF_PROBE.includes(`'${type}'`), type);
  }
});

test('a perf test owes its four checks, and the verdict holds a passed one to them', () => {
  assert.deepEqual(KIND_CHECKS[PERF_KIND], ['status', 'lcp', 'static', 'timing']);
});

test('each registered target gets one representative perf cell, on its first route and default appearance', async () => {
  const plan = planCells({
    meta: readBuildMeta(WEB),
    registrations: await loadRegistrations(),
    mode: 'pr',
  });
  const cells = perfCells(plan);
  assert.deepEqual(
    cells.map((cell) => `${cell.kind}:${cell.target}`),
    plan.targets.map((target) => `${target.kind}:${target.id}`),
  );
  for (const cell of cells) {
    assert.equal(cell.path, cell.route, `${cell.id} carries no state query`);
    assert.ok(['light', 'medium', 'heavy'].includes(cell.performanceTier));
  }
  const fallback = cells.find((cell) => cell.target === 'fallback')!;
  assert.equal(fallback.path, '/');
  assert.equal(fallback.state, 'complete');
  assert.equal(fallback.tuple.displayMode, 'system');
  // The full plan picks the same ones.
  const full = perfCells(
    planCells({ meta: readBuildMeta(WEB), registrations: await loadRegistrations(), mode: 'full' }),
  );
  assert.deepEqual(
    full.map((cell) => cell.id),
    cells.map((cell) => cell.id),
  );
});

const perfSummaryTest = (cell: string, overrides: Partial<SummaryTest> = {}): SummaryTest => ({
  title: `${cell} perf`,
  file: 'tests/quality/perf.spec.ts',
  line: 1,
  project: 'chromium x',
  engine: 'chromium',
  kind: PERF_KIND,
  cell,
  target: 'composition:fallback',
  outcome: 'expected',
  expectedStatus: 'passed',
  status: 'passed',
  skipReason: null,
  checks: ['status', 'lcp', 'static', 'timing'],
  canaryProbe: false,
  errors: [],
  records: 0,
  perf: { timing: timingResult(five(), 'light') },
  ...overrides,
});

test('perf coverage fails a perf cell that ran twice or not at all, one the plan has no such cell for, and a target with none', async () => {
  const plan = planCells({
    meta: readBuildMeta(WEB),
    registrations: await loadRegistrations(),
    mode: 'pr',
  });
  const ids = perfCells(plan).map((cell) => cell.id);
  const all = ids.map((id) => perfSummaryTest(id));
  assert.deepEqual(perfCoverage(plan, ['chromium'], { tests: all, shard: null }), []);
  const rules = (tests: SummaryTest[], shard: string | null = null) =>
    perfCoverage(plan, ['chromium'], { tests, shard }).map(({ message }) => message);
  assert.match(rules(all.slice(1))[0]!, /is planned on chromium, and didn't run\.$/);
  assert.deepEqual(rules(all.slice(1), '1/2'), [], 'a shard answers only for repeats');
  assert.match(rules([...all, all[0]!])[0]!, /ran 2 times on chromium, not once\.$/);
  assert.match(
    rules([...all, perfSummaryTest('composition:nothing')])[0]!,
    /no perf cell is composition:nothing\.$/,
  );
  // A target whose cells hold no representative one: only work routes, say.
  const noRoot = {
    targets: plan.targets,
    cells: plan.cells.filter((cell) => !(cell.target === 'fallback' && cell.path === '/')),
  };
  assert.ok(
    perfCoverage(noRoot, ['chromium'], { tests: all, shard: null }).some(({ message }) =>
      /^composition:fallback has no representative cell/.test(message),
    ),
  );
});

test('the timing trend reports each median over its ceiling, and never fails a pull request', () => {
  const over = perfSummaryTest('a', {
    perf: { timing: timingResult(five({ ...GOOD_RUN, tbtMs: 260 }), 'light') },
  });
  const trend = timingTrend({ tests: [over] });
  assert.equal(trend.gating, 'report-only');
  assert.deepEqual(trend.overCeiling, [
    'composition:fallback: tbtMs median 260, over its light ceiling 200',
  ]);
  const markdown = timingMarkdown(trend);
  assert.match(markdown, /report only: a release run gates it/);
  assert.match(markdown, /\| composition:fallback \| light \| tbtMs \| 260 \| 200 \| 0 \| over \|/);
  assert.match(timingMarkdown(timingTrend({ tests: [] })), /No perf test ran\./);
  // The release gate fails that one: 260 is 30% over.
  assert.deepEqual(
    timingFailures({ tests: [over] }).map(({ rule }) => rule),
    ['timing-over'],
  );
});

test('TIMING_GATE reads quality/summary.json under the reports it is given, and fails closed without one', () => {
  const reports = mkdtempSync(path.join(tmpdir(), 'quality-timing-'));
  try {
    assert.equal(TIMING_GATE.id, 'timing');
    assert.deepEqual(
      TIMING_GATE.run({ reports }).map(({ rule }) => rule),
      ['timing-no-summary'],
    );
    mkdirSync(path.join(reports, 'quality'));
    writeFileSync(
      path.join(reports, 'quality', 'summary.json'),
      JSON.stringify({ tests: [perfSummaryTest('a')] }),
    );
    assert.deepEqual(TIMING_GATE.run({ reports }), []);
  } finally {
    rmSync(reports, { recursive: true, force: true });
  }
});

test("summary.json's budget block copies check:budgets' report when the job has one, and says so when it hasn't", () => {
  const reports = mkdtempSync(path.join(tmpdir(), 'quality-budgets-'));
  try {
    assert.deepEqual(budgetResults(reports), {
      status: 'not in this job',
      gatedBy: BUDGETS_GATED_BY,
    });
    mkdirSync(path.join(reports, 'budgets'));
    const file = path.join(reports, 'budgets', 'budget-report.json');
    writeFileSync(file, '{');
    assert.equal(budgetResults(reports).status, 'unreadable');
    writeFileSync(
      file,
      JSON.stringify({
        tool: 'pnpm check:budgets',
        generatedAt: '2026-10-23T00:00:00.000Z',
        units: [{}, {}],
        checked: [{}, {}, {}],
        records: [
          {
            unit: { kind: 'variant', id: 'fixture-over-budget' },
            metric: 'js',
            route: '/',
            viewport: '1440x900',
            actual: 42464,
            threshold: 30720,
            test: 'over',
          },
        ],
      }),
    );
    const results = budgetResults(reports);
    assert.equal(results.status, 'over');
    assert.ok(results.status === 'over');
    assert.equal(results.units, 2);
    assert.equal(results.checked, 3);
    assert.deepEqual(results.breaches, [
      {
        unit: 'variant fixture-over-budget',
        metric: 'js',
        route: '/',
        viewport: '1440x900',
        actual: 42464,
        threshold: 30720,
        test: 'over',
      },
    ]);
    writeFileSync(file, JSON.stringify({ units: [{}], checked: [{}], records: [] }));
    assert.equal(budgetResults(reports).status, 'within');
  } finally {
    rmSync(reports, { recursive: true, force: true });
  }
});
