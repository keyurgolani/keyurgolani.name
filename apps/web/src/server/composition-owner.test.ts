import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePublicationUnit } from '@portfolio/schema';
import {
  compose,
  type AuthBindings,
  type AuthProviderFactory,
  type CompositionInput,
  type StartupRequirement,
} from './composition';
import { readDeploymentConfig, type DeploymentConfig } from './config';
import { compositionFor } from '~/lib/variants';
import { segmentFor } from './experience';
import {
  liveComposition,
  setDeploymentState,
  setLiveComposition,
  type DeploymentState,
} from './config-store';
import { loadedOwnerModules } from './load-trace';
import { listOperations } from './operations';
import { listRoutes, resolveRoute, RETIRED_PATTERNS, routeAccess } from './routes';
import { errorResult, redirectResult } from './studio-result';

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
const ENVIRONMENT = {
  displayMode: 'system',
  contrast: 'system',
  motion: 'system',
  enhancement: 'on',
};
/** A body each command's input schema takes, where `{}` isn't one. */
const INPUT: Record<string, unknown> = {
  'auth.sessions.revoke': { ref: '0123abcd' },
  'preview.grant.mint': { subject: { fixture: 'complete' }, environment: ENVIRONMENT },
  'preview.grant.renew': { grant: 'A'.repeat(22) },
  'preview.grant.revoke': { grant: 'A'.repeat(22) },
  'preview.grant.status': { grant: 'A'.repeat(22) },
};
const PORTFOLIO =
  'schemaVersion: 3\nlocale: en\ndirection: ltr\nidentity:\n  name: Rowan Test\nsections:\n  - kind: lede\n    id: about\n    body: Hi.\n';
/** The digest the double's one session has, as #7's grants bind to it. */
const SESSION_DIGEST = 'a'.repeat(64);

