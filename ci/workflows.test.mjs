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

test('every ci.yml job sets timeout-minutes', () => {
  for (const [id, job] of Object.entries(CI.jobs)) {
    assert.ok(Number.isInteger(job['timeout-minutes']) && job['timeout-minutes'] > 0, id);
  }
});
