// Writes one failure record (ci/failure-record.schema.json) per test that
// finally failed. A test that passed on retry is a flake, not a failure, so
// it gets none. Runs only under ci/run.mjs (`pnpm ci:browser`), which sets
// the gate and the local command.
import path from 'node:path';
import type { FullConfig, Reporter, Suite, TestCase } from '@playwright/test/reporter';
import { currentGate, REPO_ROOT, reportsDir, writeFailureRecord } from '../../ci/lib/reports.mjs';

// Playwright colors its messages; records hold plain text.
const ANSI = /\u001b\[[0-9;]*m/g;

function matcherLine(message: string, label: string): string | undefined {
  const line = message
    .replace(ANSI, '')
    .split('\n')
    .find((l) => l.trimStart().startsWith(`${label}:`));
  return line?.slice(line.indexOf(':') + 1).trim() || undefined;
}

function annotation(test: TestCase, type: string): string | undefined {
  return test.annotations.find((a) => a.type === type)?.description;
}

export default class FailureRecordReporter implements Reporter {
  private suite?: Suite;

  onBegin(_config: FullConfig, suite: Suite) {
    this.suite = suite;
  }

  onEnd() {
    const gate = currentGate();
    if (!gate || !this.suite) return;
    for (const test of this.suite.allTests()) {
      if (test.outcome() !== 'unexpected') continue;
      const result = test.results.at(-1);
      const message = result?.error?.message ?? '';
      const viewport = test.parent.project()?.use.viewport;
      const file = path.relative(REPO_ROOT, test.location.file);
      writeFailureRecord({
        ...gate,
        test: `${file} > ${test.titlePath().slice(3).join(' > ') || test.title}`,
        route: annotation(test, 'route'),
        profile: annotation(test, 'profile'),
        viewport: viewport ? `${viewport.width}x${viewport.height}` : undefined,
        expected: matcherLine(message, 'Expected'),
        actual: matcherLine(message, 'Received') ?? message.replace(ANSI, '').split('\n')[0],
        artifacts: (result?.attachments ?? [])
          .filter((a) => a.path)
          .map((a) => path.relative(reportsDir(), a.path!)),
        reproCommand: `${gate.reproCommand} ${file}:${test.location.line}`,
      });
    }
  }
}
