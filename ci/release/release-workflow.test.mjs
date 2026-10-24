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
const RC_JOBS = [
  'rc-verify',
  'rc-quality-plan',
  'rc-quality',
  'rc-quality-verdict',
  'rc-rehearsal',
  'rc-build',
  'rc-merge',
  'rc-scan',
  'rc-tag',
  'rc-release',
];
const FINAL_JOBS = ['promote-verify', 'promote-scan', 'promote', 'promote-release'];
const DRY_RUN_JOBS = ['dry-run-build', 'dry-run'];
// Each platform's build leg, and the job that merges the two legs' indexes.
const BUILD_JOBS = { 'dry-run-build': 'dry-run', 'rc-build': 'rc-merge' };
const LEGS = [
  { arch: 'amd64', runner: 'ubuntu-24.04' },
  { arch: 'arm64', runner: 'ubuntu-24.04-arm' },
];
const stepsOf = (id) => JOBS[id].steps ?? [];
const uses = (id, action) => stepsOf(id).filter((s) => (s.uses ?? '').startsWith(`${action}@`));
const writes = (job) =>
  Object.entries(job.permissions ?? {})
    .filter(([, level]) => level === 'write')
    .map(([scope]) => scope)
    .sort();

test('release runs on v[0-9]* tag pushes and on pull requests, with no manual trigger', () => {
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
    'rc-build': ['packages'],
    'rc-merge': ['attestations', 'id-token', 'packages'],
    'rc-tag': ['packages'],
    'rc-release': ['contents'],
    promote: ['packages'],
    'promote-release': ['contents'],
  });
  for (const id of Object.keys(JOBS)) {
    if (DRY_RUN_JOBS.includes(id)) continue;
    assert.match(JOBS[id].if, TAG_IF, `${id} runs on tag pushes only`);
  }
  for (const id of RC_JOBS) assert.match(JOBS[id].if, /kind == 'rc'/, id);
  for (const id of FINAL_JOBS) assert.match(JOBS[id].if, /kind == 'final'/, id);
});

