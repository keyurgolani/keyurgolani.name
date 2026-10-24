// Structural checks on the workflows that pnpm check:workflows (actionlint,
// zizmor) and #11's static check don't make: what the caches hold and who
// reads them, and the scheduled workflow's timeouts and permissions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => parse(readFileSync(path.join(ROOT, file), 'utf8'));
const CI = read('.github/workflows/ci.yml');
const SCHEDULED = read('.github/workflows/scheduled.yml');
const INSTALL = read('.github/actions/install/action.yml');

const CACHE_ACTIONS = /^actions\/cache(\/restore|\/save)?@/;
const usesCache = (step) =>
  CACHE_ACTIONS.test(step.uses ?? '') ||
  (step.uses ?? '').startsWith('./.github/actions/install') ||
  (/^actions\/setup-node@/.test(step.uses ?? '') && step.with?.['package-manager-cache'] !== false);

const PUBLISH_JOBS = ['publish-build', 'publish-merge', 'publish-smoke', 'publish'];

test('publish reads no cache: no cache action, no shared install, no setup-node cache', () => {
  for (const id of PUBLISH_JOBS) {
    const steps = CI.jobs[id].steps;
    assert.ok(steps.length > 0, id);
    assert.deepEqual(
      steps.filter(usesCache).map((s) => s.name ?? s.uses),
      [],
      id,
    );
    for (const step of steps.filter((s) => /^docker\/setup-buildx-action@/.test(s.uses ?? ''))) {
      assert.equal(step.with['cache-binary'], false, id);
    }
  }
  // Nor does the Docker build pull a cache in.
  const build = CI.jobs['publish-build'].steps.find((s) =>
    /docker\/build-push-action@/.test(s.uses ?? ''),
  );
  assert.ok(build);
  assert.equal(build.with['cache-from'], undefined);
  assert.equal(build.with['cache-to'], undefined);
  // And uploads no build record, which holds the build's logs, as release.yml's legs don't.
  assert.equal(build.env.DOCKER_BUILD_RECORD_UPLOAD, 'false');
});

test('publish runs only on a push to main, and only its own jobs follow gate', () => {
  const MAIN_PUSH = "${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}";
  const after = Object.entries(CI.jobs)
    .filter(([, job]) =>
      [job.needs ?? []].flat().some((n) => PUBLISH_JOBS.includes(n) || n === 'gate'),
    )
    .map(([id]) => id);
  assert.deepEqual(after.sort(), [...PUBLISH_JOBS].sort());
  assert.deepEqual(CI.jobs['publish-build'].needs, ['gate']);
  assert.deepEqual(CI.jobs['publish-merge'].needs, ['publish-build']);
  assert.deepEqual(CI.jobs['publish-smoke'].needs, ['publish-merge']);
  assert.deepEqual(CI.jobs.publish.needs, ['publish-merge', 'publish-smoke']);
  for (const id of PUBLISH_JOBS) {
    assert.equal(CI.jobs[id].if, MAIN_PUSH, id);
  }
  for (const id of CI.jobs.gate.needs) assert.ok(!PUBLISH_JOBS.includes(id), id);
  // Write access is the publish jobs' own; every other job keeps contents: read.
  const writers = Object.entries(CI.jobs)
    .filter(([, job]) => Object.values(job.permissions ?? {}).includes('write'))
    .map(([id]) => id);
  assert.deepEqual(writers.sort(), ['publish', 'publish-build', 'publish-merge']);
  assert.deepEqual(CI.jobs['publish-build'].permissions, {
    contents: 'read',
    packages: 'write',
  });
  assert.deepEqual(CI.jobs['publish-merge'].permissions, {
    contents: 'read',
    packages: 'write',
  });
  assert.deepEqual(CI.jobs['publish-smoke'].permissions, { contents: 'read', packages: 'read' });
  assert.deepEqual(CI.jobs.publish.permissions, { contents: 'read', packages: 'write' });
  // Only the tagging job sees the Docker Hub secrets.
  for (const id of ['publish-build', 'publish-merge', 'publish-smoke']) {
    assert.doesNotMatch(JSON.stringify(CI.jobs[id]), /DOCKERHUB/, id);
  }
});

