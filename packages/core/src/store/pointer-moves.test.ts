import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { memoryAuditSink } from '../audit/sink';
import { revisionCatalogReader } from './reader';
import { claimServer } from './server-claim';
import { preflight } from './preflight';
import { nodeFs } from './fs-port';
import {
  contentVariant,
  mediaDocument,
  newStore,
  owned,
  pairInput,
  publishInput,
  testChecks,
} from './test-support/fixtures';
import { relativeImports } from './test-support/imports';

// What moves the published pointer (#3, item 20; threat publish-3): the
// PublicationService alone. The commit point, writeLive(), is in commit.ts,
// which only publication.ts imports; besides the module that names the
// store's paths, only four name the pointer's file, and three of them only
// read it; and every store operation outside the PublicationService leaves
// live.json as it was.

const STORE = fileURLToPath(new URL('.', import.meta.url));
const REPO = path.resolve(STORE, '../../../..');
const SOURCE_DIRS = ['apps/web/src', 'apps/web/scripts', 'apps/web/bin', 'packages'];
const SKIPPED = new Set(['node_modules', '__fixtures__', 'test-support', 'generated', 'dist']);

/** Every source file under `dir`, tests and their helpers aside. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : walk(full);
    if (!/\.[cm]?[jt]sx?$/.test(entry.name) || /\.(?:test|spec)\./.test(entry.name)) return [];
    return [full];
  });
}

/** Every source file of the app and the packages. */
const sources = () => SOURCE_DIRS.flatMap((dir) => walk(path.join(REPO, dir)));

/** A file's text without its comment lines, which may name anything. */
const code = (file: string) => readFileSync(file, 'utf8').replace(/^\s*(?:\/\/|\/\*|\*).*$/gm, '');

const relativeTo = (file: string) => path.relative(REPO, file).split(path.sep).join('/');

/** The bytes and inode of live.json, which a move over it changes. */
function pointerFile(file: string) {
  return { bytes: readFileSync(file).toString('utf8'), ino: statSync(file).ino };
}

test('no code outside PublicationService moves the published pointer', async (t) => {
  const files = sources();
  assert.ok(files.length > 100, `${files.length} source files`);

  // Only the PublicationService imports the commit point.
  const commit = path.join(STORE, 'commit.ts');
  assert.deepEqual(files.filter((file) => relativeImports(file).includes(commit)).map(relativeTo), [
    'packages/core/src/store/publication.ts',
  ]);
  assert.deepEqual(
    files
      .filter((file) => /\bfunction writeLive\b/.test(readFileSync(file, 'utf8')))
      .map(relativeTo),
    ['packages/core/src/store/commit.ts'],
  );
  // The pointer's file, by the store's paths: commit.ts writes it, and
  // pointer.ts and the reader only read it. No other module names it, or
  // names live.json at all; the service's repair finds a temporary one a
  // crash left by its name pattern.
  assert.deepEqual(
    files
      .filter((file) => /\bpaths\.(?:live|liveTemp)\b/.test(code(file)))
      .map(relativeTo)
      .sort(),
    [
      'packages/core/src/store/commit.ts',
      'packages/core/src/store/pointer.ts',
      'packages/core/src/store/reader.ts',
    ],
  );
  assert.deepEqual(
    files.filter((file) => /['"`]live\.json(?:\.tmp)?['"`]/.test(code(file))).map(relativeTo),
    ['packages/core/src/store/layout.ts'],
  );

  // And at run time: every store operation but the PublicationService's,
  // one after another, leaves live.json as it was.
  const store = await newStore(t, { audit: memoryAuditSink() });
  const live = await publishInput(store, pairInput('engineering'));
  const before = pointerFile(store.paths.live);
  const blob = await store.assets.put(Buffer.from('a blob'), 'text/plain');
  const created = await store.drafts.create(
    {
      documents: {
        ...contentVariant(pairInput('engineering'), 'draft'),
        media: mediaDocument([blob.sha256]),
      },
    },
    'owner',
  );
  assert.equal(created.kind, 'saved');
  if (created.kind !== 'saved') return;
  const saved = await store.drafts.save(
    {
      draftId: created.draft.draftId,
      expectedVersion: created.draft.version,
      documents: contentVariant(pairInput('engineering'), 'saved'),
    },
    'owner',
  );
  assert.equal(saved.kind, 'saved');
  if (saved.kind !== 'saved') return;
  const edited = await store.drafts.applyEdits(
    {
      draftId: saved.draft.draftId,
      expectedVersion: saved.draft.version,
      edits: [{ document: 'portfolio', pointer: '/meta/description', op: 'set', value: 'Edited.' }],
    },
    'owner',
  );
  assert.equal(edited.kind, 'saved');
  if (edited.kind !== 'saved') return;
  const rebased = await store.drafts.rebase(
    {
      draftId: edited.draft.draftId,
      expectedVersion: edited.draft.version,
      documents: pairInput('engineering'),
      baseRevisionId: live,
    },
    'owner',
  );
  assert.equal(rebased.kind, 'saved');
  if (rebased.kind !== 'saved') return;
  await store.lock.withLock('test', async () => {});
  const claim = await claimServer({ fs: nodeFs, paths: store.paths });
  assert.ok(claim.ok);
  if (claim.ok) await claim.claim.release();
  assert.equal(await preflight({ dataDir: store.paths.root }), null);
  const reader = revisionCatalogReader({ dataDir: store.paths.root, checks: testChecks() });
  await reader.getLive();
  await reader.status();
  const discarded = await store.drafts.discard(
    { draftId: rebased.draft.draftId, expectedVersion: rebased.draft.version },
    'owner',
  );
  assert.equal(discarded.kind, 'discarded');
  assert.deepEqual(pointerFile(store.paths.live), before);

  // The PublicationService does move it.
  const moved = await owned(store).recover(
    { targetRevisionId: live, expectedLiveRevisionId: live },
    'owner',
  );
  assert.equal(moved.kind === 'rejected' && moved.code, 'nothing_to_publish');
  await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  assert.notDeepEqual(pointerFile(store.paths.live), before);
});
