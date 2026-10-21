import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { memoryAuditSink } from '../audit/sink';
import { prepareAuthDirectories } from '../data/layout.mjs';
import { revokeAllSessionFiles, writeSessionFile } from './session-files.mjs';
import {
  filesystemSessionStore,
  memorySessionStore,
  type SessionRecord,
  type SessionStore,
} from './session-store';
import {
  browserFamily,
  createSessions,
  MAX_SESSIONS,
  slides,
  type Activity,
  type Resolution,
  type SessionsOptions,
} from './sessions';
import { newSessionToken, sessionDigest, sessionRef } from './token';

const OLD = 'MKhpw6F1Y5AkDvbeT_fgmw';
const NEW = 'qJ3x0bQd9kVb4m2ZcLw8Tg';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A clock the test moves. */
function clock(start = Date.UTC(2026, 9, 20, 9, 0, 0)) {
  let at = start;
  return {
    now: () => at,
    advance(ms: number) {
      at += ms;
    },
  };
}

function setup(overrides: Partial<SessionsOptions> = {}) {
  const time = clock();
  const store = overrides.store ?? memorySessionStore();
  const audit = memoryAuditSink(time.now);
  const ended: string[] = [];
  const sessions = createSessions({ store, audit, fingerprint: OLD, now: time.now, ...overrides });
  sessions.onSessionEnded((digest) => ended.push(digest));
  return { time, store, audit, sessions, ended };
}

/** A Studio command, the activity that always slides. */
const COMMAND: Activity = { kind: 'command' };

const statusOf = (resolution: Resolution) =>
  resolution.status === 'ended' ? `ended:${resolution.reason}` : resolution.status;

async function dataDir(t: TestContext): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sessions-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(await prepareAuthDirectories(dir), null);
  return dir;
}

test('a session ends 60 minutes after it was last used, and 12 hours after sign-in however busy', async () => {
  const { time, sessions, ended } = setup();
  const idle = await sessions.issue({ uaFamily: 'firefox' });
  time.advance(59 * MINUTE);
  assert.equal(statusOf(await sessions.resolve(idle.token)), 'valid');
  time.advance(MINUTE);
  assert.equal(statusOf(await sessions.resolve(idle.token)), 'ended:expired');
  assert.deepEqual(ended, [idle.record.digest]);
  // Ended means deleted: the next request finds no record.
  assert.equal(statusOf(await sessions.resolve(idle.token)), 'ended:unknown');

  // A busy session still ends 12 hours after sign-in.
  const busy = await sessions.issue({ uaFamily: 'firefox' });
  for (let elapsed = 0; elapsed < 12 * HOUR - 30 * MINUTE; elapsed += 30 * MINUTE) {
    time.advance(30 * MINUTE);
    const resolved = await sessions.resolve(busy.token);
    assert.equal(resolved.status, 'valid');
    if (resolved.status === 'valid') await sessions.touch(resolved.record, COMMAND);
  }
  time.advance(30 * MINUTE);
  assert.equal(statusOf(await sessions.resolve(busy.token)), 'ended:expired');
});

test('the idle limit slides with use, writing lastSeenAt at most once a minute, and the absolute limit never moves', async () => {
  const { time, store, sessions } = setup({
    lifetime: { idleMinutes: 5, maxHours: 1 },
  });
  const { token, record } = await sessions.issue({ uaFamily: 'chrome' });
  assert.equal(sessions.maxAgeSeconds(record), 3_600);
  const writes: number[] = [];
  const put = store.put.bind(store);
  store.put = async (entry: SessionRecord) => {
    writes.push(entry.lastSeenAt);
    await put(entry);
  };
  time.advance(30_000);
  await sessions.touch(record, COMMAND);
  assert.deepEqual(writes, [], 'a touch within the minute writes nothing');
  time.advance(30_000);
  const touched = (await sessions.touch(record, COMMAND))!;
  assert.deepEqual(writes, [record.createdAt + MINUTE]);
  assert.equal(touched.absoluteExpiresAt, record.absoluteExpiresAt);
  time.advance(1_000);
  await sessions.touch(touched, { kind: 'command', extend: true });
  assert.equal(writes.length, 2, 'auth.session.extend writes at once');
  assert.deepEqual(sessions.expiry((await store.get(record.digest))!), {
    idleExpiresAt: record.createdAt + 61_000 + 5 * MINUTE,
    absoluteExpiresAt: record.createdAt + HOUR,
  });
  // Touching every few minutes keeps it past the idle limit, never past the absolute one.
  for (let elapsed = 61_000; elapsed < HOUR - 4 * MINUTE; elapsed += 4 * MINUTE) {
    time.advance(4 * MINUTE);
    const resolved = await sessions.resolve(token);
    assert.equal(resolved.status, 'valid', `${elapsed / MINUTE} minutes in`);
    if (resolved.status === 'valid') await sessions.touch(resolved.record, COMMAND);
  }
  time.advance(4 * MINUTE);
  assert.equal(statusOf(await sessions.resolve(token)), 'ended:expired');
  assert.equal(sessions.maxAgeSeconds(record), 0);
});

