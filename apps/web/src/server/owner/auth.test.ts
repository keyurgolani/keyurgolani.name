import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  csrfToken,
  filesystemSessionStore,
  memoryAuditSink,
  prepareAuthDirectories,
  sessionDigest,
  sessionRef,
  type MemoryAuditSink,
} from '@portfolio/core/owner';
import type { Capability } from '../capabilities';
import type { DeploymentConfig } from '../config';
import { setDeploymentState } from '../config-store';
import { createDispatcher, NO_BINDINGS, type Handler } from '../dispatcher';
import { listOperations, type BodyType, type ErrorCode, type Operation } from '../operations';
import { isMintedSession } from '../session';
import { provider, type OwnerAuth } from './auth';
import { mintSession } from './session-mint';

// The owner provider's bindings (#2), through the dispatcher, over a real
// data directory: which cookie counts, what a command needs at step 3, what
// slides a session, and what ends one.

const ORIGIN = 'https://rowan.test';
const MINUTE = 60_000;
const base64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');
/** A PHC string of the right shape. The provider only fingerprints it; nothing here verifies. */
const shapedHash = () =>
  `$scrypt$ln=17,r=8,p=1$${base64(randomBytes(16))}$${base64(randomBytes(32))}`;

function op(
  name: string,
  capability: Capability,
  kind: 'query' | 'command',
  extra: {
    session?: boolean;
    bodyTypes?: BodyType[];
    originCheck?: boolean;
    errors?: ErrorCode[];
  } = {},
): Operation {
  return {
    name,
    kind,
    capability,
    input: z.object({ note: z.string().optional() }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
    session: extra.session ?? true,
    originCheck: extra.originCheck ?? kind === 'command',
    bodyTypes: extra.bodyTypes,
    errors: extra.errors ?? [],
  };
}

const OPERATIONS = [
  op('test.view', 'studio.view', 'query'),
  op('test.edit', 'draft.write', 'command'),
  op('auth.session.extend', 'auth.session', 'command'),
  op('preview.grant.renew', 'preview.grant', 'command'),
  op('auth.login', 'auth.session', 'command', { session: false, bodyTypes: ['json', 'form'] }),
  op('auth.logout', 'auth.session', 'command', { session: false }),
  // A command that needs no session, and isn't auth.login.
  op('test.public', 'auth.session', 'command', { session: false }),
  // A query that asks for the origin check, as no registered one does.
  op('test.guarded', 'studio.view', 'query', { originCheck: true }),
  // A command of two steps, as #3's publish is, which can stop at its commit point.
  op('test.publish', 'publish', 'command', { errors: ['authentication_required'] }),
];

function dataDirectory(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'owner-auth-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

interface Setup {
  readonly dataDir?: string;
  readonly hash?: string;
  readonly origin?: string;
  readonly hops?: number;
  /** The provider's own audit sink, in the data directory, instead of a memory one. */
  readonly ownAudit?: boolean;
  /** Handlers in place of the one that records each operation it runs. */
  readonly handlers?: Readonly<Record<string, Handler>>;
}

async function setup(t: TestContext, options: Setup = {}) {
  const dataDir = options.dataDir ?? dataDirectory(t);
  assert.equal(await prepareAuthDirectories(dataDir), null);
  let at = Date.UTC(2026, 9, 20, 9, 0, 0);
  const now = () => at;
  const audit: MemoryAuditSink = memoryAuditSink(now);
  const config = {
    profile: 'owner',
    mode: 'production',
    origin: options.origin ?? ORIGIN,
    trustedProxyHops: options.hops ?? 0,
    dataDir,
    sessionLifetime: { idleMinutes: 60, maxHours: 12 },
    secrets: { authPasswordHash: options.hash ?? shapedHash() },
  } as DeploymentConfig;
  const auth: OwnerAuth = await provider(
    { config, mintSession },
    options.ownAudit ? { now } : { now, audit },
  );
  setDeploymentState({
    config,
    catalog: { getLive: () => assert.fail('no catalog here') },
    dispatch: () => assert.fail('tests call their own dispatcher'),
    degraded: [],
  });
  t.after(() => setDeploymentState(undefined));
  const handled: string[] = [];
  const handler: Handler = (_authorized, _input, context) => {
    handled.push(context.operation.name);
    return { ok: true };
  };
  const dispatch = createDispatcher({
    ...NO_BINDINGS,
    ...auth,
    operations: OPERATIONS,
    handlers: {
      ...Object.fromEntries(OPERATIONS.map((entry) => [entry.name, handler])),
      ...options.handlers,
    },
  });
  const issue = async () => (await auth.sessions.issue({ uaFamily: 'firefox' })).token;
  return {
    auth,
    audit,
    dataDir,
    dispatch,
    handled,
    issue,
    now,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

interface Send {
  readonly token?: string;
  readonly cookieName?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  /** Where the request goes. Default the owner origin. */
  readonly url?: string;
}

/** A browser-shaped request: a same-origin JSON command, or a same-origin GET for a query. */
function request(operation: string, { token, cookieName, headers = {}, body, url }: Send = {}) {
  const entry = OPERATIONS.find((candidate) => candidate.name === operation);
  assert.ok(entry, operation);
  const sent = new Headers({ 'x-request-id': 'req-auth', 'sec-fetch-site': 'same-origin' });
  if (token) sent.set('cookie', `${cookieName ?? '__Host-studio_session'}=${token}`);
  if (entry.kind === 'command') {
    sent.set('origin', ORIGIN);
    sent.set('content-type', 'application/json');
    if (token) sent.set('x-csrf-token', csrfToken(token));
  }
  for (const [name, value] of Object.entries(headers)) {
    if (value === '') sent.delete(name);
    else sent.set(name, value);
  }
  // Bytes, so the body adds no content type of its own.
  return new Request(url ?? `${ORIGIN}/api/studio/${operation}`, {
    method: entry.kind === 'query' ? 'GET' : 'POST',
    headers: sent,
    body: entry.kind === 'command' ? new TextEncoder().encode(body ?? '{}') : undefined,
  });
}

async function codeOf(response: Response): Promise<string | null> {
  if (response.status === 200) return null;
  return ((await response.json()) as { error: { code: string } }).error.code;
}

test('a command without an exact Origin, from a cross-site fetch, without a matching CSRF token, or not JSON is 403 request_origin_rejected', async (t) => {
  const { dispatch, handled, issue, audit } = await setup(t);
  const token = await issue();
  const other = await issue();
  const cases: [what: string, headers: Record<string, string>, reason: string][] = [
    ['no Origin', { origin: '' }, 'origin_missing'],
    ['an http Origin', { origin: 'http://rowan.test' }, 'origin_mismatch'],
    ['another port', { origin: 'https://rowan.test:8443' }, 'origin_mismatch'],
    ['an opaque origin', { origin: 'null' }, 'origin_mismatch'],
    ['a cross-site fetch', { 'sec-fetch-site': 'cross-site' }, 'fetch_site'],
    ['no CSRF token', { 'x-csrf-token': '' }, 'csrf_missing'],
    ['a wrong CSRF token', { 'x-csrf-token': 'x'.repeat(43) }, 'csrf_mismatch'],
    ["another session's CSRF token", { 'x-csrf-token': csrfToken(other) }, 'csrf_mismatch'],
    ['a text/plain body', { 'content-type': 'text/plain' }, 'content_type'],
    ['a form body', { 'content-type': 'application/x-www-form-urlencoded' }, 'content_type'],
    ['no content type', { 'content-type': '' }, 'content_type'],
  ];
  for (const [what, headers, reason] of cases) {
    const response = await dispatch(request('test.edit', { token, headers }), 'test.edit');
    assert.equal(response.status, 403, what);
    assert.equal(await codeOf(response), 'request_origin_rejected', what);
    const denial = audit.records.at(-1);
    assert.equal(denial?.type, 'command_denied', what);
    // Not known to be the owner, though it carried the owner's cookie: the
    // session is a ref.
    assert.equal(denial?.actor, 'anonymous', what);
    assert.deepEqual(
      [denial?.refs.command, denial?.refs.reason, denial?.refs.sessionRef],
      ['test.edit', reason, sessionRef(sessionDigest(token))],
      what,
    );
  }
  assert.deepEqual(handled, []);
  // The response says nothing about which check failed, and the audit log
  // holds neither token.
  const records = JSON.stringify(audit.records);
  assert.ok(!records.includes(token) && !records.includes(csrfToken(token)));

  // The same command, sent as the browser sends it, with a charset.
  const passed = await dispatch(
    request('test.edit', {
      token,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    }),
    'test.edit',
  );
  assert.equal(passed.status, 200);
  assert.deepEqual(handled, ['test.edit']);
  // auth.login needs no CSRF token, takes a form, and still needs the exact Origin.
  const form = { 'content-type': 'application/x-www-form-urlencoded' };
  assert.equal(
    (await dispatch(request('auth.login', { headers: form, body: '' }), 'auth.login')).status,
    200,
  );
  const elsewhere = { ...form, origin: 'https://demo.rowan.test', 'sec-fetch-site': 'same-site' };
  const refused = await dispatch(
    request('auth.login', { headers: elsewhere, body: '' }),
    'auth.login',
  );
  assert.equal(await codeOf(refused), 'request_origin_rejected');
  assert.equal(audit.records.at(-1)?.actor, 'anonymous');
});

test('every command but auth.login, and auth.logout with no session, needs the CSRF token, and a query that asks for the check needs the exact Origin too', async (t) => {
  const { dispatch, handled, issue, audit, auth } = await setup(t);
  // A command that needs no session still needs a token, so without one it is refused.
  const bare = await dispatch(request('test.public'), 'test.public');
  assert.equal(await codeOf(bare), 'request_origin_rejected');
  assert.equal(audit.records.at(-1)?.refs.reason, 'csrf_missing');
  // With a session and its token, it passes.
  const token = await issue();
  assert.equal((await dispatch(request('test.public', { token }), 'test.public')).status, 200);

  // A query that asks for the check: a browser's GET, with no Origin, is refused.
  const plain = await dispatch(request('test.guarded', { token }), 'test.guarded');
  assert.equal(await codeOf(plain), 'request_origin_rejected');
  assert.equal(audit.records.at(-1)?.refs.reason, 'origin_missing');
  // The exact Origin is not enough without the session's token.
  const tokenless = await dispatch(
    request('test.guarded', { token, headers: { origin: ORIGIN } }),
    'test.guarded',
  );
  assert.equal(await codeOf(tokenless), 'request_origin_rejected');
  assert.equal(audit.records.at(-1)?.refs.reason, 'csrf_missing');
  const both = { origin: ORIGIN, 'x-csrf-token': csrfToken(token) };
  assert.equal(
    (await dispatch(request('test.guarded', { token, headers: both }), 'test.guarded')).status,
    200,
  );

  // auth.logout with a session needs its token like any command. With no
  // session, or one that ended, it has none to take one from, and the exact
  // Origin is all it needs.
  const noCsrf = { 'x-csrf-token': '' };
  const withSession = await dispatch(
    request('auth.logout', { token, headers: noCsrf }),
    'auth.logout',
  );
  assert.equal(await codeOf(withSession), 'request_origin_rejected');
  assert.equal(audit.records.at(-1)?.refs.reason, 'csrf_missing');
  const ended = await issue();
  assert.ok(await auth.sessions.end(sessionDigest(ended), 'logout'));
  for (const cookie of [undefined, ended, 'not-a-token']) {
    const response = await dispatch(
      request('auth.logout', { token: cookie, headers: noCsrf }),
      'auth.logout',
    );
    assert.equal(response.status, 200, String(cookie));
    // It sets the cookie itself, so step 2 doesn't clear it as well.
    assert.equal(response.headers.get('set-cookie'), null, String(cookie));
  }
  const noOrigin = await dispatch(
    request('auth.logout', { headers: { origin: '' } }),
    'auth.logout',
  );
  assert.equal(await codeOf(noOrigin), 'request_origin_rejected');
  assert.equal(audit.records.at(-1)?.refs.reason, 'origin_missing');
  assert.deepEqual(handled, [
    'test.public',
    'test.guarded',
    'auth.logout',
    'auth.logout',
    'auth.logout',
  ]);
});

test('two session cookies give no session, and neither is cleared', async (t) => {
  const { dispatch, handled, issue } = await setup(t);
  const token = await issue();
  const planted = await issue();
  for (const pair of [
    `${token}; __Host-studio_session=${planted}`,
    `${token}; __Host-studio_session=${token}`,
  ]) {
    const response = await dispatch(request('test.view', { token: pair }), 'test.view');
    assert.equal(response.status, 401, pair);
    assert.equal(await codeOf(response), 'authentication_required');
    assert.equal(response.headers.get('set-cookie'), null, pair);
  }
  // Each still works alone: neither session was ended.
  assert.equal((await dispatch(request('test.view', { token }), 'test.view')).status, 200);
  assert.equal((await dispatch(request('test.view', { token: planted }), 'test.view')).status, 200);
  assert.deepEqual(handled, ['test.view', 'test.view']);
});

test('a session that ends during a request is let go of at the touch, so nothing after it in the request acts as it', async (t) => {
  const { auth, issue, advance } = await setup(t);
  const token = await issue();
  const edit = OPERATIONS.find((entry) => entry.name === 'test.edit')!;
  const sent = request('test.edit', { token });
  const context = { request: sent, requestId: 'req-auth', operation: edit };
  const { session } = await auth.resolveSession(context);
  assert.ok(session);
  // The owner signs out from another tab while this request is on its way.
  const [record] = await auth.sessions.list();
  assert.ok(await auth.sessions.end(record!.digest, 'logout'));
  advance(2 * MINUTE);
  await auth.touchSession({ ...context, session });
  assert.deepEqual(await auth.sessions.list(), [], 'the touch wrote the session back');
  // The provider no longer holds it, so its CSRF token counts for nothing.
  assert.equal(await auth.checkOrigin({ ...context, session }), false);
});

test('a command whose session ends between its steps stops before the commit point', async (t) => {
  // test.publish prepares, then reads its session again before it commits,
  // as #3's publish does before it moves the live pointer. The session ends
  // in between, after every check at the start of the request passed.
  let between: () => Promise<void> = async () => {};
  const commits: string[] = [];
  const publish: Handler = async (_authorized, _input, context) => {
    await between();
    const stop = await context.recheckSession();
    if (stop) return stop;
    commits.push(context.requestId);
    return { ok: true };
  };
  const { dispatch, auth, dataDir, issue, now, advance } = await setup(t, {
    handlers: { 'test.publish': publish },
  });
  const send = (token: string) => dispatch(request('test.publish', { token }), 'test.publish');

  // Nothing ends it, so it commits.
  assert.equal((await send(await issue())).status, 200);
  assert.equal(commits.length, 1);

  const endings: [what: string, end: (token: string) => Promise<void>][] = [
    [
      'a logout in another tab',
      async (token) => void (await auth.sessions.end(sessionDigest(token), 'logout')),
    ],
    [
      'revoking it from the session list',
      async (token) => void (await auth.sessions.end(sessionDigest(token), 'revoked')),
    ],
    [
      'revoke-sessions, from another process',
      async () => {
        await filesystemSessionStore(dataDir).revokeAll(now());
        // Sessions signed in after the run count again.
        advance(1);
      },
    ],
    ['the idle limit passing', async () => advance(61 * MINUTE)],
  ];
  for (const [what, end] of endings) {
    const token = await issue();
    between = () => end(token);
    const response = await send(token);
    assert.equal(response.status, 401, what);
    assert.equal(await codeOf(response), 'authentication_required', what);
    assert.equal(
      response.headers.get('set-cookie'),
      '__Host-studio_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure',
      what,
    );
    assert.equal(commits.length, 1, `${what}: it committed`);
  }

  // A store that can't be read at the commit point stops it too, and the
  // cookie stays, as at the start of a request.
  const token = await issue();
  const resolve = auth.sessions.resolve;
  t.after(() => {
    (auth.sessions as { resolve: typeof resolve }).resolve = resolve;
  });
  between = async () => {
    (auth.sessions as { resolve: typeof resolve }).resolve = async () => ({
      status: 'unavailable',
    });
  };
  const unreadable = await send(token);
  assert.equal(await codeOf(unreadable), 'authentication_required');
  assert.equal(unreadable.headers.get('set-cookie'), null);
  assert.equal(commits.length, 1);
});

test("a command from a sibling subdomain is 403 request_origin_rejected with the owner's cookie attached", async (t) => {
  const { dispatch, handled, issue } = await setup(t);
  const token = await issue();
  // A request that names attacker.test as its URL, its Host, and its Origin.
  const hostile = request('test.edit', {
    token,
    url: 'https://attacker.test/api/studio/test.edit',
    headers: { host: 'attacker.test', origin: 'https://attacker.test' },
  });
  assert.equal(await codeOf(await dispatch(hostile, 'test.edit')), 'request_origin_rejected');
  // The browser attaches the SameSite=Strict cookie, since the sibling is the
  // same site, and the sibling somehow has the CSRF token too.
  for (const site of ['same-site', '']) {
    const sibling = request('test.edit', {
      token,
      headers: { origin: 'https://demo.rowan.test', 'sec-fetch-site': site },
    });
    const response = await dispatch(sibling, 'test.edit');
    assert.equal(response.status, 403, site);
    assert.equal(await codeOf(response), 'request_origin_rejected', site);
  }
  // From the owner origin, but a fetch the browser marks same-site.
  const marked = request('test.edit', { token, headers: { 'sec-fetch-site': 'same-site' } });
  assert.equal(await codeOf(await dispatch(marked, 'test.edit')), 'request_origin_rejected');
  assert.deepEqual(handled, []);
});

test('over https a studio_session cookie is ignored', async (t) => {
  const { dispatch, issue } = await setup(t);
  const token = await issue();
  const plain = await dispatch(
    request('test.view', { token, cookieName: 'studio_session' }),
    'test.view',
  );
  assert.equal(plain.status, 401);
  assert.equal(await codeOf(plain), 'authentication_required');
  assert.equal(plain.headers.get('set-cookie'), null);
  assert.equal((await dispatch(request('test.view', { token }), 'test.view')).status, 200);

  // HTTP test mode, on a loopback origin, reads studio_session and only that.
  const local = await setup(t, { origin: 'http://127.0.0.1:3100' });
  const localToken = await local.issue();
  const view = (cookieName: string) =>
    local.dispatch(request('test.view', { token: localToken, cookieName }), 'test.view');
  assert.equal((await view('studio_session')).status, 200);
  assert.equal((await view('__Host-studio_session')).status, 401);
});

test('the provider slides a session for a Studio command and never for a query', async (t) => {
  const { dispatch, auth, issue, advance } = await setup(t);
  const token = await issue();
  const [record] = await auth.sessions.list();
  assert.ok(record);
  const lastSeen = async () => (await auth.sessions.list())[0]?.lastSeenAt;
  const send = (name: string) => dispatch(request(name, { token }), name);

  advance(2 * MINUTE);
  assert.equal((await send('test.view')).status, 200);
  assert.equal(await lastSeen(), record.createdAt, 'a query slid the session');
  assert.equal((await send('preview.grant.renew')).status, 200);
  assert.equal(await lastSeen(), record.createdAt, 'preview.grant.renew slid the session');
  assert.equal((await send('test.edit')).status, 200);
  assert.equal(await lastSeen(), record.createdAt + 2 * MINUTE);
  // Within the minute a command writes nothing, and auth.session.extend writes at once.
  advance(20_000);
  await send('test.edit');
  assert.equal(await lastSeen(), record.createdAt + 2 * MINUTE);
  await send('auth.session.extend');
  assert.equal(await lastSeen(), record.createdAt + 2 * MINUTE + 20_000);

  // Queries alone, a minute apart, let it expire 60 minutes after the last command.
  for (let minute = 0; minute < 59; minute += 1) {
    advance(MINUTE);
    assert.equal((await send('test.view')).status, 200, `${minute} minutes on`);
  }
  advance(MINUTE);
  const expired = await send('test.view');
  assert.equal(expired.status, 401);
});

test("an ended session is cleared, and one the store can't read keeps its cookie", async (t) => {
  const { dispatch, auth, issue, advance } = await setup(t);
  const token = await issue();
  advance(61 * MINUTE);
  const ended = await dispatch(request('test.view', { token }), 'test.view');
  assert.equal(ended.status, 401);
  assert.equal(
    ended.headers.get('set-cookie'),
    '__Host-studio_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure',
  );
  // A cookie that isn't a token at all is cleared too, and no cookie gets no header.
  const junk = await dispatch(request('test.view', { token: 'not-a-token' }), 'test.view');
  assert.match(junk.headers.get('set-cookie') ?? '', /^__Host-studio_session=; /);
  const none = await dispatch(request('test.view'), 'test.view');
  assert.equal(none.headers.get('set-cookie'), null);

  // A store that can't be read gives no session and leaves the cookie alone.
  const fresh = await issue();
  const broken = auth.sessions.resolve;
  t.after(() => {
    (auth.sessions as { resolve: typeof broken }).resolve = broken;
  });
  (auth.sessions as { resolve: typeof broken }).resolve = async () => ({ status: 'unavailable' });
  const unavailable = await dispatch(request('test.view', { token: fresh }), 'test.view');
  assert.equal(unavailable.status, 401);
  assert.equal(unavailable.headers.get('set-cookie'), null);
});

test('a session from one data directory is refused under another', async (t) => {
  const hash = shapedHash();
  const first = await setup(t, { hash });
  const token = await first.issue();
  assert.equal((await first.dispatch(request('test.view', { token }), 'test.view')).status, 200);
  const swapped = await setup(t, { hash });
  const response = await swapped.dispatch(request('test.view', { token }), 'test.view');
  assert.equal(response.status, 401);
  assert.match(response.headers.get('set-cookie') ?? '', /Max-Age=0/);
});

test('changing the configured hash signs out every session', async (t) => {
  const dataDir = dataDirectory(t);
  const before = await setup(t, { dataDir, hash: shapedHash() });
  const tokens = [await before.issue(), await before.issue()];
  const hash = shapedHash();
  const after = await setup(t, { dataDir, hash });
  assert.deepEqual(
    after.audit.records.map(({ type, actor }) => [type, actor]),
    [['credential_changed', 'operator']],
  );
  for (const token of tokens) {
    const response = await after.dispatch(request('test.view', { token }), 'test.view');
    assert.equal(response.status, 401);
    assert.match(response.headers.get('set-cookie') ?? '', /Max-Age=0/);
  }
  // A restart with the same hash keeps the sessions signed in since, and audits nothing.
  after.advance(MINUTE);
  const kept = await after.issue();
  const again = await setup(t, { dataDir, hash });
  assert.deepEqual(again.audit.records, []);
  assert.equal(
    (await again.dispatch(request('test.view', { token: kept }), 'test.view')).status,
    200,
  );
});

test('a denied command records where it came from as a prefix, from the trusted hop only', async (t) => {
  const spoofed = () =>
    request('auth.login', {
      headers: { origin: 'https://elsewhere.test', 'x-forwarded-for': '192.0.2.10, 203.0.113.77' },
    });
  const behindProxy = await setup(t, { hops: 1 });
  assert.equal((await behindProxy.dispatch(spoofed(), 'auth.login')).status, 403);
  assert.equal(behindProxy.audit.records.at(-1)?.refs.source, '203.0.113.0/24');
  // With no trusted hop, the header the client sent counts for nothing.
  const direct = await setup(t);
  assert.equal((await direct.dispatch(spoofed(), 'auth.login')).status, 403);
  assert.equal(direct.audit.records.at(-1)?.refs.source, 'unknown');
});

test("forged commands with the owner's cookie go to the provider's own audit log as one line a minute after the first, naming only registered operations", async (t) => {
  const { dispatch, auth, issue, dataDir, advance } = await setup(t, { ownAudit: true });
  const token = await issue();
  const forged = () =>
    request('test.edit', {
      token,
      headers: { origin: 'https://attacker.test', 'sec-fetch-site': 'cross-site' },
    });
  for (let index = 0; index < 25; index += 1) {
    assert.equal((await dispatch(forged(), 'test.edit')).status, 403);
  }
  const file = path.join(dataDir, 'audit', '2026-10.jsonl');
  type Line = { type: string; actor: string; refs: Record<string, unknown> };
  const lines = () =>
    readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Line);
  // The first is on disk at once, so an exit loses at most the count held after it.
  const ref = sessionRef(sessionDigest(token));
  assert.deepEqual(lines(), [
    {
      at: '2026-10-20T09:00:00.000Z',
      type: 'command_denied',
      actor: 'anonymous',
      outcome: 'denied',
      // test.edit isn't in the registry, so the record doesn't name it.
      refs: {
        sessionRef: ref,
        source: 'unknown',
        reason: 'origin_mismatch',
        requestId: 'req-auth',
        count: 1,
      },
    },
  ]);
  // The rest come out as one line when the minute ends, or at a flush.
  advance(MINUTE);
  await auth.audit.flush();
  assert.deepEqual(
    lines()
      .slice(1)
      .map(({ actor, refs }) => ({ actor, refs })),
    [
      {
        actor: 'anonymous',
        refs: { sessionRef: ref, source: 'unknown', reason: 'origin_mismatch', count: 24 },
      },
    ],
  );
  // A registered operation's name is kept.
  const status = listOperations().find((entry) => entry.name === 'config.status')!;
  const crossSite = new Request(`${ORIGIN}/api/studio/config.status`, {
    headers: { 'sec-fetch-site': 'cross-site' },
  });
  const context = { request: crossSite, requestId: 'req-auth', operation: status, session: null };
  assert.equal(await auth.checkOrigin(context), false);
  assert.equal(lines().at(-1)?.refs.command, 'config.status');
});

test("a Studio page's session counts as a command's does, and slides only for a page the owner opened", async (t) => {
  const { auth, issue, advance } = await setup(t);
  const token = await issue();
  const cookie = `__Host-studio_session=${token}`;
  const page = (headers: Record<string, string> = {}) =>
    new Request(`${ORIGIN}/studio`, { headers: { cookie, ...headers } });
  const seen = async () => (await auth.sessions.list())[0]!.lastSeenAt;
  const opened = {
    'sec-fetch-site': 'none',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document',
  };

  advance(2 * MINUTE);
  const before = await seen();
  const resolution = await auth.pages.resolve(page(opened));
  assert.equal(resolution.status, 'valid');
  if (resolution.status !== 'valid') return;
  assert.equal(resolution.csrfToken, csrfToken(token));
  assert.ok(isMintedSession(resolution.session));
  const slid = await seen();
  assert.ok(slid > before, 'opening the page from the address bar slid the session');

  // A page another origin loads, a prefetch, and a request without Fetch
  // Metadata find the session and leave it as it was.
  advance(2 * MINUTE);
  for (const headers of [
    { ...opened, 'sec-fetch-site': 'same-site' },
    { ...opened, 'sec-fetch-site': 'same-origin', 'sec-purpose': 'prefetch' },
    {},
  ]) {
    assert.equal(
      (await auth.pages.resolve(page(headers))).status,
      'valid',
      JSON.stringify(headers),
    );
    assert.equal(await seen(), slid, JSON.stringify(headers));
  }
});

test('a Studio page with no cookie has no session, and one whose cookie counts for nothing is told so', async (t) => {
  const { auth, issue, advance } = await setup(t);
  const request = (cookie?: string) =>
    new Request(`${ORIGIN}/studio`, { headers: cookie ? { cookie } : {} });
  assert.deepEqual(await auth.pages.resolve(request()), { status: 'none' });
  const token = await issue();
  const other = await issue();
  for (const cookie of [
    '__Host-studio_session=not-a-token',
    `__Host-studio_session=${randomBytes(32).toString('base64url')}`,
    `__Host-studio_session=${token}; __Host-studio_session=${other}`,
  ]) {
    assert.deepEqual(await auth.pages.resolve(request(cookie)), { status: 'ended' }, cookie);
  }
  // Over https a studio_session cookie is no cookie at all.
  assert.deepEqual(await auth.pages.resolve(request(`studio_session=${token}`)), {
    status: 'none',
  });
  // Ended since it was issued: expired, and ended during the lookup.
  advance(61 * MINUTE);
  assert.deepEqual(await auth.pages.resolve(request(`__Host-studio_session=${token}`)), {
    status: 'ended',
  });
  const fresh = await issue();
  const touch = auth.sessions.touch;
  (auth.sessions as { touch: typeof touch }).touch = async () => null;
  t.after(() => {
    (auth.sessions as { touch: typeof touch }).touch = touch;
  });
  assert.deepEqual(await auth.pages.resolve(request(`__Host-studio_session=${fresh}`)), {
    status: 'ended',
  });
  // A store that can't be read says so.
  const resolve = auth.sessions.resolve;
  (auth.sessions as { resolve: typeof resolve }).resolve = async () => ({ status: 'unavailable' });
  t.after(() => {
    (auth.sessions as { resolve: typeof resolve }).resolve = resolve;
  });
  assert.deepEqual(await auth.pages.resolve(request(`__Host-studio_session=${fresh}`)), {
    status: 'unavailable',
  });
});
