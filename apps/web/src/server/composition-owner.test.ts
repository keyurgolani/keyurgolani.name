import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compose,
  type AuthProvider,
  type AuthProviderFactory,
  type CompositionInput,
  type StartupRequirement,
} from './composition';
import { readDeploymentConfig, type DeploymentConfig } from './config';
import { setDeploymentState, type DeploymentState } from './config-store';
import { loadedOwnerModules } from './load-trace';
import { listOperations } from './operations';
import { listRoutes, resolveRoute, RETIRED_PATTERNS, routeAccess } from './routes';

// Owner in process, with a test double for #2's provider: the route and
// operation matrix for owner until #2 ships a real one and reruns it end to
// end. A request carrying `x-test-session: owner` has a session the double
// minted, and a command passes the origin check when it comes from
// PORTFOLIO_ORIGIN.

const EXAMPLES = {
  portfolio: fileURLToPath(new URL('../../../../portfolio.example.yml', import.meta.url)),
  site: fileURLToPath(new URL('../../../../site.example.yml', import.meta.url)),
};
const ORIGIN = 'https://rowan.test';

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
    };
  },
};

let config: DeploymentConfig;
let state: DeploymentState;
let sourceDir: string;

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
      PORTFOLIO_AUTH_PASSWORD_HASH: 'canary-password-hash',
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
});

function studio(method: string, name: string, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { 'x-request-id': 'req-owner', ...headers } };
  if (method === 'POST') init.body = '{}';
  return state.dispatch(new Request(`${ORIGIN}/api/studio/${name}`, init), name);
}

test('owner loads its modules only through the composition root', () => {
  assert.deepEqual(loadedOwnerModules(), [
    'server/owner/config-status',
    'server/owner/session-mint',
    'server/owner/index',
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
  assert.ok(!text.includes(sourceDir), text);
  const { data } = JSON.parse(text) as { data: Record<string, unknown> };
  assert.deepEqual(data.secrets, { PORTFOLIO_AUTH_PASSWORD_HASH: 'set', GITHUB_TOKEN: 'set' });
  assert.deepEqual(data.adapters, { catalog: 'documents' });
  assert.equal(data.origin, ORIGIN);
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
  const bindings: AuthProvider = {
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