test('a query never slides the session, so a page polling in the background lets it expire', async () => {
  const { time, store, sessions } = setup({ lifetime: { idleMinutes: 5, maxHours: 1 } });
  const { token, record } = await sessions.issue({ uaFamily: 'chrome' });
  const reads: string[] = [];
  const get = store.get.bind(store);
  store.get = async (digest: string) => {
    reads.push(digest);
    return get(digest);
  };
  time.advance(2 * MINUTE);
  const unchanged = await sessions.touch(record, { kind: 'query' });
  assert.equal(unchanged, record);
  assert.deepEqual(reads, [], 'a query reads nothing to slide');
  // A command two minutes in slides it to seven minutes.
  const touched = (await sessions.touch(record, COMMAND))!;
  assert.equal(touched.lastSeenAt, record.createdAt + 2 * MINUTE);
  // Queries every minute after that, as a page left open would send, never slide it.
  for (let minute = 3; minute < 7; minute += 1) {
    time.advance(MINUTE);
    const resolved = await sessions.resolve(token);
    assert.equal(resolved.status, 'valid', `${minute} minutes in`);
    if (resolved.status === 'valid') await sessions.touch(resolved.record, { kind: 'query' });
  }
  assert.equal((await get(record.digest))?.lastSeenAt, record.createdAt + 2 * MINUTE);
  time.advance(MINUTE);
  assert.equal(statusOf(await sessions.resolve(token)), 'ended:expired');
});

