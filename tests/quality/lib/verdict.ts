// A quality run's verdict (#11, Slice 1, items 8 and 11): run.ts reads the
// reporter's summary.json against the plan, and the run fails closed on
// each of these, whatever Playwright's own exit says:
//
// - no-summary: the run wrote no summary, so nothing says what ran.
// - missing-browser: an engine the run plans doesn't launch.
// - zero-tests: it collected no test.
// - plan-coverage: a planned cell test didn't run exactly once on each
//   engine the run plans, or a cell test ran that the plan doesn't have.
// - empty-project: a Playwright project collected no test.
// - canary-probe-missing: the canary probe didn't pass, so the scan after
//   the scrub proves nothing.
// - expected-failure: a test is expected to fail (test.fail), so its
//   passing says nothing.
// - undeclared-skip: a test skipped without a reason that's a sentence, or
//   with one that isn't its own: a cell test's planned reason on its
//   engine, or a visual test's VISUAL_SKIP.
// - target-without-results: a registered composition or surface got no
//   result: none of its tests collected, or every one skipped. Perf tests
//   don't count here: a target needs a cell test of its own.
// - perf-coverage: a planned perf cell's test (perf.spec.ts, #11's 11-3)
//   didn't run exactly once on each engine, a perf test ran that the plan
//   has no perf cell for, or a target has no perf cell. It runs when the
//   plan names its perf cells, as run.ts's and plan.json's do.
// - unchecked-cell: a cell or visual test passed without every check its
//   kind runs, a cell test every check its row and viewport owe
//   (checks.ts's requiredChecks).
// - tests-failed, run-errors: a test failed, or something outside a test
//   did (a load error, a worker's late egress).
// - canary-leaked: an artifact holds the run's canary after the scrub.
// - canary-unproven: the canary probe ran, but no artifact held the canary
//   before the scrub, so the scan proved nothing.
//
// A sharded run holds only some of the tests, so the checks that need all
// of them (the plan's coverage, empty projects, the canary probe, targets
// with no test, and perf cells that didn't run) skip there; merging the shards' verdicts is #11's
// Slice 4. The checks that need a collected test skip when there's none,
// since zero-tests already fails it. Each failure names its rule, and
// run.ts writes it as a failure record.

import type { Plan, PlannedTest } from '../cells';
import { isReason, KIND_CHECKS, PERF_KIND, requiredChecks, type TestKind } from './checks';
import type { Summary, SummaryTest } from '../reporter';
import { VISUAL_SKIP } from './visual';

/** The harness's own skip reasons, which only its own tests may skip with. */
export const HARNESS_SKIPS: readonly string[] = [];

/** A planned test, as the verdict reads one. */
export type VerdictTest = Pick<PlannedTest, 'skip' | 'engineSkips'> &
  Partial<Pick<PlannedTest, 'conditions'>> & {
    readonly cell: Pick<PlannedTest['cell'], 'id'>;
    readonly viewport: Pick<PlannedTest['viewport'], 'id'>;
    readonly row: Pick<PlannedTest['row'], 'id'>;
  };

export interface ArtifactHit {
  readonly file: string;
  readonly entry?: string;
  readonly canary: string;
}

/** A planned perf cell, as plan.json and the verdict name one (lib/perf/plan.ts). */
export interface PlannedPerf {
  readonly cell: string;
  /** kind:id of the composition or surface it stands for. */
  readonly target: string;
  readonly tier: string;
  /** Why this plan leaves it to the full plan, when it does: it answers for its target, and doesn't run. */
  readonly deferred?: string;
}

