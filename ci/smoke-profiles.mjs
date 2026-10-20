#!/usr/bin/env node
// `pnpm smoke:profiles` (#1, slice 4 check, Verification items 3 and 4).
// Builds the image once without pushing it (or takes SMOKE_IMAGE) and runs
// it under each profile and each untagged fatal startup row, on an internal
// network, with every request sent from inside the container:
//
// - read-only, from the harness fixture mounted read-only, and demo, on the
//   bundled sample, each on a read-only root filesystem with a tmpfs at
//   Next's cache, as the Compose examples run them. Health and readiness
//   answer their documented shapes; every route the profile serves answers,
//   and every other route, retired route, and operation fails closed; every
//   response carries the baseline headers and no cookie. After all of that,
//   readiness still reports no owner module loaded, and the log holds one
//   deployment.config line with every secret unset.
// - owner, with deploy/compose.owner.yml's data directory on a named volume,
//   refuses to start with no authentication provider (until #2). The volume
//   starts out owned by uid 1001, mode 0700, as the image's directory is.
// - every startup row in tests/harness/startup-rows.mjs exits 1 with its
//   config.fatal lines and none of its canary values.
//
// Removes every container, network, and volume it creates, and the image
// when it built one.
//
// Environment:
//   CONTAINER_CLI     docker (default) or finch
//   IMAGE_TAG         tag to build (default portfolio:profiles)
//   SMOKE_IMAGE       test this image reference instead of building one (kept)
//   CONTAINER_PREFIX  container, network, and volume name prefix (default portfolio-ci-)
//   SMOKE_TIMEOUT_MS  how long to wait for /api/health (default 90000)
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { DEFAULT_PORTFOLIO } from '../tests/harness/app-server.mjs';
import { waitFor } from '../tests/harness/net.mjs';
import { checkRefusal, rowDocuments, STARTUP_ROWS } from '../tests/harness/startup-rows.mjs';
import { PROBE_SNIPPET, REQUESTS_SNIPPET } from './lib/container.mjs';
import {
  currentGate,
  REPO_ROOT,
  reportError,
  reportsDir,
  writeFailureRecord,
} from './lib/reports.mjs';

// The route table, the registry, and the capability matrix are TypeScript;
// the script runs under tsx (`node --import tsx`) to read them.
const require = createRequire(import.meta.url);
const { accessIn, CAPABILITIES, INDEXABLE } = require('../apps/web/src/server/capabilities.ts');
const { listOperations } = require('../apps/web/src/server/operations.ts');
const { listRoutes, RETIRED_PATTERNS, routeAccess } = require('../apps/web/src/server/routes.ts');

const cli = process.env.CONTAINER_CLI || 'docker';
const pulled = process.env.SMOKE_IMAGE;
const image = pulled || process.env.IMAGE_TAG || 'portfolio:profiles';
const prefix = process.env.CONTAINER_PREFIX || 'portfolio-ci-';
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 90_000);
const run = `${prefix}profiles-${process.pid}`;
const network = `${run}-net`;
const volume = `${run}-data`;
// Under the repo (gitignored) rather than os.tmpdir(): Finch's VM shares the
// home directory but not macOS's per-user temp directory.
const stateDir = path.join(REPO_ROOT, 'test-results', 'smoke-profiles', run);
const LOGS = path.join(reportsDir(), 'profiles');

const ORIGIN = 'https://rowan.test';
const DEMO_ORIGIN = 'https://demo.rowan.test';
const FIXTURE_NAME = 'Rowan Fixture';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const METHODS = ['GET', 'POST', 'PUT', 'DELETE'];
const BASELINE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy': "frame-ancestors 'none'",
};

const container = (args, options = {}) =>
  spawnSync(cli, args, { cwd: REPO_ROOT, encoding: 'utf8', ...options });
const envArgs = (env) => Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);

const failures = [];
function fail(test, message, fields = {}) {
  failures.push({ test, message, fields });
  console.log(`[profiles] FAIL ${test}: ${message}`);
}

/** A concrete path for a pattern, filling each dynamic segment. */
const concrete = (pattern) => pattern.replace(/\[\[?\.{0,3}[^\]]+\]\]?/g, 'sample') || '/';

/** What the transport answers a visitor with no session, by the registry and the matrix. */
function expectedOperation(profile, operation, method) {
  if (accessIn(profile, operation.capability) === 'absent') {
    return [404, 'not_available_in_profile'];
  }
  if (method !== (operation.kind === 'query' ? 'GET' : 'POST')) return [405, 'method_not_allowed'];
  if (operation.session) return [401, 'authentication_required'];
  // No provider: the origin check refuses every command.
  if (operation.kind === 'command') return [403, 'request_origin_rejected'];
  return [200, null];
}

