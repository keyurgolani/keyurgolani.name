import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  csrfToken,
  memoryAuditSink,
  prepareAuthDirectories,
  type MemoryAuditSink,
} from '@portfolio/core/owner';
import { revokeAllSessionFiles } from '../../../../../packages/core/src/auth/session-files.mjs';
import { authorize, type Authorized } from '../authorize';
import { accessIn, CAPABILITIES } from '../capabilities';
import type { DeploymentConfig } from '../config';
import { setDeploymentState } from '../config-store';
import { createDispatcher, NO_BINDINGS, type HandlerContext } from '../dispatcher';
import { AuthSessionSchema, listOperations } from '../operations';
import { loginAction } from '../return-to';
import { provider, type OwnerAuth } from './auth';
import { loginLimits, type LoginLimits } from './login-limits';
import { mintSession } from './session-mint';

// #2's auth entries through the dispatcher, with the owner provider over a
// real data directory: sign-in by JSON and by form, its limits, what it
// writes to the audit log, and the commands that end a session. The key
// derivation is a double that counts its calls, so a test can prove how
// many verifications ran without spending scrypt's memory on each.

const ORIGIN = 'https://rowan.test';
const PASSWORD = 'rowan correct passphrase';
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
const MINUTE = 60_000;
const SALT = randomBytes(16);
const KEY = randomBytes(32);
const base64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');
const HASH = `$scrypt$ln=17,r=8,p=1$${base64(SALT)}$${base64(KEY)}`;
/** What the derivation double gives back: the hash's key for the password, zeros for anything else. */
const KEYS = new Map([[PASSWORD, KEY]]);

interface Setup {
  readonly hops?: number;
  /** The data directory's own audit log, with its aggregation, instead of a memory one. */
  readonly diskAudit?: boolean;
  /** Holds each derivation until the test lets it go. */
  readonly gate?: () => Promise<void>;
  /** Holds each slowdown wait until the test lets it go. */
  readonly hold?: () => Promise<void>;
  readonly origin?: string;
  /** Sign-in's limits, made on the test's clock, in place of the provider's own. */
  readonly limits?: (now: () => number) => LoginLimits;
}

async function setup(t: TestContext, options: Setup = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'owner-login-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  assert.equal(await prepareAuthDirectories(dataDir), null);
  let at = Date.UTC(2026, 9, 20, 9, 0, 0);
  const now = () => at;
  const memory: MemoryAuditSink = memoryAuditSink(now);
  const waits: number[] = [];
  let derivations = 0;
  const config = {
    profile: 'owner',
    mode: 'production',
    origin: options.origin ?? ORIGIN,
    trustedProxyHops: options.hops ?? 0,
    dataDir,
    sessionLifetime: { idleMinutes: 60, maxHours: 12 },
    secrets: { authPasswordHash: HASH },
  } as DeploymentConfig;
  const auth: OwnerAuth = await provider(
    { config, mintSession },
    {
      now,
      audit: options.diskAudit ? undefined : memory,
      derive: async (password) => {
        derivations += 1;
        await options.gate?.();
        return Buffer.from(KEYS.get(password) ?? Buffer.alloc(32));
      },
      sleep: async (ms) => {
        waits.push(ms);
        await options.hold?.();
      },
      limits: options.limits?.(now),
    },
  );
  setDeploymentState({
    config,
    catalog: { getLive: () => assert.fail('no catalog here') },
    dispatch: () => assert.fail('tests call their own dispatcher'),
    degraded: [],
  });
  t.after(() => setDeploymentState(undefined));
  const dispatch = createDispatcher({
    ...NO_BINDINGS,
    resolveSession: auth.resolveSession,
    checkOrigin: auth.checkOrigin,
    touchSession: auth.touchSession,
    throttle: auth.throttle,
    invalidInput: auth.invalidInput,
    handlers: auth.handlers,
    operations: listOperations(),
  });
  return {
    auth,
    dataDir,
    audit: memory,
    waits,
    derivations: () => derivations,
    advance: (ms: number) => {
      at += ms;
    },
    send: (request: Request) => dispatch(request, new URL(request.url).pathname.split('/').pop()!),
  };
}

interface Login {
  readonly body?: Record<string, unknown>;
  /** The body's bytes as sent, in place of `body`. */
  readonly raw?: Uint8Array<ArrayBuffer>;
  readonly form?: boolean;
  readonly returnTo?: string;
  readonly headers?: Record<string, string>;
}

function login({ body = { password: PASSWORD }, raw, form, returnTo, headers = {} }: Login = {}) {
  const query = returnTo === undefined ? '' : `?returnTo=${encodeURIComponent(returnTo)}`;
  const sent = new Headers({
    origin: ORIGIN,
    'sec-fetch-site': 'same-origin',
    'x-request-id': `req-${randomBytes(4).toString('hex')}`,
    'user-agent': UA,
    'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json',
  });
  for (const [name, value] of Object.entries(headers)) {
    if (value === '') sent.delete(name);
    else sent.set(name, value);
  }
  const text = form
    ? new URLSearchParams(body as Record<string, string>).toString()
    : JSON.stringify(body);
  return new Request(`${ORIGIN}/api/studio/auth.login${query}`, {
    method: 'POST',
    headers: sent,
    body: raw ?? new TextEncoder().encode(text),
  });
}

/** A request to another auth entry, as studioFetch sends it. */
function studio(name: string, token?: string, body?: unknown) {
  const operation = listOperations().find((entry) => entry.name === name)!;
  const headers = new Headers({ 'x-request-id': 'req-studio', 'sec-fetch-site': 'same-origin' });
  if (token) headers.set('cookie', `__Host-studio_session=${token}`);
  if (operation.kind === 'command') {
    headers.set('origin', ORIGIN);
    headers.set('content-type', 'application/json');
    if (token) headers.set('x-csrf-token', csrfToken(token));
  }
  return new Request(`${ORIGIN}/api/studio/${name}`, {
    method: operation.kind === 'query' ? 'GET' : 'POST',
    headers,
    body:
      operation.kind === 'command'
        ? new TextEncoder().encode(JSON.stringify(body ?? {}))
        : undefined,
  });
}

const COOKIE =
  /^__Host-studio_session=([A-Za-z0-9_-]{43}); Path=\/; Max-Age=(\d+); HttpOnly; SameSite=Strict; Secure$/;
const CLEARED = '__Host-studio_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure';

/**
 * The token a response's Set-Cookie carries, or null. Each Set-Cookie on its
 * own: a response sets the session cookie once at most.
 */
function tokenOf(response: Response): string | null {
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.length <= 1, `the cookie was set ${cookies.length} times`);
  return COOKIE.exec(cookies[0] ?? '')?.[1] ?? null;
}

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

