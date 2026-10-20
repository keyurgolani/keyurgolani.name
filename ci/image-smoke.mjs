#!/usr/bin/env node
// Builds the image without pushing it, starts one container with the harness
// fixture mounted read-only, and checks /api/health, the home page, and the
// image's own HEALTHCHECK command. Always removes the container; keeps the
// image so later steps (the proxy smoke) can run it.
//
// Environment:
//   CONTAINER_CLI     docker (default) or finch
//   IMAGE_TAG         tag to build (default portfolio:ci)
//   IMAGE_PLATFORM    for example linux/amd64 (default: the builder's platform)
//   CONTAINER_PREFIX  container name prefix (default portfolio-ci-)
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { freePort, getText, waitFor } from '../tests/harness/net.mjs';
import {
  currentGate,
  REPO_ROOT,
  reportError,
  reportsDir,
  writeFailureRecord,
} from './lib/reports.mjs';

const cli = process.env.CONTAINER_CLI || 'docker';
const tag = process.env.IMAGE_TAG || 'portfolio:ci';
const platform = process.env.IMAGE_PLATFORM;
const name = `${process.env.CONTAINER_PREFIX || 'portfolio-ci-'}image-${process.pid}`;
const FIXTURE_NAME = 'Rowan Fixture';
const LOG = path.join(reportsDir(), 'image', 'container.log');

const container = (args, options = {}) =>
  spawnSync(cli, args, { cwd: REPO_ROOT, encoding: 'utf8', ...options });

class SmokeFailure extends Error {
  constructor(message, fields) {
    super(message);
    this.fields = fields;
  }
}

function saveLogs() {
  const logs = container(['logs', name]);
  mkdirSync(path.dirname(LOG), { recursive: true });
  writeFileSync(LOG, `${logs.stdout ?? ''}${logs.stderr ?? ''}`);
  console.log(
    `--- container logs (${path.relative(REPO_ROOT, LOG)}) ---\n${logs.stdout}${logs.stderr}`,
  );
}

async function smoke() {
  const platformArgs = platform ? ['--platform', platform] : [];
  console.log(`[image] building ${tag}${platform ? ` for ${platform}` : ''} with ${cli}`);
  const build = container(['build', ...platformArgs, '-t', tag, '.'], { stdio: 'inherit' });
  if (build.status !== 0) {
    throw new SmokeFailure('the image build failed', {
      test: 'image builds',
      actual: `exit ${build.status}`,
    });
  }

  const port = await freePort();
  const run = container([
    'run',
    '-d',
    '--name',
    name,
    ...platformArgs,
    '-p',
    `127.0.0.1:${port}:3000`,
    '-v',
    `${path.join(REPO_ROOT, 'tests', 'fixtures')}:/data:ro`,
    '-e',
    'TZ=UTC',
    tag,
  ]);
  if (run.status !== 0) {
    throw new SmokeFailure(`the container did not start: ${run.stderr.trim()}`, {
      test: 'container starts',
    });
  }

  const origin = `http://127.0.0.1:${port}`;
  const running = () =>
    container(['inspect', '--format', '{{.State.Running}}', name]).stdout.trim() === 'true';
  const health = await waitFor(
    async () => {
      const response = await getText(`${origin}/api/health`);
      return response.status === 200 ? response : undefined;
    },
    { timeoutMs: 90_000, alive: running, what: 'GET /api/health to answer 200' },
  ).catch((error) => {
    throw new SmokeFailure(error.message, {
      test: 'GET /api/health',
      route: '/api/health',
      expected: 200,
    });
  });
  if (JSON.parse(health.body).ok !== true) {
    throw new SmokeFailure('/api/health answered without ok: true', {
      test: 'GET /api/health',
      route: '/api/health',
      expected: 'ok: true',
      actual: health.body.slice(0, 200),
    });
  }
  console.log(`[image] GET /api/health -> 200 ${health.body}`);

  const inspect = container(['image', 'inspect', '--format', '{{json .Config.Healthcheck}}', tag]);
  const healthcheck = JSON.parse(inspect.stdout || 'null');
  const [kind, ...command] = healthcheck?.Test ?? [];
  if (kind !== 'CMD' && kind !== 'CMD-SHELL') {
    throw new SmokeFailure('the image has no HEALTHCHECK command', { test: 'image HEALTHCHECK' });
  }
  const probe = container(['exec', name, ...(kind === 'CMD' ? command : ['sh', '-c', command[0]])]);
  if (probe.status !== 0) {
    throw new SmokeFailure('the image HEALTHCHECK command failed inside the container', {
      test: 'image HEALTHCHECK',
      expected: 'exit 0',
      actual: `exit ${probe.status}`,
    });
  }
  console.log('[image] HEALTHCHECK command -> exit 0');

  const home = await getText(`${origin}/`);
  if (home.status !== 200 || !home.body.includes(FIXTURE_NAME)) {
    throw new SmokeFailure(`GET / did not render the mounted fixture (status ${home.status})`, {
      test: 'GET / renders the mounted portfolio',
      route: '/',
      expected: `200 containing ${FIXTURE_NAME}`,
      actual: home.status,
    });
  }
  console.log(`[image] GET / -> 200 with the mounted fixture`);
}

let exitCode = 0;
try {
  await smoke();
  console.log(`[image] ${tag} passed`);
} catch (error) {
  exitCode = 1;
  reportError(`image smoke: ${error.message}`, { title: 'image smoke' });
  saveLogs();
  const gate = currentGate();
  if (gate) {
    writeFailureRecord({
      ...gate,
      ...(error.fields ?? { test: 'image smoke' }),
      asset: tag,
      artifacts: ['image/container.log'],
    });
  }
} finally {
  container(['rm', '-f', name]);
}
process.exit(exitCode);
