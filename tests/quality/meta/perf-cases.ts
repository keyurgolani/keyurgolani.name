// The performance gates' cases for `pnpm quality:meta` (#11, 11-3): a
// known-bad and a known-good input for each, appended to META_CASES
// (cases.ts), each through the gate's own code:
//
// - perf: the deterministic rules every run holds a perf cell to
//   (lib/perf/samples.ts's perfFindings), over recorded samples, and the
//   verdict's perf-coverage rule (lib/verdict.ts). perf-browser-cases.ts
//   adds the cases that run the real probe in Chromium.
// - timing: the release run's timing gate (lib/perf/timing.ts's
//   timingFailures, which TIMING_GATE runs), over recorded summaries whose
//   medians come from timingResult, as perf.spec.ts writes them.
// - budgets: VR1's bundle size. #6's check:budgets core (ci/lib/budgets.mjs's
//   checkBudgets), over fixture-over-budget's real manifest and sources as
//   its build ships them, must report one record of each metric #6's own
//   proof names (ci/budgets.mjs's overBudgetProblems), and over
//   fixture-variant-light's, none. CI's trace job runs the same check on the
//   real build, and gates on it.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../../../quality/thresholds';
import { overBudgetProblems } from '../../../ci/budgets.mjs';
import { checkBudgets, reportRecord } from '../../../ci/lib/budgets.mjs';
import { loadValidator } from '../../../ci/summarize.mjs';
import { gzipBytes } from '../../harness/trace/attribution.mjs';
import { PERF_KIND } from '../lib/checks';
import {
  perfFindings,
  timingResult,
  type LcpEntry,
  type PerfRun,
  type PerfSample,
} from '../lib/perf/samples';
import { timingFailures } from '../lib/perf/timing';
import { perfCoverage } from '../lib/verdict';
import type { Summary, SummaryTest } from '../reporter';
import type { MetaCase, MetaOutcome } from './cases';

// ---- perf: the deterministic rules -----------------------------------------

/** A server-rendered headline covering a tenth of the viewport. */
const HEADLINE: LcpEntry = {
  startTime: 900,
  kind: 'headline',
  tag: 'h1',
  size: 33_000,
  share: 0.1,
  serverRendered: true,
  selector: 'main > h1',
};

/** A load that's fine: a server-rendered heading as its LCP element, well within every ceiling. */
export const GOOD_RUN: PerfRun = {
  status: 200,
  lcp: HEADLINE,
  canvasLed: false,
  lcpMs: 900,
  cls: 0,
  tbtMs: 40,
  idleTaskMs: 12,
  heapMiB: 4,
  growthMiB: 0.1,
  payload: { requests: 14, transferBytes: 180_000, byType: { document: 35_000, script: 140_000 } },
};

export const GOOD_STATIC: PerfSample['static'] = {
  status: 200,
  lcp: HEADLINE,
  canvasLed: false,
  reducedMotion: true,
  frameCallbacks: 0,
  layoutCount: 0,
};

/** Five of `run`: what perf.spec.ts takes at default motion. */
const five = (run: PerfRun = GOOD_RUN): PerfRun[] => [run, run, run, run, run];

const sample = (
  runs: readonly PerfRun[] = five(),
  staticRun: PerfSample['static'] = GOOD_STATIC,
): PerfSample => ({ tier: 'light', static: staticRun, runs });

const findingsOutcome = (input: Pick<PerfSample, 'static' | 'runs'>): MetaOutcome => {
  const findings = perfFindings(input);
  return {
    passed: findings.length === 0,
    findings: findings.map(
      (finding) => `${finding.rule}: ${finding.actual}; expected ${finding.expected}`,
    ),
  };
};

/** Every load canvas-led, with `lcp` as its LCP element. */
const canvasLed = (lcp: LcpEntry | null): PerfSample =>
  sample(five({ ...GOOD_RUN, canvasLed: true, lcp }), { ...GOOD_STATIC, canvasLed: true, lcp });

