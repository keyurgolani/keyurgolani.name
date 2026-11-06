// Structural checks on the workflows that pnpm check:workflows (actionlint,
// zizmor) and #11's static check don't make: what the caches hold and who
// reads them, and the scheduled workflow's timeouts and permissions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { passedRuns, RELEASE_WORKFLOW, REQUIRED_RC_JOBS } from './release/promote-check.mjs';
import { SUITES } from './shards.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => parse(readFileSync(path.join(ROOT, file), 'utf8'));
const CI = read('.github/workflows/ci.yml');
const SCHEDULED = read('.github/workflows/scheduled.yml');
const INSTALL = read('.github/actions/install/action.yml');
const RELEASE = read('.github/workflows/release.yml');
const PREFLIGHT = read('.github/workflows/rc-preflight.yml');

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

test('catalog-provenance runs weekly with links, reads only, and report expects its skip (#20)', () => {
  const MONDAY = '23 6 * * 1';
  const job = SCHEDULED.jobs['catalog-provenance'];
  assert.ok(job, 'scheduled.yml has a catalog-provenance job');
  // Weekly: on the Monday schedule only, the one run that can close the report.
  assert.ok(
    SCHEDULED.on.schedule.some((s) => s.cron === MONDAY),
    'the Monday schedule is there',
  );
  assert.equal(job.if, `\${{ github.event.schedule == '${MONDAY}' }}`);
  assert.equal(job.if, SCHEDULED.jobs.links.if, 'it runs on the nights links does');
  // contents: read alone, the workflow's, and no job-level grant.
  assert.equal(job.permissions, undefined);
  assert.deepEqual(SCHEDULED.permissions, { contents: 'read' });
  assert.ok(Number.isInteger(job['timeout-minutes']) && job['timeout-minutes'] <= 30);
  // Its check runs through the runner as its gate, with the token on that step alone.
  const steps = job.steps;
  const check = steps.find((s) => s.name === 'pnpm ci:catalog-provenance');
  assert.equal(
    check.run,
    'node ci/run.mjs catalog-provenance -- node ci/check-catalog-provenance.mjs',
  );
  assert.deepEqual(check.env, { GITHUB_TOKEN: '${{ github.token }}' });
  for (const step of steps.filter((s) => s !== check)) {
    assert.doesNotMatch(JSON.stringify(step), /GITHUB_TOKEN|github\.token|secrets\./, step.name);
  }
  assert.doesNotMatch(JSON.stringify(job), /secrets\./);
  for (const checkout of steps.filter((s) => /^actions\/checkout@/.test(s.uses ?? ''))) {
    assert.equal(checkout.with['persist-credentials'], false);
  }
  const upload = steps.find((s) => /^actions\/upload-artifact@/.test(s.uses ?? ''));
  assert.equal(upload.with.name, 'reports-catalog-provenance');
  assert.equal(upload.if, '${{ always() }}');
  // report needs it, and expects its skip on exactly the nights it doesn't run.
  const report = SCHEDULED.jobs.report;
  assert.ok(report.needs.includes('catalog-provenance'));
  const step = report.steps.find((s) => s.env?.EXPECTED_SKIPS);
  assert.equal(
    step.env.EXPECTED_SKIPS,
    `\${{ github.event.schedule != '${MONDAY}' && 'links catalog-provenance' || '' }}`,
  );
});

test('no workflow has a manual trigger but rc-preflight.yml, which has nothing else', () => {
  const files = readdirSync(path.join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.includes('rc-preflight.yml'));
  // By its name anywhere in the file, so no form of on: hides one.
  const manual = files.filter((file) =>
    /workflow_dispatch/.test(readFileSync(path.join(ROOT, '.github/workflows', file), 'utf8')),
  );
  assert.deepEqual(manual, ['rc-preflight.yml']);
  assert.deepEqual(Object.keys(PREFLIGHT.on), ['workflow_dispatch']);
  assert.deepEqual(Object.keys(CI.on), ['pull_request', 'push']);
});

