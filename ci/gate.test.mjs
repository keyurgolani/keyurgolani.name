import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateNeeds, renderGateSummary } from './gate.mjs';

const needs = (results) =>
  Object.fromEntries(
    Object.entries(results).map(([job, result]) => [job, { result, outputs: {} }]),
  );

test('passes when every needed job succeeded', () => {
  const verdict = evaluateNeeds(needs({ static: 'success', unit: 'success', image: 'success' }));
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.failed, []);
});

for (const result of ['failure', 'cancelled', 'skipped']) {
  test(`fails when a needed job finished as ${result}`, () => {
    const verdict = evaluateNeeds(needs({ static: 'success', unit: result }));
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.failed, [{ job: 'unit', result }]);
  });
}

test('fails when a job reports no result', () => {
  assert.equal(evaluateNeeds({ unit: {} }).ok, false);
});

test('fails when it needs no jobs at all', () => {
  assert.equal(evaluateNeeds({}).ok, false);
  assert.equal(evaluateNeeds(undefined).ok, false);
});

test('the summary lists every job and its result', () => {
  const summary = renderGateSummary(evaluateNeeds(needs({ unit: 'failure', static: 'success' })));
  assert.match(summary, /### gate: failed/);
  assert.match(summary, /\| static \| success \|/);
  assert.match(summary, /\| unit \| failure \|/);
});