export const PERF_CASES: readonly MetaCase[] = [
  {
    id: 'perf/good',
    gate: 'perf',
    input:
      'a recorded perf sample: server-rendered headline LCP on every load, and a still static load',
    expect: 'pass',
    run: () => findingsOutcome(sample()),
  },
  {
    id: 'perf/canvas-led-headline',
    gate: 'perf',
    input:
      'a canvas-led sample whose LCP element is a server-rendered h1 covering 10% of the viewport',
    expect: 'pass',
    run: () => findingsOutcome(canvasLed(HEADLINE)),
  },
  {
    id: 'perf/canvas-led-poster',
    gate: 'perf',
    input: 'a canvas-led sample whose LCP element is a server-rendered poster image',
    expect: 'pass',
    run: () => findingsOutcome(canvasLed({ ...HEADLINE, kind: 'image', tag: 'img', share: 0.4 })),
  },
  {
    id: 'perf/missing-lcp-entry',
    gate: 'perf',
    input: 'a sample with one load that ended with no largest-contentful-paint entry',
    expect: 'fail',
    reason: /^lcp-entry: load 3 of 5 ended with none; expected a largest-contentful-paint entry$/,
    run: () =>
      findingsOutcome(sample([GOOD_RUN, GOOD_RUN, { ...GOOD_RUN, lcp: null }, GOOD_RUN, GOOD_RUN])),
  },
  {
    id: 'perf/canvas-only',
    gate: 'perf',
    input:
      'a canvas-led sample whose canvas is all the first viewport paints: no LCP entry on any load',
    expect: 'fail',
    reason:
      /^lcp-entry: (?:the static load|load \d of 5) ended with none; expected a largest-contentful-paint entry: a canvas-led page needs server-rendered text or a poster image/,
    run: () => findingsOutcome(canvasLed(null)),
  },
  {
    id: 'perf/canvas-led-client-headline',
    gate: 'perf',
    input: "a canvas-led sample whose headline the document's response body doesn't hold",
    expect: 'fail',
    reason:
      /^lcp-element: (?:the static load|load \d of 5)'s LCP element is headline <h1>, which the document's response body doesn't hold; expected with a canvas in the first viewport/,
    run: () => findingsOutcome(canvasLed({ ...HEADLINE, serverRendered: false })),
  },
  {
    id: 'perf/canvas-led-small-headline',
    gate: 'perf',
    input: 'a canvas-led sample whose server-rendered h1 covers 1% of the viewport',
    expect: 'fail',
    reason:
      /^lcp-element: (?:the static load|load \d of 5)'s LCP element is headline <h1> covering 1% of the viewport, under 5%; expected/,
    run: () => findingsOutcome(canvasLed({ ...HEADLINE, share: 0.01 })),
  },
  {
    id: 'perf/canvas-led-body-text',
    gate: 'perf',
    input: 'a canvas-led sample whose LCP element is a server-rendered paragraph, not a headline',
    expect: 'fail',
    reason:
      /^lcp-element: (?:the static load|load \d of 5)'s LCP element is text in <p>, not a poster image or headline; expected/,
    run: () => findingsOutcome(canvasLed({ ...HEADLINE, kind: 'text', tag: 'p' })),
  },
  {
    id: 'perf/static-emulation-ignored',
    gate: 'perf',
    input: "a static load whose page didn't match prefers-reduced-motion: reduce",
    expect: 'fail',
    reason: /^static-emulation: it didn't, so its frame and layout counts say nothing/,
    run: () => findingsOutcome(sample(undefined, { ...GOOD_STATIC, reducedMotion: false })),
  },
  {
    id: 'perf/static-frame-loop',
    gate: 'perf',
    input: 'a static load that ran 180 requestAnimationFrame callbacks in the frame window',
    expect: 'fail',
    reason:
      /^frame-callbacks: 180; expected at most 0 requestAnimationFrame callbacks from 1000 ms to 4000 ms after load in static mode$/,
    run: () => findingsOutcome(sample(undefined, { ...GOOD_STATIC, frameCallbacks: 180 })),
  },
  {
    id: 'perf/static-layout',
    gate: 'perf',
    input: 'a static load whose LayoutCount grew by 3 in the frame window',
    expect: 'fail',
    reason:
      /^layout-count: 3 layouts; expected no layout from 1000 ms to 4000 ms after load in static mode$/,
    run: () => findingsOutcome(sample(undefined, { ...GOOD_STATIC, layoutCount: 3 })),
  },
];

