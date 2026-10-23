// The quality runs' reporter (#11, Slice 1, items 10 and 11). It writes
// reports/quality/summary.json: every collected test, its cell, viewport,
// row, outcome, the reason it skipped with, the checks it ran, its vitals,
// a perf test's perf.json, and the run's own errors, which run.ts's
// verdict reads. Under ci/run.mjs it also writes the failure records: each
// failed test's own (one per failing rule and element), or, for a test
// that failed before it wrote any, one record of the failure.

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
import { writeCellFailures, type CellFailure } from './lib/failure-records';
import { RECORDS_ATTACHMENT } from './lib/records';
import { CHECKS_ANNOTATION, KIND_ANNOTATION } from './lib/checks';

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
  readonly vitals?: unknown;
  /** A perf test's perf.json: its loads, deterministic findings, and timing medians (#11, 11-3). */
  readonly perf?: unknown;
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
    const tests = (this.suite?.allTests() ?? []).map((test): SummaryTest => {
      const last = test.results.at(-1);
      const status = last?.status ?? 'not run';
      const skipped = test.outcome() === 'skipped';
      const records = (attachment(test, RECORDS_ATTACHMENT) as CellFailure[] | undefined) ?? [];
      return {
        title: test.titlePath().slice(3).join(' > ') || test.title,
        file: path.relative(REPO_ROOT, test.location.file),
        line: test.location.line,
        project: test.parent.project()?.name ?? '',
        engine: (test.parent.project()?.use as { browserName?: string } | undefined)?.browserName,
        kind: annotation(test, KIND_ANNOTATION),
        cell: annotation(test, 'cell'),
        target: annotation(test, 'target'),
        route: annotation(test, 'route'),
        viewport: annotation(test, 'viewport'),
        row: annotation(test, 'row'),
        outcome: test.outcome(),
        expectedStatus: test.expectedStatus,
        status,
        skipReason: skipped
          ? (annotation(test, 'skip') ?? annotation(test, 'fixme') ?? null)
          : null,
        checks: annotation(test, CHECKS_ANNOTATION)?.split(' ').filter(Boolean) ?? [],
        canaryProbe: annotation(test, 'quality-canary-probe') !== undefined,
        errors: (last?.errors ?? []).map((error) => plain(error.message ?? error.value)),
        records: records.length,
        vitals: attachment(test, 'vitals.json'),
        perf: attachment(test, 'perf.json'),
      };
    });
    const shard = this.config?.shard;
    const summary: Summary = {
      schemaVersion: 1,
      mode: process.env.QUALITY_MODE ?? 'pr',
      shard: shard ? `${shard.current}/${shard.total}` : null,
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
    for (const test of this.suite.allTests()) {
      if (test.outcome() !== 'unexpected') continue;
      const last = test.results.at(-1);
      const file = path.relative(REPO_ROOT, test.location.file);
      const artifacts = (last?.attachments ?? [])
        .filter((each) => each.path)
        .map((each) => path.relative(reportsDir(), each.path!));
      const failures = (attachment(test, RECORDS_ATTACHMENT) as CellFailure[] | undefined) ?? [];
      const reproCommand = `${gate.reproCommand} ${file}:${test.location.line}`;
      if (failures.length > 0) {
        // Part A's writer checks each against the schema, 1.1, before it writes any.
        await writeCellFailures(
          failures.map((failure) => ({ ...failure, artifacts, reproCommand })),
          { gate },
        );
      } else {
        // A test that failed before it had any, such as on a timeout, or a
        // harness check: one record of the failure, as the browser suite's.
        const message = plain(last?.errors[0]?.message ?? last?.error?.message);
        writeFailureRecord({
          ...gate,
          test: `${file} > ${test.titlePath().slice(3).join(' > ') || test.title}`,
          route: annotation(test, 'route'),
          profile: annotation(test, 'profile'),
          viewport: annotation(test, 'viewport'),
          actual: message.split('\n')[0] || last?.status,
          artifacts,
          reproCommand,
        });
      }
    }
  }
}