test('login issues a new token and ends the session of any cookie sent with it', async (t) => {
  const { send, audit } = await setup(t);
  const first = await send(login());
  assert.equal(first.status, 200);
  const match = COOKIE.exec(first.headers.get('set-cookie') ?? '');
  assert.ok(match, first.headers.get('set-cookie') ?? 'no cookie');
  assert.equal(match[2], '43200', 'Max-Age is the absolute lifetime left');
  const old = match[1]!;
  const { data } = (await first.json()) as { data: unknown };
  const view = AuthSessionSchema.parse(data);
  assert.equal(view.csrfToken, csrfToken(old));
  assert.equal((await send(studio('auth.session', old))).status, 200);

  // Signing in again with that cookie gives a new token, and the old one ends.
  const again = await send(login({ headers: { cookie: `__Host-studio_session=${old}` } }));
  const fresh = tokenOf(again);
  assert.ok(fresh && fresh !== old);
  assert.equal((await send(studio('auth.session', old))).status, 401);
  assert.equal((await send(studio('auth.session', fresh))).status, 200);
  // A token the server never issued is never adopted: the login sets a new
  // one, and the planted one stays worthless.
  const planted = randomBytes(32).toString('base64url');
  const third = await send(login({ headers: { cookie: `__Host-studio_session=${planted}` } }));
  const issued = tokenOf(third);
  assert.ok(issued && issued !== planted, 'the login set no new token');
  assert.equal((await send(studio('auth.session', issued))).status, 200);
  assert.equal((await send(studio('auth.session', planted))).status, 401);
  assert.deepEqual(
    audit.records
      .filter((record) => record.type === 'login_succeeded')
      .map((record) => record.actor),
    ['owner', 'owner', 'owner'],
  );
  // Two cookies of the name, one planted beside the owner's: the sessions of both end.
  const mine = tokenOf(await send(login()))!;
  const theirs = tokenOf(await send(login()))!;
  const pair = `__Host-studio_session=${mine}; __Host-studio_session=${theirs}`;
  assert.equal((await send(login({ headers: { cookie: pair } }))).status, 200);
  for (const token of [mine, theirs]) {
    assert.equal((await send(studio('auth.session', token))).status, 401);
  }
});

test('an auth command whose session ended during the request answers 401 and clears the cookie', async (t) => {
  const { auth, send, advance, audit } = await setup(t);
  // Another tab signs every session out after this request's session
  // resolved, and before its touch.
  let signOutFirst = false;
  const dispatch = createDispatcher({
    ...NO_BINDINGS,
    resolveSession: auth.resolveSession,
    checkOrigin: auth.checkOrigin,
    touchSession: async (context) => {
      if (signOutFirst) await auth.sessions.revokeAll();
      await auth.touchSession(context);
    },
    throttle: auth.throttle,
    handlers: auth.handlers,
    operations: listOperations(),
  });
  const race = async (name: string, body?: unknown) => {
    // A sign-in after the last revocation, not in its millisecond.
    advance(MINUTE);
    const token = tokenOf(await send(login()))!;
    signOutFirst = true;
    try {
      return await dispatch(studio(name, token, body), name);
    } finally {
      signOutFirst = false;
    }
  };
  for (const [name, body] of [
    ['auth.session.extend', {}],
    ['auth.sessions.revoke', { ref: '0123abcd' }],
    ['auth.sessions.revokeAll', {}],
  ] as const) {
    const revocations = () =>
      audit.records.filter((record) => record.type === 'sessions_revoked_all').length;
    const before = revocations();
    const response = await race(name, body);
    assert.equal(response.status, 401, name);
    assert.equal(await errorCode(response), 'authentication_required', name);
    assert.deepEqual(response.headers.getSetCookie(), [CLEARED], name);
    // The other tab's revocation, and none by the command itself.
    assert.equal(revocations(), before + 1, name);
  }
  // Signing out a session that ended meanwhile still signs the browser out.
  const logout = await race('auth.logout');
  assert.equal(logout.status, 200);
  assert.deepEqual(logout.headers.getSetCookie(), [CLEARED]);
  assert.equal(logout.headers.get('clear-site-data'), '"cache"');
});

test('over https the cookie is __Host-studio_session with Secure, HttpOnly, SameSite=Strict, Path=/, and no Domain', async (t) => {
  const { send } = await setup(t);
  const cookie = (await send(login())).headers.get('set-cookie') ?? '';
  assert.match(cookie, COOKIE);
  assert.doesNotMatch(cookie, /Domain/i);
  // HTTP test mode, on a loopback origin: studio_session, without Secure.
  const local = 'http://127.0.0.1:3100';
  const loopback = await setup(t, { origin: local });
  const request = login();
  const sent = new Headers(request.headers);
  sent.set('origin', local);
  const response = await loopback.send(
    new Request(`${local}/api/studio/auth.login`, {
      method: 'POST',
      headers: sent,
      body: new TextEncoder().encode(JSON.stringify({ password: PASSWORD })),
    }),
  );
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get('set-cookie') ?? '',
    /^studio_session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=43200; HttpOnly; SameSite=Strict$/,
  );
});

test('idle and absolute expiry are enforced on the server', async (t) => {
  const { send, advance } = await setup(t);
  // Idle: 60 minutes after the last command, the session is gone.
  const idle = tokenOf(await send(login()))!;
  advance(59 * MINUTE);
  assert.equal((await send(studio('auth.session', idle))).status, 200);
  advance(MINUTE);
  const ended = await send(studio('auth.session', idle));
  assert.equal(ended.status, 401);
  assert.match(ended.headers.get('set-cookie') ?? '', /Max-Age=0/);
  // Absolute: extending every 30 minutes keeps it only to 12 hours after sign-in.
  const busy = tokenOf(await send(login()))!;
  for (let elapsed = 0; elapsed < 12 * 60 * MINUTE - 30 * MINUTE; elapsed += 30 * MINUTE) {
    advance(30 * MINUTE);
    assert.equal((await send(studio('auth.session.extend', busy))).status, 200, `${elapsed}`);
  }
  advance(30 * MINUTE);
  assert.equal((await send(studio('auth.session', busy))).status, 401);
  // The cookie's Max-Age never outlives that limit either.
  const late = await send(login());
  assert.equal(COOKIE.exec(late.headers.get('set-cookie') ?? '')?.[2], '43200');
});

test('every credential failure runs one verification and answers the same body', async (t) => {
  const { send, derivations, audit } = await setup(t);
  const failures: Record<string, unknown>[] = [
    {},
    { password: '' },
    { password: 42 },
    { password: null },
    { password: ['x'] },
    { password: 'x'.repeat(257) },
    { password: `${PASSWORD}x` },
    { password: PASSWORD.toUpperCase() },
  ];
  const bodies = new Set<string>();
  for (const body of failures) {
    const before = derivations();
    const response = await send(login({ body }));
    assert.equal(derivations() - before, 1, JSON.stringify(body));
    assert.equal(response.status, 401, JSON.stringify(body));
    assert.equal(response.headers.get('set-cookie'), null);
    const { error } = (await response.json()) as { error: Record<string, string> };
    bodies.add(JSON.stringify({ ...error, requestId: undefined }));
  }
  assert.deepEqual(
    [...bodies],
    [JSON.stringify({ code: 'credentials_rejected', message: "That password didn't work." })],
  );
  // The same from the form, as a 303 that never echoes what was sent.
  for (const body of [{}, { password: 'wrong but long enough' }]) {
    const before = derivations();
    const response = await send(login({ body, form: true }));
    assert.equal(derivations() - before, 1);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/studio/sign-in?state=failed');
  }
  assert.ok(audit.records.every((record) => record.type === 'login_failed'));
  assert.ok(audit.records.every((record) => record.actor === 'anonymous'));
});