// ---- perf: every target's perf cell ran, once ------------------------------

const FALLBACK_PERF = {
  cell: 'composition:fallback complete / fallback/platform-neutral/warm-parchment/humanist-ui/system',
  target: 'composition:fallback',
  tier: 'light',
};
const TARGETS = [{ kind: 'composition' as const, id: 'fallback' }];

const coverageOutcome = (tests: readonly SummaryTest[]): MetaOutcome => {
  const failures = perfCoverage([FALLBACK_PERF], TARGETS, ['chromium'], { tests, shard: null });
  return {
    passed: failures.length === 0,
    findings: failures.map(({ rule, message }) => `${rule}: ${message}`),
  };
};

export const COVERAGE_CASES: readonly MetaCase[] = [
  {
    id: 'perf/coverage-ran',
    gate: 'perf',
    input: "a run whose one target's perf cell ran once on Chromium",
    expect: 'pass',
    run: () => coverageOutcome([perfTest(five())]),
  },
  {
    id: 'perf/coverage-missing',
    gate: 'perf',
    input: "a run that collected no perf test of the fallback composition's perf cell",
    expect: 'fail',
    reason:
      /^perf-coverage: The perf test of composition:fallback complete \/ .* is planned on chromium, and didn't run\.$/,
    run: () => coverageOutcome([]),
  },
];

// ---- timing: the release run's medians -------------------------------------

/** A passing perf test in summary.json, with the timing perf.spec.ts would write for `runs`. */
function perfTest(runs: readonly PerfRun[], overrides: Partial<SummaryTest> = {}): SummaryTest {
  return {
    title: 'fallback complete /, performance at 390x844 (light)',
    file: 'tests/quality/perf.spec.ts',
    line: 30,
    project: 'chromium c946a80325',
    engine: 'chromium',
    kind: PERF_KIND,
    cell: 'composition:fallback complete / fallback/platform-neutral/warm-parchment/humanist-ui/system',
    target: 'composition:fallback',
    route: '/',
    viewport: '390x844',
    outcome: 'expected',
    expectedStatus: 'passed',
    status: 'passed',
    skipReason: null,
    checks: ['status', 'lcp', 'static', 'timing'],
    canaryProbe: false,
    errors: [],
    records: 0,
    perf: { timing: timingResult(runs, 'light') },
    ...overrides,
  };
}

const summaryOf = (tests: readonly SummaryTest[]): Pick<Summary, 'tests'> => ({ tests });

const timingOutcome = (summary: Pick<Summary, 'tests'> | null): MetaOutcome => {
  // A first attempt, whatever this job's own is: timing/rerun names another.
  const failures = timingFailures(summary, undefined, { GITHUB_RUN_ATTEMPT: '1' });
  return {
    passed: failures.length === 0,
    findings: failures.map(({ rule, message }) => `${rule}: ${message}`),
  };
};

const lcp = (ms: number): PerfRun => ({ ...GOOD_RUN, lcpMs: ms });

