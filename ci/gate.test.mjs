import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateGate,
  evaluateNeeds,
  evaluateSelected,
  renderGateSummary,
  selectionOf,
} from './gate.mjs';

const needs = (results) =>
  Object.fromEntries(
    Object.entries(results).map(([job, result]) => [job, { result, outputs: {} }]),
  );

const run = ({ complete, jobs, changes = 'success' }, results) => ({
  changes: {
    result: changes,
    outputs:
      changes === 'success' ? { complete: String(complete), jobs: JSON.stringify(jobs) } : {},
  },
  ...needs(results),
});

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

test('gate passes a complete run where every job succeeded', () => {
  const verdict = evaluateGate(
    run({ complete: true, jobs: ['static', 'unit'] }, { static: 'success', unit: 'success' }),
  );
  assert.equal(verdict.ok, true, verdict.reason);
});

test('gate fails a selected run even when every selected job passed', () => {
  const verdict = evaluateGate(
    run({ complete: false, jobs: ['static'] }, { static: 'success', unit: 'skipped' }),
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /complete run/);
  assert.match(renderGateSummary(verdict), /marked ready for review/);
});

test('gate fails a selected run that ran everything but was not reported complete', () => {
  const verdict = evaluateGate(
    run({ complete: false, jobs: ['static', 'unit'] }, { static: 'success', unit: 'success' }),
  );
  assert.equal(verdict.ok, false);
});

test('gate fails a complete run with a skipped, failed, or timed-out job', () => {
  for (const result of ['skipped', 'failure', 'cancelled']) {
    const verdict = evaluateGate(
      run({ complete: true, jobs: ['static', 'unit'] }, { static: 'success', unit: result }),
    );
    assert.equal(verdict.ok, false, result);
  }
});

test('gate fails a complete run whose selection left out a needed job', () => {
  const verdict = evaluateGate(
    run({ complete: true, jobs: ['static'] }, { static: 'success', unit: 'success' }),
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /left out unit/);
});

test('gate and selected fail when changes failed or reported nothing readable', () => {
  const broken = [
    run({ changes: 'failure' }, { static: 'skipped' }),
    {
      changes: { result: 'success', outputs: { complete: 'true', jobs: 'not json' } },
      ...needs({ static: 'success' }),
    },
    {
      changes: { result: 'success', outputs: { complete: 'true', jobs: '{}' } },
      ...needs({ static: 'success' }),
    },
    needs({ static: 'success' }),
  ];
  for (const input of broken) {
    assert.equal(selectionOf(input), null);
    assert.equal(evaluateGate(input).ok, false);
    assert.equal(evaluateSelected(input).ok, false);
  }
});

test('selected passes when the selected jobs succeeded and the rest were skipped', () => {
  const verdict = evaluateSelected(
    run(
      { complete: false, jobs: ['static', 'docs'] },
      {
        static: 'success',
        docs: 'success',
        unit: 'skipped',
        // A job with no selection condition runs anyway; success is fine.
        other: 'success',
      },
    ),
  );
  assert.equal(verdict.ok, true);
});

test('selected fails a selected job that was skipped, and any job that failed', () => {
  assert.equal(
    evaluateSelected(run({ complete: false, jobs: ['static'] }, { static: 'skipped' })).ok,
    false,
  );
  assert.equal(
    evaluateSelected(
      run({ complete: false, jobs: ['static'] }, { static: 'success', unit: 'failure' }),
    ).ok,
    false,
  );
  assert.equal(
    evaluateSelected(
      run({ complete: false, jobs: ['static'] }, { static: 'success', unit: 'cancelled' }),
    ).ok,
    false,
  );
});
