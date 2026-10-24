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
// - owner with no password hash refuses to start for the hash, and for the
//   first-start import of the fixture's variant, missing-variant, which no
//   package registers, but never for the data directory. Its volume starts out owned by uid 1001,
//   mode 0700, as the image's directory is.
// - every startup row in tests/harness/startup-rows.mjs that refuses exits 1
//   with its config.fatal lines and none of its canary values, and every one
//   that starts serves with its config.warning lines and none of its values.
// - readiness says degraded, and the log carries the variant.unavailable
//   warning, while the fallback composition renders in place of the
//   profile's selected variant (#5).
//
//
// And for #12 (12-3), CI's profiles job (pnpm ci:profiles):
//
// - every server container runs as the Compose examples now do, with
//   HARDENING (ci/lib/profile-checks.mjs): --read-only with the cache tmpfs,
//   --cap-drop=ALL, and no-new-privileges. Under each profile, `inspect`
//   shows those flags, no writable persistent mount but owner's data
//   directory, and no hash in the environment; /proc/1/status shows uid and
//   gid 1001, no capability, and NoNewPrivs; a write probe finds nothing
//   writable but the cache tmpfs and, under owner, the data directory; the
//   container has no route out; and the image holds nothing the image scan
//   refuses (threat rows deploy-2 and deploy-3).
// - spoofed forwarded headers move no absolute URL or redirect under any
//   profile, and under owner, at 0 trusted hops and then at 1, no cookie
//   flag or origin check, and X-Forwarded-For moves the sign-in source only
//   within the hop count.
// - each server stops on SIGTERM within 10 seconds, starts again, and
//   answers health and readiness; owner's data volume then serves a new
//   container with every durable file it held.
// - owner refuses to start, with a redacted config.fatal line, on a hash
//   file that's missing, unreadable, group- or world-writable, or
//   malformed, on the bundled sample identity, and on a missing or
//   unreadable source directory. Its hash reaches it only through the _FILE.
// - per-run canaries, masked in the Actions log, never show in a response,
//   a log, or the reports this run uploads, which are redacted if one does.
// - the Compose examples publish only on 127.0.0.1 and keep the hardening,
//   read from `compose config`.
// - demo with the read-only reference (#9): deploy/compose.demo.reference.yml
//   layered over demo's example keeps that hardening and mounts nothing but
//   the reference, read-only. With PORTFOLIO_REFERENCE_HOST_DIR unset,
//   Compose refuses the pair, and with it naming no directory, Compose won't
//   create the container and makes no directory. A container mounting a
//   copy of the CI fixture as the overlay does keeps a read-only root and no
//   writable mount, serves /reference and a rendition its view places, and
//   gives the private one the plain 404, with no reference canary in any
//   answer or its log. The plain demo run above still finds /reference
//   unmounted.
//
// Owner's seeded run stands in for its ready rows, since the harness
// fixture selects missing-variant, which no first start can import (12-5). No publish is reachable today, so the SIGKILL during
// publish check stays with 12-5 too; packages/core/src/store/crash.test.ts
// covers the store's side.
//
// Removes every container, network, and volume it creates, and the image
// when it built or loaded one.
//
// Environment:
//   CONTAINER_CLI        docker (default) or finch
//   IMAGE_TAG            tag to build or load (default portfolio:profiles)
//   SMOKE_IMAGE          test this image reference instead of building one (kept)
//   SMOKE_IMAGE_ARCHIVE  load the image from this `docker save` archive instead
//                        of building it, as CI's profiles job does with the image job's
//   SMOKE_PROFILES       the parts to run, from read-only, demo, owner, and rows (default all)
//   CONTAINER_PREFIX     container, network, and volume name prefix (default portfolio-ci-)
//   SMOKE_TIMEOUT_MS     how long to wait for /api/health (default 90000)
// First: the route table below reads the server-only variant registry (#6).
import '../apps/web/scripts/server-only.cjs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { DEFAULT_PORTFOLIO, DEFAULT_SITE } from '../tests/harness/app-server.mjs';
import {
  CANARY_BODY,
  CANARY_SECRET,
  CANARY_SOURCE,
  canaries,
  encodings,
  FORGED_LINE,
  hashCanaries,
  HOPS_FILE,
  IMAGE_PROBE,
  referenceLeaks,
} from '../tests/harness/canaries.mjs';
import { waitFor } from '../tests/harness/net.mjs';
import { ownerSecret } from '../tests/harness/owner-secret.mjs';
import { copyReferenceFixture, REFERENCE_FIXTURE } from '../tests/harness/reference-fixture.ts';
import { COPY_SEED_INTO_VOLUME, seedOwnerStore } from '../tests/harness/owner-store.mjs';
import { headerProblems, isPreviewPath, isStudioPath } from '../tests/harness/route-headers.mjs';
import {
  checkRefusal,
  checkWarnings,
  HEAD,
  rowDocuments,
  STARTUP_ROWS,
  WARNING_ROWS,
  warningLines,
} from '../tests/harness/startup-rows.mjs';
import {
  assessRoutes,
  HOST_REQUESTS_SNIPPET,
  PROBE_SNIPPET,
  REQUESTS_SNIPPET,
  SCAN_SNIPPET,
  STATUS_SNIPPET,
  TREE_SNIPPET,
  WRITE_SNIPPET,
} from './lib/container.mjs';
import {
  composeProblems,
  REFERENCE_HOST_DIR,
  REFERENCE_OVERLAY,
  referenceOverlayProblems,
  referenceRefusalProblems,
  referenceRunArgs,
  HARDENING,
  hermeticProblems,
  anonymousLeaks,
  fatalCodes,
  HOST_PROBES,
  hopsLabel,
  hostProblems,
  inspectProblems,
  leakProblems,
  maskCommands,
  DYNAMIC_ROUTES,
  dynamicRouteProblems,
  isDynamic,
  mediaCacheFor,
  MEDIA_PATTERN,
  mediaMissProblems,
  newAuditRecords,
  partsOf,
  persistenceProblems,
  PREVIEW_ORIGIN,
  processProblems,
  redact,
  redactArtifacts,
  reproFor,
  requiredSampleProblems,
  SAMPLES,
  signedInLeaks,
  sourceProblems,
  SPOOFED_HEADERS,
  SPOOFED_HOST,
  spoofProblems,
  stopProblems,
  successSourceProblems,
  WRITE_TARGETS,
  writeProblems,
} from './lib/profile-checks.mjs';
import { buildRegistry } from './lib/registry.mjs';
import {
  currentGate,
  REPO_ROOT,
  reportError,
  reportsDir,
  writeFailureRecord,
} from './lib/reports.mjs';

// The route table, the registry, and the capability matrix are TypeScript;
// the script runs under tsx (`node --import tsx`) to read them. The route
// table imports the generated registry, and nothing here builds the app, so
// the registry is written first (ci/lib/registry.mjs). One that doesn't
// build is the run's one failure, reported as the end of the run reports one.
try {
  console.log(buildRegistry());
} catch (error) {
  console.log(`[profiles] FAIL smoke:profiles: ${error.message}`);
  reportError('smoke:profiles: 1 failure(s)', { title: 'smoke:profiles' });
  const gate = currentGate();
  if (gate) writeFailureRecord({ ...gate, test: 'smoke:profiles', actual: error.message });
  process.exit(1);
}
const require = createRequire(import.meta.url);
const { accessIn, CAPABILITIES, INDEXABLE } = require('../apps/web/src/server/capabilities.ts');
const { listOperations } = require('../apps/web/src/server/operations.ts');
const { listRoutes, RETIRED_PATTERNS, routeAccess } = require('../apps/web/src/server/routes.ts');
const {
  PREVIEW_STATUS_DOCUMENT,
  PREVIEW_STATUS_TYPE,
} = require('../apps/web/src/preview/status.ts');