test('a form login answers with a 303 to returnTo and the cookie, or back to sign-in keeping returnTo', async (t) => {
  const { send } = await setup(t);
  const signedIn = await send(login({ form: true, returnTo: '/studio/drafts?tab=history' }));
  assert.equal(signedIn.status, 303);
  assert.equal(signedIn.headers.get('location'), '/studio/drafts?tab=history');
  assert.ok(tokenOf(signedIn));
  const failed = await send(
    login({
      form: true,
      body: { password: 'not the password at all' },
      returnTo: '/studio/drafts',
    }),
  );
  assert.equal(
    failed.headers.get('location'),
    '/studio/sign-in?state=failed&returnTo=%2Fstudio%2Fdrafts',
  );
  assert.ok(!(failed.headers.get('location') ?? '').includes('password'));
  // A returnTo off /studio lands on /studio.
  for (const returnTo of ['https://elsewhere.test/', '//elsewhere.test', '/studio/../admin']) {
    const response = await send(login({ form: true, returnTo }));
    assert.equal(response.headers.get('location'), '/studio', returnTo);
  }
});

test('five failures from one source in 15 minutes block it for a minute, doubling up to 15', async (t) => {
  const { send, derivations, advance, audit } = await setup(t, { hops: 1 });
  const from = (address: string) => ({ 'x-forwarded-for': `198.51.100.250, ${address}` });
  const wrong = (address: string) =>
    login({ body: { password: 'wrong password here' }, headers: from(address) });
  for (let index = 0; index < 5; index += 1) {
    assert.equal((await send(wrong('203.0.113.7'))).status, 401);
  }
  const blocked = async (seconds: number) => {
    const before = derivations();
    const response = await send(wrong('203.0.113.7'));
    assert.equal(response.status, 429);
    assert.equal(await errorCode(response), 'rate_limited');
    assert.equal(response.headers.get('retry-after'), String(seconds));
    assert.equal(derivations(), before, 'a blocked attempt ran a verification');
  };
  await blocked(60);
  // Another source is unaffected, and the form gets the sign-in page.
  assert.equal((await send(wrong('203.0.113.8'))).status, 401);
  const form = await send(login({ form: true, headers: from('203.0.113.7') }));
  assert.equal(form.headers.get('location'), '/studio/sign-in?state=rate_limited&retryAfter=60');
  // Each further failure, once the block is over, doubles it, up to 15 minutes.
  let previous = 60;
  for (const seconds of [120, 240, 480, 900, 900]) {
    advance(previous * 1000);
    assert.equal((await send(wrong('203.0.113.7'))).status, 401);
    await blocked(seconds);
    previous = seconds;
  }
  // A success clears the source: it takes 5 failures again to block it.
  advance(previous * 1000);
  assert.equal((await send(login({ headers: from('203.0.113.7') }))).status, 200);
  for (let index = 0; index < 4; index += 1) {
    assert.equal((await send(wrong('203.0.113.7'))).status, 401);
  }
  assert.equal((await send(wrong('203.0.113.7'))).status, 401);
  await blocked(60);
  // So do 15 quiet minutes after the block.
  advance(MINUTE + 15 * MINUTE);
  assert.equal((await send(wrong('203.0.113.7'))).status, 401);
  assert.equal((await send(wrong('203.0.113.7'))).status, 401);
  assert.deepEqual(
    [
      ...new Set(
        audit.records
          .filter((record) => record.type === 'login_throttled')
          .map((record) => record.refs.reason),
      ),
    ],
    ['source_blocked'],
  );

  // At 0 trusted hops nothing names a source, so no source is blocked.
  const direct = await setup(t);
  for (let index = 0; index < 8; index += 1) {
    assert.equal((await direct.send(wrong('203.0.113.7'))).status, 401);
  }
});

test('after 50 failures in an hour every attempt waits 2 seconds, and none is locked out', async (t) => {
  const { send, waits, advance } = await setup(t, { hops: 1 });
  for (let index = 0; index < 50; index += 1) {
    const address = `203.0.113.${index}`;
    const response = await send(
      login({ body: { password: 'wrong password here' }, headers: { 'x-forwarded-for': address } }),
    );
    assert.equal(response.status, 401);
  }
  assert.deepEqual(waits, []);
  const next = await send(login({ headers: { 'x-forwarded-for': '198.51.100.9' } }));
  assert.equal(next.status, 200, 'the owner still signs in');
  assert.deepEqual(waits, [2000]);
  // An hour on, the failures have aged out.
  advance(61 * MINUTE);
  await send(login({ headers: { 'x-forwarded-for': '198.51.100.9' } }));
  assert.deepEqual(waits, [2000]);
});

const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Lets the attempts in flight run until `done` holds, failing at once when
 * they stop short of it rather than waiting out the test's timeout.
 */
async function until(done: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 100_000 && !done(); turn += 1) await tick();
  assert.ok(done(), what);
}

/** The answer to an attempt that must not wait, or a failure when it waits. */
async function soon(attempt: Promise<Response>, what: string): Promise<Response> {
  let answer: Response | undefined;
  void attempt.then((response) => {
    answer = response;
  });
  await until(() => answer !== undefined, what);
  return answer!;
}

test('a third concurrent attempt is 429 with Retry-After: 1 and runs no verification', async (t) => {
  const held: (() => void)[] = [];
  const { send, derivations } = await setup(t, {
    gate: () => new Promise<void>((resolve) => held.push(resolve)),
  });
  const first = send(login());
  const second = send(login({ body: { password: 'wrong password here' } }));
  await until(() => held.length === 2, 'two verifications running');
  const third = await soon(send(login()), 'the third attempt waited for a slot');
  assert.equal(third.status, 429);
  assert.equal(third.headers.get('retry-after'), '1');
  assert.equal(derivations(), 2);
  const formThird = await soon(send(login({ form: true })), 'the third form post waited');
  assert.equal(
    formThird.headers.get('location'),
    '/studio/sign-in?state=rate_limited&retryAfter=1',
  );
  for (const release of held) release();
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 401);
  // The slots are free again.
  const after = send(login());
  await until(() => held.length === 3, 'a verification after the first two');
  held[2]!();
  assert.equal((await after).status, 200);
});

const failing = () => login({ body: { password: 'wrong password here' } });

test('during the slowdown attempts wait outside the verification slots, so the owner signs in past attempts kept in flight', async (t) => {
  const waiting: (() => void)[] = [];
  let holding = true;
  const { send, waits } = await setup(t, {
    hold: () =>
      holding ? new Promise<void>((resolve) => waiting.push(resolve)) : Promise.resolve(),
  });
  // 50 failures from anywhere in the hour turn the slowdown on. At 0 hops
  // no source is blocked, so every one of them is a verification.
  for (let index = 0; index < 50; index += 1) assert.equal((await send(failing())).status, 401);
  // Attempts kept in flight, each waiting out its 2 seconds.
  const attacks = Array.from({ length: 4 }, () => send(failing()));
  await until(() => waiting.length === 4, 'four attempts waiting out the slowdown');
  // The owner's attempt waits too, then finds both slots free: no waiting
  // attempt holds one.
  holding = false;
  const owner = await send(login());
  assert.equal(owner.status, 200, 'the owner was held off by attempts in flight');
  assert.deepEqual(waits, [2000, 2000, 2000, 2000, 2000]);
  for (const [index, release] of waiting.entries()) {
    release();
    assert.equal((await attacks[index]!).status, 401);
  }
});

