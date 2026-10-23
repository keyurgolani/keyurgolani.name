// The release candidate's refusal, on fixture API responses
// (ci/release/fixtures/): the compare API's answer for the commit against
// main, ci.yml's runs on it, and their jobs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { candidateRuns, evaluateRc, gatePassed, onMain } from './verify-rc.mjs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const SHA = '1'.repeat(40);
const RUNS = fixture('ci-runs').workflow_runs;
const PASSED = fixture('ci-jobs-gate-passed').jobs;
const FAILED = fixture('ci-jobs-gate-failed').jobs;

const input = (overrides = {}) => ({
  tag: 'v1.2.0-rc.1',
  sha: SHA,
  compare: fixture('compare-ahead'),
  runs: RUNS,
  jobsByRun: { 105: PASSED },
  ...overrides,
});

test('a candidate on main with a green complete ci run is eligible', () => {
  const verdict = evaluateRc(input());
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.run.id, 105);
  // main's tip itself is on main too.
  assert.equal(evaluateRc(input({ compare: fixture('compare-identical') })).ok, true);
});

test('a candidate whose commit is not on main is refused', () => {
  for (const name of ['compare-diverged', 'compare-behind']) {
    const verdict = evaluateRc(input({ compare: fixture(name) }));
    assert.equal(verdict.ok, false, name);
    assert.equal(verdict.reasons.length, 1);
    assert.match(verdict.reasons[0], /is not on main/);
  }
  // ahead, but from another merge base, is not on main either.
  const forged = { ...fixture('compare-ahead'), merge_base_commit: { sha: '2'.repeat(40) } };
  assert.equal(onMain(SHA, forged), false);
  assert.equal(onMain(SHA, undefined), false);
});

test('a candidate without a green complete ci run is refused', () => {
  // The only push run on main for the commit that succeeded has a failed gate.
  let verdict = evaluateRc(input({ jobsByRun: { 105: FAILED } }));
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons.join(), /no green complete ci run/);
  // No jobs read for it at all.
  verdict = evaluateRc(input({ jobsByRun: {} }));
  assert.equal(verdict.ok, false);
  // A PR run, a failed run, another workflow, and another commit never count,
  // even with gate passing in every one of them.
  const others = RUNS.filter((run) => run.id !== 105);
  verdict = evaluateRc(
    input({
      runs: others,
      jobsByRun: Object.fromEntries(others.map((run) => [run.id, PASSED])),
    }),
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons.join(), /no green complete ci run/);
});

test('both refusals are reported together', () => {
  const verdict = evaluateRc(input({ compare: fixture('compare-diverged'), jobsByRun: {} }));
  assert.equal(verdict.reasons.length, 2);
});

test('only an RC tag on a full SHA is checked', () => {
  assert.match(evaluateRc(input({ tag: 'v1.2.0' })).reasons.join(), /not a vX\.Y\.Z-rc\.N tag/);
  const short = evaluateRc(input({ sha: '1111111' }));
  assert.equal(short.ok, false);
  assert.match(short.reasons.join(), /not a full commit SHA/);
});

test('candidate runs are ci.yml push runs on main for the exact commit that succeeded', () => {
  assert.deepEqual(
    candidateRuns(SHA, RUNS).map((run) => run.id),
    [105],
  );
  assert.equal(gatePassed(PASSED), true);
  assert.equal(gatePassed(FAILED), false);
  assert.equal(gatePassed([{ name: 'selected', conclusion: 'success' }]), false);
});
