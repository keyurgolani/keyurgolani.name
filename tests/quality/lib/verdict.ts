// A quality run's verdict (#11, Slice 1, items 8 and 11): run.ts reads the
// reporter's summary.json against the plan, and the run fails closed on
// each of these, whatever Playwright's own exit says:
//
// - no-summary: the run wrote no summary, so nothing says what ran.
// - missing-browser: an engine the run plans doesn't launch.
// - zero-tests: it collected no test.
// - undeclared-skip: a test skipped without a reason, or with one neither
//   the plan nor the harness declares.
// - target-without-results: a registered composition or surface got no
//   result: none of its tests collected, or every one skipped.
// - unchecked-cell: a cell test passed without running every cell check.
// - tests-failed, run-errors: a test failed, or something outside a test
//   did (a load error, a worker's late egress).
// - canary-leaked: an artifact holds the run's canary after the scrub.
// - canary-unproven: the canary probe ran, but no artifact held the canary
//   before the scrub, so the scan proved nothing.
//
// Each failure names its rule, and run.ts writes it as a failure record.

import type { Plan } from '../cells';
import { CELL_CHECKS } from './checks';
import type { Summary } from '../reporter';
import { VISUAL_SKIP } from './visual';

/** The harness's own skip reasons, beside the plan's. */
export const HARNESS_SKIPS: readonly string[] = [VISUAL_SKIP];

export interface ArtifactHit {
  readonly file: string;
  readonly entry?: string;
  readonly canary: string;
}

export interface VerdictInput {
  readonly plan: Pick<Plan, 'targets' | 'reasons'>;
  readonly summary: Summary | null;
  readonly missingBrowsers: readonly { readonly engine: string; readonly error: string }[];
  readonly canary: {
    readonly before: readonly ArtifactHit[];
    readonly after: readonly ArtifactHit[];
  } | null;
}

export interface Failure {
  readonly rule: string;
  readonly message: string;
}

export interface Verdict {
  readonly ok: boolean;
  readonly failures: readonly Failure[];
  /** Tests that passed on a retry. PR runs only report them. */
  readonly flaky: readonly string[];
  readonly counts: Readonly<Record<string, number>>;
}

/** A launch error's tell: Playwright's own words for a browser it can't find or start. */
const LAUNCH_ERROR = /Executable doesn't exist|browserType\.launch|Failed to launch/i;

export function judge({ plan, summary, missingBrowsers, canary }: VerdictInput): Verdict {
  const failures: Failure[] = [];
  const fail = (rule: string, message: string) => failures.push({ rule, message });

  for (const { engine, error } of missingBrowsers) {
    fail('missing-browser', `${engine} doesn't launch: ${error}`);
  }
  if (!summary) {
    // A missing browser stops the run before Playwright, so no summary is by design then.
    if (missingBrowsers.length === 0) {
      fail('no-summary', 'The run wrote no summary.json, so nothing says what ran.');
    }
    return { ok: false, failures, flaky: [], counts: {} };
  }
  const launch = [...summary.errors, ...summary.tests.flatMap((test) => test.errors)].find(
    (error) => LAUNCH_ERROR.test(error),
  );
  if (launch && missingBrowsers.length === 0) fail('missing-browser', launch.split('\n')[0]!);

  const { tests } = summary;
  if (tests.length === 0) fail('zero-tests', 'The run collected no test.');

  const declared = new Set([...plan.reasons, ...HARNESS_SKIPS]);
  for (const test of tests.filter((each) => each.outcome === 'skipped')) {
    if (!test.skipReason) {
      fail('undeclared-skip', `${test.title} skipped without a reason.`);
    } else if (!declared.has(test.skipReason)) {
      fail(
        'undeclared-skip',
        `${test.title} skipped with a reason nothing declares: ${test.skipReason}`,
      );
    }
  }

  const sharded = summary.shard !== null;
  for (const target of plan.targets) {
    const key = `${target.kind}:${target.id}`;
    const own = tests.filter((test) => test.target === key);
    if (own.length === 0) {
      // A shard holds only some tests; the merged shards answer for the rest.
      if (!sharded)
        fail('target-without-results', `${key} is registered, and no test of it was collected.`);
      continue;
    }
    if (!own.some((test) => test.status !== 'skipped' && test.status !== 'not run')) {
      fail(
        'target-without-results',
        `${key} is registered, and none of its ${own.length} tests ran.`,
      );
    }
  }

  for (const test of tests) {
    if (!test.cell || test.status !== 'passed') continue;
    const missing = CELL_CHECKS.filter((check) => !test.checks.includes(check));
    if (missing.length > 0) {
      fail('unchecked-cell', `${test.title} passed without its ${missing.join(', ')} check(s).`);
    }
  }

  const failed = tests.filter((test) => test.outcome === 'unexpected');
  if (failed.length > 0) {
    fail(
      'tests-failed',
      `${failed.length} test(s) failed: ${failed.map((test) => test.title).join('; ')}`,
    );
  }
  for (const error of summary.errors) fail('run-errors', error.split('\n')[0]!);

  if (canary) {
    for (const hit of canary.after) {
      fail(
        'canary-leaked',
        `${hit.file}${hit.entry ? ` (${hit.entry})` : ''} holds ${hit.canary} after the scrub.`,
      );
    }
    const probed = tests.some((test) => test.canaryProbe && test.status !== 'skipped');
    if (probed && canary.before.length === 0) {
      fail(
        'canary-unproven',
        'The canary probe ran, and no artifact held the canary before the scrub.',
      );
    }
  }

  const counts: Record<string, number> = { collected: tests.length };
  for (const test of tests) counts[test.outcome] = (counts[test.outcome] ?? 0) + 1;
  return {
    ok: failures.length === 0,
    failures,
    flaky: tests.filter((test) => test.outcome === 'flaky').map((test) => test.title),
    counts,
  };
}
