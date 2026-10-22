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
//   and every other route, retired route, and operation fails closed, as
//   /_next/image does, with the optimizer off and nothing logged; every
//   response carries the baseline headers and no cookie, and none carries a
//   canary (tests/harness/canaries.mjs) or the server's own path. After all
//   of that, readiness still reports no owner module loaded, and the log
//   holds one deployment.config line with every secret unset.
// - owner, with the password provider (#2), on the same read-only root and
//   cache tmpfs, with the harness fixture at a canary path, its data
//   directory on a new named volume at /var/lib/portfolio as
//   deploy/compose.owner.yml mounts it, and a hash the image's own
//   hash-password --stdin made for a password made for the run, in a _FILE
//   beside the hop count. The same matrix and canary scan as read-only, with
//   the password, the hash, and the data directory among the canaries, and
//   one deployment.config line with only the hash set. Then the owner signs
//   in: no response to a signed-in request carries a canary, but for the
//   summary config.status gives an owner session, sign-out ends the
//   session, and neither the log nor the data directory holds the password
//   or the hash.
// - owner with no password hash refuses to start for the hash alone: the
//   data directory passes. Its volume starts out owned by uid 1001, mode
//   0700, as the image's directory is.
// - every startup row in tests/harness/startup-rows.mjs that refuses exits 1
//   with its config.fatal lines and none of its canary values, and every one
//   that starts serves with its config.warning lines and none of its values.
// - readiness says degraded, and the log carries the variant.unavailable
//   warning, while the fallback composition renders in place of the
//   profile's selected variant (#5).
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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { DEFAULT_PORTFOLIO, DEFAULT_SITE } from '../tests/harness/app-server.mjs';
import {
  CANARY_BODY,
  CANARY_SECRET,
  CANARY_SOURCE,
  canaries,
  FORGED_LINE,
  hashCanaries,
  HOPS_FILE,
  IMAGE_PROBE,
} from '../tests/harness/canaries.mjs';
import { waitFor } from '../tests/harness/net.mjs';
import { ownerSecret } from '../tests/harness/owner-secret.mjs';
import { headerProblems, isStudioPath } from '../tests/harness/route-headers.mjs';
import {
  checkRefusal,
  checkWarnings,
  rowDocuments,
  STARTUP_ROWS,
  WARNING_ROWS,
  warningLines,
} from '../tests/harness/startup-rows.mjs';
import { PROBE_SNIPPET, REQUESTS_SNIPPET, TREE_SNIPPET } from './lib/container.mjs';
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
const ownerVolume = `${run}-owner-data`;
// Under the repo (gitignored) rather than os.tmpdir(): Finch's VM shares the
// home directory but not macOS's per-user temp directory.
const stateDir = path.join(REPO_ROOT, 'test-results', 'smoke-profiles', run);
const LOGS = path.join(reportsDir(), 'profiles');

const ORIGIN = 'https://rowan.test';
const DEMO_ORIGIN = 'https://demo.rowan.test';
const FIXTURE_NAME = 'Rowan Fixture';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const METHODS = ['GET', 'POST', 'PUT', 'DELETE'];
// The server's working directory in the image, which no response may name.
const SERVER_DIR = '/app/apps/web';
// The canary _FILE, mounted read-only in every profile's container.
const SECRET_DIR = `/run/${CANARY_SECRET}`;
// Owner's hash, beside it, and its data directory, where compose.owner.yml puts it.
const HASH_FILE = 'owner_password_hash';
const DATA_DIR = '/var/lib/portfolio';
const SESSION_COOKIE =
  /^__Host-studio_session=([A-Za-z0-9_-]{43}); Path=\/; Max-Age=\d+; HttpOnly; SameSite=Strict; Secure$/;

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
  // These requests send no Origin, so the origin check refuses every
  // command: owner's provider wants the exact one, and the other profiles
  // bind no provider, whose check refuses them all.
  if (operation.kind === 'command') return [403, 'request_origin_rejected'];
  return [200, null];
}

/**
 * The variant ids this build registers, read from @portfolio/web's
 * dependencies as the image's prebuild reads them, without writing anything.
 */
