// The quality runs' reporter (#11, Slice 1, items 10 and 11). It writes
// reports/quality/summary.json: every collected test, its cell, viewport,
// row, outcome, the reason it skipped with, the checks it ran, its vitals,
// a perf test's perf.json, and the run's own errors, which run.ts's
// verdict reads. Under ci/run.mjs it also writes the failure records: each
// failed test's own (one per failing rule and element), or, for a test
// that failed before it wrote any, one record of the failure; and a passing
// test's waived findings, each with its exceptionId, so a scheduled
// quality:exceptions can tell an exception that waived something from a
// stale one.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
} from '@playwright/test/reporter';
import { currentGate, REPO_ROOT, reportsDir, writeFailureRecord } from '../../ci/lib/reports.mjs';
import { runShard } from './lib/env';
import { failureKey, writeCellFailures, type CellFailure } from './lib/failure-records';
import { RECORDS_ATTACHMENT } from './lib/records';
import { failureOf } from '../../ci/release/release-records.mjs';
import {
  CHECKS_ANNOTATION,
  KIND_ANNOTATION,
  OWED_ANNOTATION,
  SOFT_FAILURES_ANNOTATION,
} from './lib/checks';

// Playwright colors its messages; summaries and records hold plain text.
const ANSI = /\u001b\[[0-9;]*m/g;
const plain = (text: string | undefined) => (text ?? '').replace(ANSI, '');

/** One collected test, as summary.json lists it. */
export interface SummaryTest {
  readonly title: string;
  readonly file: string;
  readonly line: number;
  readonly project: string;
  /** The project's engine: chromium, firefox, or webkit. */
  readonly engine?: string;
  /** cell or visual, for a cell test or a visual test; none for the harness's own. */
  readonly kind?: string;
  readonly cell?: string;
  /** kind:id of the composition or surface it's a cell of. */
  readonly target?: string;
  readonly route?: string;
  readonly viewport?: string;
  readonly row?: string;
  /** expected, unexpected, flaky, or skipped. */
  readonly outcome: string;
  /** What Playwright expected it to end as: passed, or failed for test.fail(), or skipped. */
  readonly expectedStatus: string;
  /** The last result's status, or `not run`. */
  readonly status: string;
  /** For a skipped test: the reason it gave, or null for none. */
  readonly skipReason: string | null;
  /** The checks a cell test ran (run-cell.ts's CELL_CHECKS). */
  readonly checks: readonly string[];
  readonly canaryProbe: boolean;
  readonly errors: readonly string[];
  readonly records: number;
  /**
   * A failed test's failure records that no exception waived, each by what names it alone: its
   * check, rule, and element (failureTarget), with no measurement. A release candidate's records
   * list is matched on these (ci/release/release-records.mjs). Empty for a test that didn't fail.
   */
  readonly failures?: readonly SummaryFailure[];
  /**
   * How many of runCell's soft expectations failed (SOFT_FAILURES_ANNOTATION): each stands on
   * records, so an error beyond them is something no record names (a fixture's throw, egress, a
   * timeout). Absent when runCell didn't reach them.
   */
  readonly softFailures?: number;
  /** The checks the cell test owed (OWED_ANNOTATION), which a covered test must have run. */
  readonly owed?: readonly string[];
  readonly vitals?: unknown;
  /** A perf test's perf.json: its loads, deterministic findings, and timing medians (#11, 11-3). */
  readonly perf?: unknown;
}

/** A failure record, as a records list names it. */
export interface SummaryFailure {
  readonly check: string;
  readonly rule: string;
  readonly target: string | null;
}

export interface Summary {
  readonly schemaVersion: 1;
  readonly mode: string;
  readonly shard: string | null;
  readonly status: string;
  readonly projects: readonly { readonly name: string; readonly browserName?: string }[];
  readonly tests: readonly SummaryTest[];
  /** Errors outside any test: a load error, a global setup's, or a worker's teardown. */
  readonly errors: readonly string[];
}

export const SUMMARY_FILE = () => path.join(reportsDir(), 'quality', 'summary.json');

function annotation(test: TestCase, type: string): string | undefined {
  const result = test.results.at(-1);
  return [...test.annotations, ...(result?.annotations ?? [])].find((each) => each.type === type)
    ?.description;
}

/** Every attachment named `name` of the test's last result, each parsed; one that won't parse is skipped. */
function attachments(test: TestCase, name: string): unknown[] {
  return (test.results.at(-1)?.attachments ?? [])
    .filter((each) => each.name === name)
    .flatMap((found) => {
      try {
        return [
          JSON.parse(found.body ? found.body.toString('utf8') : readFileSync(found.path!, 'utf8')),
        ];
      } catch {
        return [];
      }
    });
}

/** Every failure record the test attached: runCell's, and an egress fixture's, each its own attachment. */
export function testRecords(test: TestCase): CellFailure[] {
  return attachments(test, RECORDS_ATTACHMENT).flatMap((each) =>
    Array.isArray(each) ? (each as CellFailure[]) : [],
  );
}

/** A JSON attachment of the test's last result, from its body or its file. */
function attachment(test: TestCase, name: string): unknown {
  const found = test.results.at(-1)?.attachments.find((each) => each.name === name);
  if (!found) return undefined;
  try {
    const text = found.body ? found.body.toString('utf8') : readFileSync(found.path!, 'utf8');
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * One test as summary.json lists it. A failed cell test's failures are its unwaived records, each
 * keyed under the test's own surface and viewport (failureOf), so a record of the primitives page
 * or of the landscape pass is told apart from the cell page's own. A record that repeats one kept
 * already, by the failure records' own key (failureKey: the same rule on the same element in the
 * same cell, such as reflow's re-probe with a disclosure toggled), is one record, as
 * writeCellFailures writes it once; only when it names its element by selector, so an aria-only
 * or elementless repeat stays repeated until RC2's per-element key.
 */
function unwaivedRecords(records: readonly CellFailure[]): CellFailure[] {
  const kept = new Set<string>();
  return records.filter((record) => {
    if (record.exceptionId !== undefined) return false;
    if (!record.element?.selector) return true;
    const key = failureKey(record);
    if (kept.has(key)) return false;
    kept.add(key);
    return true;
  });
}

/**
 * One test as summary.json lists it: its fields, and a failed cell test's unwaived records as its
 * failures (unwaivedRecords()).
 */
export function summaryTest(test: TestCase): SummaryTest {
  const last = test.results.at(-1);
  const status = last?.status ?? 'not run';
  const skipped = test.outcome() === 'skipped';
  const records = testRecords(test);
  const soft = annotation(test, SOFT_FAILURES_ANNOTATION);
  const owed = annotation(test, OWED_ANNOTATION);
  const target = annotation(test, 'target');
  const viewport = annotation(test, 'viewport');
  const own = { surface: target?.slice(target.indexOf(':') + 1), viewport };
  return {
    title: test.titlePath().slice(3).join(' > ') || test.title,
    file: path.relative(REPO_ROOT, test.location.file),
    line: test.location.line,
    project: test.parent.project()?.name ?? '',
    engine: (test.parent.project()?.use as { browserName?: string } | undefined)?.browserName,
    kind: annotation(test, KIND_ANNOTATION),
    cell: annotation(test, 'cell'),
    target,
    route: annotation(test, 'route'),
    viewport,
    row: annotation(test, 'row'),
    outcome: test.outcome(),
    expectedStatus: test.expectedStatus,
    status,
    skipReason: skipped ? (annotation(test, 'skip') ?? annotation(test, 'fixme') ?? null) : null,
    checks: annotation(test, CHECKS_ANNOTATION)?.split(' ').filter(Boolean) ?? [],
    canaryProbe: annotation(test, 'quality-canary-probe') !== undefined,
    errors: (last?.errors ?? []).map((error) => plain(error.message ?? error.value)),
    records: records.length,
    failures:
      test.outcome() === 'unexpected'
        ? unwaivedRecords(records).map((record) => failureOf(record, own) as SummaryFailure)
        : [],
    ...(soft !== undefined && /^\d+$/.test(soft) ? { softFailures: Number(soft) } : {}),
    ...(owed !== undefined ? { owed: owed.split(' ').filter(Boolean) } : {}),
    vitals: attachment(test, 'vitals.json'),
    perf: attachment(test, 'perf.json'),
  };
}

export default class QualityReporter implements Reporter {
  private config?: FullConfig;
  private suite?: Suite;
  private readonly errors: string[] = [];

  onBegin(config: FullConfig, suite: Suite) {
    this.config = config;
    this.suite = suite;
  }

  onError(error: TestError) {
    this.errors.push(plain(error.message ?? error.value ?? 'unknown error'));
  }

  async onEnd(result: FullResult) {
    const tests = (this.suite?.allTests() ?? []).map(summaryTest);
    // run.ts's own shard (lib/pr-shards.ts, lib/full-shards.ts), or Playwright's, given some other way.
    const shard = this.config?.shard;
    const summary: Summary = {
      schemaVersion: 1,
      mode: process.env.QUALITY_MODE ?? 'pr',
      shard: shard ? `${shard.current}/${shard.total}` : runShard(),
      status: result.status,
      projects: (this.config?.projects ?? []).map((project) => ({
        name: project.name,
        browserName: (project.use as { browserName?: string }).browserName,
      })),
      tests,
      errors: this.errors,
    };
    mkdirSync(path.dirname(SUMMARY_FILE()), { recursive: true });
    writeFileSync(SUMMARY_FILE(), `${JSON.stringify(summary, null, 2)}\n`);

    const gate = currentGate();
    if (!gate || !this.suite) return;
    await writeTestRecords(this.suite.allTests(), gate);
  }
}

/**
 * The failure records of a run's tests, under `gate`: a failed test's own (or one of the failure,
 * when it wrote none), and a passed test's waived findings alone, each with its exceptionId. A
 * waived record fails nothing: ci/run.mjs and ci/summarize.mjs set it apart from the failures.
 */
export async function writeTestRecords(
  tests: readonly TestCase[],
  gate: { readonly gate: string; readonly reproCommand: string },
  dir?: string,
): Promise<void> {
  for (const test of tests) {
    const outcome = test.outcome();
    if (outcome === 'skipped') continue;
    const last = test.results.at(-1);
    const file = path.relative(REPO_ROOT, test.location.file);
    const artifacts = (last?.attachments ?? [])
      .filter((each) => each.path)
      .map((each) => path.relative(reportsDir(), each.path!));
    const records = testRecords(test);
    const reproCommand = `${gate.reproCommand} ${file}:${test.location.line}`;
    // What an exception waived, whatever the outcome; what failed, for a test that failed. A
    // test that passed (or passed on a retry) failed nothing.
    const waived = records.filter((record) => record.exceptionId !== undefined);
    const failing =
      outcome === 'unexpected' ? records.filter((record) => record.exceptionId === undefined) : [];
    if (waived.length + failing.length > 0) {
      // Part A's writer checks each against the schema, 1.1, before it writes any.
      await writeCellFailures(
        [...failing, ...waived].map((failure) => ({ ...failure, artifacts, reproCommand })),
        { gate, ...(dir ? { dir } : {}) },
      );
    }
    if (outcome === 'unexpected' && failing.length === 0) {
      // A test that failed before it had any, such as on a timeout, or a
      // harness check, or with every finding waived (it failed on something
      // else): one record of the failure, as the browser suite's.
      const message = plain(last?.errors[0]?.message ?? last?.error?.message);
      writeFailureRecord(
        {
          ...gate,
          test: `${file} > ${test.titlePath().slice(3).join(' > ') || test.title}`,
          route: annotation(test, 'route'),
          profile: annotation(test, 'profile'),
          viewport: annotation(test, 'viewport'),
          actual: message.split('\n')[0] || last?.status,
          artifacts,
          reproCommand,
        },
        dir,
      );
    }
  }
}
