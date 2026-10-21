import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compose,
  type AuthBindings,
  type AuthProviderFactory,
  type CompositionInput,
  type StartupRequirement,
} from './composition';
import { readDeploymentConfig, type DeploymentConfig } from './config';
import { setDeploymentState, type DeploymentState } from './config-store';
import { loadedOwnerModules } from './load-trace';
import { listOperations } from './operations';
import { listRoutes, resolveRoute, RETIRED_PATTERNS, routeAccess } from './routes';
import { redirectResult } from './studio-result';

// Owner in process, with a test double for #2's provider: the route and
// operation matrix for owner, which tests/e2e/owner.spec.ts runs end to end
// with the password provider. A request carrying `x-test-session: owner` has
// a session the double minted, and a command passes the origin check when it
// comes from PORTFOLIO_ORIGIN. The double answers the provider's own auth
// entries with fixed output, so the matrix covers them too;
// owner/auth.test.ts runs the real ones.

const EXAMPLES = {
  portfolio: fileURLToPath(new URL('../../../../portfolio.example.yml', import.meta.url)),
  site: fileURLToPath(new URL('../../../../site.example.yml', import.meta.url)),
};
const ORIGIN = 'https://rowan.test';

/**
 * A scrypt PHC string at the floor, made here rather than with
 * @portfolio/core, which would load owner modules before the composition
 * root does.
 */
function passwordHash(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, {
    N: 2 ** 17,
    r: 8,
    p: 1,
    maxmem: 2 * 128 * 2 ** 17 * 8,
  });
  const base64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');
  return `$scrypt$ln=17,r=8,p=1$${base64(salt)}$${base64(key)}`;
}
const HASH = passwordHash('composition owner passphrase');

const AT = '2026-10-20T09:00:00.000Z';
const SESSION_VIEW = {
  principal: { id: 'owner', method: 'password', authTime: AT },
  csrfToken: 'A'.repeat(43),
  idleExpiresAt: AT,
  absoluteExpiresAt: AT,
};
/** Fixed output for each of the provider's own entries. */
const AUTH_OUTPUT: Record<string, unknown> = {
  'auth.session': SESSION_VIEW,
  'auth.login': SESSION_VIEW,
  'auth.logout': { signedOut: true },
  'auth.session.extend': { idleExpiresAt: AT, absoluteExpiresAt: AT },
  'auth.sessions.list': { sessions: [] },
  'auth.sessions.revoke': { revoked: false },
  'auth.sessions.revokeAll': { revoked: 0 },
};
/** A body each command's input schema takes, where `{}` isn't one. */
const INPUT: Record<string, unknown> = { 'auth.sessions.revoke': { ref: '0123abcd' } };

const PROVIDER: AuthProviderFactory = {
  name: 'test-double',
  load: async ({ config, mintSession }) => {
    const session = mintSession();
    return {
      resolveSession: async ({ request }) => ({
        session: request.headers.get('x-test-session') === 'owner' ? session : null,
      }),
      checkOrigin: async ({ request }) => request.headers.get('origin') === config.origin,
      touchSession: async () => {},
      handlers: Object.fromEntries(
        Object.entries(AUTH_OUTPUT).map(([name, output]) => [name, () => output]),
      ),
    };
  },
};

let config: DeploymentConfig;
let state: DeploymentState;
let sourceDir: string;
let dataDir: string;

function input(overrides: Partial<CompositionInput> = {}): CompositionInput {
  return {
    config,
    examples: EXAMPLES,
    report: () => {},
    authProviders: [PROVIDER],
    ...overrides,
  };
}

test.before(async () => {
  sourceDir = mkdtempSync(path.join(tmpdir(), 'composition-owner-'));
  dataDir = mkdtempSync(path.join(tmpdir(), 'composition-owner-data-'));
  writeFileSync(
    path.join(sourceDir, 'portfolio.yml'),
    'schemaVersion: 2\nlocale: en\ndirection: ltr\nidentity:\n  name: Rowan Test\nsections:\n  - kind: lede\n    id: about\n    body: Hi.\n',
  );
  copyFileSync(EXAMPLES.site, path.join(sourceDir, 'site.yml'));
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: 'owner',
      PORTFOLIO_ORIGIN: ORIGIN,
      PORTFOLIO_SOURCE_DIR: sourceDir,
      PORTFOLIO_DATA_DIR: dataDir,
      PORTFOLIO_AUTH_PASSWORD_HASH: HASH,
      GITHUB_TOKEN: 'canary-github-token',
    },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  config = read.config;
  assert.deepEqual(loadedOwnerModules(), []);
  const composed = await compose(input());
  assert.ok(composed.ok, JSON.stringify(composed.issues));
  state = composed.state;
  // As register() does.
  setDeploymentState(state);
});

