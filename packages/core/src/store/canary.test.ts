// Seeded secret and session canaries appear in no file in the data
// directory (#3, Slice 1), however the store is used beside #2's auth state,
// and no revision or event names a path. A backup's own scan is Slice 3's.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { credentialFingerprint } from '../auth/phc.mjs';
import { filesystemSessionStore } from '../auth/session-store';
import { createSessions } from '../auth/sessions';
import { csrfToken } from '../auth/token';
import { filesystemAuditSink } from '../audit/sink';
import { prepareAuthDirectories } from '../data/layout.mjs';
import { readLive } from './pointer';
import { nodeFs } from './fs-port';
import { preflight } from './preflight';
import { openStore } from './store';
import {
  contentVariant,
  filesUnder,
  mediaDocument,
  owned,
  pairInput,
  publishInput,
  SCHEMA_FIXTURES,
  tempDir,
  testChecks,
} from './test-support/fixtures';

const base64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');

test('seeded secret and session canaries appear in no file in the data directory, and no revision or event names a path', async (t) => {
  const dataDir = tempDir(t);
  assert.equal(await prepareAuthDirectories(dataDir), null);
  assert.equal(await preflight({ dataDir }), null);

  // What the server holds that a revision must never: the password hash and
  // a GitHub token from its environment, and a session's token and CSRF token.
  const hash = `$scrypt$ln=17,r=8,p=1$${base64(randomBytes(16))}$${base64(randomBytes(32))}`;
  const githubToken = `ghp_${randomBytes(24).toString('hex')}`;
  const saved = { hash: process.env.PORTFOLIO_AUTH_PASSWORD_HASH, token: process.env.GITHUB_TOKEN };
  process.env.PORTFOLIO_AUTH_PASSWORD_HASH = hash;
  process.env.GITHUB_TOKEN = githubToken;
  t.after(() => {
    for (const [key, value] of [
      ['PORTFOLIO_AUTH_PASSWORD_HASH', saved.hash],
      ['GITHUB_TOKEN', saved.token],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const audit = filesystemAuditSink({ dataDir });
  const sessions = createSessions({
    store: filesystemSessionStore(dataDir),
    audit,
    fingerprint: credentialFingerprint(hash),
  });
  const { token } = await sessions.issue({ uaFamily: 'firefox' });
  const canaries = [hash, githubToken, token, csrfToken(token)];

  // Every write the store makes, beside the session.
  const store = openStore({ dataDir, checks: testChecks(), audit });
  const first = await publishInput(store, pairInput('engineering'));
  const blob = await store.assets.put(Buffer.from('a photograph'), 'image/jpeg');
  const created = await store.drafts.create(
    {
      documents: {
        ...contentVariant(pairInput('engineering'), 'two'),
        media: mediaDocument([blob.sha256]),
      },
      expectedVersion: undefined,
    },
    'owner',
  );
  assert.equal(created.kind, 'saved');
  if (created.kind !== 'saved') return;
  const edited = await store.drafts.applyEdits(
    {
      draftId: created.draft.draftId,
      expectedVersion: 1,
      edits: [{ document: 'portfolio', pointer: '/identity/tagline', op: 'set', value: 'Edited' }],
    },
    'owner',
  );
  assert.equal(edited.kind, 'saved');
  const second = await owned(store).publish(
    {
      draftId: created.draft.draftId,
      draftVersion: 2,
      expectedLiveRevisionId: first,
      idempotencyKey: 'canary-1',
    },
    'owner',
    { requestId: 'req-canary' },
  );
  assert.equal(second.kind, 'committed');
  if (second.kind !== 'committed') return;
  await owned(store).rollback(
    { targetRevisionId: first, expectedLiveRevisionId: second.revisionId, reason: 'Checking' },
    'owner',
  );
  await owned(store).recover(
    { expectedLiveRevisionId: first, targetRevisionId: second.revisionId },
    'operator',
  );
  await store.publication.repair();
  await store.drafts.create({}, 'owner');
  assert.equal((await readLive(nodeFs, store.paths))?.seq, 4);

  const files = filesUnder(dataDir);
  assert.ok(files.some((file) => file.startsWith('audit/')));
  assert.ok(files.some((file) => file.startsWith('ephemeral/auth/sessions/')));
  for (const file of files) {
    const text = readFileSync(path.join(dataDir, file), 'latin1');
    for (const canary of canaries) {
      assert.equal(text.includes(canary), false, `${file} holds a canary`);
    }
  }
  // Drafts go back over HTTP, so they name no path either.
  assert.ok(files.some((file) => file.startsWith('drafts/')));
  const paths = [dataDir, SCHEMA_FIXTURES, homedir(), process.cwd()];
  for (const file of files.filter((name) => /^(revisions|publication|audit|drafts)\//.test(name))) {
    const text = readFileSync(path.join(dataDir, file), 'utf8');
    for (const where of paths) assert.equal(text.includes(where), false, `${file} names a path`);
  }
});

test('a document holding a secret saves as a draft but never publishes', async (t) => {
  const dataDir = tempDir(t);
  assert.equal(await preflight({ dataDir }), null);
  const store = openStore({ dataDir, checks: testChecks() });
  const first = await publishInput(store, pairInput('engineering'));
  const token = `ghp_${randomBytes(24).toString('hex')}`;
  const created = await store.drafts.create(
    {
      documents: contentVariant(pairInput('engineering'), `with ${token} pasted in`),
      expectedVersion: undefined,
    },
    'owner',
  );
  assert.equal(created.kind, 'saved');
  if (created.kind !== 'saved') return;
  const outcome = await owned(store).publish(
    { draftId: created.draft.draftId, draftVersion: 1, expectedLiveRevisionId: first },
    'owner',
  );
  assert.equal(outcome.kind === 'rejected' && outcome.code, 'validation_failed');
  assert.ok(
    outcome.kind === 'rejected' && outcome.diagnostics.some((d) => d.code === 'secret.detected'),
  );
  for (const file of filesUnder(store.paths.revisions)) {
    assert.equal(
      readFileSync(path.join(store.paths.revisions, file), 'utf8').includes(token),
      false,
      file,
    );
  }
});
