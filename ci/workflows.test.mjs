// Structural checks on the workflows that pnpm check:workflows (actionlint,
// zizmor) and #11's static check don't make: what the caches hold and who
// reads them, and the scheduled workflow's timeouts and permissions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('publish reads no cache: no cache action, no shared install, no setup-node cache', () => {
  const steps = CI.jobs.publish.steps;
  assert.ok(steps.length > 0);
  assert.deepEqual(
    steps.filter(usesCache).map((s) => s.name ?? s.uses),
    [],
  );
  // Nor does the Docker build pull a cache in.
  const build = steps.find((s) => /docker\/build-push-action@/.test(s.uses ?? ''));
  assert.ok(build);
  assert.equal(build.with['cache-from'], undefined);
  assert.equal(build.with['cache-to'], undefined);
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

test('every job runs on a pinned GitHub-hosted Ubuntu, and arm64 only where a release leg builds it natively', () => {
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
      // No release job emulates another platform. ci.yml's publish still
      // builds arm64 under QEMU.
      if (file === 'release.yml') {
        for (const step of job.steps ?? []) {
          assert.doesNotMatch(step.uses ?? '', /setup-qemu-action/, `${file}:${id}`);
        }
      }
    }
  }
  assert.deepEqual(legs.sort(), ['release.yml:dry-run-build', 'release.yml:rc-build']);
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