test.after(() => {
  setDeploymentState(undefined);
  rmSync(sourceDir, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

function studio(method: string, name: string, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { 'x-request-id': 'req-owner', ...headers } };
  if (method === 'POST') init.body = JSON.stringify(INPUT[name] ?? {});
  return state.dispatch(new Request(`${ORIGIN}/api/studio/${name}`, init), name);
}

test('owner loads its modules only through the composition root', () => {
  // Owner code, then the auth.secret and data.directory checks, which load
  // all of @portfolio/core through its one entry (#2).
  assert.deepEqual([...loadedOwnerModules()].sort(), [
    'core/audit/record',
    'core/audit/sink',
    'core/audit/source',
    'core/auth/fingerprint',
    'core/auth/phc',
    'core/auth/provider',
    'core/auth/session-files',
    'core/auth/session-store',
    'core/auth/sessions',
    'core/auth/token',
    'core/data/layout',
    'core/owner',
    'server/owner/auth-secret',
    'server/owner/config-status',
    'server/owner/data-directory',
    'server/owner/index',
    'server/owner/session-mint',
  ]);
  assert.deepEqual(state.degraded, []);
});

test('every registered operation fails closed without a session and runs with one', async () => {
  for (const operation of listOperations()) {
    const [method, wrong] = operation.kind === 'query' ? ['GET', 'POST'] : ['POST', 'GET'];
    const origin = { origin: ORIGIN, 'content-type': 'application/json' };

    const anonymous = await studio(method, operation.name, origin);
    assert.equal(anonymous.status, operation.session ? 401 : 200, operation.name);
    assert.equal(anonymous.headers.get('cache-control'), 'no-store');

    const misrouted = await studio(wrong, operation.name, { ...origin, 'x-test-session': 'owner' });
    assert.equal(misrouted.status, 405, operation.name);

    if (operation.kind === 'command') {
      const foreign = await studio(method, operation.name, {
        origin: 'https://elsewhere.test',
        'x-test-session': 'owner',
      });
      assert.equal(foreign.status, 403, operation.name);
    }

    const signedIn = await studio(method, operation.name, { ...origin, 'x-test-session': 'owner' });
    assert.equal(signedIn.status, 200, operation.name);
    const body = (await signedIn.json()) as { data: unknown };
    assert.equal(operation.output.safeParse(body.data).success, true, operation.name);
  }
});

test('config.status shows each secret as set and never a value or a path', async () => {
  const response = await studio('GET', 'config.status', { 'x-test-session': 'owner' });
  const text = await response.text();
  assert.ok(!text.includes('canary'), text);
  assert.ok(!text.includes(HASH) && !text.includes('$scrypt$'), text);
  assert.ok(!text.includes(sourceDir), text);
  const { data } = JSON.parse(text) as { data: Record<string, unknown> };
  assert.deepEqual(data.secrets, { PORTFOLIO_AUTH_PASSWORD_HASH: 'set', GITHUB_TOKEN: 'set' });
  assert.deepEqual(data.adapters, { catalog: 'documents' });
  assert.equal(data.origin, ORIGIN);
  // The owner's diagnostic (#5): the site example selects a variant this
  // build doesn't register yet, so the fallback composition renders.
  assert.deepEqual(data.variant, {
    status: 'degraded',
    requested: 'editorial-evidence',
    rendered: 'fallback',
  });
});

test("the owner branch binds the provider's throttle and invalidInput, and goes on without them when it has neither", async () => {
  const limited = await compose(
    input({
      authProviders: [
        {
          name: 'limited',
          load: async (tools) => ({
            ...(await PROVIDER.load(tools)),
            throttle: async ({ request }) =>
              request.headers.has('x-test-throttle')
                ? redirectResult('/studio/sign-in?state=rate_limited&retryAfter=1')
                : null,
            invalidInput: async () => redirectResult('/studio/sign-in?state=error'),
          }),
        },
      ],
    }),
  );
  assert.ok(limited.ok, JSON.stringify(limited.issues));
  const login = (headers: Record<string, string>, body: string) =>
    new Request(`${ORIGIN}/api/studio/auth.login`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
      body,
    });
  const throttled = await limited.state.dispatch(
    login({ 'x-test-throttle': '1' }, '{}'),
    'auth.login',
  );
  assert.equal(throttled.status, 303);
  assert.equal(
    throttled.headers.get('location'),
    '/studio/sign-in?state=rate_limited&retryAfter=1',
  );
  const malformed = await limited.state.dispatch(login({}, '{'), 'auth.login');
  assert.equal(malformed.status, 303);
  assert.equal(malformed.headers.get('location'), '/studio/sign-in?state=error');
  // The double has neither: nothing is throttled, and malformed input is the 400.
  assert.equal(
    (await state.dispatch(login({ 'x-test-throttle': '1' }, '{}'), 'auth.login')).status,
    200,
  );
  assert.equal((await state.dispatch(login({}, '{'), 'auth.login')).status, 400);
});

test('an unknown operation is the same 404 with or without a session', async () => {
  const visitors: Record<string, string>[] = [{}, { 'x-test-session': 'owner' }];
  for (const headers of visitors) {
    const response = await studio('GET', 'publish', headers);
    assert.equal(response.status, 404);
    const { error } = (await response.json()) as { error: { code: string; requestId: string } };
    assert.deepEqual(error.code, 'not_available_in_profile');
    assert.equal(error.requestId, 'req-owner');
  }
});

test('the owner route matrix: each route as its capability says, and retired ones absent', () => {
  const concrete = (pattern: string) => pattern.replace(/\[[^\]]+\]/g, 'sample');
  for (const entry of listRoutes()) {
    const expected = routeAccess('owner', entry) === 'absent' ? 'absent' : 'served';
    assert.equal(resolveRoute('owner', concrete(entry.pattern)).status, expected, entry.pattern);
  }
  for (const pattern of RETIRED_PATTERNS) {
    assert.equal(resolveRoute('owner', concrete(pattern)).status, 'absent', pattern);
  }
});

