// Structural checks on .github/workflows/release.yml that actionlint,
// zizmor, and #11's static workflow check don't make: its triggers, who
// holds which write permission, that the dry run never reaches GHCR or a
// secret, that nothing reads a cache, and that only promotion moves latest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const SOURCE = readFileSync(
  new URL('../../.github/workflows/release.yml', import.meta.url),
  'utf8',
);
const WORKFLOW = parse(SOURCE);
const JOBS = WORKFLOW.jobs;
const TAG_IF =
  /^\$\{\{ github\.ref_type == 'tag'( && needs\.classify\.outputs\.kind == '(rc|final)')? \}\}$/;
const RC_JOBS = ['rc-verify', 'rc-build', 'rc-scan', 'rc-tag', 'rc-release'];
const FINAL_JOBS = ['promote-verify', 'promote-scan', 'promote', 'promote-release'];
const stepsOf = (id) => JOBS[id].steps ?? [];
const uses = (id, action) => stepsOf(id).filter((s) => (s.uses ?? '').startsWith(`${action}@`));
const writes = (job) =>
  Object.entries(job.permissions ?? {})
    .filter(([, level]) => level === 'write')
    .map(([scope]) => scope)
    .sort();

test('release runs on v* tag pushes and on pull requests, with no manual trigger', () => {
  assert.deepEqual(Object.keys(WORKFLOW.on).sort(), ['pull_request', 'push']);
  assert.deepEqual(WORKFLOW.on.push, { tags: ['v[0-9]*'] });
  assert.ok(!('branches' in WORKFLOW.on.push), 'no branch push publishes');
  assert.ok(!('workflow_dispatch' in WORKFLOW.on));
  assert.doesNotMatch(SOURCE, /workflow_dispatch|workflow_call|pull_request_target|workflow_run/);
  assert.deepEqual(WORKFLOW.on.pull_request.branches, ['main', 'next']);
  for (const path of [
    '.github/workflows/release.yml',
    'ci/release/**',
    'Dockerfile',
    '.dockerignore',
    '.grype.yaml',
    'pnpm-lock.yaml',
  ]) {
    assert.ok(WORKFLOW.on.pull_request.paths.includes(path), path);
  }
});

test('the workflow token is contents: read, and each write is a tag-gated job of its own', () => {
  assert.deepEqual(WORKFLOW.permissions, { contents: 'read' });
  const holders = Object.fromEntries(
    Object.entries(JOBS)
      .filter(([, job]) => writes(job).length > 0)
      .map(([id, job]) => [id, writes(job)]),
  );
  assert.deepEqual(holders, {
    'rc-build': ['attestations', 'id-token', 'packages'],
    'rc-tag': ['packages'],
    'rc-release': ['contents'],
    promote: ['packages'],
    'promote-release': ['contents'],
  });
  for (const id of Object.keys(JOBS)) {
    if (id === 'dry-run') continue;
    assert.match(JOBS[id].if, TAG_IF, `${id} runs on tag pushes only`);
  }
  for (const id of RC_JOBS) assert.match(JOBS[id].if, /kind == 'rc'/, id);
  for (const id of FINAL_JOBS) assert.match(JOBS[id].if, /kind == 'final'/, id);
});

