// Seeded secret and session canaries appear in no file in the data
// directory (#3, Slice 1), however the store and its CLI are used beside
// #2's auth state, nor in a backup or a store restored from one (Slice 3),
// and no revision, event, or backup manifest names a path.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { readPairBytes } from '@portfolio/schema/node';
import { credentialFingerprint } from '../auth/phc.mjs';
import { filesystemSessionStore } from '../auth/session-store';
import { createSessions } from '../auth/sessions';
import { csrfToken } from '../auth/token';
import { filesystemAuditSink } from '../audit/sink';
import { probeDataDirectory } from '../data/layout.mjs';
import { backupStore, restoreStore } from './backup';
import { readLive } from './pointer';
import { nodeFs } from './fs-port';
import { preflight } from './preflight';
import { openStore } from './store';
import { cli } from './test-support/cli';
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

/**
 * A data directory with #2's auth state beside every write the store makes,
 * the CLI's included, and the canaries none of its files may hold.
 */
async function everyWrite(t: TestContext) {
  const dataDir = tempDir(t);
  assert.equal(await probeDataDirectory(dataDir), null);
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
  if (created.kind !== 'saved') assert.fail(created.kind);
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
  if (second.kind !== 'committed') assert.fail(second.kind);
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

  // The CLI's writes: an import and retention.
  const source = tempDir(t, 'store-source-');
  const imported = contentVariant(pairInput('engineering'), 'imported');
  writeFileSync(path.join(source, 'portfolio.yml'), imported.portfolio.sourceText);
  writeFileSync(path.join(source, 'site.yml'), imported.site.sourceText);
  for (const argv of [['import', '--from', source], ['retention']]) {
    const run = await cli(argv, { dataDir, readSource: readPairBytes });
    assert.equal(run.code, 0, `${argv.join(' ')}: ${run.err}`);
  }
  assert.equal((await readLive(nodeFs, store.paths))?.seq, 5);
  return { dataDir, canaries, store };
}

/** No file under `root` holds a canary, and no store record there names a path. */
function scan(root: string, canaries: readonly string[], dataDir: string) {
  const files = filesUnder(root);
  for (const file of files) {
    const text = readFileSync(path.join(root, file), 'latin1');
    for (const canary of canaries) {
      assert.equal(text.includes(canary), false, `${file} holds a canary`);
    }
  }
  // Drafts go back over HTTP, so they name no path either.
  assert.ok(files.some((file) => file.startsWith('drafts/')));
  // The temporary directory holds the source directory the CLI imported from.
  const paths = [dataDir, root, SCHEMA_FIXTURES, homedir(), process.cwd(), tmpdir()];
  for (const file of files.filter((name) =>
    /^(revisions|publication|audit|drafts)\/|backup-manifest/.test(name),
  )) {
    const text = readFileSync(path.join(root, file), 'utf8');
    for (const where of paths) assert.equal(text.includes(where), false, `${file} names a path`);
  }
  return files;
}

test('seeded secret and session canaries appear in no file in the data directory, and no revision or event names a path', async (t) => {
  const { dataDir, canaries } = await everyWrite(t);
  const files = scan(dataDir, canaries, dataDir);
  assert.ok(files.some((file) => file.startsWith('audit/')));
  assert.ok(files.some((file) => file.startsWith('ephemeral/auth/sessions/')));
});

test('the canaries appear in no file of a backup, or of the store restored from it', async (t) => {
  const { dataDir, canaries, store } = await everyWrite(t);
  const out = path.join(tempDir(t, 'store-backup-'), 'b1');
  const backup = await backupStore({ fs: nodeFs, paths: store.paths, lock: store.lock }, out);
  assert.equal(backup.kind, 'done');
  const files = scan(out, canaries, dataDir);
  assert.ok(files.includes('backup-manifest.json'));
  assert.ok(files.some((file) => file.startsWith('audit/')));
  assert.equal(
    files.some((file) => file.startsWith('ephemeral/')),
    false,
  );
  const into = path.join(tempDir(t, 'store-restored-'), 'data');
  assert.equal((await restoreStore({ fs: nodeFs }, out, into)).kind, 'restored');
  scan(into, canaries, dataDir);
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
