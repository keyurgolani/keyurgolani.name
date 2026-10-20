#!/usr/bin/env node
// Builds the image without pushing it (or pulls SMOKE_IMAGE), starts one
// container on an internal network under the read-only profile, with the
// harness fixture mounted read-only as its source directory, and checks from
// inside the container: /api/health, the home page, the image's own
// HEALTHCHECK command, what the image contains, that the server's user can
// change nothing in the app tree, the owner CLI's hash-password and
// revoke-sessions, and that the container has no route out. Always removes
// the container and network; keeps the image so later steps (the proxy
// smoke) can run it.
//
// Environment:
//   CONTAINER_CLI     docker (default) or finch
//   IMAGE_TAG         tag to build (default portfolio:ci)
//   SMOKE_IMAGE       test this image reference instead of building one
//   IMAGE_PLATFORM    for example linux/arm64 (default: the host's platform)
//   SMOKE_TIMEOUT_MS  how long to wait for /api/health (default 90000)
//   CONTAINER_PREFIX  container and network name prefix (default portfolio-ci-)
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseHash, verifyPassword } from '../packages/core/src/auth/phc.mjs';
import { waitFor } from '../tests/harness/net.mjs';
import { assessRoutes, PROBE_SNIPPET, SCAN_SNIPPET, WRITABLE_SNIPPET } from './lib/container.mjs';
import {
  currentGate,
  REPO_ROOT,
  reportError,
  reportsDir,
  writeFailureRecord,
} from './lib/reports.mjs';

const cli = process.env.CONTAINER_CLI || 'docker';
const pulled = process.env.SMOKE_IMAGE;
const image = pulled || process.env.IMAGE_TAG || 'portfolio:ci';
const platform = process.env.IMAGE_PLATFORM;
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 90_000);
const prefix = process.env.CONTAINER_PREFIX || 'portfolio-ci-';
const name = `${prefix}image-${process.pid}`;
const network = `${prefix}image-net-${process.pid}`;
const FIXTURE_NAME = 'Rowan Fixture';
const LOG = path.join(
  reportsDir(),
  'image',
  `container-${platform?.replace('/', '-') ?? 'native'}.log`,
);

const container = (args, options = {}) =>
  spawnSync(cli, args, { cwd: REPO_ROOT, encoding: 'utf8', ...options });

/**
 * The exit code of a command run with `exec`. Docker passes it through;
 * Finch exits 1 and names the command's code on stderr.
 */
const execStatus = (result) =>
  Number(/exec failed with exit code (\d+)/.exec(result.stderr ?? '')?.[1] ?? result.status);

class SmokeFailure extends Error {
  constructor(message, fields) {
    super(message);
    this.fields = fields;
  }
}

/** GET a path from inside the container; resolves to { status, body } or { error }. */
function probe(pathname) {
  const result = container(['exec', name, 'node', '-e', PROBE_SNIPPET, pathname]);
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { error: (result.stderr || `exit ${result.status}`).trim() };
  }
}

function saveLogs() {
  const logs = container(['logs', name]);
  mkdirSync(path.dirname(LOG), { recursive: true });
  writeFileSync(LOG, `${logs.stdout ?? ''}${logs.stderr ?? ''}`);
  console.log(`--- container logs (${path.relative(REPO_ROOT, LOG)}) ---`);
  console.log(`${logs.stdout ?? ''}${logs.stderr ?? ''}`);
}

/**
 * The owner CLI runs from the image (#2). Given a password twice on --stdin,
 * hash-password prints one PHC string at the floor, and the hash verifies.
 * It refuses a password in its arguments, and input that isn't a terminal
 * without --stdin, and neither refusal repeats the password. revoke-sessions
 * runs as the server's user against the image's data directory.
 */
