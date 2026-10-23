import assert from 'node:assert/strict';
import test from 'node:test';
import { judge } from '../lib/verdict';
import { RUNNER_CASES } from './runner-cases';

// The runner's cases in pnpm quality:meta: their shape. meta.test.ts runs
// the ones that need no browser; the quality-meta job runs them all.

/** The fail-closed rules #11 names, and the verdict's and the fixtures' others. */
const RULES = [
  'zero-tests',
  'undeclared-skip',
  'missing-browser',
  'target-without-results',
  'ignored-media-emulation',
  'unchecked-cell',
  'tests-failed',
  'run-errors',
  'no-summary',
  'browser-egress',
  'server-egress',
  'canary-leaked',
  'canary-unproven',
];

test('every fail-closed rule of the runner has a known-bad case and a known-good one', () => {
  for (const rule of RULES) {
    const own = RUNNER_CASES.filter(({ id }) => id.startsWith(`runner/${rule}-`));
    assert.deepEqual(
      [...new Set(own.map(({ expect }) => expect))].sort(),
      ['fail', 'pass'],
      `${rule}: ${own.map(({ id }) => id).join(', ')}`,
    );
  }
  for (const { id } of RUNNER_CASES) {
    assert.ok(
      RULES.some((rule) => id.startsWith(`runner/${rule}-`)),
      `${id} names no rule`,
    );
  }
});

test("a launch error inside a test's result fails the run as a missing browser, beside the test failure", () => {
  const verdict = judge({
    plan: { targets: [], reasons: [] },
    summary: {
      schemaVersion: 1,
      mode: 'pr',
      shard: null,
      status: 'failed',
      projects: [],
      tests: [
        {
          title: 'a cell',
          file: 'tests/quality/cells.spec.ts',
          line: 1,
          project: 'chromium',
          outcome: 'unexpected',
          status: 'failed',
          skipReason: null,
          checks: [],
          canaryProbe: false,
          errors: ["browserType.launch: Executable doesn't exist at /x\nmore"],
          records: 0,
        },
      ],
      errors: [],
    },
    missingBrowsers: [],
    canary: null,
  });
  assert.deepEqual(
    verdict.failures.map(({ rule }) => rule),
    ['missing-browser', 'tests-failed'],
  );
  assert.equal(verdict.failures[0]?.message, "browserType.launch: Executable doesn't exist at /x");
});
