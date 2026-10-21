import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { memoryAuditSink } from '../audit/sink';
import { authPaths, prepareAuthDirectories } from '../data/layout.mjs';
import { revokeAllSessionFiles } from './session-files.mjs';
import {
  filesystemSessionStore,
  memorySessionStore,
  type SessionRecord,
  type SessionStore,
} from './session-store';
import { createSessions } from './sessions';
import { newSessionToken, sessionDigest } from './token';

const FINGERPRINT = 'MKhpw6F1Y5AkDvbeT_fgmw';

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const at = Date.UTC(2026, 9, 20, 12, 0, 0);
  return {
    digest: sessionDigest(newSessionToken()),
    createdAt: at,
    lastSeenAt: at + 1_000,
    absoluteExpiresAt: at + 12 * 3_600_000,
    credentialFingerprint: FINGERPRINT,
    uaFamily: 'firefox',
    ...overrides,
  };
}

async function dataDir(t: TestContext): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'session-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(await prepareAuthDirectories(dir), null);
  return dir;
}

const adapters: [name: string, open: (t: TestContext) => Promise<SessionStore>][] = [
  ['memory', async () => memorySessionStore()],
  ['filesystem', async (t) => filesystemSessionStore(await dataDir(t))],
];

for (const [name, open] of adapters) {
  test(`the ${name} store puts, gets, lists, and deletes records by digest, and refuses anything else as a key`, async (t) => {
    const store = await open(t);
    const first = record();
    const second = record({ uaFamily: 'safari' });
    await store.put(first);
    await store.put(second);
    assert.deepEqual(await store.get(first.digest), first);
    assert.deepEqual(
      (await store.list()).map((entry) => entry.digest).sort(),
      [first.digest, second.digest].sort(),
    );
    const moved = { ...first, lastSeenAt: first.lastSeenAt + 60_000 };
    await store.put(moved);
    assert.deepEqual(await store.get(first.digest), moved);
    assert.equal(await store.delete(first.digest), true);
    assert.equal(await store.delete(first.digest), false);
    assert.equal(await store.get(first.digest), null);
    for (const key of ['../escape', `${first.digest}x`, first.digest.toUpperCase(), '']) {
      await assert.rejects(store.get(key), TypeError, key);
      await assert.rejects(store.delete(key), TypeError, key);
      await assert.rejects(store.put({ ...first, digest: key }), TypeError, key);
    }
  });

  test(`the ${name} store revokes every session: revokedBefore first, then no record`, async (t) => {
    const store = await open(t);
    assert.equal(await store.revokedBefore(), null);
    const kept = [record(), record()];
    for (const entry of kept) await store.put(entry);
    const at = Date.UTC(2026, 9, 20, 13, 0, 0);
    const deleted = await store.revokeAll(at);
    assert.deepEqual(deleted.sort(), kept.map((entry) => entry.digest).sort());
    assert.equal(await store.revokedBefore(), at);
    assert.deepEqual(await store.list(), []);
  });
}

test('a record on disk is a 0600 file in a 0700 directory, named for its digest, holding no token', async (t) => {
  const dir = await dataDir(t);
  const store = filesystemSessionStore(dir);
  const token = newSessionToken();
  const entry = record({ digest: sessionDigest(token) });
  await store.put(entry);
  const { sessions, auth, ephemeral } = authPaths(dir);
  for (const directory of [ephemeral, auth, sessions]) {
    assert.equal(statSync(directory).mode & 0o777, 0o700, directory);
  }
  assert.deepEqual(readdirSync(sessions), [`${entry.digest}.json`]);
  const file = path.join(sessions, `${entry.digest}.json`);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const text = readFileSync(file, 'utf8');
  assert.ok(!text.includes(token), 'the file holds the token');
  assert.deepEqual(JSON.parse(text), {
    v: 1,
    createdAt: '2026-10-20T12:00:00.000Z',
    lastSeenAt: '2026-10-20T12:00:01.000Z',
    absoluteExpiresAt: '2026-10-21T00:00:00.000Z',
    credentialFingerprint: FINGERPRINT,
    uaFamily: 'firefox',
  });
});

test('a damaged revoked-before file makes the store unavailable, so no session counts, until revoke-sessions writes it again', async (t) => {
  const dir = await dataDir(t);
  let at = Date.UTC(2026, 9, 20, 12, 0, 0);
  const now = () => at;
  const logged: string[] = [];
  const sessions = createSessions({
    store: filesystemSessionStore(dir),
    audit: memoryAuditSink(now),
    fingerprint: FINGERPRINT,
    now,
    log: (entry) => logged.push(entry.event),
  });
  const { token } = await sessions.issue({ uaFamily: 'firefox' });
  writeFileSync(authPaths(dir).revokedBefore, 'not a time\n');
  at += 1_000;
  // Never read as "nothing was revoked": no session, and no new one either.
  assert.equal((await sessions.resolve(token)).status, 'unavailable');
  assert.deepEqual(logged, ['session.read_failed']);
  await assert.rejects(sessions.issue({ uaFamily: 'firefox' }));
  // revoke-sessions writes it again, and a sign-in after that counts.
  await revokeAllSessionFiles(dir, at);
  at += 1_000;
  const fresh = await sessions.issue({ uaFamily: 'firefox' });
  assert.equal((await sessions.resolve(fresh.token)).status, 'valid');
  assert.equal((await sessions.resolve(token)).status, 'ended');
});

test('a session file that is not a record counts as none, and is deleted', async (t) => {
  const dir = await dataDir(t);
  const store = filesystemSessionStore(dir);
  const good = JSON.parse(
    JSON.stringify({
      v: 1,
      createdAt: '2026-10-20T12:00:00.000Z',
      lastSeenAt: '2026-10-20T12:00:01.000Z',
      absoluteExpiresAt: '2026-10-21T00:00:00.000Z',
      credentialFingerprint: FINGERPRINT,
      uaFamily: 'firefox',
    }),
  );
  const bad = [
    'not json',
    'null',
    JSON.stringify({ ...good, v: 2 }),
    JSON.stringify({ ...good, createdAt: 'yesterday' }),
    JSON.stringify({ ...good, credentialFingerprint: 'short' }),
    JSON.stringify({ ...good, uaFamily: 'Mozilla/5.0 (X11; Linux x86_64)' }),
  ];
  for (const text of bad) {
    const digest = sessionDigest(newSessionToken());
    const file = path.join(authPaths(dir).sessions, `${digest}.json`);
    writeFileSync(file, text);
    assert.equal(await store.get(digest), null, text);
    assert.throws(() => statSync(file), { code: 'ENOENT' }, text);
  }
});

test('a record write replaces the file whole, and leaves no temporary file', async (t) => {
  const dir = await dataDir(t);
  const store = filesystemSessionStore(dir);
  const entry = record();
  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      store.put({ ...entry, lastSeenAt: entry.lastSeenAt + index }),
    ),
  );
  assert.deepEqual(readdirSync(authPaths(dir).sessions), [`${entry.digest}.json`]);
  const kept = await store.get(entry.digest);
  assert.ok(kept && kept.lastSeenAt >= entry.lastSeenAt && kept.lastSeenAt < entry.lastSeenAt + 20);
});