test('publish builds each platform natively, by digest, with a 25-minute step timeout', () => {
  const job = CI.jobs['publish-build'];
  const builds = job.steps.filter((s) => /^docker\/build-push-action@/.test(s.uses ?? ''));
  assert.equal(builds.length, 1);
  const [build] = builds;
  assert.equal(build['timeout-minutes'], 25);
  assert.equal(build.with.platforms, 'linux/${{ matrix.arch }}');
  assert.match(build.with.outputs, /push-by-digest=true/);
  assert.doesNotMatch(build.with.outputs, /:sha-|tags=/);
  assert.equal(build.with.tags, undefined, 'a leg pushes no tag');
  // The provenance and SBOM settings publish always had: none.
  assert.equal(build.with.provenance, false);
  assert.equal(build.with.sbom, undefined);
  assert.equal(build.env.BUILDX_METADATA_PROVENANCE, 'disabled');
  const buildx = job.steps.find((s) => /^docker\/setup-buildx-action@/.test(s.uses ?? ''));
  assert.ok(buildx.with['driver-opts'].split('\n').includes('provenance-add-gha=false'));
  assert.equal(job.outputs['digest-amd64'], '${{ steps.digest.outputs.digest-amd64 }}');
  assert.equal(job.outputs['digest-arm64'], '${{ steps.digest.outputs.digest-arm64 }}');
  // Every docker build in ci.yml has a step timeout.
  for (const [id, j] of Object.entries(CI.jobs)) {
    for (const step of (j.steps ?? []).filter((s) => /build-push-action@/.test(s.uses ?? ''))) {
      assert.ok(Number.isInteger(step['timeout-minutes']) && step['timeout-minutes'] <= 25, id);
    }
  }
});

test('only ci.yml publish-merge merges --unattested, and no release job ever does', () => {
  const RELEASE_SOURCE = readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');
  assert.doesNotMatch(RELEASE_SOURCE, /unattested|sha-publish/i);
  const files = readdirSync(path.join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f));
  const callers = [];
  for (const file of files) {
    const workflow = read(`.github/workflows/${file}`);
    if (/unattested|sha-publish/i.test(JSON.stringify(workflow.env ?? {})))
      callers.push(`${file}:env`);
    for (const [id, job] of Object.entries(workflow.jobs)) {
      // The job's env and every step's run and env, wherever a flag could hide.
      if (/unattested|sha-publish/i.test(JSON.stringify(job.env ?? {})))
        callers.push(`${file}:${id}:env`);
      for (const step of job.steps ?? []) {
        const text = JSON.stringify({ run: step.run, env: step.env, with: step.with });
        if (/unattested|sha-publish/i.test(text))
          callers.push(`${file}:${id}:${step.id ?? step.name}`);
      }
    }
  }
  assert.deepEqual(callers, ['ci.yml:publish-merge:merge']);
  // And the shared actions never pass it either.
  for (const action of readdirSync(path.join(ROOT, '.github/actions'))) {
    const text = readFileSync(path.join(ROOT, '.github/actions', action, 'action.yml'), 'utf8');
    assert.doesNotMatch(text, /unattested|sha-publish/i, action);
  }
  // Nor does anything a workflow could reach it through: a package.json
  // script, or a file under ci/ but the merge itself, its test, and this one.
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
    assert.doesNotMatch(script, /unattested|sha-publish/i, `package.json scripts.${name}`);
  }
  assert.deepEqual(unattestedMentionsIn('ci'), [
    'ci/release/merge-index.mjs',
    'ci/release/merge-index.test.mjs',
    'ci/workflows.test.mjs',
  ]);
});

/** Every file under `dir`, from the root, that names the unattested merge, sorted. */
function unattestedMentionsIn(dir) {
  const found = [];
  for (const entry of readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.parentPath.includes('node_modules')) continue;
    const file = path.relative(ROOT, path.join(entry.parentPath, entry.name));
    if (/unattested|sha-publish/i.test(readFileSync(path.join(ROOT, file), 'utf8'))) {
      found.push(file.split(path.sep).join('/'));
    }
  }
  return found.sort();
}