function registeredVariants() {
  const script = path.join(REPO_ROOT, 'apps', 'web', 'scripts', 'build-registry.ts');
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', script, '--check', '--format', 'json'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) {
    throw new Error(`the registry doesn't build: ${result.stdout}${result.stderr}`.trim());
  }
  return JSON.parse(result.stdout).variants.map((variant) => variant.id);
}
let registered;

/** The variant each profile's site selects: the harness fixture's, or the bundled sample's. */
const SELECTED = Object.fromEntries(
  Object.entries({
    'read-only': DEFAULT_SITE,
    owner: DEFAULT_SITE,
    demo: path.join(REPO_ROOT, 'site.example.yml'),
  }).map(([profile, file]) => [profile, parseYaml(readFileSync(file, 'utf8')).appearance.variant]),
);

/** `degraded` while the fallback composition renders in place of the profile's variant (#5). */
function packsStatus(profile) {
  registered ??= registeredVariants();
  return registered.includes(SELECTED[profile]) ? 'ok' : 'degraded';
}

/** What /api/ready answers for a profile whose checks pass, or the packs check only degrades. */
function readyBody(profile) {
  const packs = packsStatus(profile);
  return {
    status: packs === 'ok' ? 'ready' : 'degraded',
    profile,
    capabilities: CAPABILITIES.flatMap((id) => {
      const access = accessIn(profile, id);
      return access === 'absent' ? [] : [{ id, access }];
    }),
    checks: [
      { id: 'catalog', status: 'ok' },
      { id: 'packs', status: packs },
      // Owner's modules are its own.
      ...(profile === 'owner' ? [] : [{ id: 'owner-modules', status: 'ok' }]),
    ],
  };
}

/** Every path the leak scans request: each route, retired route, and operation, and some that don't exist. */
function scanTargets() {
  return [
    ...listRoutes()
      .filter((route) => route.capability !== 'operations')
      .map((route) => concrete(route.pattern)),
    ...RETIRED_PATTERNS.map(concrete),
    IMAGE_PROBE,
    ...listOperations().map((operation) => `/api/studio/${operation.name}`),
    '/api/studio/no.such.operation',
    '/no-such-page',
    '/api/no-such-route',
  ];
}

