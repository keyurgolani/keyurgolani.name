import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOOP_ITERATIONS as AUDIT_LOOPS, loops as auditLoops } from '@portfolio/appearance/node';
import { LOOP_ITERATIONS as BUDGET_LOOPS, loops as budgetLoops } from '../../../ci/lib/budgets.mjs';

// One reading of a loop (K-4 round 2, R2-L3): the stylesheet count
// (ci/lib/budgets.mjs), the source audit's motion-gate rule, and the trace
// probe, which inlines its copy since Playwright sends it as source text,
// agree on the iteration count past which a finite animation runs for as
// long as a page shows, and on what in a value says so.

const PROBE = readFileSync(
  new URL('../../../tests/harness/trace/probe.mjs', import.meta.url),
  'utf8',
);

test('the count, the audit, and the probe share one loop threshold', () => {
  assert.equal(AUDIT_LOOPS, 1000);
  assert.equal(BUDGET_LOOPS, AUDIT_LOOPS);
  assert.match(PROBE, new RegExp(`const LOOP_ITERATIONS = ${AUDIT_LOOPS};`));
});

test('the count and the audit read every spelling of an iteration count alike', () => {
  const cases: [string, boolean][] = [
    ['spin 1s linear infinite', true],
    ['INFINITE', true],
    ['spin 1s 1001', true],
    ['1e6', true],
    ['1E+4', true],
    ['5000.5', true],
    ['.5e4', true],
    ['spin 1s 1000', false],
    ['3', false],
    ['1e3', false],
    ['spin 1s both', false],
    ['spin-infinite 1s', false],
  ];
  for (const [value, expected] of cases) {
    assert.equal(auditLoops(value), expected, `audit: ${value}`);
    assert.equal(budgetLoops(value), expected, `count: ${value}`);
  }
});