async function checkOwnerCli() {
  const typed = 'image smoke passphrase';
  const cliArgs = ['node', 'apps/web/bin/owner.mjs', 'hash-password'];
  const fail = (message, actual) => {
    throw new SmokeFailure(`the owner CLI in the image: ${message}`, {
      test: 'the owner CLI runs from the image',
      actual,
    });
  };
  const echoes = (result) => `${result.stdout ?? ''}${result.stderr ?? ''}`.includes(typed);

  const hashed = container(['exec', '-i', name, ...cliArgs, '--stdin'], {
    input: `${typed}\n${typed}\n`,
  });
  const phc = (hashed.stdout ?? '').replace(/\n$/, '');
  const parsed = parseHash(phc);
  if (hashed.status !== 0) fail('--stdin did not exit 0', `exit ${hashed.status}`);
  if (!parsed.ok || !phc.startsWith('$scrypt$ln=17,r=8,p=1$')) {
    fail('stdout is not one PHC string at the floor', `${phc.length} characters`);
  }
  if (!(await verifyPassword(typed, parsed.hash))) fail('the hash does not verify', 'mismatch');
  if (echoes(hashed)) fail('the output repeats the password', 'password in the output');

  const inArgs = container(['exec', name, ...cliArgs, typed]);
  if (execStatus(inArgs) !== 2) {
    fail('a password in the arguments was not a usage error', `exit ${execStatus(inArgs)}`);
  }
  if (echoes(inArgs)) fail('a password in the arguments was repeated', 'password in the output');

  const piped = container(['exec', '-i', name, ...cliArgs], { input: `${typed}\n${typed}\n` });
  if (execStatus(piped) !== 2 || piped.stdout !== '') {
    fail('input that is not a terminal was read without --stdin', `exit ${execStatus(piped)}`);
  }
  console.log(
    '[image] hash-password: --stdin prints a hash that verifies; argv and piped input are refused',
  );

  const revoked = container([
    'exec',
    '-e',
    'PORTFOLIO_DATA_DIR=/var/lib/portfolio',
    name,
    'node',
    'apps/web/bin/owner.mjs',
    'revoke-sessions',
  ]);
  if (execStatus(revoked) !== 0 || !/^Revoked 0 sessions\./.test(revoked.stderr ?? '')) {
    fail('revoke-sessions did not run against /var/lib/portfolio', `exit ${execStatus(revoked)}`);
  }
  console.log('[image] revoke-sessions: runs as the server user against /var/lib/portfolio');
}