test('at most 16 attempts wait out the slowdown, and one more gets 429 at once, before any wait or verification', async (t) => {
  const waiting: (() => void)[] = [];
  const { send, waits, derivations } = await setup(t, {
    hold: () => new Promise<void>((resolve) => waiting.push(resolve)),
  });
  for (let index = 0; index < 50; index += 1) assert.equal((await send(failing())).status, 401);
  const attacks = Array.from({ length: 16 }, () => send(failing()));
  await until(() => waiting.length === 16, 'sixteen attempts waiting out the slowdown');
  const before = derivations();
  const overflow = await soon(send(login()), 'the attempt past 16 waited');
  assert.equal(overflow.status, 429);
  assert.equal(overflow.headers.get('retry-after'), '1');
  const form = await soon(
    send(login({ form: true, returnTo: '/studio/drafts' })),
    'the form post past 16 waited',
  );
  assert.equal(
    form.headers.get('location'),
    '/studio/sign-in?state=rate_limited&retryAfter=1&returnTo=%2Fstudio%2Fdrafts',
  );
  assert.equal(waits.length, 16, 'the attempt over the cap waited');
  assert.equal(derivations(), before);
  for (const [index, release] of waiting.entries()) {
    release();
    assert.equal((await attacks[index]!).status, 401);
  }
  // The room is free again.
  const later = send(login());
  await until(() => waiting.length === 17, 'a place to wait, free again');
  waiting[16]!();
  assert.equal((await later).status, 200);
});

/** The source a trusted proxy names for a request: one hop, so the last entry. */
const fromSource = (address: string) => ({ 'x-forwarded-for': address });
const wrongFrom = (address: string) =>
  login({ body: { password: 'wrong password here' }, headers: fromSource(address) });
const ATTACKER = '203.0.113.7';

/**
 * One trusted hop, the slowdown on, and every wait and verification held
 * until the test lets it go. `burst` sends attempts from ATTACKER at once,
 * as attempts 150 ms apart all land inside one 2-second wait. Each one
 * waits or is turned away; then every wait ends together, and then every
 * verification, so the attempts in flight overlap all they can.
 */
async function slowedDown(t: TestContext) {
  const waiting: (() => void)[] = [];
  const verifying: (() => void)[] = [];
  let holding = false;
  const held = (queue: (() => void)[]) => () =>
    holding ? new Promise<void>((resolve) => queue.push(resolve)) : Promise.resolve();
  const harness = await setup(t, { hops: 1, hold: held(waiting), gate: held(verifying) });
  // 50 failures from 50 sources turn the slowdown on, and block none of them.
  for (let index = 0; index < 50; index += 1) {
    assert.equal((await harness.send(wrongFrom(`198.51.100.${index}`))).status, 401);
  }
  holding = true;
  async function burst(count: number): Promise<Response[]> {
    const settled: Response[] = [];
    const sent = Array.from({ length: count }, () =>
      harness.send(wrongFrom(ATTACKER)).then((response) => {
        settled.push(response);
        return response;
      }),
    );
    await until(() => settled.length + waiting.length === count, 'each waiting or turned away');
    for (const release of waiting.splice(0)) release();
    await until(() => settled.length + verifying.length === count, 'each verifying or turned away');
    for (const release of verifying.splice(0)) release();
    return Promise.all(sent);
  }
  return { ...harness, burst, waiting, verifying };
}

test('a burst from one source through the slowdown gets 5 verifications before its block, one at a time', async (t) => {
  const { burst, derivations, waits } = await slowedDown(t);
  const before = derivations();
  const rounds: Response[][] = [];
  for (let round = 0; round < 5; round += 1) rounds.push(await burst(3));
  const waited = waits.length;
  rounds.push(await burst(3));
  assert.equal(waits.length, waited, 'a blocked attempt waited out the slowdown');
  assert.equal(derivations() - before, 5, 'verifications for the one source');
  // One in flight, the others past the source's one place, until the
  // fifth failure blocks it.
  assert.deepEqual(
    rounds.map((round) => round.map((response) => response.status).sort()),
    [
      [401, 429, 429],
      [401, 429, 429],
      [401, 429, 429],
      [401, 429, 429],
      [401, 429, 429],
      [429, 429, 429],
    ],
  );
  for (const round of rounds.slice(0, 5)) {
    const busy = round.filter((response) => response.status === 429);
    assert.deepEqual(
      busy.map((response) => response.headers.get('retry-after')),
      ['1', '1'],
    );
  }
  for (const response of rounds[5]!) assert.equal(response.headers.get('retry-after'), '60');
});

test('a sign-in whose body is held counts against its source from the throttle on, so none verifies past the block', async (t) => {
  const { send, burst, derivations, waiting, verifying } = await slowedDown(t);
  // One attempt from the source sends its headers and holds back its body.
  let reading = false;
  let finish!: () => void;
  const arrived = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const bytes = new TextEncoder().encode(JSON.stringify({ password: 'wrong password here' }));
  const head = wrongFrom(ATTACKER);
  const slow = send(
    new Request(head.url, {
      method: 'POST',
      headers: head.headers,
      body: new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            reading = true;
            await arrived;
            controller.enqueue(bytes);
            controller.close();
          },
        },
        { highWaterMark: 0 },
      ),
      duplex: 'half',
    } as RequestInit),
  );
  await until(() => reading, 'the held attempt reading its body');
  const before = derivations();
  // It holds the source's place, so the burst gets no verification at all.
  for (let round = 0; round < 2; round += 1) {
    assert.deepEqual(
      (await burst(2)).map((response) => response.status),
      [429, 429],
    );
  }
  assert.equal(derivations(), before);
  // Its body comes in: it waits out the slowdown, and is the first verification.
  finish();
  await until(() => waiting.length === 1, 'the held attempt waiting out the slowdown');
  waiting.splice(0)[0]!();
  await until(() => verifying.length === 1, 'the held attempt verifying');
  verifying.splice(0)[0]!();
  assert.equal((await slow).status, 401);
  // Then one at a time, four more, and the fifth failure blocks the source.
  const rounds: number[][] = [];
  for (let round = 0; round < 4; round += 1) {
    rounds.push((await burst(2)).map((response) => response.status).sort());
  }
  assert.deepEqual(rounds, [
    [401, 429],
    [401, 429],
    [401, 429],
    [401, 429],
  ]);
  assert.equal(derivations() - before, 5);
  // And the block holds.
  const [blocked] = await burst(1);
  assert.equal(blocked!.status, 429);
  assert.equal(blocked!.headers.get('retry-after'), '60');
  assert.equal(derivations() - before, 5);
});