test('the dry run holds contents: read, no secret, and never reaches GHCR', () => {
  assert.equal(JOBS['dry-run-build'].if, "${{ github.event_name == 'pull_request' }}");
  // After a failed leg too: Grype still installs, and the dependency scan
  // still reports.
  assert.deepEqual(JOBS['dry-run'].needs, ['dry-run-build']);
  assert.equal(JOBS['dry-run'].if, "${{ !cancelled() && github.event_name == 'pull_request' }}");
  const step = (name) => stepsOf('dry-run').find((s) => s.name === name);
  assert.equal(step('Install Grype').if, '${{ !cancelled() }}');
  assert.match(step('Scan the production dependencies against the base').if, /!cancelled\(\)/);
  for (const id of DRY_RUN_JOBS) {
    const text = JSON.stringify(JOBS[id]);
    assert.equal(JOBS[id].permissions, undefined, `${id} keeps the workflow's contents: read`);
    assert.doesNotMatch(text, /secrets\.|github\.token|GITHUB_TOKEN|GH_TOKEN/, id);
    assert.doesNotMatch(text, /ghcr\.io/, id);
    assert.deepEqual(uses(id, 'docker/login-action'), [], id);
    assert.deepEqual(uses(id, 'actions/attest-build-provenance'), [], id);
    assert.doesNotMatch(text, /gh release|gh attestation/, id);
  }
  // The legs hand over their OCI layouts as one-day artifacts.
  const [layout] = uses('dry-run-build', 'actions/upload-artifact');
  assert.equal(layout.with.name, 'oci-dry-run-${{ matrix.arch }}');
  assert.equal(layout.with['retention-days'], 1);
  assert.equal(uses('dry-run', 'actions/download-artifact')[0].with.pattern, 'oci-dry-run-*');
  assert.equal(JOBS['dry-run-build'].services, undefined, 'the legs need no registry');
  // Its registry is the service on the runner, published on loopback only.
  const job = JOBS['dry-run'];
  assert.equal(job.env.IMAGE, 'localhost:5000/portfolio');
  assert.match(job.services.registry.image, /^registry:2\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
  assert.deepEqual(job.services.registry.ports, ['127.0.0.1:5000:5000']);
  // The workflow's env names no secret either.
  assert.doesNotMatch(JSON.stringify(WORKFLOW.env), /secrets/);
});

test("the candidate's quality gate holds contents: read and no secret, and rc-tag waits on it", () => {
  for (const id of ['rc-quality-plan', 'rc-quality', 'rc-quality-verdict']) {
    assert.equal(JOBS[id].permissions, undefined, `${id} keeps the workflow's contents: read`);
    assert.doesNotMatch(
      JSON.stringify(JOBS[id]),
      /secrets\.|github\.token|GITHUB_TOKEN|GH_TOKEN/,
      id,
    );
    assert.deepEqual(uses(id, 'docker/login-action'), [], id);
  }
  // tests/quality/full-shards.test.ts holds its shards, timeout, and commands.
  assert.ok(JOBS['rc-tag'].needs.includes('rc-quality-verdict'));
});

test('each platform builds once, natively on its own runner, with mode=max provenance and an SBOM', () => {
  for (const id of Object.keys(BUILD_JOBS)) {
    const job = JOBS[id];
    assert.deepEqual(job.strategy.matrix, { include: LEGS }, id);
    assert.equal(job['runs-on'], '${{ matrix.runner }}', id);
    const builds = uses(id, 'docker/build-push-action');
    assert.equal(builds.length, 1, `${id} builds once`);
    const { with: input } = builds[0];
    assert.equal(input.platforms, 'linux/${{ matrix.arch }}', "one platform, the runner's own");
    assert.equal(input.provenance, 'mode=max');
    assert.equal(input.sbom, true);
    assert.doesNotMatch(input.outputs, /:[\w.-]+,|tags=/, 'no tag at build time');
    assert.equal(input.tags, undefined);
    assert.equal(input['cache-from'], undefined);
    assert.equal(input['cache-to'], undefined);
    // Each leg hands its digest on under its own name.
    assert.deepEqual(job.outputs, {
      'digest-amd64': '${{ steps.digest.outputs.digest-amd64 }}',
      'digest-arm64': '${{ steps.digest.outputs.digest-arm64 }}',
    });
    const record = stepsOf(id).find((s) => s.id === 'digest');
    assert.equal(record.env.DIGEST, '${{ steps.build.outputs.digest }}');
    assert.equal(record.run, 'echo "digest-$ARCH=$DIGEST" >> "$GITHUB_OUTPUT"');
  }
  // The candidate's legs push to GHCR by digest; the dry run's write layouts.
  assert.match(uses('rc-build', 'docker/build-push-action')[0].with.outputs, /push-by-digest=true/);
  assert.equal(
    uses('dry-run-build', 'docker/build-push-action')[0].with.outputs,
    'type=oci,dest=${{ runner.temp }}/oci,tar=false',
  );
  assert.equal(WORKFLOW.env.PLATFORMS, 'linux/amd64,linux/arm64');
  // Nothing else builds an image, but rc-rehearsal's local one of the
  // tagged commit, which it never pushes (its own test, below).
  for (const id of Object.keys(JOBS)) {
    if (id in BUILD_JOBS || id === 'rc-rehearsal') continue;
    assert.deepEqual(uses(id, 'docker/build-push-action'), [], id);
    assert.doesNotMatch(JSON.stringify(JOBS[id]), /docker (build|push) |buildx build /, id);
  }
});

test('no job emulates a platform: QEMU is gone', () => {
  assert.doesNotMatch(SOURCE, /setup-qemu-action|binfmt|qemu/i);
});

test('the merge job merges both legs by digest, then checks and attests the merged index', () => {
  for (const [leg, id] of Object.entries(BUILD_JOBS)) {
    assert.ok(JOBS[id].needs.includes(leg), `${id} needs ${leg}`);
    const steps = stepsOf(id);
    const merge = steps.findIndex((s) => s.id === 'merge');
    assert.ok(merge >= 0, id);
    assert.equal(steps[merge].env.AMD64, `\${{ needs.${leg}.outputs.digest-amd64 }}`);
    assert.equal(steps[merge].env.ARM64, `\${{ needs.${leg}.outputs.digest-arm64 }}`);
    assert.match(
      steps[merge].run,
      /^node ci\/release\/merge-index\.mjs "\$IMAGE" "\$AMD64" "\$ARM64"$/m,
    );
    // The merge runs on buildx's pinned imagetools, as every setup-buildx.
    const buildx = steps.findIndex((s) => /^docker\/setup-buildx-action@/.test(s.uses ?? ''));
    assert.ok(buildx >= 0 && buildx < merge, `${id} sets up buildx before the merge`);
    // The provenance and SBOM check reads the merged index.
    const check = steps.find((s) => /attestations\.mjs/.test(s.run ?? ''));
    assert.ok(steps.indexOf(check) > merge, id);
    assert.equal(check.env.DIGEST, '${{ steps.merge.outputs.digest }}', id);
    assert.equal(JOBS[id].env?.DIGEST, undefined, id);
  }
  assert.deepEqual(JOBS['rc-merge'].outputs, { digest: '${{ steps.merge.outputs.digest }}' });
  // The attestation is on the merged digest, and only there.
  const attests = Object.keys(JOBS).flatMap((id) =>
    uses(id, 'actions/attest-build-provenance').map((s) => ({ id, ...s.with })),
  );
  assert.equal(attests.length, 1);
  assert.equal(attests[0].id, 'rc-merge');
  assert.equal(attests[0]['subject-digest'], '${{ steps.merge.outputs.digest }}');
  // Everything after the merge takes the merged digest.
  assert.equal(JOBS['rc-scan'].env.DIGEST, '${{ needs.rc-merge.outputs.digest }}');
  for (const id of ['rc-tag', 'rc-release']) {
    const digests = stepsOf(id)
      .map((s) => s.env?.DIGEST)
      .filter(Boolean);
    assert.deepEqual(digests, ['${{ needs.rc-merge.outputs.digest }}'], id);
  }
  assert.doesNotMatch(SOURCE, /needs\.rc-build\.outputs\.digest[^-]/);
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
  assert.deepEqual(needs('rc-merge'), ['classify', 'rc-build']);
  assert.deepEqual(needs('rc-scan'), ['classify', 'rc-merge']);
  assert.deepEqual(needs('rc-quality-plan'), ['classify', 'rc-verify']);
  assert.deepEqual(needs('rc-quality'), ['classify', 'rc-quality-plan']);
  assert.deepEqual(needs('rc-quality-verdict'), ['classify', 'rc-quality', 'rc-quality-plan']);
  assert.deepEqual(needs('rc-rehearsal'), ['classify', 'rc-verify']);
  assert.deepEqual(needs('rc-tag'), [
    'classify',
    'rc-merge',
    'rc-quality-verdict',
    'rc-rehearsal',
    'rc-scan',
  ]);
  assert.deepEqual(needs('rc-release'), ['classify', 'rc-merge', 'rc-scan', 'rc-tag']);
  assert.deepEqual(needs('dry-run'), ['dry-run-build']);
  assert.deepEqual(needs('promote-verify'), ['classify']);
  assert.deepEqual(needs('promote-scan'), ['classify', 'promote-verify']);
  assert.deepEqual(needs('promote'), ['classify', 'promote-scan', 'promote-verify']);
  assert.deepEqual(needs('promote-release'), [
    'classify',
    'promote',
    'promote-scan',
    'promote-verify',
  ]);
  // promote-verify's names for rc-scan, rc-quality-verdict, and rc-tag are these jobs' names.
  assert.equal(JOBS['rc-scan'].name, 'rc-scan');
  assert.equal(JOBS['rc-quality-verdict'].name, 'rc-quality-verdict');
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

test('each image build has its own 25-minute timeout, inside the job timeout', () => {
  for (const id of Object.keys(BUILD_JOBS)) {
    const [build] = uses(id, 'docker/build-push-action');
    assert.equal(build.id, 'build', id);
    assert.equal(build['timeout-minutes'], 25, id);
    assert.ok(JOBS[id]['timeout-minutes'] > build['timeout-minutes'], id);
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
  // The quality gate's shards and verdict, which keep the release's one day too.
  assert.deepEqual(reports.map((u) => u.name).sort(), [
    'reports-quality-release-${{ matrix.shard }}',
    'reports-quality-release-verdict',
    'reports-release-dry-run',
    'reports-release-promote-scan',
    'reports-release-rehearsal',
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

test('every step that runs grype runs under a condition that also installs it', () => {
  // How far past a failed step a condition still runs: no if: is success(),
  // then !cancelled(), then always().
  const reach = (cond = '') => (/always\(\)/.test(cond) ? 2 : /!cancelled\(\)/.test(cond) ? 1 : 0);
  const BARE = [undefined, '${{ !cancelled() }}', '${{ always() }}'];
  let scans = 0;
  for (const [id, job] of Object.entries(JOBS)) {
    const steps = job.steps ?? [];
    const install = steps.findIndex((s) => /install-grype\.mjs/.test(s.run ?? ''));
    for (const [index, step] of steps.entries()) {
      if (!/^\s*grype /m.test(step.run ?? '')) continue;
      scans += 1;
      const where = `${id}: ${step.name}`;
      assert.ok(install !== -1 && install < index, `${where} has no Grype installed before it`);
      const installIf = steps[install].if;
      // A bare status check: an extra condition could skip the install
      // when the scan still runs.
      assert.ok(BARE.includes(installIf), `${id}: Install Grype runs under ${installIf}`);
      assert.ok(
        reach(installIf) >= reach(step.if),
        `${where} runs under ${step.if}, but Grype installs under ${installIf ?? 'success()'}`,
      );
    }
  }
  // The image and dependency scans in the dry run and rc-scan, and
  // promote-scan's image scan.
  assert.equal(scans, 5);
});

test('an image scan never runs without the image it scans', () => {
  const scans = [];
  for (const [id, job] of Object.entries(JOBS)) {
    for (const step of job.steps ?? []) {
      const run = step.run ?? '';
      if (!run.includes('grype') || !run.includes('registry:')) continue;
      scans.push(id);
      // No if: is success(), so a failed build or digest step skips it.
      assert.equal(step.if, undefined, `${id}: ${step.name}`);
    }
  }
  assert.deepEqual(scans.sort(), ['dry-run', 'promote-scan', 'rc-scan']);
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
  for (const id of Object.keys(BUILD_JOBS)) {
    for (const step of uses(id, 'docker/build-push-action')) {
      assert.equal(step.env.DOCKER_BUILD_RECORD_UPLOAD, 'false', id);
      // buildx's metadata provenance prints the event payload in the log.
      assert.equal(step.env.BUILDX_METADATA_PROVENANCE, 'disabled', id);
    }
    // The builder that makes the image never hands BuildKit the event
    // payload, which every provenance would otherwise carry.
    const [builder] = uses(id, 'docker/setup-buildx-action');
    assert.ok(
      String(builder.with['driver-opts'])
        .split(/[\n,]/)
        .map((opt) => opt.trim())
        .includes('provenance-add-gha=false'),
      id,
    );
  }
  // The raw provenance may carry the event payload too, so it stays on the
  // runner, outside every uploaded directory.
  let inspected = 0;
  for (const [id, job] of Object.entries(JOBS)) {
    for (const step of job.steps) {
      for (const line of (step.run ?? '').match(/imagetools inspect .*\.(Provenance|SBOM) .*$/gm) ??
        []) {
        inspected += 1;
        assert.match(line, />\s*"\$RUNNER_TEMP\//, `${id}: ${line}`);
      }
    }
  }
  assert.equal(inspected, 6, 'dry-run, rc-merge, and promote-scan each read both');
});

test('rc-rehearsal rehearses an image of the tagged commit it builds itself, with no cache, push, or token', () => {
  const job = JOBS['rc-rehearsal'];
  assert.match(job.if, /kind == 'rc'/);
  assert.equal(job.permissions, undefined, "rc-rehearsal keeps the workflow's contents: read");
  const text = JSON.stringify(job);
  assert.doesNotMatch(text, /secrets\.|github\.token|GITHUB_TOKEN|GH_TOKEN|ghcr\.io/);
  assert.deepEqual(uses('rc-rehearsal', 'docker/login-action'), []);
  const build = stepsOf('rc-rehearsal').find((s) => /docker build/.test(s.run ?? ''));
  assert.ok(build, 'it builds the image');
  assert.match(build.run, /--no-cache/);
  assert.doesNotMatch(build.run, /--push|--cache-from|--cache-to/);
  assert.ok(build['timeout-minutes'] <= 25 && job['timeout-minutes'] > build['timeout-minutes']);
  const run = stepsOf('rc-rehearsal').find((s) => s.run === 'pnpm ci:rehearsal');
  assert.ok(run, 'it runs pnpm ci:rehearsal');
  assert.equal(run.env.REHEARSAL_CONTAINER, 'required', 'the container rows must run');
  assert.equal(job.env.REHEARSAL_IMAGE, 'portfolio:rehearsal');
  assert.match(build.run, /"\$REHEARSAL_IMAGE"/);
  assert.ok(JOBS['rc-tag'].needs.includes('rc-rehearsal'), 'no candidate is tagged without it');
});
