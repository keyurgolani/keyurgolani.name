import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  asEnvironment,
  asSubject,
  filesystemGrantStore,
  memoryGrantStore,
  parseGrant,
  previewPaths,
  serializeGrant,
  type GrantRecord,
} from './grant-store';
import {
  grantDigest,
  grantRef,
  isGrantDigest,
  isGrantToken,
  newChannelNonce,
  newGrantToken,
} from './token';

// The grant store's records on disk (#7, Slice 2): what a record holds, the
// text it's kept as, and what counts as a damaged one. grants.test.ts runs
// the store under the grant service.

const AT = Date.UTC(2026, 9, 22, 12, 0, 0);

function record(overrides: Partial<GrantRecord> = {}): GrantRecord {
  const token = newGrantToken();
  return {
    digest: grantDigest(token),
    sessionDigest: grantDigest('a session'),
    profile: 'owner',
    studioOrigin: 'https://rowan.test',
    nonce: newChannelNonce(),
    subject: { kind: 'draft', draftId: `drf_${'a'.repeat(32)}`, version: 3 },
    documents: {
      portfolio: { format: 'yaml', sourceText: 'identity:\n  name: Rowan\n' },
      site: { format: 'json', sourceText: '{}\n' },
    },
    schemes: { brand: { generator: { id: 'fixture-seed', version: 1 } } },
    appearance: { variant: 'editorial' },
    environment: { displayMode: 'system', contrast: 'system', motion: 'system', enhancement: 'on' },
    createdAt: AT,
    renewedAt: AT + 1000,
    absoluteExpiresAt: AT + 7_200_000,
    state: 'active',
    ...overrides,
  };
}

test('a grant token is 16 random bytes of base64url, named by its SHA-256 digest and an 8-character ref', () => {
  const tokens = new Set(Array.from({ length: 200 }, newGrantToken));
  assert.equal(tokens.size, 200);
  for (const token of tokens) {
    assert.ok(isGrantToken(token));
    assert.equal(Buffer.from(token, 'base64url').length, 16);
    assert.ok(isGrantDigest(grantDigest(token)));
  }
  assert.equal(grantRef('0123456789abcdef'.repeat(4)), '01234567');
  for (const value of [
    undefined,
    '',
    'local',
    'dev',
    'x'.repeat(21),
    'x'.repeat(23),
    `${'x'.repeat(21)}=`,
  ]) {
    assert.equal(isGrantToken(value), false, String(value));
  }
  assert.equal(isGrantDigest('A'.repeat(64)), false);
});

test("a grant record keeps its times in ISO 8601 and no digest, which is its file's name, and reads back as written", () => {
  const written = record();
  const text = serializeGrant(written);
  assert.ok(!text.includes(written.digest));
  assert.match(text, /"createdAt":"2026-10-22T12:00:00\.000Z"/);
  assert.deepEqual(parseGrant(written.digest, text), written);
  // An ended grant drops its documents, and one with no override has none.
  const bare: { -readonly [K in keyof GrantRecord]?: GrantRecord[K] } = { ...record() };
  delete bare.documents;
  delete bare.schemes;
  delete bare.appearance;
  const ended = { ...(bare as GrantRecord), state: 'session_ended' as const };
  assert.deepEqual(parseGrant(ended.digest, serializeGrant(ended)), ended);
});

test('a record with any field missing, of the wrong type, or out of its set reads as no record', () => {
  const written = record();
  const fields = JSON.parse(serializeGrant(written)) as Record<string, unknown>;
  const broken: Record<string, unknown>[] = [
    { ...fields, v: 2 },
    { ...fields, sessionDigest: 'nope' },
    { ...fields, nonce: 'short' },
    { ...fields, subject: { kind: 'draft', draftId: 'drf_x', version: 1 } },
    { ...fields, subject: { kind: 'revision', revisionId: '../etc' } },
    { ...fields, subject: { kind: 'fixture', fixture: 'Complete' } },
    { ...fields, subject: { kind: 'other' } },
    { ...fields, environment: { ...(fields.environment as object), motion: 'full' } },
    { ...fields, environment: { ...(fields.environment as object), extra: 1 } },
    { ...fields, documents: { portfolio: { format: 'toml', sourceText: '' } } },
    { ...fields, documents: { ...(fields.documents as object), extra: {} } },
    { ...fields, appearance: ['editorial'] },
    // Pinned schemes are an object, and only beside the documents they were minted with.
    { ...fields, schemes: ['brand'] },
    { ...fields, documents: undefined },
    { ...fields, createdAt: 'yesterday' },
    { ...fields, state: 'expired' },
  ];
  for (const value of broken) {
    assert.equal(parseGrant(written.digest, JSON.stringify(value)), null, JSON.stringify(value));
  }
  assert.equal(parseGrant(written.digest, '{'), null);
  assert.equal(parseGrant('not-a-digest', serializeGrant(written)), null);
  assert.equal(asSubject({ kind: 'draft', draftId: `drf_${'a'.repeat(32)}`, version: 0 }), null);
  assert.equal(asEnvironment(null), null);
});

test('the memory store refuses a record its file could not hold, and both stores refuse a path made from a bad name', async () => {
  const memory = memoryGrantStore();
  await assert.rejects(memory.put(record({ nonce: 'short' })), TypeError);
  await assert.rejects(memory.get('../x'), TypeError);
  await assert.rejects(memory.newestDraftVersion('drf_../../x' as `drf_${string}`), TypeError);

  const dir = mkdtempSync(path.join(tmpdir(), 'grant-store-'));
  try {
    const store = filesystemGrantStore(dir);
    await assert.rejects(store.get('../../etc/passwd'), TypeError);
    await assert.rejects(store.put(record({ digest: '../x' })), TypeError);
    await assert.rejects(store.setNewestDraftVersion(`drf_${'a'.repeat(32)}`, 0), TypeError);
    // Files that aren't records are left alone, and listing skips them.
    const written = record();
    await store.put(written);
    writeFileSync(path.join(previewPaths(dir).grants, 'notes.txt'), 'hello\n');
    assert.deepEqual(await store.list(), [written]);
    assert.ok(readdirSync(previewPaths(dir).grants).includes('notes.txt'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