/** What /api/ready answers for a profile whose checks all pass. */
function readyBody(profile) {
  return {
    status: 'ready',
    profile,
    capabilities: CAPABILITIES.flatMap((id) => {
      const access = accessIn(profile, id);
      return access === 'absent' ? [] : [{ id, access }];
    }),
    checks: [
      { id: 'catalog', status: 'ok' },
      { id: 'packs', status: 'ok' },
      { id: 'owner-modules', status: 'ok' },
    ],
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function parse(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/**
 * The requests a profile's container gets, each with the problems its
 * response shows: the route matrix, health, and readiness.
 */
function plan(profile) {
  const requests = [];
  const add = (method, pathname, check) =>
    requests.push({ method, path: pathname, ...(method === 'GET' ? {} : { body: {} }), check });
  const status = (expected) => (response) =>
    response.status === expected ? [] : [`answered ${response.status}, not ${expected}`];
  const noStore = (response) =>
    response.headers['cache-control'] === 'no-store' ? [] : ['no Cache-Control: no-store'];

  add('GET', '/api/health', (response) => [
    ...status(200)(response),
    ...noStore(response),
    ...(same(parse(response.body), { status: 'ok', profile })
      ? []
      : [`body ${response.body.slice(0, 200)}`]),
  ]);
  add('GET', '/api/ready', (response) => [
    ...status(200)(response),
    ...noStore(response),
    ...(same(parse(response.body), readyBody(profile))
      ? []
      : [`body ${response.body.slice(0, 300)}`]),
  ]);
  for (const entry of listRoutes().filter((route) => route.capability !== 'operations')) {
    if (routeAccess(profile, entry) !== 'absent') {
      add('GET', concrete(entry.pattern), (response) => [
        ...status(200)(response),
        ...(UUID.test(response.headers['x-request-id'] ?? '') ? [] : ['no x-request-id']),
      ]);
    } else {
      for (const method of METHODS) add(method, concrete(entry.pattern), status(404));
    }
  }
  for (const pattern of RETIRED_PATTERNS) {
    for (const method of METHODS) {
      add(method, concrete(pattern), (response) => [
        ...status(404)(response),
        ...noStore(response),
      ]);
    }
  }
  for (const operation of listOperations()) {
    for (const method of METHODS) {
      const [expected, code] = expectedOperation(profile, operation, method);
      add(method, `/api/studio/${operation.name}`, (response) => {
        const problems = [...status(expected)(response), ...noStore(response)];
        if (code !== null && parse(response.body)?.error?.code !== code) {
          problems.push(`not the ${code} envelope`);
        }
        return problems;
      });
    }
  }
  // Every response: the baseline headers, no cookie, and noindex exactly
  // where the profile can't be indexed.
  for (const request of requests) {
    const own = request.check;
    request.check = (response) => {
      if (response.error) return [`no answer (${response.error})`];
      const problems = own(response);
      for (const [name, value] of Object.entries(BASELINE_HEADERS)) {
        if (response.headers[name] !== value) problems.push(`${name} is ${response.headers[name]}`);
      }
      if (response.headers['set-cookie'] !== undefined) problems.push('sets a cookie');
      const robots = INDEXABLE[profile] ? undefined : 'noindex';
      if (response.headers['x-robots-tag'] !== robots) {
        problems.push(`X-Robots-Tag is ${response.headers['x-robots-tag']}, not ${robots}`);
      }
      return problems;
    };
  }
  return requests;
}

/** Sends `requests` from inside the container, in order. Pages and images make it long. */
function send(name, requests) {
  const result = container(
    ['exec', name, 'node', '-e', REQUESTS_SNIPPET, JSON.stringify(requests)],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const responses = parse(result.stdout ?? '');
  if (!Array.isArray(responses) || responses.length !== requests.length) {
    throw new Error(`the in-container requests failed: ${(result.stderr || '').trim()}`);
  }
  return responses;
}

/** JSON log lines among a container's output. */
function logEntries(text) {
  return text
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map(parse)
    .filter(Boolean);
}

function saveLogs(name, text) {
  mkdirSync(LOGS, { recursive: true });
  const file = path.join(LOGS, `${name}.log`);
  writeFileSync(file, text);
  return path.relative(reportsDir(), file);
}

async function profileRun(profile, { env, mounts = [] }) {
  const name = `${run}-${profile}`;
  const started = container([
    'run',
    '-d',
    '--name',
    name,
    '--network',
    network,
    '--read-only',
    '--tmpfs',
    '/app/apps/web/.next/cache',
    ...mounts,
    ...envArgs({ TZ: 'UTC', ...env }),
    image,
  ]);
  if (started.status !== 0) {
    fail(profile, `the container did not start: ${(started.stderr || '').trim()}`);
    return;
  }
  const failed = failures.length;
  try {
    const running = () =>
      container(['inspect', '--format', '{{.State.Running}}', name]).stdout.trim() === 'true';
    await waitFor(
      () => {
        const result = container(['exec', name, 'node', '-e', PROBE_SNIPPET, '/api/health']);
        return parse(result.stdout ?? '')?.status === 200 ? true : undefined;
      },
      { timeoutMs, alive: running, what: `${profile}: GET /api/health to answer 200` },
    );

    const requests = plan(profile);
    const responses = send(
      name,
      requests.map(({ method, path: pathname, body }) => ({ method, path: pathname, body })),
    );
    requests.forEach((request, index) => {
      for (const problem of request.check(responses[index])) {
        fail(profile, `${request.method} ${request.path} ${problem}`, {
          profile,
          route: request.path,
        });
      }
    });
    const home = responses[requests.findIndex((request) => request.path === '/')];
    const expectedName = profile === 'demo' ? 'Anamika Devi' : FIXTURE_NAME;
    if (!home?.body?.includes(expectedName)) fail(profile, `GET / doesn't show ${expectedName}`);
    console.log(`[profiles] ${profile}: ${requests.length} requests checked`);

    // Every route and operation done, still no owner module.
    const [ready] = send(name, [{ method: 'GET', path: '/api/ready' }]);
    const checks = parse(ready.body)?.checks ?? [];
    if (!checks.some((check) => same(check, { id: 'owner-modules', status: 'ok' }))) {
      fail(profile, `after every route, owner-modules isn't ok: ${ready.body}`, {
        route: '/api/ready',
      });
    } else {
      console.log(`[profiles] ${profile}: owner-modules ok after every route`);
    }

    const logs = container(['logs', name]);
    const text = `${logs.stdout ?? ''}${logs.stderr ?? ''}`;
    const summaries = logEntries(text).filter((entry) => entry.event === 'deployment.config');
    if (summaries.length !== 1) {
      fail(profile, `logged deployment.config ${summaries.length} times, not once`);
    } else {
      const [summary] = summaries;
      const secrets = Object.values(summary.secrets ?? {});
      if (summary.profile !== profile || summary.origin !== env.PORTFOLIO_ORIGIN) {
        fail(profile, `deployment.config names ${summary.profile} at ${summary.origin}`);
      }
      if (secrets.length === 0 || secrets.some((state) => state !== 'unset')) {
        fail(profile, `deployment.config secrets are ${JSON.stringify(summary.secrets)}`);
      }
    }
    // A write the read-only root refused shows up as EROFS.
    if (/EROFS|read-only file system/i.test(text)) {
      fail(profile, 'a write hit the read-only root filesystem');
    }
    if (failures.length > failed) saveLogs(name, text);
    else console.log(`[profiles] ${profile} passed`);
  } catch (error) {
    fail(profile, error.message);
    const logs = container(['logs', name]);
    saveLogs(name, `${logs.stdout ?? ''}${logs.stderr ?? ''}`);
  } finally {
    container(['rm', '-f', name]);
  }
}

/**
 * Runs a container that should exit. Returns its exit code, its stdout, and
 * all output, the runtime's own warnings on stderr included.
 */
function runToExit(name, args) {
  const result = container(['run', '--rm', '--name', name, '--network', network, ...args], {
    timeout: 60_000,
  });
  // Gone already unless it hung past the timeout.
  container(['rm', '-f', name]);
  const stdout = result.stdout ?? '';
  return { code: result.status, stdout, output: `${stdout}${result.stderr ?? ''}` };
}

function ownerRun() {
  const test = 'owner';
  const stat = (mounts) =>
    runToExit(`${run}-stat`, [...mounts, image, 'stat', '-c', '%u:%g %a', '/var/lib/portfolio']);
  for (const [what, mounts] of [
    ['the image', []],
    ['a new named volume', ['-v', `${volume}:/var/lib/portfolio`]],
  ]) {
    const { code, stdout } = stat(mounts);
    if (code !== 0 || stdout.trim() !== '1001:1001 700') {
      fail(
        test,
        `/var/lib/portfolio in ${what} is ${stdout.trim() || `exit ${code}`}, not 1001:1001 700`,
      );
    } else {
      console.log(`[profiles] owner: /var/lib/portfolio in ${what} is 1001:1001 700`);
    }
  }
  const { code, output } = runToExit(`${run}-owner`, [
    '-v',
    `${path.dirname(DEFAULT_PORTFOLIO)}:/config:ro`,
    '-v',
    `${volume}:/var/lib/portfolio`,
    ...envArgs({
      PORTFOLIO_PROFILE: 'owner',
      PORTFOLIO_ORIGIN: ORIGIN,
      PORTFOLIO_SOURCE_DIR: '/config',
      PORTFOLIO_DATA_DIR: '/var/lib/portfolio',
    }),
    image,
  ]);
  const fatal = logEntries(output).filter((entry) => entry.event === 'config.fatal');
  const keys = fatal.map((entry) => `${entry.key}:${entry.code}`);
  if (code !== 1 || !same(keys, ['PORTFOLIO_PROFILE:auth_provider_missing'])) {
    fail(test, `exit ${code}, ${JSON.stringify(keys)}: not the no-provider refusal`);
  } else {
    console.log('[profiles] owner: refuses to start with no authentication provider');
  }
}

function rowRuns() {
  let passed = 0;
  STARTUP_ROWS.forEach((row, index) => {
    const dir = path.join(stateDir, `row-${index}`);
    const config = path.join(dir, 'config');
    const files = path.join(dir, 'files');
    mkdirSync(config, { recursive: true });
    mkdirSync(files, { recursive: true });
    for (const [name, text] of Object.entries(rowDocuments(row))) {
      writeFileSync(path.join(config, name), text);
    }
    for (const [name, text] of Object.entries(row.files ?? {})) {
      writeFileSync(path.join(files, name), text);
    }
    const paths = { source: '/config', beside: (name) => `/files/${name}` };
    const { code, output } = runToExit(`${run}-row-${index}`, [
      // The server runs as uid 1001, which can't read a root-owned 0000 tmpfs.
      ...(row.unreadable ? ['--tmpfs', '/config:mode=0000'] : ['-v', `${config}:/config:ro`]),
      '-v',
      `${files}:/files:ro`,
      ...envArgs(row.env(paths)),
      image,
    ]);
    const test = `startup row: ${row.group}, ${row.name}`;
    const problems = checkRefusal(row, paths, output);
    if (code !== 1) problems.unshift(`exited ${code ?? 'never'}, not 1`);
    for (const problem of problems) fail(test, problem);
    if (problems.length === 0) passed += 1;
    else saveLogs(`${run}-row-${index}`, output);
  });
  console.log(`[profiles] startup rows: ${passed} of ${STARTUP_ROWS.length} passed`);
}

async function smoke() {
  if (pulled) {
    console.log(`[profiles] pulling ${image} with ${cli}`);
    if (container(['pull', image], { stdio: 'inherit' }).status !== 0) {
      throw new Error('the image could not be pulled');
    }
  } else {
    console.log(`[profiles] building ${image} with ${cli}`);
    if (container(['build', '-t', image, '.'], { stdio: 'inherit' }).status !== 0) {
      throw new Error('the image build failed');
    }
  }
  const net = container(['network', 'create', '--internal', network]);
  if (net.status !== 0) throw new Error(`could not create the network: ${net.stderr.trim()}`);
  if (container(['volume', 'create', volume]).status !== 0) {
    throw new Error('could not create the data volume');
  }
  mkdirSync(stateDir, { recursive: true });

  await profileRun('read-only', {
    env: {
      PORTFOLIO_PROFILE: 'read-only',
      PORTFOLIO_ORIGIN: ORIGIN,
      PORTFOLIO_SOURCE_DIR: '/config',
    },
    mounts: ['-v', `${path.dirname(DEFAULT_PORTFOLIO)}:/config:ro`],
  });
  await profileRun('demo', {
    env: { PORTFOLIO_PROFILE: 'demo', PORTFOLIO_ORIGIN: DEMO_ORIGIN },
  });
  ownerRun();
  rowRuns();
}

let exitCode = 0;
try {
  await smoke();
} catch (error) {
  fail('smoke:profiles', error.message);
} finally {
  container(['network', 'rm', network]);
  container(['volume', 'rm', '-f', volume]);
  rmSync(stateDir, { recursive: true, force: true });
  if (!pulled) container(['rmi', image]);
}
if (failures.length > 0) {
  exitCode = 1;
  reportError(`smoke:profiles: ${failures.length} failure(s)`, { title: 'smoke:profiles' });
  const gate = currentGate();
  for (const { test, message, fields } of failures) {
    if (gate) writeFailureRecord({ ...gate, test, actual: message, asset: image, ...fields });
  }
} else {
  console.log(`[profiles] ${image} passed under every profile and startup row`);
}
process.exit(exitCode);