/** The canaries a response or a header carries, as problems. */
function leaksIn(response, leaks) {
  const problems = [];
  const headers = Object.entries(response.headers ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
  for (const canary of leaks) {
    if (headers.includes(canary)) problems.push(`a header carries ${canary}`);
    if ((response.body ?? '').includes(canary)) problems.push(`the body carries ${canary}`);
  }
  return problems;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function parse(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** Whether `profile` serves a Studio page, as owner does: under another, /studio is as unknown as any path (#2). */
const hasStudio = (profile) =>
  listRoutes().some(
    (entry) =>
      entry.kind === 'page' &&
      isStudioPath(entry.pattern) &&
      routeAccess(profile, entry) !== 'absent',
  );

/**
 * The requests a profile's container gets, each with the problems its
 * response shows: the route matrix, health, and readiness. `leaks` are the
 * canaries no response may carry.
 */
function plan(profile, leaks) {
  const requests = [];
  const add = (method, pathname, check) =>
    requests.push({
      method,
      path: pathname,
      ...(method === 'GET' ? {} : { body: { draft: CANARY_BODY } }),
      check,
    });
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
    const access = routeAccess(profile, entry);
    if (access === 'session' && entry.kind === 'page') {
      // No session cookie: proxy.ts sends it to sign-in on the canonical origin (#2).
      add('GET', concrete(entry.pattern), (response) => {
        const location = new URL(response.headers.location ?? '', 'http://unset.invalid');
        return [
          ...status(303)(response),
          ...(location.origin === ORIGIN && location.pathname === '/studio/sign-in'
            ? []
            : [`goes to ${response.headers.location}, not sign-in`]),
          ...(UUID.test(response.headers['x-request-id'] ?? '') ? [] : ['no x-request-id']),
        ];
      });
    } else if (access !== 'absent') {
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
  // No image optimizer (next.config.ts): the 404 page, whatever the url says.
  for (const method of METHODS) add(method, IMAGE_PROBE, status(404));
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
  // Every response: the headers its path gets (route-headers.mjs), no
  // cookie, noindex exactly where the profile can't be indexed, and no
  // canary in a header or the body.
  for (const request of requests) {
    const own = request.check;
    request.check = (response) => {
      if (response.error) return [`no answer (${response.error})`];
      const problems = [
        ...own(response),
        ...leaksIn(response, leaks),
        ...headerProblems(
          new URL(request.path, 'http://unset.invalid').pathname,
          response.headers,
          {
            studio: hasStudio(profile),
          },
        ),
      ];
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
  // On stdin, never as an argument: a batch is too long for one.
  const result = container(['exec', '-i', name, 'node', '-e', REQUESTS_SNIPPET], {
    input: JSON.stringify(requests),
    maxBuffer: 64 * 1024 * 1024,
  });
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

/**
 * Runs `profile`'s container through the matrix and the canary scan, with
 * `secrets` among the canaries, which the log mustn't hold either, and
 * `paths`, which no response may name. `then` runs next against the same
 * container, for owner's signed-in checks, and returns its problems.
 */
async function profileRun(profile, { env, mounts = [], secrets = [], paths = [], then }) {
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
    '-v',
    `${path.join(stateDir, CANARY_SECRET)}:${SECRET_DIR}:ro`,
    ...mounts,
    ...envArgs({ TZ: 'UTC', [HOPS_FILE.key]: `${SECRET_DIR}/${HOPS_FILE.name}`, ...env }),
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

    const requests = plan(profile, canaries(SERVER_DIR, { secrets: [...secrets, ...paths] }));
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

    // Every route and operation done, still no owner module, outside owner.
    if (profile !== 'owner') {
      const [ready] = send(name, [{ method: 'GET', path: '/api/ready' }]);
      const checks = parse(ready.body)?.checks ?? [];
      if (!checks.some((check) => same(check, { id: 'owner-modules', status: 'ok' }))) {
        fail(profile, `after every route, owner-modules isn't ok: ${ready.body}`, {
          route: '/api/ready',
        });
      } else {
        console.log(`[profiles] ${profile}: owner-modules ok after every route`);
      }
    }
    for (const problem of then ? then(name) : []) fail(profile, problem);

    const logs = container(['logs', name]);
    const text = `${logs.stdout ?? ''}${logs.stderr ?? ''}`;
    const summaries = logEntries(text).filter((entry) => entry.event === 'deployment.config');
    if (summaries.length !== 1) {
      fail(profile, `logged deployment.config ${summaries.length} times, not once`);
    } else {
      const [summary] = summaries;
      // Only owner's hash is set, and only under owner.
      const expected = {
        PORTFOLIO_AUTH_PASSWORD_HASH: profile === 'owner' ? 'set' : 'unset',
        GITHUB_TOKEN: 'unset',
      };
      if (summary.profile !== profile || summary.origin !== env.PORTFOLIO_ORIGIN) {
        fail(profile, `deployment.config names ${summary.profile} at ${summary.origin}`);
      }
      if (!same(summary.secrets, expected)) {
        fail(profile, `deployment.config secrets are ${JSON.stringify(summary.secrets)}`);
      }
    }
    // The owner's diagnostic while the fallback composition stands in, which
    // never names the selected variant.
    const unavailable = warningLines(text).filter((entry) => entry.code === 'variant.unavailable');
    const expected = packsStatus(profile) === 'degraded' ? 1 : 0;
    if (unavailable.length !== expected) {
      fail(profile, `logged variant.unavailable ${unavailable.length} times, not ${expected}`);
    } else if (unavailable[0] && unavailable[0].path !== '/appearance/variant') {
      fail(profile, `variant.unavailable is at ${unavailable[0].path}, not /appearance/variant`);
    }
    if (text.includes(SELECTED[profile])) fail(profile, 'the log names the selected variant');
    if (text.includes(FORGED_LINE)) fail(profile, 'a /_next/image url reached the log as a line');
    // A write the read-only root refused shows up as EROFS.
    if (/EROFS|read-only file system/i.test(text)) {
      fail(profile, 'a write hit the read-only root filesystem');
    }
    for (const secret of secrets) {
      if (text.includes(secret)) fail(profile, 'the log holds the password or the hash');
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

/**
 * Owner signed in (#2), with the run's password: no response to a signed-in
 * request carries a canary, but for the summary config.status gives an owner
 * session; sign-out ends the session; and the data directory holds neither
 * the password nor the hash. Returns the problems found.
 */
function signedIn(name, { password, secrets }) {
  const problems = [];
  const [login] = send(name, [
    {
      method: 'POST',
      path: '/api/studio/auth.login',
      body: { password },
      headers: { origin: ORIGIN },
    },
  ]);
  const token = login.cookies?.length === 1 ? SESSION_COOKIE.exec(login.cookies[0])?.[1] : null;
  const csrf = parse(login.body ?? '')?.data?.csrfToken;
  if (login.status !== 200 || !token || typeof csrf !== 'string') {
    return [
      `sign-in answered ${login.status ?? login.error}, setting ${login.cookies?.length} cookies`,
    ];
  }
  const headers = {
    origin: ORIGIN,
    cookie: `__Host-studio_session=${token}`,
    'x-csrf-token': csrf,
  };
  const requests = scanTargets().flatMap((target) =>
    ['GET', 'POST'].map((method) => ({
      method,
      path: target,
      headers,
      ...(method === 'GET' ? {} : { body: { draft: CANARY_BODY } }),
    })),
  );
  const session = { method: 'GET', path: '/api/studio/auth.session', headers };
  const responses = send(name, [
    ...requests,
    session,
    { method: 'POST', path: '/api/studio/auth.logout', headers, body: {} },
    session,
  ]);
  const leaks = canaries(SERVER_DIR, { secrets: [...secrets, DATA_DIR], summary: false });
  requests.forEach((request, index) => {
    const response = responses[index];
    if (response.error) problems.push(`signed in, ${request.method} ${request.path}: no answer`);
    for (const problem of leaksIn(response, leaks)) {
      problems.push(`signed in, ${request.method} ${request.path} ${problem}`);
    }
  });
  const [before, out, after] = responses.slice(requests.length);
  // The scan's bodies fit no auth command, so the session lasts until sign-out.
  if (before.status !== 200)
    problems.push(`after the scan, auth.session answered ${before.status}`);
  if (
    out.status !== 200 ||
    out.headers['clear-site-data'] !== '"cache"' ||
    !/^__Host-studio_session=; Path=\/; Max-Age=0;/.test(out.cookies?.[0] ?? '')
  ) {
    problems.push(`sign-out answered ${out.status}, clearing ${JSON.stringify(out.cookies)}`);
  }
  if (after.status !== 401) problems.push(`after sign-out, auth.session answered ${after.status}`);

  // What the server wrote: its sessions and the audit log.
  const tree = container(['exec', name, 'node', '-e', TREE_SNIPPET, DATA_DIR], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const files = parse(tree.stdout ?? '')?.files;
  if (!files || !Object.keys(files).some((file) => file.startsWith('audit/'))) {
    problems.push(`the data directory couldn't be read, or has no audit log: ${tree.stderr}`);
  } else {
    for (const [file, text] of Object.entries(files)) {
      if (secrets.some((secret) => text.includes(secret))) {
        problems.push(`${file} in the data directory holds the password or the hash`);
      }
    }
  }
  if (problems.length === 0) {
    console.log(
      `[profiles] owner: signed in, ${requests.length} requests carry no canary; sign-out ends the session`,
    );
  }
  return problems;
}

/** Owner with the password provider, on a new data volume and a hash made for this run. */
async function ownerProfileRun(source) {
  // The image's own hash-password, given the password on stdin that isn't a terminal.
  const hasher = `${run}-hash`;
  let secret;
  try {
    secret = ownerSecret([
      cli,
      'run',
      '--rm',
      '-i',
      '--name',
      hasher,
      '--network',
      network,
      image,
      'node',
      'apps/web/bin/owner.mjs',
    ]);
  } finally {
    container(['rm', '-f', hasher]);
  }
  writeFileSync(path.join(stateDir, CANARY_SECRET, HASH_FILE), `${secret.hash}\n`);
  if (container(['volume', 'create', ownerVolume]).status !== 0) {
    throw new Error("could not create owner's data volume");
  }
  const secrets = [secret.password, ...hashCanaries(secret.hash)];
  await profileRun('owner', {
    env: {
      PORTFOLIO_PROFILE: 'owner',
      PORTFOLIO_ORIGIN: ORIGIN,
      PORTFOLIO_SOURCE_DIR: source,
      PORTFOLIO_DATA_DIR: DATA_DIR,
      PORTFOLIO_AUTH_PASSWORD_HASH_FILE: `${SECRET_DIR}/${HASH_FILE}`,
    },
    mounts: [
      '-v',
      `${path.dirname(DEFAULT_PORTFOLIO)}:${source}:ro`,
      '-v',
      `${ownerVolume}:${DATA_DIR}`,
    ],
    secrets,
    // No response names the data directory either.
    paths: [DATA_DIR],
    then: (name) => signedIn(name, { password: secret.password, secrets }),
  });
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
  if (code !== 1 || !same(keys, ['PORTFOLIO_AUTH_PASSWORD_HASH_FILE:required'])) {
    fail(test, `exit ${code}, ${JSON.stringify(keys)}: not the missing-hash refusal`);
  } else {
    console.log('[profiles] owner: refuses to start without a password hash, on its data volume');
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

/** Each startup row that starts: it serves, and logs its warnings without their values. */
async function warningRowRuns() {
  let passed = 0;
  for (const [index, row] of WARNING_ROWS.entries()) {
    const name = `${run}-warning-${index}`;
    const test = `startup row: ${row.group}, ${row.name}`;
    const config = path.join(stateDir, `warning-${index}`, 'config');
    mkdirSync(config, { recursive: true });
    for (const [file, text] of Object.entries(row.documents)) {
      writeFileSync(path.join(config, file), text);
    }
    const paths = { source: '/config', beside: (file) => `/files/${file}` };
    const started = container([
      'run',
      '-d',
      '--name',
      name,
      '--network',
      network,
      '-v',
      `${config}:/config:ro`,
      ...envArgs(row.env(paths)),
      image,
    ]);
    if (started.status !== 0) {
      fail(test, `the container did not start: ${(started.stderr || '').trim()}`);
      continue;
    }
    const output = () => {
      const logs = container(['logs', name]);
      return `${logs.stdout ?? ''}${logs.stderr ?? ''}`;
    };
    try {
      const running = () =>
        container(['inspect', '--format', '{{.State.Running}}', name]).stdout.trim() === 'true';
      await waitFor(
        () => {
          const result = container(['exec', name, 'node', '-e', PROBE_SNIPPET, '/api/health']);
          return parse(result.stdout ?? '')?.status === 200 ? true : undefined;
        },
        { timeoutMs, alive: running, what: `${test}: GET /api/health to answer 200` },
      );
      const problems = checkWarnings(row, output());
      for (const problem of problems) fail(test, problem);
      if (problems.length === 0) passed += 1;
      else saveLogs(name, output());
    } catch (error) {
      fail(test, error.message);
      saveLogs(name, output());
    } finally {
      container(['rm', '-f', name]);
    }
  }
  console.log(`[profiles] warning rows: ${passed} of ${WARNING_ROWS.length} passed`);
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
  mkdirSync(path.join(stateDir, CANARY_SECRET), { recursive: true });
  writeFileSync(path.join(stateDir, CANARY_SECRET, HOPS_FILE.name), HOPS_FILE.text);

  // The source directory at a canary path, so a response naming it shows.
  const source = `/${CANARY_SOURCE}`;
  await profileRun('read-only', {
    env: {
      PORTFOLIO_PROFILE: 'read-only',
      PORTFOLIO_ORIGIN: ORIGIN,
      PORTFOLIO_SOURCE_DIR: source,
    },
    mounts: ['-v', `${path.dirname(DEFAULT_PORTFOLIO)}:${source}:ro`],
  });
  await profileRun('demo', {
    env: { PORTFOLIO_PROFILE: 'demo', PORTFOLIO_ORIGIN: DEMO_ORIGIN },
  });
  await ownerProfileRun(source);
  ownerRun();
  rowRuns();
  await warningRowRuns();
}

let exitCode = 0;
try {
  await smoke();
} catch (error) {
  fail('smoke:profiles', error.message);
} finally {
  container(['network', 'rm', network]);
  container(['volume', 'rm', '-f', volume]);
  container(['volume', 'rm', '-f', ownerVolume]);
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