test('a page slides the session only when the owner opens it, from the owner origin or the address bar', async () => {
  const page = (headers: Record<string, string>): Activity => ({
    kind: 'page',
    headers: new Headers(headers),
  });
  const navigation = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
  const router = { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', rsc: '1' };
  const cases: [what: string, headers: Record<string, string>, slides: boolean][] = [
    ['a link on the owner origin', { ...navigation, 'sec-fetch-site': 'same-origin' }, true],
    ['the address bar or a bookmark', { ...navigation, 'sec-fetch-site': 'none' }, true],
    ["the App Router's navigation", { ...router, 'sec-fetch-site': 'same-origin' }, true],
    ['a link on a sibling origin', { ...navigation, 'sec-fetch-site': 'same-site' }, false],
    ['a link on another site', { ...navigation, 'sec-fetch-site': 'cross-site' }, false],
    ['a sibling forging the router request', { ...router, 'sec-fetch-site': 'same-site' }, false],
    ['no Fetch Metadata', {}, false],
    ['the page without its mode', { 'sec-fetch-site': 'same-origin' }, false],
    [
      'a frame',
      { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' },
      false,
    ],
    [
      "a script's fetch of the page",
      { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' },
      false,
    ],
    [
      'an image tag',
      { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' },
      false,
    ],
    [
      'a browser prefetch',
      { ...navigation, 'sec-fetch-site': 'same-origin', 'sec-purpose': 'prefetch' },
      false,
    ],
    [
      'a prerender',
      { ...navigation, 'sec-fetch-site': 'none', 'sec-purpose': 'prefetch;prerender' },
      false,
    ],
    [
      'a legacy prefetch',
      { ...navigation, 'sec-fetch-site': 'same-origin', purpose: 'prefetch' },
      false,
    ],
    [
      "the router's prefetch",
      { ...router, 'sec-fetch-site': 'same-origin', 'next-router-prefetch': '1' },
      false,
    ],
    [
      "the router's segment prefetch",
      { ...router, 'sec-fetch-site': 'same-origin', 'next-router-segment-prefetch': '/_tree' },
      false,
    ],
  ];
  for (const [what, headers, expected] of cases) {
    assert.equal(slides(page(headers)), expected, what);
  }
  assert.equal(slides(COMMAND), true);
  assert.equal(slides({ kind: 'query' }), false);

  // touch() follows the same rule.
  const { time, store, sessions } = setup();
  const { record } = await sessions.issue({ uaFamily: 'safari' });
  time.advance(2 * MINUTE);
  await sessions.touch(record, page({ ...navigation, 'sec-fetch-site': 'same-site' }));
  assert.equal((await store.get(record.digest))?.lastSeenAt, record.createdAt);
  await sessions.touch(record, page({ ...navigation, 'sec-fetch-site': 'same-origin' }));
  assert.equal((await store.get(record.digest))?.lastSeenAt, record.createdAt + 2 * MINUTE);
});

test('a lower maximum set after sign-in applies to sessions already issued', async () => {
  const time = clock();
  const store = memorySessionStore();
  const audit = memoryAuditSink(time.now);
  const before = createSessions({ store, audit, fingerprint: OLD, now: time.now });
  const { token } = await before.issue({ uaFamily: 'edge' });
  const after = createSessions({
    store,
    audit,
    fingerprint: OLD,
    now: time.now,
    lifetime: { idleMinutes: 60, maxHours: 1 },
  });
  time.advance(59 * MINUTE);
  assert.equal(statusOf(await after.resolve(token)), 'valid');
  time.advance(MINUTE);
  assert.equal(statusOf(await after.resolve(token)), 'ended:expired');
});

test("a sign-in gets a new token and ends the session the request's cookie carried", async () => {
  const { sessions, ended, store } = setup();
  const first = await sessions.issue({ uaFamily: 'firefox' });
  const second = await sessions.issue({ uaFamily: 'firefox', replacing: first.token });
  assert.notEqual(second.token, first.token);
  assert.equal(statusOf(await sessions.resolve(first.token)), 'ended:unknown');
  assert.equal(statusOf(await sessions.resolve(second.token)), 'valid');
  assert.deepEqual(ended, [first.record.digest]);
  assert.deepEqual(
    (await store.list()).map((entry) => entry.digest),
    [second.record.digest],
  );
  // A cookie that isn't a token, or names no session, changes nothing.
  for (const replacing of ['forged', newSessionToken(), null]) {
    await sessions.issue({ uaFamily: 'firefox', replacing });
  }
  assert.equal((await store.list()).length, 4);
  // Two cookies of the name: the sessions of both end.
  const one = await sessions.issue({ uaFamily: 'firefox' });
  const two = await sessions.issue({ uaFamily: 'firefox' });
  await sessions.issue({ uaFamily: 'firefox', replacing: [one.token, two.token, 'forged'] });
  for (const { token } of [one, two]) {
    assert.equal(statusOf(await sessions.resolve(token)), 'ended:unknown');
  }
});

test('at most 5 sessions exist, and a sixth evicts the least recently seen', async () => {
  const { time, sessions, audit, ended } = setup();
  const issued = [];
  for (let index = 0; index < MAX_SESSIONS; index += 1) {
    issued.push(await sessions.issue({ uaFamily: 'safari' }));
    time.advance(2 * MINUTE);
  }
  // The first one is seen again, so the second is now the least recently seen.
  const first = await sessions.resolve(issued[0]!.token);
  assert.equal(first.status, 'valid');
  if (first.status === 'valid') await sessions.touch(first.record, COMMAND);
  time.advance(MINUTE);
  const sixth = await sessions.issue({ uaFamily: 'safari', context: { requestId: 'req-sixth' } });
  assert.equal(statusOf(await sessions.resolve(issued[1]!.token)), 'ended:unknown');
  for (const kept of [issued[0]!, ...issued.slice(2), sixth]) {
    assert.equal(statusOf(await sessions.resolve(kept.token)), 'valid');
  }
  assert.deepEqual(ended, [issued[1]!.record.digest]);
  assert.deepEqual(
    audit.records.map(({ type, actor, outcome, refs }) => ({ type, actor, outcome, refs })),
    [
      {
        type: 'session_evicted',
        actor: 'owner',
        outcome: 'success',
        refs: { sessionRef: sessionRef(issued[1]!.record.digest), requestId: 'req-sixth' },
      },
    ],
  );
  assert.equal((await sessions.list()).length, MAX_SESSIONS);
});

test('logout, revocation, and revoke-all each end a session in the store, tell onSessionEnded, and audit it', async () => {
  const { sessions, audit, ended } = setup();
  const [one, two, three, four] = [
    await sessions.issue({ uaFamily: 'firefox' }),
    await sessions.issue({ uaFamily: 'firefox' }),
    await sessions.issue({ uaFamily: 'firefox' }),
    await sessions.issue({ uaFamily: 'firefox' }),
  ];
  assert.equal(await sessions.end(one.record.digest, 'logout', { requestId: 'req-1' }), true);
  assert.equal(await sessions.end(one.record.digest, 'logout'), false);
  assert.equal(await sessions.end(two.record.digest, 'revoked', { requestId: 'req-2' }), true);
  assert.equal(await sessions.revokeAll({ requestId: 'req-3' }), 2);
  for (const issued of [one, two, three, four]) {
    assert.equal(statusOf(await sessions.resolve(issued.token)), 'ended:unknown');
  }
  assert.deepEqual(
    ended.sort(),
    [one, two, three, four].map((issued) => issued.record.digest).sort(),
  );
  assert.deepEqual(
    audit.records.map(({ type, refs }) => [type, refs]),
    [
      ['logout', { sessionRef: sessionRef(one.record.digest), requestId: 'req-1' }],
      ['session_revoked', { sessionRef: sessionRef(two.record.digest), requestId: 'req-2' }],
      ['sessions_revoked_all', { count: 2, requestId: 'req-3' }],
    ],
  );
});

test('a session signed in under another password hash no longer counts', async (t) => {
  const dir = await dataDir(t);
  const time = clock();
  const audit = memoryAuditSink(time.now);
  const before = createSessions({
    store: filesystemSessionStore(dir),
    audit,
    fingerprint: OLD,
    now: time.now,
  });
  const issued = [
    await before.issue({ uaFamily: 'firefox' }),
    await before.issue({ uaFamily: 'chrome' }),
  ];
  // The restart: the same data directory, a new hash.
  const ended: string[] = [];
  const after = createSessions({
    store: filesystemSessionStore(dir),
    audit,
    fingerprint: NEW,
    now: time.now,
  });
  after.onSessionEnded((digest) => ended.push(digest));
  for (const { token } of issued) {
    assert.equal(statusOf(await after.resolve(token)), 'ended:credential_changed');
    assert.equal(statusOf(await after.resolve(token)), 'ended:unknown');
  }
  assert.deepEqual(ended.sort(), issued.map(({ record }) => record.digest).sort());
  assert.deepEqual(await after.list(), []);
  const fresh = await after.issue({ uaFamily: 'firefox' });
  assert.equal(statusOf(await after.resolve(fresh.token)), 'valid');
});

test('a session from one data directory is unknown in another', async (t) => {
  const [first, second] = [await dataDir(t), await dataDir(t)];
  const time = clock();
  const audit = memoryAuditSink(time.now);
  const here = createSessions({
    store: filesystemSessionStore(first),
    audit,
    fingerprint: OLD,
    now: time.now,
  });
  const there = createSessions({
    store: filesystemSessionStore(second),
    audit,
    fingerprint: OLD,
    now: time.now,
  });
  const { token } = await here.issue({ uaFamily: 'firefox' });
  assert.equal(statusOf(await there.resolve(token)), 'ended:unknown');
  assert.equal(statusOf(await here.resolve(token)), 'valid');
});

test('sessions created before revoke-sessions ran are refused, even when a record is written back', async (t) => {
  const dir = await dataDir(t);
  const time = clock();
  const sessions = createSessions({
    store: filesystemSessionStore(dir),
    audit: memoryAuditSink(time.now),
    fingerprint: OLD,
    now: time.now,
  });
  const { token, record } = await sessions.issue({ uaFamily: 'firefox' });
  time.advance(MINUTE);
  // What owner.mjs revoke-sessions does, from another process.
  await revokeAllSessionFiles(dir, time.now());
  // A write that raced the run puts the record back.
  await writeSessionFile(dir, { ...record, lastSeenAt: time.now() });
  assert.equal(statusOf(await sessions.resolve(token)), 'ended:revoked');
  time.advance(1);
  const fresh = await sessions.issue({ uaFamily: 'firefox' });
  assert.equal(statusOf(await sessions.resolve(fresh.token)), 'valid');
});

test('a touch never writes back a session that ended meanwhile, and answers null for it', async () => {
  const { time, store, sessions } = setup();
  const { token, record } = await sessions.issue({ uaFamily: 'firefox' });
  time.advance(2 * MINUTE);
  const [touched, , after] = await Promise.all([
    sessions.touch(record, COMMAND),
    sessions.end(record.digest, 'logout'),
    sessions.touch(record, { kind: 'command', extend: true }),
  ]);
  assert.equal(touched?.lastSeenAt, record.createdAt + 2 * MINUTE);
  assert.equal(after, null, 'the touch after the logout found the session gone');
  assert.equal(await store.get(record.digest), null);
  assert.equal(statusOf(await sessions.resolve(token)), 'ended:unknown');
});

test('revoking every session waits for a touch in flight, and one queued behind it writes nothing back', async () => {
  const { time, store, sessions, ended } = setup();
  const { token, record } = await sessions.issue({ uaFamily: 'firefox' });
  time.advance(2 * MINUTE);
  // The first write waits, so the touch is mid-write when revokeAll starts.
  let release: () => void = () => {};
  let first = true;
  const put = store.put.bind(store);
  store.put = async (entry: SessionRecord) => {
    if (first) {
      first = false;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    await put(entry);
  };
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const inFlight = sessions.touch(record, COMMAND);
  await tick();
  // revokeAll now holds the sign-in lock and waits for the session's.
  const revoking = sessions.revokeAll();
  await tick();
  const queued = sessions.touch(record, { kind: 'command', extend: true });
  release();
  assert.equal((await inFlight)?.lastSeenAt, record.createdAt + 2 * MINUTE);
  assert.equal(await revoking, 1);
  assert.equal(await queued, null);
  assert.equal(await store.get(record.digest), null, 'a touch wrote a revoked session back');
  assert.equal(statusOf(await sessions.resolve(token)), 'ended:unknown');
  assert.deepEqual(ended, [record.digest], 'onSessionEnded fired once');
});

test('a session created in the millisecond of a revocation is revoked too', async () => {
  const { time, store, sessions } = setup();
  const { token, record } = await sessions.issue({ uaFamily: 'firefox' });
  // Another process revokes at the very millisecond the record was made.
  await store.revokeAll(record.createdAt);
  await store.put(record);
  time.advance(1);
  assert.equal(statusOf(await sessions.resolve(token)), 'ended:revoked');
});

test('a failed lastSeenAt write is logged and the request goes on; a store that cannot be read gives no session', async () => {
  const logged: string[] = [];
  const store = memorySessionStore();
  const { time, sessions } = setup({
    store,
    log: (entry) => logged.push(`${entry.level}:${entry.event}`),
  });
  const { token, record } = await sessions.issue({ uaFamily: 'firefox' });
  time.advance(2 * MINUTE);
  const failing: SessionStore = {
    ...store,
    put: async () => {
      throw new Error('disk full');
    },
  };
  const broken = createSessions({
    store: failing,
    audit: memoryAuditSink(),
    fingerprint: OLD,
    now: time.now,
    log: (entry) => logged.push(`${entry.level}:${entry.event}`),
  });
  const touched = await broken.touch(record, COMMAND);
  assert.deepEqual(touched, record);
  assert.deepEqual(logged, ['warn:session.touch_failed']);
  const unreadable = createSessions({
    store: {
      ...store,
      get: async () => {
        throw new Error('EIO');
      },
    },
    audit: memoryAuditSink(),
    fingerprint: OLD,
    now: time.now,
    log: (entry) => logged.push(`${entry.level}:${entry.event}`),
  });
  assert.equal(statusOf(await unreadable.resolve(token)), 'unavailable');
  assert.deepEqual(logged, ['warn:session.touch_failed', 'error:session.read_failed']);
  // The record is still there for the next request.
  assert.equal(statusOf(await sessions.resolve(token)), 'valid');
});

test('a sign-in whose record cannot be written fails, and leaves no session', async () => {
  const store = memorySessionStore();
  const { sessions } = setup({
    store: {
      ...store,
      put: async () => {
        throw new Error('read-only file system');
      },
    },
  });
  await assert.rejects(sessions.issue({ uaFamily: 'firefox' }), /read-only/);
  assert.deepEqual(await store.list(), []);
});

test('no cookie is no session, and a cookie that is not a token is an ended one', async () => {
  const { sessions } = setup();
  for (const token of [undefined, null, '']) {
    assert.equal(statusOf(await sessions.resolve(token)), 'none');
  }
  for (const token of ['forged', `${newSessionToken()}=`, 'x'.repeat(43)]) {
    assert.equal(
      statusOf(await sessions.resolve(token)),
      token.length === 43 ? 'ended:unknown' : 'ended:malformed',
    );
  }
  assert.equal(
    statusOf(await sessions.resolve(sessionDigest(newSessionToken()))),
    'ended:malformed',
  );
});

test('a session list shows a coarse browser family, never the user agent', () => {
  const cases: [string | null, string][] = [
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'firefox'],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'chrome',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      'edge',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      'safari',
    ],
    ['curl/8.9.1', 'other'],
    [null, 'other'],
  ];
  for (const [agent, family] of cases) assert.equal(browserFamily(agent), family, String(agent));
});