test('the dry run holds contents: read, no secret, and never reaches GHCR', () => {
  const job = JOBS['dry-run'];
  assert.equal(job.if, "${{ github.event_name == 'pull_request' }}");
  assert.equal(job.permissions, undefined, "it keeps the workflow's contents: read");
  const text = JSON.stringify(job);
  assert.doesNotMatch(text, /secrets\.|github\.token|GITHUB_TOKEN|GH_TOKEN/);
  assert.doesNotMatch(text, /ghcr\.io/);
  assert.deepEqual(uses('dry-run', 'docker/login-action'), []);
  assert.deepEqual(uses('dry-run', 'actions/attest-build-provenance'), []);
  assert.doesNotMatch(text, /gh release|gh attestation/);
  // Its registry is the service on the runner, published on loopback only.
  assert.equal(job.env.IMAGE, 'localhost:5000/portfolio');
  assert.match(job.services.registry.image, /^registry:2\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
  assert.deepEqual(job.services.registry.ports, ['127.0.0.1:5000:5000']);
  // The workflow's env names no secret either.
  assert.doesNotMatch(JSON.stringify(WORKFLOW.env), /secrets/);
});

test('every build is one multi-arch push by digest with mode=max provenance and an SBOM', () => {
  for (const id of ['dry-run', 'rc-build']) {
    const builds = uses(id, 'docker/build-push-action');
    assert.equal(builds.length, 1, `${id} builds once`);
    const { with: input } = builds[0];
    assert.equal(input.platforms, '${{ env.PLATFORMS }}');
    assert.equal(input.provenance, 'mode=max');
    assert.equal(input.sbom, true);
    assert.match(input.outputs, /push-by-digest=true/);
    assert.doesNotMatch(input.outputs, /:[\w.-]+,|tags=/, 'no tag at build time');
    assert.equal(input.tags, undefined);
    assert.equal(input['cache-from'], undefined);
    assert.equal(input['cache-to'], undefined);
  }
  assert.equal(WORKFLOW.env.PLATFORMS, 'linux/amd64,linux/arm64');
  const attest = uses('rc-build', 'actions/attest-build-provenance');
  assert.equal(attest.length, 1);
  assert.equal(attest[0].with['subject-digest'], '${{ steps.build.outputs.digest }}');
  // Nothing else builds an image.
  for (const id of Object.keys(JOBS)) {
    if (id === 'dry-run' || id === 'rc-build') continue;
    assert.deepEqual(uses(id, 'docker/build-push-action'), [], id);
    assert.doesNotMatch(JSON.stringify(JOBS[id]), /docker (build|push) |buildx build /, id);
  }
});

test('no release job reads or writes a cache', () => {
  for (const [id, job] of Object.entries(JOBS)) {
    for (const step of job.steps) {
      const action = (step.uses ?? '').split('@')[0];
      assert.doesNotMatch(action, /^actions\/cache/, id);
      assert.ok(
        !action.startsWith('./'),
        `${id} uses no local action, the shared install's cache included`,
      );
      if (action === 'actions/setup-node')
        assert.equal(step.with['package-manager-cache'], false, id);
      if (action === 'docker/setup-buildx-action')
        assert.equal(step.with['cache-binary'], false, id);
      if (action === 'docker/setup-qemu-action') assert.equal(step.with['cache-image'], false, id);
    }
  }
  assert.doesNotMatch(JSON.stringify(WORKFLOW), /cache-from|cache-to|type=gha|actions\/cache/);
});

test('only promote moves latest, one at a time, through targets it reads again just before', () => {
  const retags = Object.entries(JOBS)
    .filter(([, job]) => job.steps.some((s) => /ci\/release\/retag\.mjs/.test(s.run ?? '')))
    .map(([id]) => id)
    .sort();
  assert.deepEqual(retags, ['dry-run', 'promote', 'rc-tag']);
  const step = (id) => stepsOf(id).find((s) => /retag\.mjs/.test(s.run ?? ''));
  const steps = stepsOf('promote');
  const recheck = steps.findIndex((s) => s.id === 'targets');
  assert.match(steps[recheck].run, /node ci\/release\/tags\.mjs --targets/);
  assert.equal(recheck, steps.indexOf(step('promote')) - 1, 'read right before the retag');
  assert.equal(step('promote').env.TARGETS, '${{ steps.targets.outputs.targets }}');
  assert.equal(uses('promote', 'actions/checkout')[0].with['fetch-depth'], 0, 'it sees every tag');
  assert.deepEqual(JOBS.promote.concurrency, {
    group: 'release-promote',
    'cancel-in-progress': false,
  });
  assert.equal(step('rc-tag').env.RC_TAG, '${{ needs.classify.outputs.rc-tag }}');
  // Of the jobs that log in to GHCR, only promote names latest or the targets.
  for (const [id, job] of Object.entries(JOBS)) {
    if (id === 'promote' || uses(id, 'docker/login-action').length === 0) continue;
    const text = JSON.stringify(job.steps);
    assert.doesNotMatch(text, /latest|outputs\.targets/, id);
  }
});

test('each step waits on the one before it', () => {
  const needs = (id) => [...(JOBS[id].needs ?? [])].sort();
  assert.deepEqual(needs('rc-verify'), ['classify']);
  assert.deepEqual(needs('rc-build'), ['classify', 'rc-verify']);
  assert.deepEqual(needs('rc-scan'), ['classify', 'rc-build']);
  assert.deepEqual(needs('rc-tag'), ['classify', 'rc-build', 'rc-scan']);
  assert.deepEqual(needs('rc-release'), ['classify', 'rc-build', 'rc-scan', 'rc-tag']);
  assert.deepEqual(needs('promote-verify'), ['classify']);
  assert.deepEqual(needs('promote-scan'), ['classify', 'promote-verify']);
  assert.deepEqual(needs('promote'), ['classify', 'promote-scan', 'promote-verify']);
  assert.deepEqual(needs('promote-release'), [
    'classify',
    'promote',
    'promote-scan',
    'promote-verify',
  ]);
  // promote-verify's names for rc-scan and rc-tag are these jobs' names.
  assert.equal(JOBS['rc-scan'].name, 'rc-scan');
  assert.equal(JOBS['rc-tag'].name, 'rc-tag');
});

test('every job sets timeout-minutes, and no checkout keeps its credentials', () => {
  for (const [id, job] of Object.entries(JOBS)) {
    assert.ok(Number.isInteger(job['timeout-minutes']) && job['timeout-minutes'] > 0, id);
    for (const step of uses(id, 'actions/checkout')) {
      assert.equal(step.with['persist-credentials'], false, id);
    }
  }
});

test('no run: block expands an expression, so no tag name or input reaches a shell as code', () => {
  for (const [id, job] of Object.entries(JOBS)) {
    for (const step of job.steps) {
      if (step.run) assert.doesNotMatch(step.run, /\$\{\{/, `${id}: ${step.name}`);
    }
  }
});

test('scan findings upload for one day only, and the logs get counts from scan-gate', () => {
  const uploads = Object.entries(JOBS).flatMap(([id, job]) =>
    job.steps
      .filter((s) => (s.uses ?? '').startsWith('actions/upload-artifact@'))
      .map((s) => ({ id, ...s.with })),
  );
  const reports = uploads.filter((u) => u.path === 'reports/');
  assert.deepEqual(reports.map((u) => u.name).sort(), [
    'reports-release-dry-run',
    'reports-release-promote-scan',
    'reports-release-scan',
  ]);
  for (const upload of reports) assert.equal(upload['retention-days'], 1, upload.name);
  // Nothing else uploads the reports directory, where Grype's JSON goes.
  for (const upload of uploads) {
    if (upload.path !== 'reports/') assert.doesNotMatch(upload.path, /^reports/, upload.name);
  }
  for (const [id, job] of Object.entries(JOBS)) {
    for (const step of job.steps) {
      const run = step.run ?? '';
      // Grype writes its JSON under $REPORTS and prints nothing else.
      for (const call of run.match(/^\s*grype .*$/gm) ?? []) {
        assert.match(call, /^\s*grype -q /, `${id}: ${call}`);
        assert.match(call, /--file "\$REPORTS\//, `${id}: ${call}`);
      }
      // Every verdict writes its full report to the one-day directory.
      for (const call of run.match(/scan-gate\.mjs (image|deps) .*$/gm) ?? []) {
        assert.match(call, /--report="\$REPORTS\//, `${id}: ${call}`);
      }
    }
  }
});

test('release tags can be created only by an admin, and by nobody moved or deleted', () => {
  const ruleset = (name) =>
    JSON.parse(
      readFileSync(new URL(`../../.github/rulesets/${name}.json`, import.meta.url), 'utf8'),
    );
  const tags = ruleset('release-tags');
  const creation = ruleset('release-tag-creation');
  for (const set of [tags, creation]) {
    assert.equal(set.target, 'tag');
    assert.equal(set.enforcement, 'active');
    assert.deepEqual(set.conditions.ref_name.include, ['refs/tags/v[0-9]*']);
  }
  // The rules that keep a tag fixed have no bypass at all.
  assert.deepEqual(tags.bypass_actors, []);
  assert.deepEqual(tags.rules.map((r) => r.type).sort(), [
    'deletion',
    'non_fast_forward',
    'update',
  ]);
  // Creation is its own ruleset, so its admin bypass reaches no other rule.
  assert.deepEqual(creation.rules, [{ type: 'creation' }]);
  assert.deepEqual(creation.bypass_actors, [
    { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' },
  ]);
});

test('every setup-buildx pins its buildx version, and no build uploads a build record', () => {
  const buildx = Object.keys(JOBS).flatMap((id) => uses(id, 'docker/setup-buildx-action'));
  assert.ok(buildx.length >= 4);
  for (const step of buildx) assert.match(step.with.version, /^v\d+\.\d+\.\d+$/);
  assert.equal(new Set(buildx.map((s) => s.with.version)).size, 1);
  for (const id of ['dry-run', 'rc-build']) {
    for (const step of uses(id, 'docker/build-push-action')) {
      assert.equal(step.env.DOCKER_BUILD_RECORD_UPLOAD, 'false', id);
    }
  }
});
