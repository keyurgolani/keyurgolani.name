// The timing medians (#11, 11-3): the lab vitals, idle work, and memory
// each perf test measured over timing.runs loads (samples.ts).
//
// - timingTrend(), on every run: each perf test's medians against its
//   tier's ceilings, which run.ts writes into summary.json and prints, and
//   under GitHub Actions adds to the job summary. A median over its ceiling
//   is reported there and never fails a pull request or scheduled run.
// - TIMING_GATE, on the release run: fails a median more than
//   timing.releaseTolerance over its ceiling, a test with fewer loads than
//   timing.runs or a metric that didn't come, and a perf test that ran more
//   than once, since a retried test's numbers aren't its first run's. It
//   fails closed on a run with no summary or no perf test. It has the shape
//   of 11-4's ReleaseGate, for its RELEASE_GATES seam.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadThresholds, type Thresholds } from '../../../../quality/thresholds';
import type { Summary, SummaryTest } from '../../reporter';
import type { Failure } from '../verdict';
import { PERF_KIND } from './plan';
import { releaseProblems, type TimingResult } from './samples';

/** One perf test's timing, as summary.json's timing block lists it. */
export interface TrendEntry {
  readonly title: string;
  readonly cell: string | null;
  readonly target: string | null;
  readonly outcome: string;
  readonly timing: TimingResult | null;
}

export interface TimingTrend {
  /** What the block is for: a pull request or scheduled run reports it, and only a release run gates it. */
  readonly gating: 'report-only' | 'release';
  readonly tests: readonly TrendEntry[];
  /** Each median over its ceiling, one line each. */
  readonly overCeiling: readonly string[];
}

const perfTests = (summary: Pick<Summary, 'tests'>) =>
  summary.tests.filter((test) => test.kind === PERF_KIND);

const timingOf = (test: SummaryTest): TimingResult | null => {
  const perf = test.perf as { timing?: TimingResult } | undefined;
  return perf?.timing ?? null;
};

/** Each perf test's medians, and every one over its ceiling. */
export function timingTrend(
  summary: Pick<Summary, 'tests'>,
  gating: TimingTrend['gating'] = 'report-only',
): TimingTrend {
  const tests = perfTests(summary).map((test): TrendEntry => ({
    title: test.title,
    cell: test.cell ?? null,
    target: test.target ?? null,
    outcome: test.outcome,
    timing: timingOf(test),
  }));
  const overCeiling = tests.flatMap((entry) =>
    (entry.timing?.rows ?? [])
      .filter((row) => row.overCeiling)
      .map(
        (row) =>
          `${entry.target ?? entry.title}: ${row.metric} median ${row.median}, over its ${entry.timing!.tier} ceiling ${row.ceiling}`,
      ),
  );
  return { gating, tests, overCeiling };
}

/** The trend as Markdown, for the job summary. */
export function timingMarkdown(trend: TimingTrend): string {
  const lines = [
    `### Performance timing (${trend.gating === 'release' ? 'gates this release run' : 'report only: a release run gates it'})`,
    '',
  ];
  if (trend.tests.length === 0) return `${lines.join('\n')}No perf test ran.\n`;
  lines.push(
    '| Target | Tier | Metric | Median | Ceiling | Spread | |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const entry of trend.tests) {
    if (!entry.timing) {
      lines.push(`| ${entry.target ?? entry.title} | | no timing | | | | |`);
      continue;
    }
    for (const row of entry.timing.rows) {
      lines.push(
        `| ${entry.target ?? entry.title} | ${entry.timing.tier} | ${row.metric} | ${row.median ?? 'none'} | ${row.ceiling} | ${row.spread ?? ''} | ${row.overCeiling ? 'over' : ''} |`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Why `summary`'s timing fails a release, as failures, or none. */
export function timingFailures(
  summary: Pick<Summary, 'tests'> | null,
  thresholds: Thresholds = loadThresholds(),
): Failure[] {
  if (!summary) {
    return [
      {
        rule: 'timing-no-summary',
        message: 'The run left no summary.json, so no median says anything.',
      },
    ];
  }
  const tests = perfTests(summary);
  if (tests.length === 0) {
    return [
      { rule: 'timing-no-perf', message: 'No perf test ran, so nothing measured the timing.' },
    ];
  }
  const failures: Failure[] = [];
  for (const test of tests) {
    const name = test.target ?? test.title;
    if (test.outcome === 'flaky' || test.status === 'not run') {
      failures.push({
        rule: test.outcome === 'flaky' ? 'timing-retried' : 'timing-missing',
        message:
          test.outcome === 'flaky'
            ? `${name}'s perf test passed on a retry, and timing is never retried to green: its first run counts.`
            : `${name}'s perf test didn't run.`,
      });
      continue;
    }
    const timing = timingOf(test);
    if (!timing) {
      failures.push({ rule: 'timing-missing', message: `${name}'s perf test kept no timing.` });
      continue;
    }
    for (const { rule, message } of releaseProblems(timing, thresholds)) {
      failures.push({ rule, message: `${name}: ${message}` });
    }
  }
  return failures;
}

/** summary.json under `reports`, or null when there's none to read. */
export function readQualitySummary(reports: string): Summary | null {
  try {
    return JSON.parse(
      readFileSync(path.join(reports, 'quality', 'summary.json'), 'utf8'),
    ) as Summary;
  } catch {
    return null;
  }
}

/** What a release gate reads, as 11-4's ReleaseContext gives it. */
export interface TimingGateContext {
  readonly reports: string;
}

/** The release run's timing gate, for 11-4's RELEASE_GATES. */
export const TIMING_GATE = {
  id: 'timing',
  description: `the median of ${loadThresholds().timing.runs} loads of each perf cell, at most ${Math.round(loadThresholds().timing.releaseTolerance * 100)}% over its ceiling in quality/thresholds.json`,
  run: ({ reports }: TimingGateContext): readonly Failure[] =>
    timingFailures(readQualitySummary(reports)),
} as const;