export const TIMING_CASES: readonly MetaCase[] = [
  {
    id: 'timing/within',
    gate: 'timing',
    input: 'a release summary whose five loads all sit within their light ceilings',
    expect: 'pass',
    run: () => timingOutcome(summaryOf([perfTest(five())])),
  },
  {
    id: 'timing/one-slow-load',
    gate: 'timing',
    input:
      'five loads, one of them a shared-runner stall at twice the LCP ceiling: the median holds',
    expect: 'pass',
    run: () =>
      timingOutcome(summaryOf([perfTest([lcp(1800), lcp(5000), lcp(1900), lcp(2000), lcp(1850)])])),
  },
  {
    id: 'timing/within-tolerance',
    gate: 'timing',
    input: 'an LCP median of 2,650 ms: over the 2,500 ms ceiling, within its 10% release tolerance',
    expect: 'pass',
    run: () =>
      timingOutcome(summaryOf([perfTest([lcp(2600), lcp(2650), lcp(2700), lcp(2640), lcp(2660)])])),
  },
  {
    id: 'timing/over',
    gate: 'timing',
    input: 'an LCP median of 2,800 ms, 12% over the 2,500 ms ceiling',
    expect: 'fail',
    reason:
      /^timing-over: composition:fallback: lcpMs's median 2800 is over 2750, its light ceiling 2500 plus 10%\.$/,
    run: () =>
      timingOutcome(summaryOf([perfTest([lcp(2790), lcp(2800), lcp(2810), lcp(2700), lcp(2900)])])),
  },
  {
    id: 'timing/too-few-loads',
    gate: 'timing',
    input: 'a perf test with three loads, not the five the median takes',
    expect: 'fail',
    reason: /^timing-runs: composition:fallback: 3 load\(s\), not the 5 the median takes/,
    run: () => timingOutcome(summaryOf([perfTest([GOOD_RUN, GOOD_RUN, GOOD_RUN])])),
  },
  {
    id: 'timing/missing-metric',
    gate: 'timing',
    input: 'a perf test one of whose loads read no heap',
    expect: 'fail',
    reason: /^timing-missing: composition:fallback: heapMiB didn't come on 1 of 5 load\(s\)\.$/,
    run: () =>
      timingOutcome(
        summaryOf([
          perfTest([GOOD_RUN, GOOD_RUN, { ...GOOD_RUN, heapMiB: null }, GOOD_RUN, GOOD_RUN]),
        ]),
      ),
  },
  {
    id: 'timing/retried',
    gate: 'timing',
    input: 'a perf test that passed on a retry',
    expect: 'fail',
    reason:
      /^timing-retried: composition:fallback's perf test passed on a retry, and timing is never retried to green/,
    run: () => timingOutcome(summaryOf([perfTest(five(), { outcome: 'flaky' })])),
  },
  {
    id: 'timing/no-perf-test',
    gate: 'timing',
    input: 'a release summary with no perf test in it',
    expect: 'fail',
    reason: /^timing-no-perf: No perf test ran/,
    run: () => timingOutcome(summaryOf([])),
  },
  {
    id: 'timing/no-summary',
    gate: 'timing',
    input: 'a release run that left no summary.json',
    expect: 'fail',
    reason: /^timing-no-summary: /,
    run: () => timingOutcome(null),
  },
  {
    id: 'timing/rerun',
    gate: 'timing',
    input: "a release summary within every ceiling, on the workflow run's second attempt",
    expect: 'fail',
    reason:
      /^timing-rerun: This is attempt 2 of the workflow run, and timing is never retried to green/,
    run: () => {
      const failures = timingFailures(summaryOf([perfTest(five())]), undefined, {
        GITHUB_RUN_ATTEMPT: '2',
      });
      return {
        passed: failures.length === 0,
        findings: failures.map(({ rule, message }) => `${rule}: ${message}`),
      };
    },
  },
];

// ---- budgets: VR1's bundle size, through #6's check ------------------------

const FIXTURES = path.join(REPO_ROOT, 'packages', 'budget-fixtures');
const ORIGIN = 'http://127.0.0.1:4000';
const CEILINGS = (
  JSON.parse(readFileSync(path.join(REPO_ROOT, 'runtime-budgets.json'), 'utf8')) as {
    budgets: unknown;
  }
).budgets;