test('publish merges the legs with the release helper, and tags only the merged digest', () => {
  const merge = CI.jobs['publish-merge'].steps.find((s) => s.id === 'merge');
  assert.equal(
    merge.run,
    'node ci/release/merge-index.mjs --unattested --purpose sha-publish "$IMAGE_NAME" "$AMD64" "$ARM64"',
  );
  assert.equal(merge.env.AMD64, '${{ needs.publish-build.outputs.digest-amd64 }}');
  assert.equal(merge.env.ARM64, '${{ needs.publish-build.outputs.digest-arm64 }}');
  assert.equal(CI.jobs['publish-merge'].outputs.digest, '${{ steps.merge.outputs.digest }}');
  const MERGED = '${{ needs.publish-merge.outputs.digest }}';
  // Both platforms are smoke-tested from the merged digest.
  const smoke = CI.jobs['publish-smoke'].steps.find((s) => s.run === 'pnpm ci:image');
  assert.equal(smoke.env.SMOKE_IMAGE, `\${{ env.IMAGE_NAME }}@${MERGED}`);
  assert.equal(smoke.env.IMAGE_PLATFORM, 'linux/${{ matrix.arch }}');
  // The one step that tags, in publish, tags the merged digest and checks it.
  const tagging = Object.entries(CI.jobs).flatMap(([id, job]) =>
    (job.steps ?? [])
      .filter((s) => /imagetools create --tag/.test(s.run ?? ''))
      .map((s) => [id, s]),
  );
  assert.deepEqual(
    tagging.map(([id, s]) => `${id}:${s.name}`),
    ['publish:Tag the tested digest sha-<short>'],
  );
  const [[, tag]] = tagging;
  assert.equal(tag.env.DIGEST, MERGED);
  assert.match(tag.run, /imagetools create --tag "\$target" "\$IMAGE_NAME@\$DIGEST"/);
  assert.match(tag.run, /"\$pushed" != "\$DIGEST"/);
  assert.equal(tag.env.TAG, '${{ steps.meta.outputs.version }}');
  const meta = CI.jobs.publish.steps.find((s) => s.id === 'meta');
  assert.equal(meta.with.tags.trim(), 'type=sha,format=short');
  assert.equal(meta.with.flavor.trim(), 'latest=false');
});

test('no cache holds node_modules, a build output, or a generated registry', () => {
  const steps = [
    ...Object.values(CI.jobs).flatMap((job) => job.steps ?? []),
    ...INSTALL.runs.steps,
  ].filter((s) => CACHE_ACTIONS.test(s.uses ?? ''));
  assert.ok(steps.length >= 3, 'the store and the Next caches are there');
  for (const step of steps) {
    const paths = String(step.with.path).split('\n');
    for (const p of paths) {
      assert.doesNotMatch(p, /node_modules|generated|_portfolio|standalone|reports/, p);
      assert.ok(
        p === '${{ steps.store.outputs.path }}' || p === 'apps/web/.next/cache',
        `${p} is the pnpm store or the Next build cache`,
      );
    }
    assert.match(
      step.with.key,
      /hashFiles\('pnpm-lock\.yaml'\)/,
      'every key includes the lockfile',
    );
  }
});

test('only jobs that build without fixture flags restore the Next cache', () => {
  const withNext = Object.entries(CI.jobs)
    .filter(([, job]) => (job.steps ?? []).some((s) => s.with?.path === 'apps/web/.next/cache'))
    .map(([id]) => id)
    .sort();
  assert.deepEqual(withNext, ['browser', 'build', 'variants']);
  // build writes it; the others only restore.
  const writers = withNext.filter((id) =>
    CI.jobs[id].steps.some(
      (s) => s.with?.path === 'apps/web/.next/cache' && /^actions\/cache@/.test(s.uses),
    ),
  );
  assert.deepEqual(writers, ['build']);
  for (const id of withNext) {
    const env = JSON.stringify(CI.jobs[id].env ?? {});
    assert.doesNotMatch(env, /FIXTURES|PORTFOLIO_ANALYZE/, id);
  }
});

test('every scheduled job sets timeout-minutes, and only report may write issues', () => {
  assert.deepEqual(Object.keys(SCHEDULED.on), ['schedule']);
  assert.deepEqual(SCHEDULED.permissions, { contents: 'read' });
  for (const [id, job] of Object.entries(SCHEDULED.jobs)) {
    assert.ok(Number.isInteger(job['timeout-minutes']) && job['timeout-minutes'] > 0, id);
    if (id === 'report') {
      assert.deepEqual(job.permissions, { contents: 'read', issues: 'write' });
      assert.match(job.if, /always\(\)/, 'report runs after a failed or timed-out job');
      assert.match(job.if, /github\.event_name == 'schedule'/);
      assert.deepEqual(
        [...job.needs].sort(),
        Object.keys(SCHEDULED.jobs)
          .filter((j) => j !== 'report')
          .sort(),
        'report needs every other scheduled job',
      );
    } else {
      assert.equal(job.permissions, undefined, `${id} keeps the workflow's contents: read`);
    }
  }
});

test('no workflow has a manual trigger', () => {
  for (const workflow of [CI, SCHEDULED]) {
    assert.ok(!('workflow_dispatch' in workflow.on));
  }
});