export interface VerdictInput {
  readonly plan: Pick<Plan, 'targets'> & {
    readonly tests: readonly VerdictTest[];
    /** The perf cells, when the plan has them: perf-coverage holds the run to them. */
    readonly perf?: readonly PlannedPerf[];
  };
  /** The engines the run plans, each of which runs every planned test once. */
  readonly engines: readonly string[];
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

const planKey = (cell: string, viewport: string, row: string, engine: string) =>
  JSON.stringify([cell, viewport, row, engine]);

/** The reasons `test` may skip with: its own, by its kind. */
function ownReasons(test: SummaryTest, planned: VerdictTest | undefined): string[] {
  if (test.kind === 'visual') return [VISUAL_SKIP];
  if (test.kind === 'cell') {
    if (!planned) return [];
    const engine = test.engine ?? '';
    return [planned.skip, planned.engineSkips[engine]].filter(
      (reason): reason is string => reason !== undefined,
    );
  }
  return [...HARNESS_SKIPS];
}

export function judge({ plan, engines, summary, missingBrowsers, canary }: VerdictInput): Verdict {
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
  const sharded = summary.shard !== null;
  const whole = !sharded && tests.length > 0;
  if (tests.length === 0) fail('zero-tests', 'The run collected no test.');

  // Each planned test once on each engine, and no cell test the plan doesn't have.
  const planned = new Map<string, VerdictTest>();
  for (const test of plan.tests) {
    for (const engine of engines) {
      planned.set(planKey(test.cell.id, test.viewport.id, test.row.id, engine), test);
    }
  }
  const ran = new Map<string, number>();
  const plannedFor = (test: SummaryTest) =>
    planned.get(planKey(test.cell ?? '', test.viewport ?? '', test.row ?? '', test.engine ?? ''));
  if (tests.length > 0) {
    for (const test of tests.filter((each) => each.kind === 'cell')) {
      const key = planKey(test.cell ?? '', test.viewport ?? '', test.row ?? '', test.engine ?? '');
      if (!planned.has(key))
        fail('plan-coverage', `${test.title} ran, and the plan has no such test.`);
      ran.set(key, (ran.get(key) ?? 0) + 1);
    }
    for (const [key, test] of planned) {
      const count = ran.get(key) ?? 0;
      const engine = (JSON.parse(key) as string[])[3];
      const name = `${test.cell.id} at ${test.viewport.id}, ${test.row.id}, on ${engine}`;
      if (count > 1) fail('plan-coverage', `${name} ran ${count} times, not once.`);
      else if (count === 0 && !sharded)
        fail('plan-coverage', `${name} is planned, and didn't run.`);
    }
  }
  if (whole) {
    for (const { name } of summary.projects) {
      if (!tests.some((test) => test.project === name)) {
        fail('empty-project', `The project ${name} collected no test.`);
      }
    }
    if (!tests.some((test) => test.canaryProbe && test.status === 'passed')) {
      fail(
        'canary-probe-missing',
        "The canary probe didn't pass, so the canary scan proves nothing.",
      );
    }
  }

  for (const test of tests) {
    if (test.expectedStatus !== 'passed' && test.expectedStatus !== 'skipped') {
      fail(
        'expected-failure',
        `${test.title} is expected to ${test.expectedStatus === 'failed' ? 'fail' : `end ${test.expectedStatus}`}, so its result says nothing.`,
      );
    }
  }

  for (const test of tests.filter((each) => each.outcome === 'skipped')) {
    const reason = test.skipReason;
    if (!isReason(reason)) {
      fail(
        'undeclared-skip',
        reason === null || reason.trim() === ''
          ? `${test.title} skipped without a reason.`
          : `${test.title} skipped with ${JSON.stringify(reason)}, which isn't a reason.`,
      );
    } else if (!ownReasons(test, plannedFor(test)).includes(reason!)) {
      fail('undeclared-skip', `${test.title} skipped with a reason that isn't its own: ${reason}`);
    }
  }

  for (const target of plan.targets) {
    const key = `${target.kind}:${target.id}`;
    const own = tests.filter((test) => test.target === key && test.kind !== PERF_KIND);
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

  if (plan.perf) failures.push(...perfCoverage(plan.perf, plan.targets, engines, summary));

  for (const test of tests) {
    if (!test.kind || test.status !== 'passed') continue;
    const owed =
      test.kind === 'cell' && test.row && test.viewport
        ? requiredChecks(test.row, test.viewport, plannedFor(test)?.conditions ?? true)
        : KIND_CHECKS[test.kind as TestKind];
    const missing = owed.filter((check) => !test.checks.includes(check));
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

/**
 * perf-coverage: each perf cell's test ran exactly once on each engine,
 * every perf test that ran is a perf cell's, and every target has one. A
 * shard holds only some of them, so only the repeats and strays count there.
 */
export function perfCoverage(
  perf: readonly PlannedPerf[],
  targets: Plan['targets'],
  engines: readonly string[],
  summary: Pick<Summary, 'tests' | 'shard'>,
): Failure[] {
  const failures: Failure[] = [];
  const fail = (message: string) => failures.push({ rule: 'perf-coverage', message });
  const sharded = summary.shard !== null;
  for (const target of targets) {
    const key = `${target.kind}:${target.id}`;
    if (!perf.some((each) => each.target === key)) {
      fail(`${key} has no representative cell, so nothing measures its performance.`);
    }
  }
  const ran = summary.tests.filter((test) => test.kind === PERF_KIND);
  // A deferred cell answers for its target, and runs in the full plan only.
  const runs = perf.filter((each) => each.deferred === undefined);
  for (const test of ran) {
    if (!runs.some((each) => each.cell === test.cell)) {
      fail(
        perf.some((each) => each.cell === test.cell)
          ? `${test.title} ran, and this plan leaves ${test.cell} to the full plan.`
          : `${test.title} ran, and no perf cell is ${test.cell}.`,
      );
    }
  }
  for (const { cell } of runs) {
    for (const engine of engines) {
      const count = ran.filter((test) => test.cell === cell && test.engine === engine).length;
      if (count > 1) fail(`The perf test of ${cell} ran ${count} times on ${engine}, not once.`);
      else if (count === 0 && !sharded) {
        fail(`The perf test of ${cell} is planned on ${engine}, and didn't run.`);
      }
    }
  }
  return failures;
}
