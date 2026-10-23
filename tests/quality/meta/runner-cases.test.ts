import assert from 'node:assert/strict';
import test from 'node:test';
import { RUNNER_META_CASES, runRunnerCases } from './runner-cases';

// The runner's proving cases that need no browser, which pnpm test runs; the
// browser ones run in pnpm quality:meta.

test('every fail-closed rule of the runner has a known-bad case and a known-good one', () => {
  const rules = new Map<string, Set<string>>();
  for (const meta of RUNNER_META_CASES) {
    rules.set(meta.rule, (rules.get(meta.rule) ?? new Set()).add(meta.expect));
  }
  for (const rule of [
    'zero-tests',
    'undeclared-skip',
    'missing-browser',
    'target-without-results',
    'missing-fixture-marker',
    'ignored-media-emulation',
    'browser-egress',
    'server-egress',
    'canary-leaked',
    'canary-unproven',
    'unchecked-cell',
  ]) {
    assert.deepEqual([...(rules.get(rule) ?? [])].sort(), ['fail', 'pass'], rule);
  }
  assert.equal(
    new Set(RUNNER_META_CASES.map((meta) => `${meta.rule} ${meta.id}`)).size,
    RUNNER_META_CASES.length,
  );
});

test('every case that needs no browser holds', async () => {
  const results = await runRunnerCases((meta) => !meta.browser);
  assert.ok(results.length > 10);
  for (const { meta, held, failed, error } of results) {
    assert.ok(
      held,
      `${meta.rule}: ${meta.id}: expected ${meta.expect}, ${error ?? (failed ? 'failed' : 'passed')}`,
    );
  }
});