test("after its wait, a sign-in checks its source's block again, before a verification", async (t) => {
  // Whatever started a block while an attempt waited, the check after the
  // wait sees it. Counted from the throttle, attempts can't start one.
  let blockedNow = false;
  const { send, derivations, audit } = await setup(t, {
    hops: 1,
    limits: (now) => {
      const limits = loginLimits({ now });
      return {
        ...limits,
        retryAfter: (address) => (blockedNow ? 90 : limits.retryAfter(address)),
      };
    },
    hold: async () => {
      blockedNow = true;
    },
  });
  for (let index = 0; index < 50; index += 1) {
    assert.equal((await send(wrongFrom(`198.51.100.${index}`))).status, 401);
  }
  const before = derivations();
  const json = await send(wrongFrom(ATTACKER));
  assert.equal(json.status, 429);
  assert.equal(json.headers.get('retry-after'), '90');
  const form = await send(
    login({ form: true, headers: fromSource(ATTACKER), returnTo: '/studio/drafts' }),
  );
  assert.equal(
    form.headers.get('location'),
    '/studio/sign-in?state=rate_limited&retryAfter=90&returnTo=%2Fstudio%2Fdrafts',
  );
  assert.equal(derivations(), before);
  assert.deepEqual(
    audit.records.slice(-2).map((record) => [record.type, record.refs.reason]),
    [
      ['login_throttled', 'source_blocked'],
      ['login_throttled', 'source_blocked'],
    ],
  );
});

test('behind a trusted proxy one source takes one verification slot at most, so the owner signs in while it verifies', async (t) => {
  const held: (() => void)[] = [];
  const { send } = await setup(t, {
    hops: 1,
    gate: () => new Promise<void>((resolve) => held.push(resolve)),
  });
  // A pair from one source: one verifies, and the other is turned away at once.
  const attacks = [send(wrongFrom(ATTACKER)), send(wrongFrom(ATTACKER))];
  await until(() => held.length === 1, 'one attempt from the source verifying');
  // The owner, from another source, gets the second slot meanwhile.
  const owner = send(login({ headers: fromSource('198.51.100.200') }));
  await until(() => held.length === 2, 'the owner verifying beside it');
  held[1]!();
  assert.equal((await owner).status, 200, 'the owner was turned away');
  held[0]!();
  const answers = await Promise.all(attacks);
  assert.deepEqual(answers.map((response) => response.status).sort(), [401, 429]);
});

test('behind a trusted proxy a source holds one place, so one client cannot fill the room, and being turned away counts against no one', async (t) => {
  const waiting: (() => void)[] = [];
  let holding = false;
  const { send, derivations, audit } = await setup(t, {
    hops: 1,
    hold: () =>
      holding ? new Promise<void>((resolve) => waiting.push(resolve)) : Promise.resolve(),
  });
  for (let index = 0; index < 50; index += 1) {
    assert.equal((await send(wrongFrom(`198.51.100.${index}`))).status, 401);
  }
  holding = true;
  // One client sends 16 at once: 1 waits, and 15 get 429 at once, before
  // any wait or verification.
  const before = derivations();
  const settled: Response[] = [];
  const attacks = Array.from({ length: 16 }, () =>
    send(wrongFrom(ATTACKER)).then((response) => {
      settled.push(response);
      return response;
    }),
  );
  await until(() => waiting.length === 1 && settled.length === 15, 'one waiting, fifteen not');
  for (const response of settled) {
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '1');
  }
  assert.equal(derivations(), before);
  // The owner, from another source, finds a place, waits, and signs in.
  const owner = send(login({ headers: fromSource('198.51.100.200') }));
  await until(() => waiting.length === 2, 'the owner waiting out the slowdown');
  const [first, mine] = waiting.splice(0);
  mine!();
  assert.equal((await owner).status, 200);
  first!();
  const answered = await Promise.all(attacks);
  assert.equal(answered.filter((response) => response.status === 401).length, 1);
  // The 15 turned away counted as no failures: the source has 1, and takes
  // 4 more verifications to be blocked.
  holding = false;
  for (let index = 0; index < 4; index += 1) {
    assert.equal((await send(wrongFrom(ATTACKER))).status, 401, `failure ${index + 2}`);
  }
  const blocked = await send(wrongFrom(ATTACKER));
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '60');
  const busy = audit.records.filter(
    (record) => record.type === 'login_throttled' && record.refs.reason === 'busy',
  );
  assert.equal(busy.length, 15);
  assert.ok(busy.every((record) => record.refs.source === '203.0.113.0/24'));
});

test('many sources can still fill the room, one place each, and the owner turned away gets in once a place frees, with no failure counted', async (t) => {
  const waiting: (() => void)[] = [];
  let holding = false;
  const { send } = await setup(t, {
    hops: 1,
    hold: () =>
      holding ? new Promise<void>((resolve) => waiting.push(resolve)) : Promise.resolve(),
  });
  for (let index = 0; index < 50; index += 1) {
    assert.equal((await send(wrongFrom(`198.51.100.${index}`))).status, 401);
  }
  holding = true;
  const settled: Response[] = [];
  const crowd = Array.from({ length: 16 }, (_, index) =>
    send(wrongFrom(`192.0.2.${index}`)).then((response) => {
      settled.push(response);
      return response;
    }),
  );
  await until(() => waiting.length === 16, 'sixteen sources filling the room');
  // More turn-aways than the 5 failures that would block the owner's source.
  const owner = { 'x-forwarded-for': '198.51.100.200' };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const refused = await soon(send(login({ headers: owner })), 'the owner waited for a place');
    assert.equal(refused.status, 429);
    assert.equal(refused.headers.get('retry-after'), '1');
  }
  // One of the crowd's attempts ends, and the owner's next try gets its place.
  waiting.shift()!();
  await until(() => settled.length === 1, 'an attempt leaving the room');
  const retry = send(login({ headers: owner }));
  await until(() => waiting.length === 16, 'the owner waiting out the slowdown');
  waiting.pop()!();
  assert.equal((await retry).status, 200);
  holding = false;
  for (const release of waiting.splice(0)) release();
  await Promise.all(crowd);
});

test('a sign-in form turned away before its body is read keeps the returnTo its action URL carries', async (t) => {
  const verifying: (() => void)[] = [];
  let holding = false;
  const { send, derivations } = await setup(t, {
    hops: 1,
    gate: () =>
      holding ? new Promise<void>((resolve) => verifying.push(resolve)) : Promise.resolve(),
  });
  const returnTo = '/studio/drafts?tab=history';
  /** The post the sign-in page makes: the field, and the action URL, which the form takes from loginAction(). */
  const form = (address: string) => {
    const request = login({
      form: true,
      body: { password: 'wrong password here', returnTo },
      returnTo,
      headers: fromSource(address),
    });
    const url = new URL(request.url);
    assert.equal(`${url.pathname}${url.search}`, loginAction(returnTo));
    return request;
  };
  const kept = (seconds: number) =>
    `/studio/sign-in?state=rate_limited&retryAfter=${seconds}&returnTo=${encodeURIComponent(returnTo)}`;

  // A blocked source.
  for (let index = 0; index < 5; index += 1) await send(wrongFrom(ATTACKER));
  const before = derivations();
  const blocked = await send(form(ATTACKER));
  assert.equal(blocked.status, 303);
  assert.equal(blocked.headers.get('location'), kept(60));
  // A source whose place another attempt holds.
  holding = true;
  const running = send(wrongFrom('203.0.113.8'));
  await until(() => verifying.length === 1, 'an attempt verifying');
  const crowded = await soon(send(form('203.0.113.8')), 'the second attempt waited');
  assert.equal(crowded.status, 303);
  assert.equal(crowded.headers.get('location'), kept(1));
  assert.equal(derivations(), before + 1, 'a post turned away ran a verification');
  holding = false;
  for (const release of verifying.splice(0)) release();
  await running;
});