const cli = process.env.CONTAINER_CLI || 'docker';
const pulled = process.env.SMOKE_IMAGE;
const archive = process.env.SMOKE_IMAGE_ARCHIVE;
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
// Made for this run: a canary every container gets in its environment, and
// in the path of the _FILE directory, which nothing may repeat.
const RUN_TOKEN = randomBytes(8).toString('hex');
const RUN_CANARY = `canary-run-${RUN_TOKEN}`;
// The canary _FILE, mounted read-only in every profile's container.
const SECRET_DIR = `/run/${CANARY_SECRET}-${RUN_TOKEN}`;
// Owner's hash, beside it, and its data directory, where compose.owner.yml puts it.
const HASH_FILE = 'owner_password_hash';
// Beside the hops file: one trusted hop, for owner's new container.
const HOPS_ONE = 'hops-1';
const DATA_DIR = '/var/lib/portfolio';
const SESSION_COOKIE =
  /^__Host-studio_session=([A-Za-z0-9_-]{43}); Path=\/; Max-Age=\d+; HttpOnly; SameSite=Strict; Secure$/;

const container = (args, options = {}) =>
  spawnSync(cli, args, { cwd: REPO_ROOT, encoding: 'utf8', ...options });
const envArgs = (env) => Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
/** Every server container's environment gets the run's canary. */
const withCanary = (env) => ({ CI_RUN_CANARY: RUN_CANARY, ...env });

/**
 * The run's own secrets, in every encoding a response could carry them:
 * the canary, the token in the _FILE path, and owner's password, hash, and
 * malformed hash once they're made. No response, log, or uploaded report
 * may hold one, and no failure message repeats one.
 */
const runSecrets = [];
function addSecrets(...values) {
  for (const value of values) runSecrets.push(...encodings(value));
  for (const line of maskCommands(values, process.env)) console.log(line);
}
addSecrets(RUN_CANARY, RUN_TOKEN);

/** The part of the run under way (SMOKE_PROFILES), which each failure names. */
let part = 'read-only';
const failures = [];
function fail(test, message, fields = {}) {
  const text = redact(message, runSecrets);
  failures.push({
    test,
    message: text,
    part,
    fields: { ...(part === 'rows' ? {} : { profile: part }), ...fields },
  });
  console.log(`[profiles] FAIL ${test}: ${text}`);
}

/**
 * A concrete path for a pattern: an optional catch-all left empty, and each
 * other dynamic segment a word no route starts with, so the path is the
 * pattern's own and not a static route's.
 */
const concrete = (pattern) =>
  pattern.replace(/\/\[\[\.\.\.[^\]]+\]\]/g, '').replace(/\[\.{0,3}[^\]]+\]/g, 'probe') || '/';

/**
 * What a dynamic pattern's made-up path answers, by DYNAMIC_ROUTES (#12),
 * or undefined for a static pattern. `not-found` is a path that names
 * nothing it can render: no installed variant declares a view at /probe,
 * and no live revision routes a case study at /work/probe (#5, Slice 4;
 * #10b). The route table calls it missing in every profile, so a GET gets
 * the app's 404 page, rendered from the server, and any other method the
 * proxy's plain 404, as an absent route does.
 */
const madeUpOf = (entry) =>
  isDynamic(entry.pattern) ? DYNAMIC_ROUTES[entry.pattern]?.madeUp : undefined;

/** The patterns smoke:profiles probes, the operations aside, which listOperations() covers. */
const probedPatterns = () =>
  listRoutes()
    .filter((route) => route.capability !== 'operations')
    .map(({ pattern }) => pattern);

/**
 * Whether `profile` serves a grant route, as owner does (#7): there
 * proxy.ts gives every preview path no active grant admits the status
 * document, as tests/harness/profile-matrix.ts expects of the built server.
 */
const hasGrantRoutes = (profile) =>
  listRoutes().some(
    (entry) => entry.grant !== undefined && routeAccess(profile, entry) !== 'absent',
  );

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
      // Owner probes its data directory (#3); the others check no owner code loaded.
      ...(profile === 'owner'
        ? [{ id: 'data-directory', status: 'ok' }]
        : [{ id: 'owner-modules', status: 'ok' }]),
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
 * canaries no response may carry, and `origin`, the container's
 * PORTFOLIO_ORIGIN, the only origin that may frame a preview.
 */