test('owner runs loaded requirements after its code, then loads the provider', async () => {
  const order: string[] = [];
  const bindings: AuthBindings = {
    resolveSession: async () => ({ session: null }),
    checkOrigin: async () => false,
    touchSession: async () => {},
  };
  const requirement = (id: string, row: Partial<StartupRequirement>): StartupRequirement => ({
    id,
    issue: '#1',
    profiles: ['owner'],
    failure: 'fatal',
    ...row,
  });
  const composed = await compose(
    input({
      authProviders: [
        {
          name: 'ordered',
          load: async (tools) => {
            assert.equal(tools.config, config);
            order.push('provider');
            return bindings;
          },
        },
      ],
      requirements: [
        requirement('late', {
          load: async () => {
            order.push('load late');
            return async (context) => {
              assert.equal(context.config, config);
              order.push('check late');
              return [];
            };
          },
        }),
        requirement('early', {
          check: async () => {
            order.push('check early');
            return [];
          },
        }),
      ],
    }),
  );
  assert.ok(composed.ok, JSON.stringify(composed.issues));
  assert.deepEqual(order, ['check early', 'load late', 'check late', 'provider']);
});

test('a fatal loaded requirement stops owner before the provider loads', async () => {
  let loaded = false;
  const composed = await compose(
    input({
      authProviders: [
        {
          name: 'never',
          load: async () => {
            loaded = true;
            throw new Error('the provider loads only after the requirements pass');
          },
        },
      ],
      requirements: [
        {
          id: 'auth.secret',
          issue: '#2',
          profiles: ['owner'],
          failure: 'fatal',
          load: async () => async () => [
            {
              severity: 'fatal',
              key: 'PORTFOLIO_AUTH_PASSWORD_HASH',
              code: 'malformed',
              message: 'test',
            },
          ],
        },
      ],
    }),
  );
  assert.equal(composed.ok, false);
  assert.deepEqual(
    composed.issues.map((issue) => `${issue.severity} ${issue.code}`),
    ['fatal malformed'],
  );
  assert.equal(loaded, false);
});