/** A budget fixture as ASSET_MANIFEST and one trace case would show it: its real manifest, stylesheet, and source bytes. */
function fixtureUnit(dir: string, sources: readonly string[], cssImports: readonly string[] = []) {
  const root = path.join(FIXTURES, dir);
  const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
  const manifest = JSON.parse(read('manifest.json')) as {
    id: string;
    performanceTier: string;
    budgets: Record<string, number>;
  };
  const { name } = JSON.parse(read('package.json')) as { name: string };
  const css = read('src/styles.css');
  // The compiled stylesheet carries its local @imports inline, as the build's does.
  const compiled = [css, ...cssImports.map(read)].join('\n');
  const stylesheet = {
    url: `/_portfolio/variant/${manifest.id}.0123456789ab.css`,
    bytes: Buffer.byteLength(compiled),
    gzipBytes: gzipBytes(compiled),
    sha256: 'recorded',
  };
  const js = sources.map(read).join('\n');
  const unit = {
    kind: 'variant',
    id: manifest.id,
    packageName: name,
    version: '0.1.0',
    fixture: true,
    performanceTier: manifest.performanceTier,
    stylesheet,
    fonts: [],
    images: [],
    stills: [],
    enhancements: [],
    budgets: manifest.budgets,
  };
  const trace = {
    cases: [
      {
        route: '/',
        viewport: '1440x900',
        profile: 'read-only',
        composition: manifest.id,
        origin: ORIGIN,
        requests: [{ url: `${ORIGIN}${stylesheet.url}` }],
        probe: {
          frames: { loops: [], loopCount: 0 },
          timers: { intervals: [], timeouts: [], recurring: 0 },
          animations: { infinite: [] },
        },
        attribution: {
          chunks: [
            {
              kind: 'js',
              url: `${ORIGIN}/_next/static/chunks/${manifest.id}-island.js`,
              packages: [{ package: name, bytes: Buffer.byteLength(js), gzipBytes: gzipBytes(js) }],
            },
          ],
          withoutMap: [],
        },
      },
    ],
  };
  return { unit, trace, css };
}

/** check:budgets' core over one fixture, as its report keeps the records. */
function budgetRecords(fixture: ReturnType<typeof fixtureUnit>) {
  const { records } = checkBudgets({
    units: [fixture.unit],
    platform: null,
    ceilings: CEILINGS,
    trace: fixture.trace,
    chunks: [],
    entries: () => ({}),
    stylesheet: (url: string) => (url === fixture.unit.stylesheet.url ? fixture.css : null),
  });
  return (records as Record<string, unknown>[]).map(
    (record) => reportRecord(record) as { metric: string; test: string },
  );
}

export const BUDGET_CASES: readonly MetaCase[] = [
  {
    id: 'budgets/fixture-variant-light',
    gate: 'budgets',
    input: "check:budgets' core over fixture-variant-light's manifest and sources",
    expect: 'pass',
    run: () => {
      const records = budgetRecords(
        fixtureUnit('fixture-variant-light', ['src/index.tsx', 'src/spotlight.tsx']),
      );
      return {
        passed: records.length === 0,
        findings: records.map((record) => `${record.metric}: ${record.test}`),
      };
    },
  },
  {
    id: 'budgets/fixture-over-budget',
    gate: 'budgets',
    input: "check:budgets' core over fixture-over-budget's manifest, ballast, and remote @import",
    expect: 'fail',
    // One record each, as #6's proof requires: its JS, its CSS, and its
    // remote @import. A missing or extra one is a proof finding, off reason.
    reason:
      /^(?:js: variant fixture-over-budget's js on \/ is \d+, over its declared budget of 30720;|css: variant fixture-over-budget's css is \d+, over its declared budget of 10240;|remote: variant fixture-over-budget's stylesheet reaches another host, .*https:\/\/fonts\.example\.invalid\/)/,
    run: async () => {
      const records = budgetRecords(
        fixtureUnit(
          'fixture-over-budget',
          ['src/index.tsx', 'src/ballast-island.tsx', 'src/ballast.ts'],
          ['src/ballast.css'],
        ),
      );
      const proof = overBudgetProblems({ records }, await loadValidator());
      return {
        passed: records.length === 0,
        findings: [
          ...records.map((record) => `${record.metric}: ${record.test}`),
          ...proof.map((problem: string) => `proof: ${problem}`),
        ],
      };
    },
  },
];

/** Every performance case. */
export const PERFORMANCE_CASES: readonly MetaCase[] = [
  ...PERF_CASES,
  ...COVERAGE_CASES,
  ...TIMING_CASES,
  ...BUDGET_CASES,
];