const PROVIDER: AuthProviderFactory = {
  name: 'test-double',
  load: async ({ config, mintSession }) => {
    const session = mintSession();
    // #2's sessions over memory, for the real hold #3's pointer moves ask
    // for. The composition root has loaded owner code by now.
    const core = await import('@portfolio/core/owner');
    const sessions = core.createSessions({
      store: core.memorySessionStore(),
      audit: core.memoryAuditSink(),
      fingerprint: 'test-fingerprint',
    });
    const { token } = await sessions.issue({ uaFamily: 'firefox' });
    return {
      resolveSession: async ({ request }) => ({
        session: request.headers.get('x-test-session') === 'owner' ? session : null,
      }),
      checkOrigin: async ({ request }) => request.headers.get('origin') === config.origin,
      touchSession: async () => {},
      commitWithSession: async (context, commit) => {
        if (context.session !== session) {
          return { ok: false, result: errorResult('authentication_required') };
        }
        const holding = await sessions.holding(token, (hold) => commit(hold));
        return holding.status === 'valid'
          ? { ok: true, value: holding.value }
          : { ok: false, result: errorResult('authentication_required') };
      },
      handlers: Object.fromEntries(
        Object.entries(AUTH_OUTPUT).map(([name, output]) => [name, () => output]),
      ),
      grantSessions: {
        of: (given) =>
          given === session
            ? { digest: SESSION_DIGEST, absoluteExpiresAt: Date.now() + 3_600_000 }
            : null,
        resolveDigest: async (digest) => ({
          status: digest === SESSION_DIGEST ? ('valid' as const) : ('ended' as const),
        }),
        onSessionEnded: () => () => {},
      },
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
    // #5's fixture a fixture grant renders (#7): the test pair.
    previewFixtures: (id) =>
      id === 'complete'
        ? {
            portfolio: { format: 'yaml', sourceText: PORTFOLIO },
            site: { format: 'yaml', sourceText: readFileSync(EXAMPLES.site, 'utf8') },
          }
        : null,
    ...overrides,
  };
}

test.before(async () => {
  sourceDir = mkdtempSync(path.join(tmpdir(), 'composition-owner-'));
  dataDir = mkdtempSync(path.join(tmpdir(), 'composition-owner-data-'));
  writeFileSync(path.join(sourceDir, 'portfolio.yml'), PORTFOLIO);
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

/**
 * A query's input goes in the search parameters, a command's in its JSON
 * body: by default, the body INPUT gives the command.
 */
function studio(
  method: string,
  name: string,
  headers: Record<string, string> = {},
  input = (INPUT[name] ?? {}) as Record<string, unknown>,
) {
  const init: RequestInit = { method, headers: { 'x-request-id': 'req-owner', ...headers } };
  let query = '';
  if (method === 'POST') init.body = JSON.stringify(input);
  else if (Object.keys(input).length > 0) {
    query = `?${new URLSearchParams(input as Record<string, string>)}`;
  }
  return state.dispatch(new Request(`${ORIGIN}/api/studio/${name}${query}`, init), name);
}

/** Documents the store takes, with `name` as the portfolio's identity. */
function documents(name: string) {
  return {
    portfolio: {
      format: 'yaml' as const,
      sourceText: `schemaVersion: 3\nlocale: en\ndirection: ltr\nidentity:\n  name: ${name}\nsections:\n  - kind: lede\n    id: about\n    body: Hi.\n`,
    },
    site: { format: 'yaml' as const, sourceText: readFileSync(EXAMPLES.site, 'utf8') },
  };
}

/**
 * The data directory's store, as the CLI opens one beside the server, with
 * the checks the composition root uses here. Loaded once owner code has.
 */
async function sideStore() {
  const core = await import('@portfolio/core/owner');
  return core.openStore({
    dataDir,
    checks: {
      validate: (pair) => validatePublicationUnit(pair, { canonicalOrigin: ORIGIN }),
      appVersion: '',
    },
  });
}

test("owner's revision store reader records the composition of the unit each getLive() returns (#6, Slice 2)", async (t) => {
  t.after(() => setLiveComposition(undefined));
  setLiveComposition('stale');
  const live = await state.catalog.getLive();
  assert.ok(live.unit, 'the first-start import published the mounted documents');
  assert.equal(
    liveComposition(),
    compositionFor(live.unit.site.appearance.variant).rendered.manifest.id,
  );
  // The example site selects a variant this build doesn't register.
  assert.equal(liveComposition(), 'fallback');
});

test('owner loads its modules only through the composition root', () => {
  // Owner code, then the auth.secret and data.directory checks, which load
  // @portfolio/core's owner code through @portfolio/core/owner (#2), the
  // revision store's modules (#3) with the rest. The publication unit they
  // share with read-only isn't owner code, and isn't in the trace.
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
    'core/preview/grant-store',
    'core/preview/grants',
    'core/preview/token',
    'core/store/assets',
    'core/store/commit',
    'core/store/common',
    'core/store/drafts',
    'core/store/fs-port',
    'core/store/health-cache',
    'core/store/layout',
    'core/store/lock',
    'core/store/pointer',
    'core/store/preflight',
    'core/store/publication',
    'core/store/read-fs',
    'core/store/reader',
    'core/store/revisions',
    'core/store/server-claim',
    'core/store/source',
    'core/store/store',
    'server/owner/auth-secret',
    'server/owner/config-status',
    'server/owner/data-directory',
    'server/owner/first-start',
    'server/owner/index',
    'server/owner/preview',
    'server/owner/revision-integrity',
    'server/owner/session-mint',
    'server/owner/store',
    'server/owner/store-handlers',
  ]);
  assert.deepEqual(state.degraded, []);
});

test('config.status shows each secret as set and never a value or a path', async () => {
  const response = await studio('GET', 'config.status', { 'x-test-session': 'owner' });
  const text = await response.text();
  assert.ok(!text.includes('canary'), text);
  assert.ok(!text.includes(HASH) && !text.includes('$scrypt$'), text);
  assert.ok(!text.includes(sourceDir), text);
  const { data } = JSON.parse(text) as { data: Record<string, unknown> };
  assert.deepEqual(data.secrets, { PORTFOLIO_AUTH_PASSWORD_HASH: 'set', GITHUB_TOKEN: 'set' });
  // Owner reads through the revision store's reader (#3), and its first
  // start imported the mounted pair into the empty store as revision 1.
  assert.deepEqual(data.adapters, { catalog: 'revisions' });
  const live = (await state.catalog.getLive()).revisionId;
  assert.match(String(live), /^rev_/);
  assert.deepEqual(data.catalog, {
    state: 'live',
    liveRevisionId: live,
    servingRevisionId: live,
    renderDrift: null,
  });
  // This server holds the data directory, so owner writes go through.
  assert.deepEqual(data.writes, { state: 'open' });
  assert.equal(data.origin, ORIGIN);
  // The owner's diagnostic (#5): the site example selects a variant this
  // build doesn't register yet, so the fallback composition renders.
  assert.deepEqual(data.variant, {
    status: 'degraded',
    requested: 'editorial-evidence',
    rendered: 'fallback',
  });
});

test('every registered operation fails closed without a session and runs with one', async () => {
  // Two revisions, published from beside the server as the CLI would, and
  // a working draft, so each store entry has something to act on.
  const side = await sideStore();
  const revisions: string[] = [];
  for (const name of ['Rowan First', 'Rowan Second']) {
    const created = await side.drafts.create({ documents: documents(name) }, 'owner');
    assert.equal(created.kind, 'saved');
    if (created.kind !== 'saved') return;
    const live = (await side.publication.status()).liveRevisionId;
    const outcome = await side.publication.publish(
      { draftId: created.draft.draftId, draftVersion: 1, expectedLiveRevisionId: live },
      'operator',
    );
    assert.equal(outcome.kind, 'committed', JSON.stringify(outcome));
    if (outcome.kind === 'committed') revisions.push(outcome.revisionId);
  }
  assert.equal((await side.drafts.create({}, 'owner')).kind, 'saved');
  const live = async () => (await side.publication.status()).liveRevisionId;
  const working = async () => {
    const draft = await side.drafts.getWorking();
    assert.ok(draft);
    return draft;
  };
  /** The input each entry runs with, signed in, from what the store holds by then. */
  const inputs: Record<string, () => Promise<Record<string, unknown>>> = {
    'auth.sessions.revoke': async () => ({ ref: '0123abcd' }),
    'revision.list': async () => ({ limit: '1' }),
    'revision.get': async () => ({ revisionId: revisions[0] }),
    'history.list': async () => ({ offset: '1' }),
    'draft.get': async () => ({ draftId: (await working()).draftId }),
    'draft.create': async () => ({ expectedVersion: (await working()).version }),
    'draft.save': async () => {
      const draft = await working();
      return {
        draftId: draft.draftId,
        expectedVersion: draft.version,
        documents: documents('Rowan Saved'),
      };
    },
    'draft.applyEdits': async () => {
      const draft = await working();
      return {
        draftId: draft.draftId,
        expectedVersion: draft.version,
        edits: [
          { document: 'portfolio', pointer: '/identity/name', op: 'set', value: 'Rowan Edited' },
        ],
      };
    },
    'draft.rebase': async () => {
      const draft = await working();
      return {
        draftId: draft.draftId,
        expectedVersion: draft.version,
        documents: documents('Rowan Rebased'),
        baseRevisionId: await live(),
      };
    },
    'draft.discard': async () => {
      const draft = await working();
      return { draftId: draft.draftId, expectedVersion: draft.version };
    },
    publish: async () => {
      const created = await side.drafts.create({ documents: documents('Rowan Third') }, 'owner');
      assert.equal(created.kind, 'saved');
      const draft = created.kind === 'saved' ? created.draft : await working();
      return {
        draftId: draft.draftId,
        draftVersion: draft.version,
        expectedLiveRevisionId: await live(),
      };
    },
    rollback: async () => ({
      targetRevisionId: revisions[0],
      expectedLiveRevisionId: await live(),
    }),
    recover: async () => ({ targetRevisionId: revisions[1], expectedLiveRevisionId: await live() }),
  };

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

    const signedIn = await studio(
      method,
      operation.name,
      { ...origin, 'x-test-session': 'owner' },
      await (
        inputs[operation.name] ??
        (async () => (INPUT[operation.name] ?? {}) as Record<string, unknown>)
      )(),
    );
    const text = await signedIn.text();
    assert.equal(signedIn.status, 200, `${operation.name}: ${text}`);
    const body = JSON.parse(text) as { data: unknown };
    assert.equal(operation.output.safeParse(body.data).success, true, operation.name);
  }
  // After the first-start import and the two from beside the server, the
  // pointer moved three times through Studio: publish, rollback, recover.
  assert.equal((await side.publication.status()).seq, 6);
  assert.equal(await live(), revisions[1]);
});

