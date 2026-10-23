// Promotion's refusal, on fixture API responses (ci/release/fixtures/) and
// fixture `git for-each-ref` output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { candidatesFor, evaluatePromotion, parseTagRefs, passedRuns } from './promote-check.mjs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const SHA = '1'.repeat(40);
const OTHER = '2'.repeat(40);
const TAG_OBJECT = '3'.repeat(40);
const RUNS = fixture('release-runs').workflow_runs;
const PASSED = fixture('release-jobs-passed').jobs;

// rc.1 lightweight and rc.2 annotated, both on SHA; v1.1.0 already out.
const REFS = [
  `v1.1.0 ${OTHER} `,
  `v1.2.0-rc.1 ${SHA} `,
  `v1.2.0-rc.2 ${TAG_OBJECT} ${SHA}`,
  'not-a-ref',
].join('\n');

const input = (overrides = {}) => ({
  tag: 'v1.2.0',
  sha: SHA,
  tagRefs: parseTagRefs(REFS),
  runs: RUNS,
  jobsByRun: { 202: PASSED },
  ...overrides,
});

test('a tag ref resolves to its commit, peeled when the tag is annotated', () => {
  assert.deepEqual(parseTagRefs(REFS), [
    { tag: 'v1.1.0', commit: OTHER },
    { tag: 'v1.2.0-rc.1', commit: SHA },
    { tag: 'v1.2.0-rc.2', commit: SHA },
  ]);
});

test('the newest candidate on this commit with a passed scan is promoted', () => {
  const verdict = evaluatePromotion(input());
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.candidate, 'v1.2.0-rc.2');
  assert.deepEqual(verdict.targets, ['1.2.0', '1.2', '1', 'latest']);
});

test('promotion is refused with no candidate for the version', () => {
  const verdict = evaluatePromotion(input({ tag: 'v1.3.0' }));
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons.join(), /no release candidate exists for 1\.3\.0/);
  assert.deepEqual(verdict.targets, []);
});

test('promotion is refused when the newest candidate is on another commit', () => {
  const refs = [...parseTagRefs(REFS), { tag: 'v1.2.0-rc.3', commit: OTHER }];
  const verdict = evaluatePromotion(input({ tagRefs: refs }));
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons.join(), /newest candidate, v1\.2\.0-rc\.3, is on 2{40}/);
});

test('promotion is refused unless the candidate passed its scan', () => {
  // rc-scan skipped, so the run's success doesn't count.
  let verdict = evaluatePromotion(
    input({ jobsByRun: { 202: fixture('release-jobs-scan-skipped').jobs } }),
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons.join(), /v1\.2\.0-rc\.2 has no passed release run/);
  // No jobs read.
  verdict = evaluatePromotion(input({ jobsByRun: {} }));
  assert.equal(verdict.ok, false);
  // Only rc.1's failed run and runs from another event or workflow.
  verdict = evaluatePromotion(
    input({
      runs: RUNS.filter((run) => run.id !== 202),
      jobsByRun: { 201: PASSED, 203: PASSED, 204: PASSED },
    }),
  );
  assert.equal(verdict.ok, false);
  // An older candidate's passed run doesn't stand in for the newest one's.
  const older = RUNS.map((run) => (run.id === 202 ? { ...run, head_branch: 'v1.2.0-rc.1' } : run));
  verdict = evaluatePromotion(input({ runs: older }));
  assert.equal(verdict.ok, false);
});

test('only a final tag is promoted', () => {
  assert.match(
    evaluatePromotion(input({ tag: 'v1.2.0-rc.2' })).reasons.join(),
    /not a vX\.Y\.Z tag/,
  );
});

test('candidates are the RC tags for the version, newest first', () => {
  const refs = [
    { tag: 'v1.2.0-rc.2', commit: SHA },
    { tag: 'v1.2.0-rc.10', commit: SHA },
    { tag: 'v1.2.1-rc.1', commit: SHA },
    { tag: 'v1.2.0', commit: SHA },
  ];
  assert.deepEqual(
    candidatesFor('1.2.0', refs).map((ref) => ref.tag),
    ['v1.2.0-rc.10', 'v1.2.0-rc.2'],
  );
  assert.deepEqual(
    passedRuns('v1.2.0-rc.2', SHA, RUNS, { 202: PASSED }).map((run) => run.id),
    [202],
  );
});

test("each way the candidate's run can miss refuses promotion on its own", () => {
  const good = RUNS.find((run) => run.id === 202);
  const variants = {
    'a run on another head_sha': { head_sha: OTHER },
    'a pull_request run': { event: 'pull_request' },
    'a run of another workflow': { path: '.github/workflows/ci.yml' },
    'a run that has not completed': { status: 'in_progress' },
    'a run that did not succeed': { conclusion: 'failure' },
    "another candidate's run": { head_branch: 'v1.2.0-rc.1' },
  };
  assert.equal(evaluatePromotion(input({ runs: [good] })).ok, true);
  for (const [label, change] of Object.entries(variants)) {
    const verdict = evaluatePromotion(input({ runs: [{ ...good, ...change }] }));
    assert.equal(verdict.ok, false, label);
    assert.match(verdict.reasons.join(), /has no passed release run/, label);
  }
});
