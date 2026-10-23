// The quality runs' reporter (#11, Slice 1, items 10 and 11). It writes
// reports/quality/summary.json: every collected test, its cell, viewport,
// row, outcome, the reason it skipped with, the checks it ran, its vitals
// (report-only until Slice 3), and the run's own errors, which run.ts's
// verdict reads. Under ci/run.mjs it also writes the failure records: each
// failed test's own (one per failing rule and element), or, for a test
// that failed before it wrote any, one record of the failure.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
} from '@playwright/test/reporter';
import { currentGate, REPO_ROOT, reportsDir } from '../../ci/lib/reports.mjs';
import { HOST_MARKERS } from './lib/markers';
import { RECORDS_ATTACHMENT, writeRecords, type RecordFields } from './lib/records';
import { CHECKS_ANNOTATION } from './lib/checks';

// Playwright colors its messages; summaries and records hold plain text.
const ANSI = /\u001b\[[0-9;]*m/g;
const plain = (text: string | undefined) => (text ?? '').replace(ANSI, '');

/** One collected test, as summary.json lists it. */
export interface SummaryTest {
  readonly title: string;
  readonly file: string;
  readonly line: number;
  readonly project: string;
  readonly cell?: string;
  /** kind:id of the composition or surface it's a cell of. */
  readonly target?: string;
  readonly route?: string;
  readonly viewport?: string;
  readonly row?: string;
  /** expected, unexpected, flaky, or skipped. */
  readonly outcome: string;
  /** The last result's status, or `not run`. */
  readonly status: string;
  /** For a skipped test: the reason it gave, or null for none. */
  readonly skipReason: string | null;
  /** The checks a cell test ran (run-cell.ts's CELL_CHECKS). */
  readonly checks: readonly string[];
  readonly markers?: string;
  readonly canaryProbe: boolean;
  readonly errors: readonly string[];
  readonly records: number;
  readonly vitals?: unknown;
}

export interface Summary {
  readonly schemaVersion: 1;
  readonly mode: string;
  readonly shard: string | null;
  readonly status: string;
  readonly markers: string;
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

function attachment(test: TestCase, name: string): unknown {
  const found = test.results.at(-1)?.attachments.find((each) => each.name === name && each.body);
  if (!found?.body) return undefined;
  try {
    return JSON.parse(found.body.toString('utf8'));
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

  onEnd(result: FullResult) {
    const tests = (this.suite?.allTests() ?? []).map((test): SummaryTest => {
      const last = test.results.at(-1);
      const status = last?.status ?? 'not run';
      const skipped = test.outcome() === 'skipped';
      const records = (attachment(test, RECORDS_ATTACHMENT) as RecordFields[] | undefined) ?? [];
      return {
        title: test.titlePath().slice(3).join(' > ') || test.title,
        file: path.relative(REPO_ROOT, test.location.file),
        line: test.location.line,
        project: test.parent.project()?.name ?? '',
        cell: annotation(test, 'cell'),
        target: annotation(test, 'target'),
        route: annotation(test, 'route'),
        viewport: annotation(test, 'viewport'),
        row: annotation(test, 'row'),
        outcome: test.outcome(),
        status,
        skipReason: skipped
          ? (annotation(test, 'skip') ?? annotation(test, 'fixme') ?? null)
          : null,
        checks: annotation(test, CHECKS_ANNOTATION)?.split(' ').filter(Boolean) ?? [],
        markers: annotation(test, 'quality-markers'),
        canaryProbe: annotation(test, 'quality-canary-probe') !== undefined,
        errors: (last?.errors ?? []).map((error) => plain(error.message ?? error.value)),
        records: records.length,
        vitals: attachment(test, 'vitals.json'),
      };
    });
    const shard = this.config?.shard;
    const summary: Summary = {
      schemaVersion: 1,
      mode: process.env.QUALITY_MODE ?? 'pr',
      shard: shard ? `${shard.current}/${shard.total}` : null,
      status: result.status,
      markers: HOST_MARKERS,
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
      const records = (attachment(test, RECORDS_ATTACHMENT) as RecordFields[] | undefined) ?? [];
      const repro = `${gate.reproCommand} ${file}:${test.location.line}`;
      if (records.length > 0) {
        writeRecords(
          records.map((record) => ({ ...record, artifacts })),
          { gate: gate.gate, reproCommand: repro },
        );
      } else {
        const message = plain(last?.errors[0]?.message ?? last?.error?.message);
        writeRecords(
          [
            {
              test: `${file} > ${test.titlePath().slice(3).join(' > ') || test.title}`,
              rule: 'test-failed',
              route: annotation(test, 'route'),
              profile: annotation(test, 'profile'),
              viewport: annotation(test, 'viewport'),
              preferenceMode: annotation(test, 'row'),
              actual: message.split('\n')[0] || last?.status,
              artifacts,
            },
          ],
          { gate: gate.gate, reproCommand: repro },
        );
      }
    }
  }
}