test('every job runs on a pinned GitHub-hosted Ubuntu, and arm64 only where a leg runs it natively', () => {
  const legs = [];
  for (const [file, workflow] of [
    ['ci.yml', CI],
    ['scheduled.yml', SCHEDULED],
    ['release.yml', RELEASE],
    ['rc-preflight.yml', PREFLIGHT],
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
    'release.yml:rc-smoke',
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

test('rehearsal loads the image the image job saved, builds nothing, holds no token, and must run its container rows', () => {
  const job = CI.jobs.rehearsal;
  assert.ok(job, 'ci.yml has a rehearsal job');
  assert.deepEqual(job.needs, ['changes', 'image']);
  assert.match(job.if, /needs\.image\.outputs\.saved == 'true'/);
  assert.match(job.if, /contains\(fromJSON\(needs\.changes\.outputs\.jobs\), 'rehearsal'\)/);
  const download = job.steps.find((s) => /^actions\/download-artifact@/.test(s.uses ?? ''));
  assert.equal(download.with.name, 'image-amd64');
  const run = job.steps.find((s) => s.run === 'pnpm ci:rehearsal');
  assert.ok(run, 'rehearsal runs pnpm ci:rehearsal');
  assert.match(run.env.REHEARSAL_IMAGE_ARCHIVE, /portfolio-ci\.tar\.gz$/);
  assert.equal(run.env.REHEARSAL_CONTAINER, 'required');
  const text = JSON.stringify(job);
  assert.doesNotMatch(text, /docker build|ci:image|build-push-action/);
  assert.doesNotMatch(text, /secrets\.|GITHUB_TOKEN|github\.token/);
  assert.equal(job.permissions, undefined, "rehearsal keeps the workflow's contents: read");
  for (const checkout of job.steps.filter((s) => /^actions\/checkout@/.test(s.uses ?? ''))) {
    assert.equal(checkout.with['persist-credentials'], false);
  }
  for (const control of ['gate', 'selected']) {
    assert.ok(CI.jobs[control].needs.includes('rehearsal'), control);
  }
});

test('fresh-clone reads no cache, installs nothing itself, holds no token, and runs the container steps', () => {
  const job = CI.jobs['fresh-clone'];
  assert.ok(job, 'ci.yml has a fresh-clone job');
  assert.deepEqual(job.needs, ['changes']);
  assert.match(job.if, /contains\(fromJSON\(needs\.changes\.outputs\.jobs\), 'fresh-clone'\)/);
  assert.deepEqual(
    job.steps.filter(usesCache).map((s) => s.name ?? s.uses),
    [],
  );
  const text = JSON.stringify(job);
  assert.doesNotMatch(text, /secrets\.|GITHUB_TOKEN|github\.token|pnpm install/);
  assert.equal(job.permissions, undefined, "fresh-clone keeps the workflow's contents: read");
  for (const checkout of job.steps.filter((s) => /^actions\/checkout@/.test(s.uses ?? ''))) {
    assert.equal(checkout.with['persist-credentials'], false);
  }
  const run = job.steps.find((s) => /ci\/fresh-clone\.mjs/.test(s.run ?? ''));
  assert.equal(run.run, 'node ci/run.mjs fresh-clone -- node ci/fresh-clone.mjs');
  assert.equal(run.env.FRESH_CLONE_CONTAINERS, '1');
  for (const control of ['gate', 'selected']) {
    assert.ok(CI.jobs[control].needs.includes('fresh-clone'), control);
  }
});

// rc-preflight.yml's jobs, and the release.yml job each one runs as.
const PREFLIGHT_OF = {
  'preflight-plan': 'rc-quality-plan',
  'preflight-quality': 'rc-quality',
  'preflight-verdict': 'rc-quality-verdict',
};
const PREFLIGHT_SHA = '${{ needs.preflight-verify.outputs.sha }}';

/** The release.yml job `id` as rc-preflight.yml runs it: on the verified commit, under its own names. */
function asPreflight(id) {
  let text = JSON.stringify(RELEASE.jobs[id]);
  for (const [own, release] of Object.entries(PREFLIGHT_OF)) {
    text = text.replaceAll(`needs.${release}.`, `needs.${own}.`);
  }
  text = text.replaceAll('reports-quality-release-', 'reports-quality-preflight-');
  const job = JSON.parse(text);
  // Its own needs, and no tag to wait for.
  delete job.needs;
  delete job.if;
  // Nothing left reads the event, so the copy runs the same on a dispatch.
  assert.doesNotMatch(JSON.stringify(job), /\bgithub\./, id);
  const own = Object.keys(PREFLIGHT_OF).find((key) => PREFLIGHT_OF[key] === id);
  job.name = job.name.replace(id, own);
  for (const step of job.steps) {
    if (/^actions\/checkout@/.test(step.uses ?? ''))
      step.with = { ...step.with, ref: PREFLIGHT_SHA };
  }
  return job;
}

test("rc-preflight runs release.yml's quality gate step for step, on the commit it was given", () => {
  assert.deepEqual(Object.keys(PREFLIGHT.jobs), ['preflight-verify', ...Object.keys(PREFLIGHT_OF)]);
  for (const [own, release] of Object.entries(PREFLIGHT_OF)) {
    const { needs, ...job } = PREFLIGHT.jobs[own];
    assert.deepEqual(job, asPreflight(release), `${own} is release.yml's ${release}`);
    assert.ok(needs.includes('preflight-verify'), own);
  }
  assert.deepEqual(PREFLIGHT.jobs['preflight-plan'].needs, ['preflight-verify']);
  assert.deepEqual(PREFLIGHT.jobs['preflight-quality'].needs, [
    'preflight-verify',
    'preflight-plan',
  ]);
  assert.deepEqual(PREFLIGHT.jobs['preflight-verdict'].needs, [
    'preflight-verify',
    'preflight-plan',
    'preflight-quality',
  ]);
  // The verdict runs only when every shard passed, as the release's does.
  assert.equal(PREFLIGHT.jobs['preflight-verdict'].if, undefined);
  // The workflow around them is release.yml's too, but the platforms it builds.
  const { PLATFORMS, ...shared } = RELEASE.env;
  assert.ok(PLATFORMS);
  assert.deepEqual(PREFLIGHT.env, shared);
  assert.deepEqual(Object.keys(PREFLIGHT), [
    'name',
    'run-name',
    'on',
    'permissions',
    'concurrency',
    'env',
    'jobs',
  ]);
  assert.equal(RELEASE.defaults, undefined);
  assert.equal(PREFLIGHT.defaults, undefined);
});

test('rc-preflight takes a commit id on dispatch from main, refuses one off main or with another release.yml, and runs one at a time', () => {
  const { sha, ...rest } = PREFLIGHT.on.workflow_dispatch.inputs;
  assert.deepEqual(rest, {});
  assert.equal(sha.required, true);
  assert.equal(sha.type, 'string');
  // Display only: the title names the commit, since the run's checks sit on main's tip.
  assert.equal(PREFLIGHT['run-name'], 'rc-preflight of ${{ inputs.sha }}');
  // One preflight at a time, whatever the commit, and none cancelled.
  assert.deepEqual(PREFLIGHT.concurrency, {
    group: 'rc-preflight',
    'cancel-in-progress': false,
  });
  const verify = PREFLIGHT.jobs['preflight-verify'];
  assert.deepEqual(verify.outputs, { sha: '${{ steps.verify.outputs.sha }}' });
  const [checkout, step] = verify.steps;
  assert.match(checkout.uses, /^actions\/checkout@[0-9a-f]{40}$/);
  assert.deepEqual(checkout.with, { 'persist-credentials': false, ref: 'main', 'fetch-depth': 0 });
  assert.equal(step.id, 'verify');
  // The input reaches the shell through env: only, and is a full id before anything else.
  assert.deepEqual(step.env, { SHA: '${{ inputs.sha }}' });
  const checks = [
    /\[\[ "\$SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\]/,
    // The jobs are this file at GITHUB_SHA, so it has to be main's.
    /if \[ "\$GITHUB_REF" != refs\/heads\/main \]; then/,
    // A tag object's id is 40 hex digits too.
    /if \[ "\$\(git cat-file -t "\$SHA" 2>\/dev\/null\)" != commit \]; then/,
    /if ! git merge-base --is-ancestor "\$SHA" refs\/remotes\/origin\/main 2>\/dev\/null; then/,
    // The gate main's tip runs is the one a tag on the commit would get.
    /if ! git diff --quiet "\$GITHUB_SHA" "\$SHA" -- \.github\/workflows\/release\.yml; then/,
    /^\s*echo "sha=\$SHA" >> "\$GITHUB_OUTPUT"$/m,
  ];
  const at = checks.map((check) => {
    const match = check.exec(step.run);
    assert.ok(match, String(check));
    return match.index;
  });
  assert.deepEqual(
    at,
    [...at].sort((a, b) => a - b),
    'each check runs in turn, and the output is last',
  );
  // Each refusal exits, and only the one line writes the output, which every later checkout reads.
  assert.equal(step.run.match(/exit 1/g).length, checks.length - 1);
  assert.equal(step.run.match(/GITHUB_OUTPUT/g).length, 1);
  // The summary names the commit the gate came from.
  assert.match(step.run, /echo "[^\n]*\$GITHUB_SHA[^\n]*"\n\s*\} >> "\$GITHUB_STEP_SUMMARY"$/m);
  // Every later checkout takes the commit verify passed on, and nothing else names the input.
  for (const [id, job] of Object.entries(PREFLIGHT.jobs)) {
    for (const s of job.steps) {
      if (s.run) assert.doesNotMatch(s.run, /\$\{\{/, `${id}: ${s.name}`);
      if (/^actions\/checkout@/.test(s.uses ?? '')) {
        assert.equal(s.with['persist-credentials'], false, id);
        if (id !== 'preflight-verify') assert.equal(s.with.ref, PREFLIGHT_SHA, id);
      }
    }
    if (id !== 'preflight-verify') assert.doesNotMatch(JSON.stringify(job), /inputs\./, id);
  }
});

test('rc-preflight reads only, holds no secret, reads no cache, keeps shard reports three days and the verdict one, builds no image, and never tags or publishes', () => {
  assert.deepEqual(PREFLIGHT.permissions, { contents: 'read' });
  const text = readFileSync(path.join(ROOT, '.github/workflows/rc-preflight.yml'), 'utf8');
  const jobs = JSON.stringify(PREFLIGHT.jobs);
  assert.doesNotMatch(jobs, /secrets\.|github\.token|GITHUB_TOKEN|GH_TOKEN/);
  assert.doesNotMatch(
    jobs,
    /docker |buildx|build-push-action|login-action|attest|imagetools|retag|merge-index|git (tag|push)|gh release|ghcr/i,
  );
  const uploads = [];
  for (const [id, job] of Object.entries(PREFLIGHT.jobs)) {
    assert.equal(job.permissions, undefined, `${id} keeps the workflow's contents: read`);
    assert.equal(job['runs-on'], 'ubuntu-24.04', id);
    assert.ok(Number.isInteger(job['timeout-minutes']) && job['timeout-minutes'] > 0, id);
    assert.deepEqual(
      job.steps.filter(usesCache).map((s) => s.name ?? s.uses),
      [],
      id,
    );
    for (const step of job.steps) {
      if (/^actions\/upload-artifact@/.test(step.uses ?? '')) uploads.push(step.with);
      if (/pnpm install/.test(step.run ?? '')) {
        assert.equal(step.run, 'corepack enable && pnpm install --frozen-lockfile', id);
      }
    }
  }
  assert.deepEqual(
    uploads.map((u) => u.name),
    ['reports-quality-preflight-${{ matrix.shard }}', 'reports-quality-preflight-verdict'],
  );
  for (const upload of uploads) {
    assert.equal(upload.path, 'reports/');
    // The shards' reports outlast every wave of a long release; the verdict's keep one day.
    assert.equal(upload['retention-days'], upload.name.endsWith('-verdict') ? 1 : 3, upload.name);
  }
  // Its verdict never counts for promotion: promote-verify takes only a
  // pushed release.yml run on the tag, and none of the jobs it names is one of these.
  assert.match(text, /^name: rc-preflight$/m);
  assert.equal(RELEASE_WORKFLOW, '.github/workflows/release.yml');
  const names = Object.values(PREFLIGHT.jobs).map((job) => job.name.split(' ')[0]);
  for (const name of REQUIRED_RC_JOBS) assert.ok(!names.includes(name), name);
  const sha = 'a'.repeat(40);
  const run = {
    id: 1,
    path: '.github/workflows/rc-preflight.yml',
    event: 'workflow_dispatch',
    head_branch: 'main',
    head_sha: sha,
    status: 'completed',
    conclusion: 'success',
  };
  const runJobs = { 1: REQUIRED_RC_JOBS.map((name) => ({ name, conclusion: 'success' })) };
  assert.deepEqual(passedRuns('v1.0.0-rc.1', sha, [run], runJobs), []);
});

test("only release.yml's and rc-preflight.yml's quality jobs name a release scope: every other workflow's gate stays strict", () => {
  const dir = new URL('../.github/workflows/', import.meta.url);
  const naming = readdirSync(dir)
    .filter((file) => /\.ya?ml$/.test(file))
    .filter((file) => readFileSync(new URL(file, dir), 'utf8').includes('QUALITY_RELEASE_SCOPE'))
    .sort();
  assert.deepEqual(naming, ['rc-preflight.yml', 'release.yml']);
  for (const workflow of [RELEASE, PREFLIGHT]) {
    // Never for a whole workflow or job: only on the steps that plan, run or judge the release.
    assert.equal(workflow.env?.QUALITY_RELEASE_SCOPE, undefined);
    for (const [id, job] of Object.entries(workflow.jobs)) {
      assert.equal(job.env?.QUALITY_RELEASE_SCOPE, undefined, id);
      for (const step of job.steps ?? []) {
        if (step.env?.QUALITY_RELEASE_SCOPE === undefined) continue;
        assert.equal(step.env.QUALITY_RELEASE_SCOPE, 'quality/release/scope.json', id);
        assert.match(step.run ?? '', /full-plan\.ts|ci:quality-full|ci:quality-release/, id);
      }
    }
  }
  // Nor an action every job runs, nor a package script.
  const actions = new URL('../.github/actions/', import.meta.url);
  const actionFiles = readdirSync(actions, { recursive: true }).filter((file) =>
    /\.ya?ml$/.test(String(file)),
  );
  assert.ok(actionFiles.length > 0);
  for (const file of actionFiles)
    assert.doesNotMatch(
      readFileSync(new URL(String(file), actions), 'utf8'),
      /QUALITY_RELEASE_SCOPE/,
      String(file),
    );
  const scripts = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ).scripts;
  assert.deepEqual(
    Object.entries(scripts).filter(([, run]) => run.includes('QUALITY_RELEASE_SCOPE')),
    [],
  );
});

test('each sharded suite runs as many shards as ci/shards.mjs splits it into, and the browser suite in four within 20 minutes (row 54, #175)', () => {
  for (const suite of ['unit', 'browser', 'variants']) {
    const job = CI.jobs[suite];
    const { count } = SUITES[suite];
    assert.deepEqual(
      job.strategy.matrix.shard,
      Array.from({ length: count }, (_, i) => i + 1),
      `${suite}: the matrix is 1 to ${count}`,
    );
    assert.equal(job.name, `${suite} (\${{ matrix.shard }}/${count})`, suite);
    const shardSteps = job.steps.filter((step) => step.env?.SHARD);
    assert.equal(shardSteps.length, 1, `${suite}: one step runs the shard`);
    assert.equal(shardSteps[0].env.SHARD, `\${{ matrix.shard }}/${count}`, suite);
    assert.match(
      shardSteps[0].name,
      new RegExp(` \\$\\{\\{ matrix\\.shard \\}\\}/${count}$`),
      suite,
    );
  }
  // Four browser shards, the limit unchanged: a slow suite is split, never given longer.
  const browser = CI.jobs.browser;
  assert.deepEqual(browser.strategy.matrix.shard, [1, 2, 3, 4]);
  assert.equal(browser['timeout-minutes'], 20);
  assert.equal(browser.strategy['fail-fast'], false);
  // A plain literal, so rc-verify can read the count from a tag commit's own ci.yml.
  const source = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const start = source.indexOf('\n  browser:\n');
  const next = source.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/);
  const block = source.slice(start, start + 1 + next);
  assert.ok(start >= 0 && next > 0, 'the browser job in ci.yml');
  assert.match(block, /\n {8}shard: \[1, 2, 3, 4\]\n/);
});
