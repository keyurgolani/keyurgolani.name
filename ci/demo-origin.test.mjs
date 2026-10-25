// `pnpm ci:demo-origin`'s offline parts (#9, ci/demo-origin.mjs): the one
// Playwright image, the spec's `docker run`, and its teardown. Only CI's
// image job starts the stack and the browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import {
  BROWSER_JOB,
  PASSED_ENV,
  playwrightImage,
  runDemoOrigin,
  specRunArgs,
  WORKFLOW,
} from './demo-origin.mjs';

const workflow = readFileSync(WORKFLOW, 'utf8');
const jobs = parseYaml(workflow).jobs;

test("the spec runs in ci.yml's browser-job Playwright image, its digest included, which every browser job shares", () => {
  const image = playwrightImage();
  assert.equal(image, jobs[BROWSER_JOB].container.image);
  assert.match(image, /^mcr\.microsoft\.com\/playwright:v[\d.]+-noble@sha256:[0-9a-f]{64}$/);
  const containers = Object.values(jobs)
    .map((job) => job.container?.image)
    .filter(Boolean);
  assert.ok(containers.length > 1);
  assert.deepEqual(new Set(containers), new Set([image]));
  // Nothing in the script names an image of its own.
  assert.doesNotMatch(
    readFileSync(new URL('./demo-origin.mjs', import.meta.url), 'utf8'),
    /sha256:[0-9a-f]{64}/,
  );
});

test('a browser job with no image, or one by tag alone, stops the run', () => {
  const withImage = (image) =>
    JSON.stringify({
      jobs: { [BROWSER_JOB]: image === undefined ? {} : { container: { image } } },
    });
  assert.throws(() => playwrightImage(withImage(undefined)), /no digest-pinned Playwright image/);
  assert.throws(
    () => playwrightImage(withImage('mcr.microsoft.com/playwright:v1.58.2-noble')),
    /no digest-pinned Playwright image/,
  );
  assert.throws(
    () => playwrightImage(withImage(`ghcr.io/x/playwright:v1.58.2-noble@sha256:${'a'.repeat(64)}`)),
    /no digest-pinned Playwright image/,
  );
});

test("the spec's container gets the browser jobs' flags, the checkout read-only but for reports/, and no token, secret, or socket", () => {
  const image = playwrightImage();
  const args = specRunArgs({
    image,
    root: '/w/repo',
    reports: '/w/repo/reports',
    name: 'portfolio-ci-demo-origin-x',
    args: ['--list'],
  });
  const text = args.join(' ');
  // The browser jobs' options, as ci.yml gives them.
  assert.equal(jobs[BROWSER_JOB].container.options, '--user 1001 --ipc=host --init');
  assert.ok(text.includes('--user 1001 --ipc=host --init'), text);
  assert.ok(text.includes('--network host'), text);
  // Exactly two mounts: the checkout read-only, and reports/ writable.
  const mounts = args.flatMap((arg, index) => (args[index - 1] === '-v' ? [arg] : []));
  assert.deepEqual(mounts, ['/w/repo:/w/repo:ro', '/w/repo/reports:/w/repo/reports']);
  assert.equal(args.filter((arg) => arg === '--mount' || arg === '--volumes-from').length, 0);
  // Each variable by name alone, so no value is on the command line, and only these.
  const env = args.flatMap((arg, index) => (args[index - 1] === '-e' ? [arg] : []));
  assert.deepEqual(env, ['HOME=/tmp', ...PASSED_ENV]);
  for (const name of PASSED_ENV) assert.match(name, /^[A-Z_]+$/);
  assert.doesNotMatch(
    text,
    /GITHUB_TOKEN|GH_TOKEN|ACTIONS_|SECRET|docker\.sock|--privileged|--cap-add|--env-file|--security-opt/,
  );
  // Then the image, and the demo-origin project alone, with the run's own arguments.
  const at = args.indexOf(image);
  assert.deepEqual(args.slice(at), [
    image,
    'node',
    'node_modules/@playwright/test/cli.js',
    'test',
    '-c',
    'tests/proxy/playwright.config.ts',
    '--project',
    'demo-origin',
    '--list',
  ]);
  assert.equal(args.slice(0, at).includes(image), false);
});

test('the stack and the container come down however the spec ended', async () => {
  const run = async (runSpec, startStack) => {
    const done = [];
    const status = await runDemoOrigin({
      startStack:
        startStack ?? (async () => ({ port: 4443, stop: () => void done.push('stack down') })),
      runSpec,
      remove: () => void done.push('container removed'),
      report: (error) => void done.push(`reported ${error.message}`),
    });
    return { status, done };
  };
  assert.deepEqual(await run(() => ({ status: 0 })), {
    status: 0,
    done: ['container removed', 'stack down'],
  });
  assert.deepEqual(await run(() => ({ status: 1 })), {
    status: 1,
    done: ['container removed', 'stack down'],
  });
  // Killed at its timeout, with no status.
  assert.deepEqual(await run(() => ({ status: null })), {
    status: 1,
    done: ['container removed', 'stack down'],
  });
  assert.deepEqual(
    await run(() => {
      throw new Error('spawn failed');
    }),
    { status: 1, done: ['reported spawn failed', 'container removed', 'stack down'] },
  );
  // A stack that never came up: startProxyStack takes its own down.
  assert.deepEqual(
    await run(
      () => assert.fail('no spec without a stack'),
      async () => {
        throw new Error('compose up failed');
      },
    ),
    { status: 1, done: ['reported compose up failed', 'container removed'] },
  );
  // The spec gets the stack's port.
  let port;
  await run((given) => ((port = given), { status: 0 }));
  assert.equal(port, 4443);
});
