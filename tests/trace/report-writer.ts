// Gathers each case's trace-case.json attachment into one report (#6,
// Slice 1), reports/trace/trace-report.json unless `outputFile` names
// another, and prints a line per case. The report says which checkout ran
// the trace, whether it had uncommitted changes, and the git tree ids of its
// apps, packages, and tests at HEAD, which name what was built and the trace
// tool by content, whatever becomes of the commit.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { REPO_ROOT } from '../../ci/lib/reports.mjs';
import { readTraceEnv } from '../harness/trace/options.mjs';
import { buildReport, caseSummary } from '../harness/trace/report.mjs';

function git(args: string[]): string | null {
  const run = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return run.status === 0 ? run.stdout.trim() : null;
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

export default class TraceReportWriter implements Reporter {
  private readonly outputFile: string;
  private readonly cases: Record<string, unknown>[] = [];
  private readonly failures: string[] = [];
  private ran = 0;

  constructor(options: { outputFile: string }) {
    this.outputFile = options.outputFile;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.ran += 1;
    for (const attachment of result.attachments) {
      if (attachment.name === 'trace-case.json' && attachment.body) {
        this.cases.push(JSON.parse(attachment.body.toString('utf8')));
      }
    }
    if (result.status !== 'passed' && result.status !== 'skipped') {
      this.failures.push(test.titlePath().filter(Boolean).slice(1).join(' > '));
    }
  }

  onEnd() {
    // A --list run, or one that ran nothing, leaves the last report alone.
    if (this.ran === 0) return;
    const options = readTraceEnv();
    const status = git(['status', '--porcelain']);
    const report = buildReport({
      cases: this.cases,
      checkout: {
        commit: git(['rev-parse', 'HEAD']),
        dirty: status === null ? null : status.length > 0,
        trees: Object.fromEntries(
          ['apps', 'packages', 'tests'].map((name) => [name, git(['rev-parse', `HEAD:${name}`])]),
        ),
      },
      command: options.command,
      options: {
        baseUrl: options.baseUrl,
        allowThirdParty: options.allowThirdParty,
        selection: options.selection,
      },
      failures: this.failures,
    });
    mkdirSync(path.dirname(this.outputFile), { recursive: true });
    writeFileSync(this.outputFile, `${JSON.stringify(report, null, 2)}\n`);
    for (const entry of report.cases) {
      const summary = caseSummary(entry);
      const { route, viewport, selection } = entry as Record<string, string>;
      console.log(
        [
          `[trace] ${selection} ${route} ${viewport}:`,
          `${summary.requests.total} requests (${summary.requests.thirdParty} third-party),`,
          `JS ${kb(summary.js.gzipBytes)} gzip in ${summary.js.files},`,
          `CSS ${kb(summary.css.gzipBytes)} gzip in ${summary.css.files},`,
          `${summary.longTasks.count} long tasks (${summary.longTasks.totalMs} ms),`,
          `idle task ${summary.idle.taskDurationS} s per ${summary.idle.windowS} s`,
        ].join(' '),
      );
    }
    console.log(`[trace] report: ${path.relative(REPO_ROOT, this.outputFile)}`);
  }
}
