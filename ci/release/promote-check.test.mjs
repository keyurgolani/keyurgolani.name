// Promotion's refusal, on fixture API responses (ci/release/fixtures/) and
// fixture `git for-each-ref` output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readScope } from './verify-scope.mjs';
import {
  candidatesFor,
  evaluatePromotion,
  parseTagRefs,
  passedRuns,
  pendingBaselines,
  BASELINE_PENDING_FILE,
  releaseJobs,
  REQUIRED_RC_JOBS,
} from './promote-check.mjs';
import { githubList, MAX_PAGES, PAGE_SIZE } from './github.mjs';

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
  pending: [],
  quality: {
    scope: { release: '1.2.0-rc.2', scope: 'full', records: 'records.json' },
    records: [],
  },
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

test('promotion is refused unless the candidate passed its quality gate', () => {
  const jobs = fixture('release-jobs-passed').jobs.map((job) =>
    job.name === 'rc-quality-verdict' ? { ...job, conclusion: 'skipped' } : job,
  );
  const verdict = evaluatePromotion(input({ jobsByRun: { 202: jobs } }));
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons.join(), /v1\.2\.0-rc\.2 has no passed release run/);
  assert.ok(REQUIRED_RC_JOBS.includes('rc-quality-verdict'));
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

test('promotion is refused while the baseline-pending list names any composition', () => {
  const verdict = evaluatePromotion(input({ pending: ['flux', 'singular'] }));
  assert.equal(verdict.ok, false);
  assert.match(
    verdict.reasons.join(),
    /baseline-pending\.json on 1{40} still lists 2 compositions with no screenshot baselines \(flux, singular\)/,
  );
  assert.deepEqual(verdict.targets, []);
  assert.match(
    evaluatePromotion(input({ pending: ['flux'] })).reasons.join(),
    /lists 1 composition with/,
  );
  assert.match(evaluatePromotion(input({ pending: undefined })).reasons.join(), /wasn't read/);
  assert.equal(evaluatePromotion(input({ pending: [] })).ok, true);
});

test("promotion is refused while the candidate's quality scope is narrowed or its records list names a failure", () => {
  const scope = { release: '1.2.0-rc.2', scope: 'default-packs', records: 'records.json' };
  const narrowed = evaluatePromotion(input({ quality: { scope, records: [] } }));
  assert.equal(narrowed.ok, false);
  assert.deepEqual(narrowed.targets, []);
  assert.equal(
    narrowed.reasons.join(),
    `quality/release/scope.json keeps the candidate from a final release: its scope is "default-packs", not full. A final needs the full matrix clean: scope full, an empty list and no timingReported, then a new candidate. The full matrix fits the release's 256-shard matrix only once RC2's sizing item (per-test cost, then splitting the release matrix across jobs) lands, so v1.0.0 waits on it (on ${SHA})`,
  );
  const listed = evaluatePromotion(
    input({ quality: { scope: { ...scope, scope: 'full' }, records: [{ cell: 'a' }] } }),
  );
  assert.match(listed.reasons.join(), /its records list names 1 failing cell test\./);
  const both = evaluatePromotion(input({ quality: { scope, records: [{}, {}] } }));
  assert.match(both.reasons.join(), /not full, and its records list names 2 failing cell tests\./);
  // A scope that reports any timing instead of gating it can't promote either.
  const timed = evaluatePromotion(
    input({
      quality: {
        scope: { ...scope, scope: 'full', timingReported: [{ target: 'composition:flux' }] },
        records: [],
      },
    }),
  );
  assert.equal(timed.ok, false);
  assert.match(timed.reasons.join(), /its timingReported lists 1 timing reported, not gated\./);
  assert.match(evaluatePromotion(input({ quality: null })).reasons.join(), /wasn't read/);
  // The checked-in RC2 scope, on its default packs, can't promote to 1.0.0.
  const checkedIn = readScope(fileURLToPath(new URL('../../', import.meta.url)));
  assert.equal(evaluatePromotion(input({ quality: checkedIn })).ok, false);
});

test("the baseline-pending list's ids are read sorted, and only from an object", () => {
  assert.deepEqual(pendingBaselines('{"singular": {}, "flux": {}}'), ['flux', 'singular']);
  assert.deepEqual(pendingBaselines('{}'), []);
  assert.throws(() => pendingBaselines('[]'), /not an object/);
  assert.throws(() => pendingBaselines('null'), /not an object/);
  assert.throws(() => pendingBaselines('{'));
});

test('the baseline-pending list is where the release reads it, an object keyed by composition id', () => {
  // tests/variants/baseline-pending.ts reads the same path; a move breaks this.
  const text = readFileSync(new URL(`../../${BASELINE_PENDING_FILE}`, import.meta.url), 'utf8');
  assert.ok(Array.isArray(pendingBaselines(text)));
});

/** A stand-in GET for a list of `items` under `key`, served PAGE_SIZE a page, recording each route. */
function pagedGet(items, key, routes = []) {
  return async (route) => {
    routes.push(route);
    const page = Number(new URL(route, 'https://api.test').searchParams.get('page'));
    return {
      total_count: items.length,
      [key]: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    };
  };
}

test("a release run's jobs are read whole, every page: 150 jobs, rc-tag and the quality gate on page 2, still promote", async () => {
  // A release run of 142 rc-quality shards, 150 jobs in all: the shards first, the gate's jobs
  // created last.
  const shards = Array.from({ length: 142 }, (_, at) => ({
    name: `rc-quality (${at + 1}/142)`,
    conclusion: 'success',
  }));
  const jobs = [...shards, ...PASSED, { name: 'rc-smoke (amd64)', conclusion: 'success' }];
  const routes = [];
  const jobsByRun = await releaseJobs(
    '/repos/o/r',
    RUNS.filter((run) => run.id === 202),
    pagedGet(jobs, 'jobs', routes),
  );
  assert.deepEqual(routes, [
    '/repos/o/r/actions/runs/202/jobs?filter=latest&per_page=100&page=1',
    '/repos/o/r/actions/runs/202/jobs?filter=latest&per_page=100&page=2',
  ]);
  assert.equal(jobs.length, 150);
  assert.equal(jobsByRun[202].length, jobs.length);
  for (const name of REQUIRED_RC_JOBS)
    assert.ok(jobs.findIndex((job) => job.name === name) >= PAGE_SIZE, name);
  const verdict = evaluatePromotion(input({ jobsByRun }));
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.ok, true);
  // A list of exactly one full page reads one more, empty; one past the last page refuses.
  const full = Array.from({ length: PAGE_SIZE }, (_, at) => ({ id: at }));
  assert.equal((await githubList('/x', 'jobs', { get: pagedGet(full, 'jobs') })).length, PAGE_SIZE);
  const past = Array.from({ length: PAGE_SIZE * MAX_PAGES + 1 }, (_, at) => ({ id: at }));
  await assert.rejects(
    githubList('/x', 'jobs', { get: pagedGet(past, 'jobs') }),
    /lists more than 2000 jobs, so it isn't read in part/,
  );
  // A page with no list throws, never reads as empty.
  await assert.rejects(
    githubList('/x', 'jobs', { get: async () => ({}) }),
    /answered no jobs list/,
  );
});

test('no list call of rc-verify or promote-check reads one page: each runs, jobs and artifacts listing goes through githubList', () => {
  for (const file of ['verify-rc.mjs', 'promote-check.mjs']) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /githubGet\(\s*`[^`]*\/actions\/(runs|workflows)\//, file);
    assert.match(source, /githubList\(/, file);
  }
});
