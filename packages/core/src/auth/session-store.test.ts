import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { memoryAuditSink } from '../audit/sink';
import { authPaths, probeDataDirectory } from '../data/layout.mjs';
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
  assert.equal(await probeDataDirectory(dir), null);
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
  mkdirSync(authPaths(dir).sessions, { recursive: true, mode: 0o700 });
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

test('with no auth directory yet, the store reads as empty, and the first record write makes ephemeral/auth/sessions/ at 0700', async (t) => {
  const dir = await dataDir(t);
  const store = filesystemSessionStore(dir);
  const paths = authPaths(dir);
  assert.equal(existsSync(paths.ephemeral), false);
  assert.deepEqual(await store.list(), []);
  assert.equal(await store.get(record().digest), null);
  assert.equal(await store.delete(record().digest), false);
  assert.equal(await store.revokedBefore(), null);
  // Reading made nothing.
  assert.equal(existsSync(paths.ephemeral), false);

  const entry = record();
  await store.put(entry);
  for (const each of [paths.ephemeral, paths.auth, paths.sessions]) {
    assert.equal(statSync(each).mode & 0o777, 0o700, each);
  }
  assert.deepEqual(await store.get(entry.digest), entry);
});

test('revokeAll on a data directory with no auth directory makes ephemeral/auth/ at 0700 for revoked-before', async (t) => {
  const dir = await dataDir(t);
  const store = filesystemSessionStore(dir);
  const at = Date.UTC(2026, 9, 20, 12, 0, 0);
  assert.deepEqual(await store.revokeAll(at), []);
  const paths = authPaths(dir);
  for (const each of [paths.ephemeral, paths.auth]) {
    assert.equal(statSync(each).mode & 0o777, 0o700, each);
  }
  assert.equal(await store.revokedBefore(), at);
  assert.equal(existsSync(paths.sessions), false);
});

test('a session write refuses a link or a file in place of an auth directory, and writes nothing through it', async (t) => {
  const paths = (dir: string) => authPaths(dir);
  const cases: [what: string, arrange: (dir: string, elsewhere: string) => void][] = [
    ['ephemeral/ a link', (dir, elsewhere) => symlinkSync(elsewhere, paths(dir).ephemeral)],
    [
      'ephemeral/auth/ a link',
      (dir, elsewhere) => {
        mkdirSync(paths(dir).ephemeral, { mode: 0o700 });
        symlinkSync(elsewhere, paths(dir).auth);
      },
    ],
    [
      'ephemeral/auth/sessions/ a link',
      (dir, elsewhere) => {
        mkdirSync(paths(dir).auth, { recursive: true, mode: 0o700 });
        symlinkSync(elsewhere, paths(dir).sessions);
      },
    ],
    [
      'ephemeral/auth/ a file',
      (dir) => {
        mkdirSync(paths(dir).ephemeral, { mode: 0o700 });
        writeFileSync(paths(dir).auth, '');
      },
    ],
  ];
  for (const [what, arrange] of cases) {
    const dir = await dataDir(t);
    const elsewhere = mkdtempSync(path.join(tmpdir(), 'session-store-elsewhere-'));
    t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
    arrange(dir, elsewhere);
    const store = filesystemSessionStore(dir);
    await assert.rejects(store.put(record()), /is a link|isn't a directory/, what);
    // revoked-before sits in ephemeral/auth/, so only a fault at or above it stops revokeAll.
    if (!what.startsWith('ephemeral/auth/sessions/')) {
      await assert.rejects(store.revokeAll(Date.now()), /is a link|isn't a directory/);
    }
    assert.deepEqual(readdirSync(elsewhere), [], `${what}: something was written through it`);
  }
});

test('a session write puts an auth directory an operator loosened back to 0700, and the write goes through', async (t) => {
  const dir = await dataDir(t);
  const paths = authPaths(dir);
  mkdirSync(paths.sessions, { recursive: true, mode: 0o700 });
  chmodSync(paths.auth, 0o755);
  chmodSync(paths.sessions, 0o777);
  const store = filesystemSessionStore(dir);
  const entry = record();
  await store.put(entry);
  for (const each of [paths.auth, paths.sessions]) {
    assert.equal(statSync(each).mode & 0o777, 0o700, each);
  }
  assert.deepEqual(await store.get(entry.digest), entry);
  // And revoked-before's writer puts ephemeral/auth/ back too.
  chmodSync(paths.auth, 0o750);
  const at = Date.UTC(2026, 9, 20, 12, 0, 0);
  assert.deepEqual(await store.revokeAll(at), [entry.digest]);
  assert.equal(statSync(paths.auth).mode & 0o777, 0o700);
  assert.equal(await store.revokedBefore(), at);
});

test('a session write refuses an auth directory another user owns', async (t) => {
  const dir = await dataDir(t);
  mkdirSync(authPaths(dir).sessions, { recursive: true, mode: 0o700 });
  // Only root can chown, so the server runs as another user instead.
  const uid = process.getuid!();
  t.mock.method(process as { getuid: () => number }, 'getuid', () => uid + 1);
  await assert.rejects(filesystemSessionStore(dir).put(record()), /belongs to another user/);
  assert.deepEqual(readdirSync(authPaths(dir).sessions), []);
});