test('every job runs on a pinned GitHub-hosted Ubuntu, and arm64 only where a leg runs it natively', () => {
  const RELEASE = read('.github/workflows/release.yml');
  const legs = [];
  for (const [file, workflow] of [
    ['ci.yml', CI],
    ['scheduled.yml', SCHEDULED],
    ['release.yml', RELEASE],
  ]) {
    for (const [id, job] of Object.entries(workflow.jobs)) {
      if (job['runs-on'] === '${{ matrix.runner }}') {
        legs.push(`${file}:${id}`);
        const runners = job.strategy.matrix.include.map((leg) => [leg.arch, leg.runner]);
        assert.deepEqual(runners, [
          ['amd64', 'ubuntu-24.04'],
          ['arm64', 'ubuntu-24.04-arm'],
        ]);
      } else {
        assert.equal(job['runs-on'], 'ubuntu-24.04', `${file}:${id}`);
      }
      // No job emulates another platform.
      for (const step of job.steps ?? []) {
        assert.doesNotMatch(step.uses ?? '', /setup-qemu-action/, `${file}:${id}`);
      }
    }
  }
  assert.deepEqual(legs.sort(), [
    'ci.yml:publish-build',
    'ci.yml:publish-smoke',
    'release.yml:dry-run-build',
    'release.yml:rc-build',
  ]);
  // Nor does any step reach binfmt or QEMU some other way.
  const source = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  assert.doesNotMatch(source, /setup-qemu-action|binfmt|qemu/i);
});

test("static's check:appearance holds the catalog lock to HEAD^1, which its checkout fetches (#20)", () => {
  const steps = CI.jobs.static.steps;
  const checkout = steps.find((step) => /^actions\/checkout@/.test(step.uses ?? ''));
  assert.equal(checkout.with?.['fetch-depth'], 2);
  const appearance = steps.find((step) => step.run === 'pnpm ci:appearance');
  assert.equal(appearance.env?.CATALOG_LOCK_BASE, 'HEAD^1');
});

test('every ci.yml job sets timeout-minutes', () => {
  for (const [id, job] of Object.entries(CI.jobs)) {
    assert.ok(Number.isInteger(job['timeout-minutes']) && job['timeout-minutes'] > 0, id);
  }
});

test('profiles loads the image the image job saved, builds nothing, and holds no token', () => {
  const image = CI.jobs.image;
  const profiles = CI.jobs.profiles;
  assert.ok(profiles, 'ci.yml has a profiles job');
  assert.deepEqual(profiles.needs, ['changes', 'image']);
  assert.match(profiles.if, /needs\.image\.outputs\.saved == 'true'/);
  assert.match(profiles.if, /contains\(fromJSON\(needs\.changes\.outputs\.jobs\), 'profiles'\)/);
  // The image job saves what it built and checked, and says so only once
  // the upload succeeded.
  const step = (id) => image.steps.find((s) => s.id === id);
  assert.ok(step('upload-image'), 'image uploads the image it built');
  assert.equal(step('upload-image').with['retention-days'], 1);
  assert.match(image.outputs.saved, /steps\.saved\.outputs\.saved/);
  assert.match(step('saved').if, /steps\.upload-image\.outcome == 'success'/);
  assert.match(step('save').if, /steps\.image\.outcome == 'success'/);
  assert.match(step('save').run, /set -o pipefail/);
  const download = profiles.steps.find((s) => /^actions\/download-artifact@/.test(s.uses ?? ''));
  assert.equal(download.with.name, step('upload-image').with.name);
  const run = profiles.steps.find((s) => s.run === 'pnpm ci:profiles');
  assert.ok(run, 'profiles runs pnpm ci:profiles');
  assert.match(run.env.SMOKE_IMAGE_ARCHIVE, /portfolio-ci\.tar\.gz$/);
  assert.equal(profiles.env.IMAGE_TAG, image.env.IMAGE_TAG);
  // Nothing builds an image here, and nothing hands a step a token.
  const text = JSON.stringify(profiles);
  assert.doesNotMatch(text, /docker build|ci:image|build-push-action/);
  assert.doesNotMatch(text, /secrets\.|GITHUB_TOKEN|github\.token/);
  assert.equal(profiles.permissions, undefined, "profiles keeps the workflow's contents: read");
  for (const checkout of profiles.steps.filter((s) => /^actions\/checkout@/.test(s.uses ?? ''))) {
    assert.equal(checkout.with['persist-credentials'], false);
  }
});