async function smoke() {
  const platformArgs = platform ? ['--platform', platform] : [];
  const label = `${image}${platform ? ` (${platform})` : ''}`;
  if (pulled) {
    console.log(`[image] pulling ${label} with ${cli}`);
    const pull = container(['pull', ...platformArgs, image], { stdio: 'inherit' });
    if (pull.status !== 0) {
      throw new SmokeFailure('the image could not be pulled', { test: 'image pulls' });
    }
  } else {
    console.log(`[image] building ${label} with ${cli}`);
    const build = container(['build', ...platformArgs, '-t', image, '.'], { stdio: 'inherit' });
    if (build.status !== 0) {
      throw new SmokeFailure('the image build failed', {
        test: 'image builds',
        actual: `exit ${build.status}`,
      });
    }
  }

  // No published port: an internal network has no route out, and every check
  // runs inside the container.
  const net = container(['network', 'create', '--internal', network]);
  if (net.status !== 0) {
    throw new SmokeFailure(`could not create the internal network: ${net.stderr.trim()}`, {
      test: 'internal network',
    });
  }
  const run = container([
    'run',
    '-d',
    '--name',
    name,
    '--network',
    network,
    ...platformArgs,
    '-v',
    `${path.join(REPO_ROOT, 'tests', 'fixtures')}:/config:ro`,
    '-e',
    'TZ=UTC',
    '-e',
    'PORTFOLIO_PROFILE=read-only',
    '-e',
    'PORTFOLIO_ORIGIN=https://rowan.test',
    '-e',
    'PORTFOLIO_SOURCE_DIR=/config',
    image,
  ]);
  if (run.status !== 0) {
    throw new SmokeFailure(`the container did not start: ${run.stderr.trim()}`, {
      test: 'container starts',
    });
  }

  const running = () =>
    container(['inspect', '--format', '{{.State.Running}}', name]).stdout.trim() === 'true';
  const health = await waitFor(
    () => {
      const response = probe('/api/health');
      return response.status === 200 ? response : undefined;
    },
    { timeoutMs, alive: running, what: 'GET /api/health to answer 200' },
  ).catch((error) => {
    throw new SmokeFailure(error.message, {
      test: 'GET /api/health',
      route: '/api/health',
      expected: 200,
    });
  });
  if (JSON.parse(health.body).status !== 'ok') {
    throw new SmokeFailure('/api/health answered without status: ok', {
      test: 'GET /api/health',
      route: '/api/health',
      expected: 'status: ok',
      actual: health.body.slice(0, 200),
    });
  }
  console.log(`[image] GET /api/health -> 200 ${health.body}`);

  const inspect = container([
    'image',
    'inspect',
    '--format',
    '{{json .Config.Healthcheck}}',
    image,
  ]);
  const healthcheck = JSON.parse(inspect.stdout || 'null');
  const [kind, ...command] = healthcheck?.Test ?? [];
  if (kind !== 'CMD' && kind !== 'CMD-SHELL') {
    throw new SmokeFailure('the image has no HEALTHCHECK command', { test: 'image HEALTHCHECK' });
  }
  const check = container(['exec', name, ...(kind === 'CMD' ? command : ['sh', '-c', command[0]])]);
  if (check.status !== 0) {
    throw new SmokeFailure('the image HEALTHCHECK command failed inside the container', {
      test: 'image HEALTHCHECK',
      expected: 'exit 0',
      actual: `exit ${check.status}`,
    });
  }
  console.log('[image] HEALTHCHECK command -> exit 0');

  const home = probe('/');
  if (home.status !== 200 || !home.body?.includes(FIXTURE_NAME)) {
    throw new SmokeFailure(
      `GET / did not render the mounted fixture (${home.status ?? home.error})`,
      {
        test: 'GET / renders the mounted portfolio',
        route: '/',
        expected: `200 containing ${FIXTURE_NAME}`,
        actual: home.status ?? home.error,
      },
    );
  }
  console.log('[image] GET / -> 200 with the mounted fixture');

  const scan = JSON.parse(
    container(['exec', name, 'node', '-e', SCAN_SNIPPET, '/app']).stdout || '{}',
  );
  if (!Array.isArray(scan.problems) || scan.problems.length > 0 || !scan.example) {
    const found = scan.problems?.join(', ') || 'none';
    throw new SmokeFailure(
      `the image ships files it must not (found: ${found}; example: ${scan.example})`,
      {
        test: 'image contents',
        expected:
          'only portfolio.example.yml and site.example.yml; no tests, ci, reports, .env*, or .git',
        actual: found,
      },
    );
  }
  console.log('[image] image contents: only the example pair, no test or CI files');

  // The server runs as uid 1001 in group 1001, and the app tree is root's.
  const owned = JSON.parse(
    container(['exec', name, 'node', '-e', WRITABLE_SNIPPET, '/app', '1001', '1001']).stdout ||
      '{}',
  );
  if (owned.count !== 0) {
    throw new SmokeFailure(
      `the server's user can change ${owned.count ?? 'unknown'} paths in /app (${owned.writable?.join(', ') ?? 'none listed'})`,
      {
        test: 'app tree owned by root',
        expected: 'nothing under /app writable by uid 1001',
        actual: owned.count,
      },
    );
  }
  console.log("[image] /app: nothing the server's user can change");

  await checkOwnerCli();

  const routes = assessRoutes(container(['exec', name, 'ip', 'route']), cli === 'docker');
  if (!routes.ok) {
    throw new SmokeFailure(routes.message, {
      test: 'container runs on an internal network',
      expected: 'no default route',
      actual: routes.message,
    });
  }
  console.log(`[image] ${routes.warning ? `warning: ${cli}: ${routes.warning}` : routes.message}`);
}

let exitCode = 0;
try {
  await smoke();
  console.log(`[image] ${image}${platform ? ` (${platform})` : ''} passed`);
} catch (error) {
  exitCode = 1;
  reportError(`image smoke: ${error.message}`, { title: 'image smoke' });
  saveLogs();
  const gate = currentGate();
  if (gate) {
    writeFailureRecord({
      ...gate,
      ...(error.fields ?? { test: 'image smoke' }),
      asset: image,
      artifacts: [path.relative(reportsDir(), LOG)],
    });
  }
} finally {
  container(['rm', '-f', name]);
  container(['network', 'rm', network]);
}
process.exit(exitCode);