test('a login from another origin or a sibling subdomain is 403 request_origin_rejected', async (t) => {
  const { send, derivations } = await setup(t);
  const others: Record<string, string>[] = [
    { origin: '' },
    { origin: 'https://elsewhere.test', 'sec-fetch-site': 'cross-site' },
    { origin: 'https://demo.rowan.test', 'sec-fetch-site': 'same-site' },
    { origin: 'http://rowan.test' },
    { 'sec-fetch-site': 'same-site' },
    { 'content-type': 'text/plain' },
  ];
  for (const headers of others) {
    for (const form of [false, true]) {
      const response = await send(login({ headers, form }));
      assert.equal(response.status, 403, JSON.stringify(headers));
      // A form post that fails the check gets the JSON 403, not a redirect.
      assert.equal(await errorCode(response), 'request_origin_rejected');
    }
  }
  assert.equal(derivations(), 0);
});

test("a login the session store can't write is 503 with no cookie, or the sign-in page's error", async (t) => {
  const { send, auth } = await setup(t);
  const issue = auth.sessions.issue;
  (auth.sessions as { issue: typeof issue }).issue = async () => {
    throw new Error('disk full');
  };
  t.after(() => {
    (auth.sessions as { issue: typeof issue }).issue = issue;
  });
  const json = await send(login());
  assert.equal(json.status, 503);
  assert.equal(await errorCode(json), 'unavailable');
  assert.equal(json.headers.get('set-cookie'), null);
  const form = await send(login({ form: true, returnTo: '/studio/drafts' }));
  assert.equal(
    form.headers.get('location'),
    '/studio/sign-in?state=error&returnTo=%2Fstudio%2Fdrafts',
  );
  assert.equal(form.headers.get('set-cookie'), null);
});

test("every sign-in answer but a new session clears a cookie whose session ended, and a failure keeps one the store couldn't read", async (t) => {
  t.mock.method(console, 'log', () => {});
  const verifying: (() => void)[] = [];
  let holding = false;
  const { send, auth } = await setup(t, {
    hops: 1,
    gate: () =>
      holding ? new Promise<void>((resolve) => verifying.push(resolve)) : Promise.resolve(),
  });
  const token = tokenOf(await send(login()))!;
  assert.equal((await send(studio('auth.logout', token))).status, 200);
  const dead = (headers: Record<string, string> = {}) => ({
    cookie: `__Host-studio_session=${token}`,
    ...headers,
  });
  const clears = (response: Response, status: number, what: string) => {
    assert.equal(response.status, status, what);
    assert.deepEqual(response.headers.getSetCookie(), [CLEARED], what);
  };
  const wrong = { password: 'wrong password here' };
  clears(await send(login({ body: wrong, headers: dead() })), 401, 'a wrong password');
  clears(await send(login({ form: true, body: wrong, headers: dead() })), 303, 'the form');
  const unread = new TextEncoder().encode('{"password":');
  clears(await send(login({ raw: unread, headers: dead() })), 400, 'JSON that does not parse');
  const notUtf8 = Uint8Array.from([0x70, 0x3d, 0xff]);
  clears(await send(login({ form: true, raw: notUtf8, headers: dead() })), 303, 'a broken form');
  // Both verification slots taken.
  holding = true;
  const running = [send(login({ body: wrong })), send(login({ body: wrong }))];
  await until(() => verifying.length === 2, 'two verifications running');
  clears(await soon(send(login({ headers: dead() })), 'the third waited'), 429, 'busy');
  holding = false;
  for (const release of verifying.splice(0)) release();
  await Promise.all(running);
  // A blocked source, turned away before its body is read.
  for (let index = 0; index < 5; index += 1) await send(wrongFrom(ATTACKER));
  clears(await send(login({ headers: dead(fromSource(ATTACKER)) })), 429, 'a blocked source');
  // A store that can't write the new session.
  const issue = auth.sessions.issue;
  (auth.sessions as { issue: typeof issue }).issue = async () => {
    throw new Error('disk full');
  };
  try {
    clears(await send(login({ headers: dead() })), 503, "a store that can't write");
  } finally {
    (auth.sessions as { issue: typeof issue }).issue = issue;
  }
  // A sign-in that works sets its new cookie, and only that one.
  const signedIn = await send(login({ headers: dead() }));
  assert.equal(signedIn.status, 200);
  const fresh = tokenOf(signedIn);
  assert.ok(fresh && fresh !== token, 'no new cookie');
  // One the store couldn't read may still count, so a failure leaves it.
  const resolve = auth.sessions.resolve;
  (auth.sessions as { resolve: typeof resolve }).resolve = async () => ({ status: 'unavailable' });
  try {
    const kept = await send(
      login({ body: wrong, headers: { cookie: `__Host-studio_session=${fresh}` } }),
    );
    assert.equal(kept.status, 401);
    assert.deepEqual(kept.headers.getSetCookie(), []);
  } finally {
    (auth.sessions as { resolve: typeof resolve }).resolve = resolve;
  }
});

test('a returnTo past ASCII is checked and percent-encoded before a session exists, so the redirect never fails after one', async (t) => {
  const { send, auth } = await setup(t);
  const returnTo = '/studio/drafts/ünïcödé?tab=日本#Ω';
  const encoded = '/studio/drafts/%C3%BCn%C3%AFc%C3%B6d%C3%A9?tab=%E6%97%A5%E6%9C%AC#%CE%A9';
  const response = await send(login({ form: true, returnTo }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), encoded);
  assert.ok(tokenOf(response));
  assert.equal((await auth.sessions.list()).length, 1);
  // The form's field the same way, and a failed form keeps the encoded path.
  const field = await send(login({ form: true, body: { password: PASSWORD, returnTo } }));
  assert.equal(field.headers.get('location'), encoded);
  const failed = await send(
    login({ form: true, body: { password: 'not the password at all' }, returnTo }),
  );
  assert.equal(
    failed.headers.get('location'),
    `/studio/sign-in?state=failed&returnTo=${encodeURIComponent(encoded)}`,
  );
  // Whitespace and control characters past ASCII are refused, as in ASCII.
  for (const unsafe of ['/studio/a\u00a0b', '/studio/a\u2028b', '/studio/a\u0085b']) {
    const refused = await send(login({ form: true, returnTo: unsafe }));
    assert.equal(refused.status, 303);
    assert.equal(refused.headers.get('location'), '/studio', JSON.stringify(unsafe));
  }
  assert.equal((await auth.sessions.list()).length, 5);
});

