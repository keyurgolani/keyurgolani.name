import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { memoryAuditSink } from '../audit/sink';
import { authPaths, prepareAuthDirectories } from '../data/layout.mjs';
import { syncCredentialFingerprint } from './fingerprint';
import { filesystemSessionStore } from './session-store';
import { createSessions } from './sessions';

const A = 'MKhpw6F1Y5AkDvbeT_fgmw';
const B = 'qJ3x0bQd9kVb4m2ZcLw8Tg';

test('a new hash at owner startup appends credential_changed by the operator, and a first start writes the fingerprint with no event', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fingerprint-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(await prepareAuthDirectories(dir), null);
  const audit = memoryAuditSink();
  const file = authPaths(dir).fingerprint;
  const sync = (fingerprint: string) =>
    syncCredentialFingerprint({ dataDir: dir, fingerprint, audit });

  assert.equal(await sync('MKhpw6F1Y5AkDvbeT_fgmw'), 'written');
  assert.equal(readFileSync(file, 'utf8'), 'MKhpw6F1Y5AkDvbeT_fgmw\n');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(await sync('MKhpw6F1Y5AkDvbeT_fgmw'), 'same');
  assert.deepEqual(audit.records, []);

  assert.equal(await sync('qJ3x0bQd9kVb4m2ZcLw8Tg'), 'changed');
  assert.equal(readFileSync(file, 'utf8'), 'qJ3x0bQd9kVb4m2ZcLw8Tg\n');
  assert.deepEqual(
    audit.records.map(({ type, actor, outcome, refs }) => ({ type, actor, outcome, refs })),
    [{ type: 'credential_changed', actor: 'operator', outcome: 'success', refs: {} }],
  );
  // The record names no fingerprint, old or new.
  assert.ok(!JSON.stringify(audit.records).includes('MKhpw6F1'));
});

test('a session signed in under one hash stays signed out after the hash changes and changes back', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fingerprint-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(await prepareAuthDirectories(dir), null);
  let at = Date.UTC(2026, 9, 20, 9, 0, 0);
  const now = () => at;
  const audit = memoryAuditSink(now);
  /** A restart under `fingerprint`: the sync, then the sessions. */
  const start = async (fingerprint: string) => {
    await syncCredentialFingerprint({ dataDir: dir, fingerprint, audit, now });
    return createSessions({ store: filesystemSessionStore(dir), audit, fingerprint, now });
  };
  const underA = await start(A);
  const stolen = await underA.issue({ uaFamily: 'firefox' });
  const other = await underA.issue({ uaFamily: 'safari' });
  at += 60_000;
  assert.equal((await underA.resolve(stolen.token)).status, 'valid');
  // A to B: no session signed in under A counts.
  at += 60_000;
  const underB = await start(B);
  assert.equal((await underB.resolve(other.token)).status, 'ended');
  // B back to A, with the stolen session never sent while B was configured,
  // so nothing deleted its record on the way: it still counts for nothing.
  at += 60_000;
  const backToA = await start(A);
  const resolved = await backToA.resolve(stolen.token);
  assert.equal(resolved.status, 'ended');
  // And a fresh sign-in under A works.
  at += 60_000;
  const fresh = await backToA.issue({ uaFamily: 'firefox' });
  assert.equal((await backToA.resolve(fresh.token)).status, 'valid');
  assert.deepEqual(
    audit.records.filter((record) => record.type === 'credential_changed').length,
    2,
  );
});

test('an empty fingerprint file is no fingerprint: it is written, and nothing is revoked or audited', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fingerprint-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(await prepareAuthDirectories(dir), null);
  writeFileSync(authPaths(dir).fingerprint, '\n');
  const audit = memoryAuditSink();
  assert.equal(await syncCredentialFingerprint({ dataDir: dir, fingerprint: A, audit }), 'written');
  assert.deepEqual(audit.records, []);
  assert.equal(readFileSync(authPaths(dir).fingerprint, 'utf8'), `${A}\n`);
});