test('a second composition in this process, as register() run again builds, shares the server claim, and owner writes go on', async () => {
  const server = path.join(dataDir, 'publication', 'server.json');
  const claimed = readFileSync(server, 'utf8');
  const again = await compose(input());
  assert.ok(again.ok, JSON.stringify(again.ok ? [] : again.issues));
  // No second record over the first, which the first would read as another server's.
  assert.equal(readFileSync(server, 'utf8'), claimed);
  for (const deployment of [state, again.state]) {
    const signedIn = { 'x-request-id': 'req-owner', 'x-test-session': 'owner' };
    const working = await deployment.dispatch(
      new Request(`${ORIGIN}/api/studio/draft.getWorking`, { headers: signedIn }),
      'draft.getWorking',
    );
    const { data } = (await working.json()) as { data: { draft: { version: number } | null } };
    const created = await deployment.dispatch(
      new Request(`${ORIGIN}/api/studio/draft.create`, {
        method: 'POST',
        headers: { ...signedIn, origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify(data.draft ? { expectedVersion: data.draft.version } : {}),
      }),
      'draft.create',
    );
    assert.equal(created.status, 200, await created.clone().text());
  }
});

test("the owner branch puts the provider's Studio page sessions in the deployment state, and none without them", async () => {
  const pages = { resolve: async () => ({ status: 'none' }) as const };
  const withPages = await compose(
    input({
      authProviders: [
        {
          name: 'pages',
          load: async (tools) => ({ ...(await PROVIDER.load(tools)), pages }),
        },
      ],
    }),
  );
  assert.ok(withPages.ok, JSON.stringify(withPages.issues));
  assert.equal(withPages.state.pages, pages);
  // The double binds none, so requireOwnerPage refuses every Studio page.
  assert.equal(state.pages, undefined);
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
    // No entry has the name; publish, which this used to stand in for, has one now (#3).
    const response = await studio('GET', 'revision.delete', headers);
    assert.equal(response.status, 404);
    const { error } = (await response.json()) as { error: { code: string; requestId: string } };
    assert.deepEqual(error.code, 'not_available_in_profile');
    assert.equal(error.requestId, 'req-owner');
  }
});