test("the sign-in form's returnTo field is where the owner goes, over the one in the URL", async (t) => {
  const { send } = await setup(t);
  const field = await send(
    login({ form: true, body: { password: PASSWORD, returnTo: '/studio/drafts?tab=history' } }),
  );
  assert.equal(field.status, 303);
  assert.equal(field.headers.get('location'), '/studio/drafts?tab=history');
  const both = await send(
    login({
      form: true,
      body: { password: PASSWORD, returnTo: '/studio/settings' },
      returnTo: '/studio/drafts',
    }),
  );
  assert.equal(both.headers.get('location'), '/studio/settings');
  // A failed form keeps the field's returnTo, and an unsafe one is dropped.
  const failed = await send(
    login({ form: true, body: { password: 'not the password at all', returnTo: '/studio/x' } }),
  );
  assert.equal(
    failed.headers.get('location'),
    '/studio/sign-in?state=failed&returnTo=%2Fstudio%2Fx',
  );
  const unsafe = await send(
    login({
      form: true,
      body: { password: PASSWORD, returnTo: 'https://elsewhere.test/' },
      returnTo: '/studio/drafts',
    }),
  );
  assert.equal(unsafe.headers.get('location'), '/studio');
});

test('a malformed sign-in form goes back to the sign-in page with no verification, and a malformed JSON sign-in is 400', async (t) => {
  const { send, derivations, audit } = await setup(t);
  const bytes = (text: string) => new TextEncoder().encode(text);
  const malformed: [what: string, raw: Uint8Array<ArrayBuffer>][] = [
    ['a field given twice', bytes(`password=${encodeURIComponent(PASSWORD)}&password=x`)],
    ['a returnTo given twice', bytes('password=x&returnTo=%2Fstudio&returnTo=%2Fstudio%2Fx')],
    ['a body past 4 KB', bytes(`password=${'x'.repeat(4097)}`)],
    ['bytes that are not UTF-8', Uint8Array.from([0x70, 0x3d, 0xff, 0xfe])],
  ];
  for (const [what, raw] of malformed) {
    const response = await send(login({ form: true, raw, returnTo: '/studio/drafts' }));
    assert.equal(response.status, 303, what);
    assert.equal(
      response.headers.get('location'),
      '/studio/sign-in?state=error&returnTo=%2Fstudio%2Fdrafts',
      what,
    );
    assert.equal(response.headers.get('set-cookie'), null, what);
  }
  for (const [what, raw] of [
    ['JSON that does not parse', bytes('{"password":')],
    ['a JSON body past 4 KB', bytes(JSON.stringify({ password: 'x'.repeat(4097) }))],
    ['JSON bytes that are not UTF-8', Uint8Array.from([0x7b, 0xff, 0x7d])],
  ] as const) {
    const response = await send(login({ raw }));
    assert.equal(response.status, 400, what);
    assert.equal(await errorCode(response), 'invalid_input', what);
  }
  assert.equal(derivations(), 0);
  assert.deepEqual(audit.records, []);
});

test('logout always answers signed out, clearing the cookie and the cache: with no session, an ended one, or a store that fails', async (t) => {
  const { send, auth, advance } = await setup(t);
  const logged = t.mock.method(console, 'log', () => {});
  const signedOut = async (response: Response, what: string) => {
    assert.equal(response.status, 200, what);
    assert.deepEqual((await response.json()) as unknown, { data: { signedOut: true } }, what);
    assert.deepEqual(response.headers.getSetCookie(), [CLEARED], what);
    assert.equal(response.headers.get('clear-site-data'), '"cache"', what);
  };
  /** A logout carrying `cookie` and no CSRF token, which it has no session to take one from. */
  const logout = (cookie?: string) => {
    const request = studio('auth.logout');
    if (cookie) request.headers.set('cookie', `__Host-studio_session=${cookie}`);
    return send(request);
  };
  await signedOut(await logout(), 'no cookie');
  await signedOut(await logout('not-a-token'), 'a cookie that is no token');
  // Revoked from another tab, and expired.
  const revoked = tokenOf(await send(login()))!;
  await send(studio('auth.sessions.revokeAll', tokenOf(await send(login()))!));
  await signedOut(await logout(revoked), 'a revoked session');
  const idle = tokenOf(await send(login()))!;
  advance(61 * MINUTE);
  await signedOut(await logout(idle), 'an expired session');

  // A store that can't be read: the cookie is cleared all the same.
  const unread = tokenOf(await send(login()))!;
  const resolve = auth.sessions.resolve;
  (auth.sessions as { resolve: typeof resolve }).resolve = async () => ({ status: 'unavailable' });
  try {
    await signedOut(await logout(unread), 'a store that cannot be read');
  } finally {
    (auth.sessions as { resolve: typeof resolve }).resolve = resolve;
  }

  // A store that can't end the session: the browser is signed out, and the
  // failure is logged.
  const unended = tokenOf(await send(login()))!;
  const end = auth.sessions.end;
  (auth.sessions as { end: typeof end }).end = async () => {
    throw new Error('disk full');
  };
  try {
    await signedOut(await send(studio('auth.logout', unended)), 'a store that cannot end it');
  } finally {
    (auth.sessions as { end: typeof end }).end = end;
  }
  assert.ok(
    logged.mock.calls.some((call) =>
      String(call.arguments[0]).includes('"event":"logout.store_failed"'),
    ),
    'the failure was not logged',
  );
});

test('logout still needs the exact Origin, and with a session that counts, its CSRF token', async (t) => {
  const { send, audit } = await setup(t);
  const token = tokenOf(await send(login()))!;
  const denied = async (request: Request, reason: string) => {
    const response = await send(request);
    assert.equal(response.status, 403, reason);
    assert.equal(await errorCode(response), 'request_origin_rejected', reason);
    assert.equal(response.headers.get('set-cookie'), null, reason);
    assert.equal(audit.records.at(-1)?.refs.reason, reason);
  };
  for (const cookie of [undefined, token]) {
    const noOrigin = studio('auth.logout', cookie);
    noOrigin.headers.delete('origin');
    await denied(noOrigin, 'origin_missing');
    const sibling = studio('auth.logout', cookie);
    sibling.headers.set('origin', 'https://demo.rowan.test');
    await denied(sibling, 'origin_mismatch');
  }
  const tokenless = studio('auth.logout', token);
  tokenless.headers.delete('x-csrf-token');
  await denied(tokenless, 'csrf_missing');
  // The session is still there for a logout that passes.
  assert.equal((await send(studio('auth.session', token))).status, 200);
  assert.equal((await send(studio('auth.logout', token))).status, 200);
  assert.equal((await send(studio('auth.session', token))).status, 401);
});