function plan(profile, leaks, origin) {
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
  // An entry another one serves the path of here, as /studio's two do for each other (#9), is that one's.
  const shadowed = (route) =>
    routeAccess(profile, route) === 'absent' &&
    listRoutes().some(
      (other) => other.pattern === route.pattern && routeAccess(profile, other) !== 'absent',
    );
  for (const entry of listRoutes().filter(
    (route) => route.capability !== 'operations' && !shadowed(route),
  )) {
    const access = routeAccess(profile, entry);
    // No grant is active here: a grant route, and under a profile with grant
    // routes any preview path the build doesn't serve, answer every method
    // with the status document (#7).
    const grant = access !== 'absent' && entry.grant !== undefined;
    const statusDocument =
      access === 'absent' && hasGrantRoutes(profile) && isPreviewPath(entry.pattern);
    if (grant || statusDocument) {
      for (const method of METHODS) {
        add(method, concrete(entry.pattern), (response) => [
          ...status(404)(response),
          ...(response.headers['content-type'] === PREVIEW_STATUS_TYPE &&
          response.body === PREVIEW_STATUS_DOCUMENT
            ? []
            : ["not the preview's status document"]),
          ...(UUID.test(response.headers['x-request-id'] ?? '') ? [] : ['no x-request-id']),
        ]);
      }
    } else if (madeUpOf(entry) === 'not-found') {
      add('GET', concrete(entry.pattern), (response) => [
        ...status(404)(response),
        ...(/^text\/html/.test(response.headers['content-type'] ?? '') &&
        response.body.includes('<h1>Page not found</h1>')
          ? []
          : ["not the app's 404 page"]),
        ...(UUID.test(response.headers['x-request-id'] ?? '') ? [] : ['no x-request-id']),
      ]);
      for (const method of METHODS.filter((each) => each !== 'GET')) {
        add(method, concrete(entry.pattern), status(404));
      }
    } else if (madeUpOf(entry) === 'unmounted') {
      // demo's read-only reference (#9), which the image mounts none of.
      for (const method of METHODS) add(method, concrete(entry.pattern), status(404));
    } else if (access === 'session' && entry.kind === 'page') {
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
    } else if (access !== 'absent' && madeUpOf(entry) === 'media-miss') {
      // #10's renditions: the probe path names none, so it's the plain
      // 404, never cached. demo also loads a real one (its sample).
      add('GET', concrete(entry.pattern), (response) => [
        ...mediaMissProblems(response),
        ...(UUID.test(response.headers['x-request-id'] ?? '') ? [] : ['no x-request-id']),
      ]);
    } else if (access !== 'absent' && isDynamic(entry.pattern) && madeUpOf(entry) !== 'served') {
      // A dynamic pattern checked by its sample alone: no made-up path to ask.
      continue;
    } else if (access !== 'absent' && entry.methods !== undefined) {
      // A handler that takes only the methods its entry lists, such as
      // POST /api/appearance (#19, Slice 4): any other method is the plain
      // 405 naming them, and its own, with no Origin, is a 403 that sets
      // nothing.
      for (const method of METHODS) {
        const own = entry.methods.includes(method);
        add(method, concrete(entry.pattern), (response) => [
          ...status(own ? 403 : 405)(response),
          ...noStore(response),
          ...(own || response.headers.allow === entry.methods.join(', ')
            ? []
            : [`Allow is ${response.headers.allow}, not ${entry.methods.join(', ')}`]),
          ...(response.headers['set-cookie'] === undefined ? [] : ['sets a cookie']),
          ...(UUID.test(response.headers['x-request-id'] ?? '') ? [] : ['no x-request-id']),
        ]);
      }
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
        ...leakProblems(response, leaks),
        ...headerProblems(
          new URL(request.path, 'http://unset.invalid').pathname,
          response.headers,
          {
            studio: hasStudio(profile),
            origin,
            demo: profile === 'demo',
          },
        ),
      ];
      if (response.headers['set-cookie'] !== undefined) problems.push('sets a cookie');
      const robots = isPreviewPath(new URL(request.path, 'http://unset.invalid').pathname)
        ? 'noindex, nofollow'
        : INDEXABLE[profile]
          ? undefined
          : 'noindex';
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

/**
 * The real paths a profile's container is asked for (#12): for each dynamic
 * pattern it serves whose DYNAMIC_ROUTES entry names a sample, the first
 * one / names, and what's wrong with its answer. A sample SAMPLES marks
 * required fails when / names none within `wait` ms, as demo's renditions
 * do while it derives them in the background (#10), and so does one the
 * profile serves no pattern for; any other is skipped, and says so.
 */
async function samplePaths(name, profile, wait = 60_000) {
  const serves = (pattern) =>
    listRoutes().some(
      (entry) => entry.pattern === pattern && routeAccess(profile, entry) !== 'absent',
    );
  const problems = requiredSampleProblems(profile, serves).map((text) => ({
    route: 'DYNAMIC_ROUTES',
    text,
  }));
  for (const entry of listRoutes()) {
    const sampleName = isDynamic(entry.pattern) ? DYNAMIC_ROUTES[entry.pattern]?.sample : undefined;
    if (sampleName === undefined || routeAccess(profile, entry) === 'absent') continue;
    const sample = SAMPLES[sampleName];
    if (sample.profiles && !sample.profiles.includes(profile)) continue;
    const deadline = Date.now() + (sample.required ? wait : 0);
    for (;;) {
      const [home] = send(name, [{ method: 'GET', path: '/' }]);
      const found = sample.find(home?.body);
      if (found) {
        const [response] = send(name, [{ method: 'GET', path: found }]);
        console.log(`[profiles] ${profile}: ${entry.pattern} GET ${found} ${response.status}`);
        problems.push(
          ...sample.problems(found, response).map((problem) => ({
            route: entry.pattern,
            text: `GET ${found} ${problem}`,
          })),
        );
        break;
      }
      if (Date.now() >= deadline) {
        if (sample.required) {
          problems.push({
            route: entry.pattern,
            text: `GET / names no ${sampleName} below ${entry.pattern} ${wait / 1000} s after it started`,
          });
        } else {
          console.log(
            `[profiles] ${profile}: ${entry.pattern} has no ${sampleName} on / to sample`,
          );
        }
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return problems;
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

/** Starts a server container, detached, on the internal network with HARDENING. */
function startServer(name, { env, mounts = [] }) {
  return container([
    'run',
    '-d',
    '--name',
    name,
    '--network',
    network,
    ...HARDENING,
    '-v',
    `${path.join(stateDir, CANARY_SECRET)}:${SECRET_DIR}:ro`,
    ...mounts,
    ...envArgs(
      withCanary({ TZ: 'UTC', [HOPS_FILE.key]: `${SECRET_DIR}/${HOPS_FILE.name}`, ...env }),
    ),
    image,
  ]);
}

/** Waits for /api/health to answer 200 from inside the container. */
async function waitHealthy(name, what) {
  const running = () =>
    container(['inspect', '--format', '{{.State.Running}}', name]).stdout.trim() === 'true';
  await waitFor(
    () => {
      const result = container(['exec', name, 'node', '-e', PROBE_SNIPPET, '/api/health']);
      return parse(result.stdout ?? '')?.status === 200 ? true : undefined;
    },
    { timeoutMs, alive: running, what: `${what}: GET /api/health to answer 200` },
  );
}

/**
 * A startup or run error, with the config.fatal codes the container
 * logged, so a server that exited at startup says why.
 */
function explained(name, error) {
  const codes = fatalCodes(output(name));
  return codes.length > 0 ? `${error.message}; config.fatal ${codes.join(', ')}` : error.message;
}

/** Container output, stdout and stderr. */
function output(name) {
  const logs = container(['logs', name]);
  return `${logs.stdout ?? ''}${logs.stderr ?? ''}`;
}

/** Every file under `root` in the container, by its path under `root`, or null. */
function readTree(name, root) {
  const tree = container(['exec', name, 'node', '-e', TREE_SNIPPET, root], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return parse(tree.stdout ?? '')?.files ?? null;
}

/**
 * What the hardening enforces in a running server container (threat rows
 * deploy-2 and deploy-3): the flags and mounts `inspect` reports, the
 * server process's ids, capabilities, and NoNewPrivs, which paths take a
 * write, no route out, and the image's contents. Returns the problems.
 */
function hardening(name, profile, secrets) {
  const problems = [];
  const inspected = parse(container(['inspect', name]).stdout ?? '')?.[0];
  problems.push(...inspectProblems(inspected, { profile, secrets }).map((p) => `inspect: ${p}`));
  const status = container(['exec', name, 'node', '-e', STATUS_SNIPPET]);
  problems.push(...processProblems(status.stdout).map((p) => `the server process: ${p}`));
  const writes = container([
    'exec',
    name,
    'node',
    '-e',
    WRITE_SNIPPET,
    JSON.stringify(WRITE_TARGETS),
  ]);
  problems.push(...writeProblems(parse(writes.stdout ?? ''), profile).map((p) => `write: ${p}`));
  const routes = assessRoutes(container(['exec', name, 'ip', 'route']), cli === 'docker');
  if (!routes.ok) problems.push(`network: ${routes.message}`);
  const scan = parse(container(['exec', name, 'node', '-e', SCAN_SNIPPET, '/app']).stdout ?? '');
  if (!Array.isArray(scan?.problems) || scan.problems.length > 0 || !scan.example) {
    problems.push(
      `image contents: ships ${scan?.problems?.join(', ') || 'nothing it must not'}, sample ${scan?.example}`,
    );
  }
  if (problems.length === 0) {
    console.log(
      `[profiles] ${profile}: read-only root, no capabilities, no-new-privileges, uid 1001, writes only where expected, no route out, clean image`,
    );
  }
  return problems;
}

/**
 * Spoofed forwarded headers against the pages that print absolute URLs and
 * a page that redirects: none names the spoofed host or leaves `origin`.
 */
function spoofed(name, profile, origin, hops = 0) {
  const paths = ['/', '/robots.txt', '/sitemap.xml', ...(hasStudio(profile) ? ['/studio'] : [])];
  const responses = send(
    name,
    paths.map((pathname) => ({
      method: 'GET',
      path: pathname,
      headers: { ...SPOOFED_HEADERS, 'x-forwarded-for': '198.51.100.7' },
    })),
  );
  const problems = paths.flatMap((pathname, index) =>
    spoofProblems(responses[index], origin, pathname, { indexable: INDEXABLE[profile] }).map(
      (p) => `${hopsLabel(hops)}, spoofed GET ${pathname}: ${p}`,
    ),
  );
  if (problems.length === 0) {
    console.log(
      `[profiles] ${profile}: ${hopsLabel(hops)}, spoofed forwarded headers move no URL or redirect`,
    );
  }
  return problems;
}

/** `docker stop --time 10`, timed, with the exit code the server left. */
function stopTimed(name) {
  const started = Date.now();
  const stopped = container(['stop', '--time', '10', name], { timeout: 60_000 });
  const elapsedMs = Date.now() - started;
  const state = parse(container(['inspect', '--format', '{{json .State}}', name]).stdout ?? '');
  if (stopped.status !== 0) return { exitCode: null, elapsedMs, oomKilled: false };
  return { exitCode: state?.ExitCode ?? null, elapsedMs, oomKilled: state?.OOMKilled === true };
}

/**
 * Graceful shutdown and restart: SIGTERM stops the server within 10
 * seconds, and the same container starts again and answers health and
 * readiness as before.
 */
async function restart(name, profile) {
  const stop = stopTimed(name);
  const problems = stopProblems(stop).map((p) => `on SIGTERM, the server ${p}`);
  if (container(['start', name]).status !== 0) return [...problems, 'did not start again'];
  await waitHealthy(name, `${profile} after a restart`);
  const [health, ready] = send(name, [
    { method: 'GET', path: '/api/health' },
    { method: 'GET', path: '/api/ready' },
  ]);
  if (!same(parse(health.body ?? ''), { status: 'ok', profile })) {
    problems.push(`after a restart, /api/health answered ${health.status} ${health.body}`);
  }
  if (ready.status !== 200 || !same(parse(ready.body ?? ''), readyBody(profile))) {
    problems.push(`after a restart, /api/ready answered ${ready.status} ${ready.body}`);
  }
  if (problems.length === 0) {
    console.log(
      `[profiles] ${profile}: stopped on SIGTERM in ${stop.elapsedMs} ms (exit ${stop.exitCode}), restarted, and ready again`,
    );
  }
  return problems;
}

/**
 * Runs `profile`'s container through the hardening checks, the matrix, the
 * canary scan, and spoofed forwarded headers, with `secrets` among the
 * canaries, which the log mustn't hold either, and `paths`, which no
 * response may name. `then` runs next against the same container, for
 * owner's signed-in checks, and returns its problems. Then the server
 * stops on SIGTERM and starts again, and `restarted` runs against it, for
 * owner's data volume.
 */
async function profileRun(
  profile,
  { env, mounts = [], secrets = [], paths = [], then, restarted },
) {
  const name = `${run}-${profile}`;
  // read-only and demo derive their media into a tmpfs of their own, as
  // the Compose examples give them (#10).
  const started = startServer(name, { env, mounts: [...mediaCacheFor(profile), ...mounts] });
  if (started.status !== 0) {
    fail(profile, `the container did not start: ${(started.stderr || '').trim()}`);
    return;
  }
  const failed = failures.length;
  const leaks = [...secrets, ...runSecrets];
  try {
    await waitHealthy(name, profile);
    for (const problem of hardening(name, profile, secrets)) fail(`${profile}: hardening`, problem);

    const requests = plan(
      profile,
      canaries(SERVER_DIR, { secrets: [...leaks, ...paths] }),
      env.PORTFOLIO_ORIGIN,
    );
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
    for (const { route, text } of await samplePaths(name, profile)) {
      fail(`${profile}: ${route === MEDIA_PATTERN ? 'media' : 'sample'}`, text, { profile, route });
    }
    for (const problem of spoofed(name, profile, env.PORTFOLIO_ORIGIN)) {
      fail(`${profile}: proxy trust`, problem);
    }

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

    const text = output(name);
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
    // Owner's store.render-drift line names the live revision's own
    // variant to the operator by design (#3, item 21), as the seeded
    // revision's isn't registered. No other line may.
    const naming = text
      .split('\n')
      .filter((line) => line.includes(SELECTED[profile]))
      .map((line) => parse(line)?.event ?? 'a line that is not JSON')
      .filter((event) => !(profile === 'owner' && event === 'store.render-drift'));
    if (naming.length > 0) {
      fail(profile, `the log names the selected variant, in ${[...new Set(naming)].join(', ')}`);
    }
    if (text.includes(FORGED_LINE)) fail(profile, 'a /_next/image url reached the log as a line');
    // A write the read-only root refused shows up as EROFS.
    if (/EROFS|read-only file system/i.test(text)) {
      fail(profile, 'a write hit the read-only root filesystem');
    }
    if (leaks.some((secret) => text.includes(secret))) {
      fail(profile, "the log holds the password, the hash, or the run's canary");
    }

    for (const problem of await restart(name, profile)) fail(`${profile}: restart`, problem);
    for (const problem of restarted ? await restarted(name) : []) fail(profile, problem);
    const after = `${text}${output(name).slice(text.length)}`;
    if (leaks.some((secret) => after.includes(secret))) {
      fail(profile, "after a restart, the log holds the password, the hash, or the run's canary");
    }
    if (failures.length > failed) saveLogs(name, redact(after, runSecrets));
    else console.log(`[profiles] ${profile} passed`);
  } catch (error) {
    fail(profile, explained(name, error));
    saveLogs(name, redact(output(name), runSecrets));
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
  const leaks = signedInLeaks(SERVER_DIR, secrets, runSecrets);
  const [before, out, after] = responses.slice(requests.length);
  for (const [what, answer] of [
    ['the sign-in', login],
    ['auth.session', before],
    ['auth.logout', out],
    ['auth.session after sign-out', after],
  ]) {
    for (const problem of leakProblems(answer, leaks)) problems.push(`${what}: ${problem}`);
  }
  requests.forEach((request, index) => {
    const response = responses[index];
    if (response.error) problems.push(`signed in, ${request.method} ${request.path}: no answer`);
    for (const problem of leakProblems(response, leaks)) {
      problems.push(`signed in, ${request.method} ${request.path} ${problem}`);
    }
  });
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

/**
 * Owner's proxy trust at `hops` trusted hops (#1, #2), with spoofed
 * forwarded headers on every request: a sign-in on the canonical origin
 * still sets the __Host- cookie with Secure, one from the origin the
 * headers describe is refused, and the audit log gives failed sign-ins the
 * source the hop count allows: none at 0, and at 1 the last
 * X-Forwarded-For entry, never one the client wrote. Returns the problems.
 */
function ownerTrust(name, hops, { password, secrets }) {
  const problems = [];
  const leaks = signedInLeaks(SERVER_DIR, secrets, runSecrets);
  const answers = [];
  const xff = { 'x-forwarded-for': '198.51.100.7, 203.0.113.9' };
  const login = (body, headers) => ({
    method: 'POST',
    path: '/api/studio/auth.login',
    body,
    headers: { ...SPOOFED_HEADERS, ...xff, ...headers },
  });
  const before = readTree(name, DATA_DIR);
  if (!before) return [`${hopsLabel(hops)}: the data directory could not be read`];
  const [signIn] = send(name, [login({ password }, { origin: ORIGIN })]);
  answers.push(['the spoofed sign-in', signIn]);
  const token = signIn.cookies?.length === 1 ? SESSION_COOKIE.exec(signIn.cookies[0])?.[1] : null;
  const csrf = parse(signIn.body ?? '')?.data?.csrfToken;
  if (signIn.status !== 200 || !token) {
    problems.push(
      `a spoofed sign-in answered ${signIn.status ?? signIn.error} without one __Host- Secure cookie (${signIn.cookies?.length ?? 0} set)`,
    );
  }
  const trusted = send(name, [
    login({ password }, { origin: `https://${SPOOFED_HOST}`, 'x-forwarded-proto': 'https' }),
    ...(token
      ? [
          {
            method: 'POST',
            path: '/api/studio/auth.logout',
            body: {},
            headers: {
              ...xff,
              origin: ORIGIN,
              cookie: `__Host-studio_session=${token}`,
              'x-csrf-token': csrf,
            },
          },
        ]
      : []),
  ]);
  const [described] = trusted;
  answers.push(['the sign-in from the spoofed origin', described]);
  if (trusted[1]) answers.push(['the sign-out', trusted[1]]);
  if (
    described.status !== 403 ||
    parse(described.body ?? '')?.error?.code !== 'request_origin_rejected'
  ) {
    problems.push(
      `a sign-in from the spoofed origin answered ${described.status ?? described.error}`,
    );
  }
  const wrong = send(name, [
    login({ password: 'not the password' }, { origin: ORIGIN }),
    login({ password: 'not the password' }, { origin: ORIGIN }),
  ]);
  for (const answer of wrong) {
    answers.push(['a wrong password', answer]);
    if (parse(answer.body ?? '')?.error?.code !== 'credentials_rejected') {
      problems.push(`a wrong password answered ${answer.status ?? answer.error}`);
    }
  }
  const after = readTree(name, DATA_DIR);
  // At 0 hops every sign-in this container saw had no trusted hop, and the
  // signed-in scan's failed sign-in was this minute's first, so the audit
  // log holds the rest only at the minute's end: every record counts. At 1,
  // in a new process, only the ones these attempts added.
  problems.push(...sourceProblems(newAuditRecords(hops === 0 ? {} : before, after ?? {}), hops));
  // The success, written at once, shows its source at either count.
  problems.push(...successSourceProblems(newAuditRecords(before, after ?? {}), hops));
  for (const [what, answer] of answers) {
    for (const problem of leakProblems(answer, leaks)) problems.push(`${what}: ${problem}`);
  }
  if (problems.length === 0) {
    console.log(
      `[profiles] owner: ${hopsLabel(hops)}, spoofed forwarded headers move no cookie flag, origin check, or sign-in source, and no answer carries a canary`,
    );
  }
  return problems.map((problem) => `${hopsLabel(hops)}: ${problem}`);
}

/**
 * Owner's data volume under a new container: the old one stops on SIGTERM
 * and goes, and a new one on the same volume, trusting one hop, starts
 * with every durable file the old one left, then passes spoofed() and
 * ownerTrust at 1.
 */
async function ownerReplacement(name, { env, mounts, password, secrets, leaks }) {
  const problems = [];
  const before = readTree(name, DATA_DIR);
  if (!before) return ['the data directory could not be read before the new container'];
  problems.push(...stopProblems(stopTimed(name)).map((p) => `on SIGTERM, the server ${p}`));
  container(['rm', '-f', name]);
  const next = `${name}-next`;
  const started = startServer(next, {
    env: { ...env, [HOPS_FILE.key]: `${SECRET_DIR}/${HOPS_ONE}` },
    mounts,
  });
  if (started.status !== 0) {
    return [...problems, `the new container did not start: ${(started.stderr || '').trim()}`];
  }
  try {
    await waitHealthy(next, 'owner in a new container on its data volume');
    const after = readTree(next, DATA_DIR);
    problems.push(
      ...persistenceProblems(before, after ?? {}).map(
        (p) => `the data volume, in a new container: ${p}`,
      ),
    );
    if (problems.length === 0) {
      console.log(
        `[profiles] owner: a new container on the data volume has its ${Object.keys(before).length} files`,
      );
    }
    problems.push(...spoofed(next, 'owner', ORIGIN, 1));
    problems.push(...ownerTrust(next, 1, { password, secrets }));
    const text = output(next);
    if (leaks.some((secret) => text.includes(secret))) {
      problems.push(
        "in the new container, the log holds the password, the hash, or the run's canary",
      );
    }
    if (problems.length > 0) saveLogs(next, redact(text, runSecrets));
  } catch (error) {
    problems.push(explained(next, error));
    saveLogs(next, redact(output(next), runSecrets));
  } finally {
    // SIGTERM, never rm -f alone: the server lets its claim on the data
    // volume go only as it exits, and the preview-origin container comes
    // next on the same volume.
    problems.push(
      ...stopProblems(stopTimed(next), 10_000, [143]).map(
        (p) => `the 1-hop container, on SIGTERM, ${p}`,
      ),
    );
    container(['rm', '-f', next]);
  }
  return problems;
}

/**
 * Owner with a preview origin (#7, Slice 4), on the same data volume once
 * the other containers are gone: the host rule follows the Host header
 * alone. With X-Forwarded-Host naming the other origin, the main host still
 * gets the whole site, the preview host still gets only what a frame loads,
 * and a host the deployment doesn't name gets the plain 404.
 */
async function ownerPreviewHost({ env, mounts, secrets }) {
  // Its answers are anonymous, so the config summary's fields count too.
  const leaks = anonymousLeaks(SERVER_DIR, secrets, runSecrets);
  const logLeaks = [...secrets, ...runSecrets];
  const name = `${run}-owner-preview`;
  const started = startServer(name, {
    env: { ...env, PORTFOLIO_PREVIEW_ORIGIN: PREVIEW_ORIGIN },
    mounts,
  });
  if (started.status !== 0) {
    return [`the preview-origin container did not start: ${(started.stderr || '').trim()}`];
  }
  const problems = [];
  try {
    await waitHealthy(name, 'owner with a preview origin');
    const requests = HOST_PROBES.map((probe) => ({
      method: 'GET',
      path: probe.path,
      headers: { host: probe.host, 'x-forwarded-host': probe.forwarded },
    }));
    const result = container(['exec', '-i', name, 'node', '-e', HOST_REQUESTS_SNIPPET], {
      input: JSON.stringify(requests),
      maxBuffer: 64 * 1024 * 1024,
    });
    const responses = parse(result.stdout ?? '');
    if (!Array.isArray(responses) || responses.length !== requests.length) {
      throw new Error(`the in-container host requests failed: ${(result.stderr || '').trim()}`);
    }
    HOST_PROBES.forEach((probe, index) => {
      problems.push(
        ...hostProblems(probe, responses[index], {
          fixtureName: FIXTURE_NAME,
          statusDocument: PREVIEW_STATUS_DOCUMENT,
        }).map((p) => `preview host rule: ${p}`),
        ...leakProblems(responses[index], leaks).map((p) => `preview host rule: ${p}`),
      );
    });
    const text = output(name);
    if (logLeaks.some((secret) => text.includes(secret))) {
      problems.push(
        "with a preview origin, the log holds the password, the hash, or the run's canary",
      );
    }
    if (problems.length === 0) {
      console.log(
        `[profiles] owner: with a preview origin, the Host header alone picks the host, whatever X-Forwarded-Host says (${HOST_PROBES.length} requests)`,
      );
    } else {
      saveLogs(name, redact(text, runSecrets));
    }
  } catch (error) {
    problems.push(explained(name, error));
    saveLogs(name, redact(output(name), runSecrets));
  } finally {
    problems.push(
      ...stopProblems(stopTimed(name), 10_000, [143]).map(
        (p) => `the preview-origin container, on SIGTERM, ${p}`,
      ),
    );
    container(['rm', '-f', name]);
  }
  return problems;
}

/** A password made for this run and its hash, from the image's own hash-password. */
function makeOwnerSecret() {
  // Given the password on stdin that isn't a terminal.
  const hasher = `${run}-hash`;
  try {
    const secret = ownerSecret([
      cli,
      'run',
      '--rm',
      '-i',
      '--name',
      hasher,
      '--network',
      network,
      ...HARDENING,
      image,
      'node',
      'apps/web/bin/owner.mjs',
    ]);
    addSecrets(secret.password, ...hashCanaries(secret.hash));
    const file = path.join(stateDir, CANARY_SECRET, HASH_FILE);
    writeFileSync(file, `${secret.hash}\n`);
    chmodSync(file, 0o444);
    return secret;
  } finally {
    container(['rm', '-f', hasher]);
  }
}

/** Owner with the password provider, on a new data volume and a hash made for this run. */
async function ownerProfileRun(source, secret) {
  if (container(['volume', 'create', ownerVolume]).status !== 0) {
    throw new Error("could not create owner's data volume");
  }
  // Owner's first start refuses the fixture's unregistered variant, so the
  // volume starts with the pair published into it, as root, for uid 1001,
  // with no network.
  const seedDir = path.join(stateDir, 'owner-seed');
  mkdirSync(seedDir, { recursive: true, mode: 0o700 });
  seedOwnerStore(seedDir, path.dirname(DEFAULT_PORTFOLIO));
  const seeded = container([
    'run',
    '--rm',
    '--network',
    'none',
    '-u',
    '0',
    '-v',
    `${seedDir}:/seed:ro`,
    '-v',
    `${ownerVolume}:${DATA_DIR}`,
    image,
    'node',
    '-e',
    COPY_SEED_INTO_VOLUME,
  ]);
  if (seeded.status !== 0) {
    throw new Error(`could not seed owner's data volume: ${(seeded.stderr || '').trim()}`);
  }
  const secrets = [secret.password, ...hashCanaries(secret.hash)];
  const env = {
    PORTFOLIO_PROFILE: 'owner',
    PORTFOLIO_ORIGIN: ORIGIN,
    PORTFOLIO_SOURCE_DIR: source,
    PORTFOLIO_DATA_DIR: DATA_DIR,
    PORTFOLIO_AUTH_PASSWORD_HASH_FILE: `${SECRET_DIR}/${HASH_FILE}`,
  };
  const mounts = [
    '-v',
    `${path.dirname(DEFAULT_PORTFOLIO)}:${source}:ro`,
    '-v',
    `${ownerVolume}:${DATA_DIR}`,
  ];
  await profileRun('owner', {
    env,
    mounts,
    secrets,
    // No response names the data directory either.
    paths: [DATA_DIR],
    then: (name) => [
      ...signedIn(name, { password: secret.password, secrets }),
      ...ownerTrust(name, 0, { password: secret.password, secrets }),
    ],
    restarted: async (name) => [
      ...(await ownerReplacement(name, {
        env,
        mounts,
        password: secret.password,
        secrets,
        leaks: [...secrets, ...runSecrets],
      })),
      ...(await ownerPreviewHost({ env, mounts, secrets })),
    ],
  });
}

/**
 * Owner's startup refusals beyond its missing hash (#2, #3, #12): with the
 * run's hash in place, each refuses to start, exits 1, and logs a
 * config.fatal line with the code, naming neither the hash nor the file's
 * path. A hash file that's missing, unreadable, group- or world-writable,
 * or malformed; the bundled sample identity; and a source directory that's
 * missing or unreadable. Each runs on a new data volume, so it's a first
 * start.
 */
function ownerRows(secret) {
  const sample = `${HEAD}identity:\n  name: Anamika Devi\nsections:\n  - kind: lede\n    id: about\n    body: Hi.\n`;
  const malformed = `canary-malformed-${RUN_TOKEN}`;
  addSecrets(malformed);
  const hashKey = 'PORTFOLIO_AUTH_PASSWORD_HASH_FILE';
  const rows = [
    { name: 'a missing password hash file', hash: null, key: hashKey, code: 'file_unreadable' },
    {
      name: 'an unreadable password hash file',
      hash: { text: secret.hash, mode: 0o000 },
      key: hashKey,
      code: 'file_unreadable',
    },
    {
      name: 'a group-writable password hash file',
      hash: { text: secret.hash, mode: 0o620 },
      key: hashKey,
      code: 'file_writable',
    },
    {
      name: 'a world-writable password hash file',
      hash: { text: secret.hash, mode: 0o602 },
      key: hashKey,
      code: 'file_writable',
    },
    {
      name: 'a malformed password hash',
      hash: { text: malformed, mode: 0o444 },
      key: hashKey,
      code: 'malformed',
    },
    {
      name: 'the bundled sample identity',
      documents: { 'portfolio.yml': sample },
      code: 'sample_identity',
    },
    {
      name: 'a missing source directory',
      source: 'missing',
      code: 'source_missing',
    },
    {
      name: 'an unreadable source directory',
      source: 'unreadable',
      code: 'source_unreadable',
    },
  ];
  let passed = 0;
  rows.forEach((row, index) => {
    const test = `owner startup row: ${row.name}`;
    const dir = path.join(stateDir, `owner-row-${index}`);
    const hashDir = path.join(dir, 'hash');
    const config = path.join(dir, 'config');
    mkdirSync(hashDir, { recursive: true });
    mkdirSync(config, { recursive: true });
    const hashPath = `${SECRET_DIR}-row/${HASH_FILE}`;
    const hash = row.hash === undefined ? { text: secret.hash, mode: 0o444 } : row.hash;
    if (hash) {
      const file = path.join(hashDir, HASH_FILE);
      writeFileSync(file, `${hash.text}\n`);
      chmodSync(file, hash.mode);
    }
    const documents = {
      'portfolio.yml': readFileSync(DEFAULT_PORTFOLIO, 'utf8'),
      'site.yml': readFileSync(DEFAULT_SITE, 'utf8'),
      ...row.documents,
    };
    for (const [name, text] of Object.entries(documents)) {
      writeFileSync(path.join(config, name), text);
    }
    const rowVolume = `${run}-owner-row-${index}`;
    if (container(['volume', 'create', rowVolume]).status !== 0) {
      fail(test, 'could not create its data volume');
      return;
    }
    const source =
      row.source === 'unreadable'
        ? ['--tmpfs', '/config:mode=0000']
        : row.source === 'missing'
          ? []
          : ['-v', `${config}:/config:ro`];
    const name = `${run}-owner-row-${index}`;
    try {
      const { code, output: text } = runToExit(name, [
        ...HARDENING,
        ...source,
        '-v',
        `${hashDir}:${SECRET_DIR}-row:ro`,
        '-v',
        `${rowVolume}:${DATA_DIR}`,
        ...envArgs(
          withCanary({
            TZ: 'UTC',
            PORTFOLIO_PROFILE: 'owner',
            PORTFOLIO_ORIGIN: ORIGIN,
            PORTFOLIO_SOURCE_DIR: '/config',
            PORTFOLIO_DATA_DIR: DATA_DIR,
            [hashKey]: hashPath,
          }),
        ),
        image,
      ]);
      const fatal = logEntries(text).filter((entry) => entry.event === 'config.fatal');
      const problems = [];
      if (code !== 1) problems.push(`exited ${code ?? 'never'}, not 1`);
      if (!fatal.some((entry) => (!row.key || entry.key === row.key) && entry.code === row.code)) {
        problems.push(
          `no config.fatal ${row.key ?? 'line'} with ${row.code}, got ${JSON.stringify(fatal.map((e) => `${e.key}:${e.code}`))}`,
        );
      }
      if (runSecrets.some((value) => text.includes(value))) {
        problems.push("the output holds the hash, its file's path, or the run's canary");
      }
      if (text.includes('Anamika Devi') && row.code !== 'sample_identity') {
        problems.push('the output names the bundled sample');
      }
      for (const problem of problems) fail(test, problem);
      if (problems.length === 0) passed += 1;
      else saveLogs(name, redact(text, runSecrets));
    } finally {
      container(['volume', 'rm', '-f', rowVolume]);
    }
  });
  console.log(`[profiles] owner startup rows: ${passed} of ${rows.length} passed`);
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
    ...HARDENING,
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
  // The data directory passes preflight. The first-start import of the
  // fixture's variant, missing-variant, which no package registers, refuses
  // too (#3).
  const expected = [
    'PORTFOLIO_AUTH_PASSWORD_HASH_FILE:required',
    'PORTFOLIO_DATA_DIR:store_import_failed',
    'PORTFOLIO_SOURCE_DIR:variant.unavailable',
  ];
  if (code !== 1 || !same([...keys].sort(), expected)) {
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
      // A name may sit in a directory beside the documents, such as snapshots/github.json.
      mkdirSync(path.dirname(path.join(config, name)), { recursive: true });
      writeFileSync(path.join(config, name), text);
    }
    for (const [name, text] of Object.entries(row.files ?? {})) {
      writeFileSync(path.join(files, name), text);
    }
    const paths = { source: '/config', beside: (name) => `/files/${name}` };
    const { code, output } = runToExit(`${run}-row-${index}`, [
      ...HARDENING,
      // The server runs as uid 1001, which can't read a root-owned 0000 tmpfs.
      ...(row.unreadable ? ['--tmpfs', '/config:mode=0000'] : ['-v', `${config}:/config:ro`]),
      '-v',
      `${files}:/files:ro`,
      ...envArgs(withCanary(row.env(paths))),
      image,
    ]);
    const test = `startup row: ${row.group}, ${row.name}`;
    const problems = checkRefusal(row, paths, output);
    if (code !== 1) problems.unshift(`exited ${code ?? 'never'}, not 1`);
    if (runSecrets.some((value) => output.includes(value))) {
      problems.push("the output holds the run's canary");
    }
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
      mkdirSync(path.dirname(path.join(config, file)), { recursive: true });
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
      ...HARDENING,
      '-v',
      `${config}:/config:ro`,
      ...envArgs(withCanary(row.env(paths))),
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
      if (runSecrets.some((value) => output().includes(value))) {
        problems.push("the output holds the run's canary");
      }
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

/** The Compose example each profile runs from (#1, item 23). */
const EXAMPLES = {
  'read-only': 'docker-compose.yml',
  demo: 'deploy/compose.demo.yml',
  owner: 'deploy/compose.owner.yml',
};

/**
 * The profile's Compose example as `compose config` resolves it, with
 * PORTFOLIO_ORIGIN set and PORT unset: every port on 127.0.0.1, and the
 * hardening the smoke runs it with.
 */
function composeRun(profile) {
  const file = EXAMPLES[profile];
  const env = { ...process.env, PORTFOLIO_ORIGIN: profile === 'demo' ? DEMO_ORIGIN : ORIGIN };
  delete env.PORT;
  const result = container(['compose', '-f', file, 'config', '--format', 'json'], { env });
  const config = parse(result.stdout ?? '');
  const problems = config
    ? composeProblems(config)
    : [`compose config failed: ${(result.stderr || `exit ${result.status}`).trim()}`];
  for (const problem of problems) fail(`${profile}: Compose example`, `${file}: ${problem}`);
  if (problems.length === 0) {
    console.log(`[profiles] ${profile}: ${file} publishes only on 127.0.0.1, hardened`);
  }
}

/** The rendition URL of `assetId`'s first rendition in the CI reference fixture. */
function fixtureRendition(assetId) {
  const media = parse(readFileSync(path.join(REFERENCE_FIXTURE, 'media', 'media.json'), 'utf8'));
  const found = media.assets.find((record) => record.assetId === assetId);
  const [first] = found.renditions;
  return `/reference/media/${assetId}/${found.sha256}/${first.name}.${first.ext}`;
}

/**
 * demo with the read-only reference (#9), from REFERENCE_OVERLAY layered
 * over demo's example: Compose refuses it with no directory to mount, and
 * a container mounting a copy of the CI fixture the way the resolved
 * overlay says keeps the hardening, serves the reference's public view and
 * a rendition it places, and nothing private.
 */
async function referenceRun() {
  const what = 'demo with a reference';
  const project = `${run}-reference`;
  const files = ['-p', project, '-f', EXAMPLES.demo, '-f', REFERENCE_OVERLAY];
  const base = { ...process.env, PORTFOLIO_ORIGIN: DEMO_ORIGIN };
  delete base.PORT;
  delete base[REFERENCE_HOST_DIR];
  const refused = (when, result, created) => {
    const problems = referenceRefusalProblems(result, {
      names: new RegExp(`${REFERENCE_HOST_DIR}|does not exist|no such file`, 'i'),
      created,
    });
    for (const problem of problems) fail(`${what}: Compose`, `${when}: ${problem}`);
    if (problems.length === 0) console.log(`[profiles] ${what}: Compose refuses it ${when}`);
  };

  // Unset, Compose won't resolve the pair.
  refused(
    `with ${REFERENCE_HOST_DIR} unset`,
    container(['compose', ...files, 'config', '--format', 'json'], { env: base }),
    false,
  );
  // Naming a directory that isn't there, Compose won't create the
  // container, and makes no directory. The image under test stands in
  // for the example's own tag, so nothing builds or pulls.
  const missing = path.join(stateDir, 'reference-missing');
  const tagged = path.join(stateDir, 'reference-image.yml');
  writeFileSync(tagged, `services:\n  web:\n    image: ${JSON.stringify(image)}\n`);
  const missingEnv = { env: { ...base, [REFERENCE_HOST_DIR]: missing } };
  try {
    refused(
      `with ${REFERENCE_HOST_DIR} naming no directory`,
      container(
        ['compose', ...files, '-f', tagged, 'create', '--no-build', '--pull', 'never', 'web'],
        missingEnv,
      ),
      existsSync(missing),
    );
  } finally {
    container(['compose', ...files, '-f', tagged, 'down', '--remove-orphans'], missingEnv);
  }

  // Mounted: a copy of the fixture, as the overlay resolves.
  const mount = copyReferenceFixture(path.join(stateDir, 'reference-export'));
  const resolved = container(['compose', ...files, 'config', '--format', 'json'], {
    env: { ...base, [REFERENCE_HOST_DIR]: mount },
  });
  const config = parse(resolved.stdout ?? '');
  const problems = config
    ? referenceOverlayProblems(config)
    : [`compose config failed: ${(resolved.stderr || `exit ${resolved.status}`).trim()}`];
  for (const problem of problems) fail(`${what}: Compose`, `${REFERENCE_OVERLAY}: ${problem}`);
  if (problems.length > 0) return;
  console.log(`[profiles] ${what}: ${REFERENCE_OVERLAY} keeps demo's hardening, the reference read-only`);

  const name = `${run}-demo-reference`;
  const { env, mounts } = referenceRunArgs(config);
  const started = startServer(name, {
    env: { PORTFOLIO_PROFILE: 'demo', PORTFOLIO_ORIGIN: DEMO_ORIGIN, ...env },
    mounts: [...mediaCacheFor('demo'), ...mounts],
  });
  if (started.status !== 0) {
    fail(what, `the container did not start: ${(started.stderr || '').trim()}`);
    return;
  }
  const failed = failures.length;
  try {
    await waitHealthy(name, what);
    for (const problem of hardening(name, 'demo', [])) fail(`${what}: hardening`, problem);
    const ok = (response) =>
      response.status === 200 ? [] : [`answered ${response.status ?? response.error}, not 200`];
    const kept = fixtureRendition('tide-tables-cover');
    const hidden = fixtureRendition('canary-ref-private-media');
    const requests = [
      {
        path: '/reference',
        check: (response) => [
          ...ok(response),
          ...(response.body?.includes('Wren Halloway') ? [] : ["doesn't show Wren Halloway"]),
        ],
      },
      {
        path: kept,
        check: (response) => [
          ...ok(response),
          ...(response.headers?.['content-type'] === 'image/png'
            ? []
            : [`is ${response.headers?.['content-type']}, not image/png`]),
        ],
      },
      {
        path: hidden,
        // #10's plain 404, never cached, as for any rendition nothing places.
        check: (response) => (response.error ? [response.error] : mediaMissProblems(response)),
      },
    ];
    const responses = send(
      name,
      requests.map((request) => ({ method: 'GET', path: request.path })),
    );
    requests.forEach((request, index) => {
      const response = responses[index];
      const text = `${JSON.stringify(response.headers ?? {})}\n${response.body ?? ''}`;
      const leaked = referenceLeaks(text, request.path).map((canary) => `carries ${canary}`);
      for (const problem of [...request.check(response), ...leaked]) {
        fail(what, `GET ${request.path} ${problem}`, { profile: 'demo', route: request.path });
      }
    });
    const log = output(name);
    const warned = logEntries(log).filter((entry) => entry.key === 'PORTFOLIO_REFERENCE_DIR');
    if (warned.length > 0) {
      fail(what, `the reference logged ${warned.map((entry) => entry.code).join(', ')}`);
    }
    if (referenceLeaks(log, '/').length > 0) fail(what, 'the log holds a reference canary');
    if (failures.length > failed) saveLogs(name, redact(log, runSecrets));
    else console.log(`[profiles] ${what}: /reference and its placed rendition served, the private one a 404`);
  } catch (error) {
    fail(what, explained(name, error));
    saveLogs(name, redact(output(name), runSecrets));
  } finally {
    container(['rm', '-f', name]);
  }
}

/** Builds, loads, or pulls the image under test. */
function acquire() {
  if (pulled) {
    console.log(`[profiles] pulling ${image} with ${cli}`);
    if (container(['pull', image], { stdio: 'inherit' }).status !== 0) {
      throw new Error('the image could not be pulled');
    }
  } else if (archive) {
    console.log(`[profiles] loading ${image} from ${path.basename(archive)} with ${cli}`);
    if (container(['load', '-i', archive], { stdio: 'inherit' }).status !== 0) {
      throw new Error('the image archive could not be loaded');
    }
    if (container(['image', 'inspect', image]).status !== 0) {
      throw new Error(`the image archive holds no ${image}`);
    }
  } else {
    console.log(`[profiles] building ${image} with ${cli}`);
    if (container(['build', '-t', image, '.'], { stdio: 'inherit' }).status !== 0) {
      throw new Error('the image build failed');
    }
  }
}

async function smoke(parts) {
  for (const problem of hermeticProblems(process.env)) fail('hermetic', problem);
  acquire();
  const net = container(['network', 'create', '--internal', network]);
  if (net.status !== 0) throw new Error(`could not create the network: ${net.stderr.trim()}`);
  if (container(['volume', 'create', volume]).status !== 0) {
    throw new Error('could not create the data volume');
  }
  mkdirSync(path.join(stateDir, CANARY_SECRET), { recursive: true });
  writeFileSync(path.join(stateDir, CANARY_SECRET, HOPS_FILE.name), HOPS_FILE.text);
  writeFileSync(path.join(stateDir, CANARY_SECRET, HOPS_ONE), '1\n');

  // The source directory at a canary path, so a response naming it shows.
  const source = `/${CANARY_SOURCE}`;
  if (parts.includes('read-only')) {
    part = 'read-only';
    composeRun('read-only');
    await profileRun('read-only', {
      env: {
        PORTFOLIO_PROFILE: 'read-only',
        PORTFOLIO_ORIGIN: ORIGIN,
        PORTFOLIO_SOURCE_DIR: source,
      },
      mounts: ['-v', `${path.dirname(DEFAULT_PORTFOLIO)}:${source}:ro`],
    });
  }
  if (parts.includes('demo')) {
    part = 'demo';
    composeRun('demo');
    await profileRun('demo', {
      env: { PORTFOLIO_PROFILE: 'demo', PORTFOLIO_ORIGIN: DEMO_ORIGIN },
    });
    await referenceRun();
  }
  if (parts.includes('owner')) {
    part = 'owner';
    composeRun('owner');
    const secret = makeOwnerSecret();
    await ownerProfileRun(source, secret);
    ownerRun();
    ownerRows(secret);
  }
  if (parts.includes('rows')) {
    part = 'rows';
    rowRuns();
    await warningRowRuns();
  }
}

let exitCode = 0;
// Every dynamic pattern in the route table says what a path below it
// answers (#12), checked before any container starts.
part = 'rows';
for (const problem of dynamicRouteProblems(probedPatterns())) fail('route table', problem);
part = 'read-only';
const runParts = (() => {
  try {
    return partsOf(process.env.SMOKE_PROFILES);
  } catch (error) {
    fail('smoke:profiles', error.message);
    return [];
  }
})();
try {
  if (runParts.length > 0) await smoke(runParts);
} catch (error) {
  fail('smoke:profiles', error.message);
} finally {
  container(['network', 'rm', network]);
  container(['volume', 'rm', '-f', volume]);
  container(['volume', 'rm', '-f', ownerVolume]);
  rmSync(stateDir, { recursive: true, force: true });
  if (!pulled) container(['rmi', image]);
}
// What this run uploads holds none of its secrets: a file that does is
// redacted before the upload, and fails the run.
part = 'rows';
const artifacts = redactArtifacts(reportsDir(), runSecrets);
for (const file of artifacts.redacted) {
  fail('artifacts', `reports/${file} held a run secret, now redacted`, { artifacts: [file] });
}
for (const file of artifacts.unchecked) {
  fail('artifacts', `reports/${file} is too large to check for a run secret`, {
    artifacts: [file],
  });
}
if (failures.length > 0) {
  exitCode = 1;
  reportError(`smoke:profiles: ${failures.length} failure(s)`, { title: 'smoke:profiles' });
  const gate = currentGate();
  for (const { test, message, part: where, fields } of failures) {
    if (gate) {
      writeFailureRecord({
        ...gate,
        reproCommand: reproFor(where),
        test,
        actual: message,
        asset: image,
        ...fields,
      });
    }
  }
} else {
  console.log(`[profiles] ${image} passed under ${runParts.join(', ')}`);
}
process.exit(exitCode);