test('the owner route matrix: each route as its capability says, and retired ones absent', () => {
  // Each dynamic segment a word no route starts with, as the profile matrix
  // does, so the path is the pattern's own: `/[...view]` as `/sample` would
  // be the demo's sample route.
  const concrete = (pattern: string) =>
    pattern.replace(/\/\[\[\.\.\.[^\]]+\]\]/g, '').replace(/\[\.{0,3}[^\]]+\]/g, 'probe') || '/';
  for (const entry of listRoutes()) {
    const pathname = concrete(entry.pattern);
    // No installed variant declares a view at /probe, and no slug names a
    // work until #10. A grant route's probe is its grant, and the route's
    // home is served (#7): proxy.ts checks the grant itself.
    const expected =
      entry.kind === 'page' && pathname.includes('probe') && !entry.grant
        ? 'missing'
        : routeAccess('owner', entry) === 'absent'
          ? 'absent'
          : 'served';
    assert.equal(resolveRoute('owner', pathname).status, expected, entry.pattern);
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

test("after a publish from beside the server, a Studio config.status read records the new revision's composition, so a visitor lands in its segment with no 307 (#6, Slice 2)", async (t) => {
  t.after(() => setLiveComposition(undefined));
  // A publish from beside the server, as the CLI would make one.
  const side = await sideStore();
  const working = await side.drafts.getWorking();
  const created = await side.drafts.create(
    {
      documents: documents('Rowan Background'),
      ...(working ? { expectedVersion: working.version } : {}),
    },
    'owner',
  );
  assert.equal(created.kind, 'saved');
  if (created.kind !== 'saved') return;
  const outcome = await side.publication.publish(
    {
      draftId: created.draft.draftId,
      draftVersion: created.draft.version,
      expectedLiveRevisionId: (await side.publication.status()).liveRevisionId,
    },
    'operator',
  );
  assert.equal(outcome.kind, 'committed', JSON.stringify(outcome));
  // What a read before the publish left; then Studio's read is the first since.
  setLiveComposition('stale');
  const response = await studio('GET', 'config.status', { 'x-test-session': 'owner' });
  assert.equal(response.status, 200, await response.clone().text());
  // The example site selects a variant this build doesn't register, so the
  // fallback composition renders, and the segment the proxy names is the
  // one the page there checks again: no 307.
  assert.equal(liveComposition(), 'fallback');
  assert.equal(
    segmentFor({ profile: 'owner', pattern: '/', query: new URLSearchParams() }),
    'fallback',
  );
});