test('logout, revocation, eviction, and revoke-sessions each end the session on its next request', async (t) => {
  const { send, dataDir, advance } = await setup(t);
  const signIn = async () => {
    advance(1000);
    return tokenOf(await send(login()))!;
  };
  // Logout ends this session, clears the cookie, and the HTTP cache.
  const leaving = await signIn();
  const out = await send(studio('auth.logout', leaving));
  assert.equal(out.status, 200);
  assert.deepEqual((await out.json()) as unknown, { data: { signedOut: true } });
  assert.match(out.headers.get('set-cookie') ?? '', /^__Host-studio_session=; Path=\/; Max-Age=0/);
  assert.equal(out.headers.get('clear-site-data'), '"cache"');
  assert.equal((await send(studio('auth.session', leaving))).status, 401);

  // Revoking one session by its ref ends that one only.
  const keeper = await signIn();
  const other = await signIn();
  const listed = (await (await send(studio('auth.sessions.list', keeper))).json()) as {
    data: { sessions: { ref: string; current: boolean; browser: string }[] };
  };
  assert.equal(listed.data.sessions.length, 2);
  assert.deepEqual(listed.data.sessions.map((entry) => [entry.current, entry.browser]).sort(), [
    [false, 'firefox'],
    [true, 'firefox'],
  ]);
  const otherRef = listed.data.sessions.find((entry) => !entry.current)!.ref;
  const revoked = await send(studio('auth.sessions.revoke', keeper, { ref: otherRef }));
  assert.deepEqual((await revoked.json()) as unknown, { data: { revoked: true } });
  assert.equal(
    revoked.headers.get('set-cookie'),
    null,
    "revoking another session keeps this one's cookie",
  );
  assert.equal((await send(studio('auth.session', other))).status, 401);
  assert.equal((await send(studio('auth.session', keeper))).status, 200);

  // A sixth sign-in evicts the least recently seen.
  const five = [keeper, await signIn(), await signIn(), await signIn(), await signIn()];
  await signIn();
  assert.equal((await send(studio('auth.session', five[0]))).status, 401);
  for (const token of five.slice(1))
    assert.equal((await send(studio('auth.session', token))).status, 200);

  // Revoking all ends every one, this one included.
  const all = await send(studio('auth.sessions.revokeAll', five[1]));
  assert.deepEqual((await all.json()) as unknown, { data: { revoked: 5 } });
  assert.match(all.headers.get('set-cookie') ?? '', /Max-Age=0/);
  for (const token of five.slice(1))
    assert.equal((await send(studio('auth.session', token))).status, 401);

  // revoke-sessions, run against the data directory, ends a session the server holds.
  const survivor = await signIn();
  await revokeAllSessionFiles(dataDir, Date.now() + 365 * 24 * 60 * MINUTE);
  assert.equal((await send(studio('auth.session', survivor))).status, 401);
});

test('auth.session answers the principal, the CSRF token, and the expiry times, and never slides the session', async (t) => {
  const { send, auth, advance } = await setup(t);
  const token = tokenOf(await send(login()))!;
  const [record] = await auth.sessions.list();
  advance(5 * MINUTE);
  const response = await send(studio('auth.session', token));
  const view = AuthSessionSchema.parse(((await response.json()) as { data: unknown }).data);
  assert.equal(view.csrfToken, csrfToken(token));
  assert.deepEqual(view.principal, {
    id: 'owner',
    method: 'password',
    authTime: new Date(record!.createdAt).toISOString(),
  });
  assert.equal(view.idleExpiresAt, new Date(record!.createdAt + 60 * MINUTE).toISOString());
  assert.equal(
    view.absoluteExpiresAt,
    new Date(record!.createdAt + 12 * 60 * MINUTE).toISOString(),
  );
  assert.equal((await auth.sessions.list())[0]!.lastSeenAt, record!.lastSeenAt);

  // auth.session.extend writes lastSeenAt at once and answers the new times.
  advance(20_000);
  const extended = await send(studio('auth.session.extend', token));
  const times = ((await extended.json()) as { data: { idleExpiresAt: string } }).data;
  assert.equal(
    times.idleExpiresAt,
    new Date(record!.createdAt + 5 * MINUTE + 20_000 + 60 * MINUTE).toISOString(),
  );
});

test('every auth handler checks its token before it does anything', async (t) => {
  const { auth } = await setup(t);
  const session = mintSession();
  for (const [name, handler] of Object.entries(auth.handlers)) {
    const operation = listOperations().find((entry) => entry.name === name)!;
    const context: HandlerContext = {
      request: new Request(`${ORIGIN}/api/studio/${name}`),
      requestId: 'req-handler',
      operation,
      session,
      inputType: operation.kind === 'query' ? 'search' : 'json',
      recheckSession: async () => null,
      commitWithSession: async () => {
        throw new Error('Nothing commits in this test.');
      },
    };
    const forged = Object.freeze({
      capability: operation.capability,
      session,
    }) as unknown as Authorized;
    await assert.rejects(async () => handler(forged, {}, context), /not authorized/, name);
    for (const capability of CAPABILITIES) {
      if (capability === operation.capability || accessIn('owner', capability) === 'absent')
        continue;
      const token = authorize(capability, session);
      assert.ok(token, capability);
      await assert.rejects(
        async () => handler(token, {}, context),
        /not authorized/,
        `${name} ${capability}`,
      );
    }
  }
});

test("a source's first anonymous failure is written at once, and the rest of the minute's as one record with a count", async (t) => {
  const { send, auth, dataDir } = await setup(t, { hops: 1, diskAudit: true });
  for (let index = 0; index < 3; index += 1) {
    await send(
      login({
        body: { password: 'wrong password here' },
        headers: { 'x-forwarded-for': '203.0.113.7' },
      }),
    );
  }
  await auth.audit.flush();
  const [month] = readdirSync(path.join(dataDir, 'audit'));
  const records = readFileSync(path.join(dataDir, 'audit', month!), 'utf8')
    .trim()
    .split('\n')
    .map(
      (line) => JSON.parse(line) as { type: string; actor: string; refs: Record<string, unknown> },
    );
  // The first at once, with its request ID, and the other two counted.
  assert.deepEqual(
    records.map(({ type, actor, refs }) => ({
      type,
      actor,
      refs: { ...refs, requestId: undefined },
    })),
    [
      {
        type: 'login_failed',
        actor: 'anonymous',
        refs: { source: '203.0.113.0/24', count: 1, requestId: undefined },
      },
      {
        type: 'login_failed',
        actor: 'anonymous',
        refs: { source: '203.0.113.0/24', count: 2, requestId: undefined },
      },
    ],
  );
  assert.equal(typeof records[0]?.refs.requestId, 'string');
  assert.equal(records[1]?.refs.requestId, undefined);
});

test('auth events reach AuditSink with none of the forbidden fields', async (t) => {
  const { send, audit } = await setup(t, { hops: 1 });
  const address = { 'x-forwarded-for': '203.0.113.77' };
  await send(login({ body: { password: 'canary wrong passphrase' }, headers: address }));
  const token = tokenOf(await send(login({ headers: address })))!;
  const denied = studio('auth.logout', token);
  denied.headers.set('x-csrf-token', 'x'.repeat(43));
  await send(denied);
  await send(studio('auth.logout', token));
  const types = audit.records.map((record) => record.type);
  assert.deepEqual(types, ['login_failed', 'login_succeeded', 'command_denied', 'logout']);
  const text = JSON.stringify(audit.records);
  for (const forbidden of [
    PASSWORD,
    'canary wrong passphrase',
    HASH,
    base64(KEY),
    token,
    csrfToken(token),
    '203.0.113.77',
    UA,
    'Firefox',
  ]) {
    assert.ok(!text.includes(forbidden), forbidden);
  }
  for (const record of audit.records) {
    assert.deepEqual(Object.keys(record).sort(), ['actor', 'at', 'outcome', 'refs', 'type']);
  }
});
