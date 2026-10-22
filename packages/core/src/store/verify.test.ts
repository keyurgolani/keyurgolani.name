// `verify` (#3, item 26): every file of the store and every hash. Each kind
// of damage is a problem with the file it's in; what startup repair
// finishes is a note, and a whole store has neither problems nor notes.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { nodeFs } from './fs-port';
import { storePaths, type RevisionId, type Sha256 } from './layout';
import { readLive } from './pointer';
import { verifyStore, type StoreNoteCode, type StoreProblemCode } from './verify';
import {
  contentVariant,
  mediaDocument,
  newStore,
  pairInput,
  publishInput,
  tempDir,
  testChecks,
} from './test-support/fixtures';

interface Seeded {
  readonly root: string;
  readonly first: RevisionId;
  readonly live: RevisionId;
  readonly blob: Sha256;
  readonly draftFile: string;
}

async function seeded(t: TestContext): Promise<Seeded> {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const live = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  const { sha256: blob } = await store.assets.put(Buffer.from('an upload'), 'image/png');
  const draft = await store.drafts.create(
    { documents: { ...pairInput('engineering'), media: mediaDocument([blob]) } },
    'owner',
  );
  assert.equal(draft.kind, 'saved');
  const draftFile = draft.kind === 'saved' ? `drafts/${draft.draft.draftId}.json` : '';
  return { root: store.paths.root, first, live, blob, draftFile };
}

const verify = (root: string) =>
  verifyStore({ fs: nodeFs, paths: storePaths(root), checks: testChecks() });
const readFileText = (root: string, file: string) => readFileSync(path.join(root, file), 'utf8');

test('a whole store verifies with no problem and no note', async (t) => {
  const { root } = await seeded(t);
  const report = await verify(root);
  assert.deepEqual([report.problems, report.notes], [[], []]);
  assert.deepEqual(report.counts, { revisions: 2, tombstones: 0, events: 2, drafts: 1, blobs: 1 });
  assert.equal(report.live?.seq, 2);
});

test('verify names each kind of damage with its file, and only notes what repair finishes', async (t) => {
  const store = await seeded(t);
  const hex = store.blob.slice('sha256:'.length);
  const blobFile = `assets/sha256/${hex.slice(0, 2)}/${hex}`;
  // A finding about the pointer names no file: its code says it's the pointer.
  const cases: [
    string,
    (root: string) => void,
    [StoreProblemCode | StoreNoteCode, string | undefined][],
  ][] = [
    [
      'a changed document',
      (root) =>
        writeFileSync(
          path.join(root, `revisions/${store.first}/documents/portfolio.yml`),
          '# x\n',
          { flag: 'a' },
        ),
      [['revision_hash_mismatch', `revisions/${store.first}`]],
    ],
    [
      'a missing model',
      (root) => rmSync(path.join(root, `revisions/${store.first}/documents/site.model.json`)),
      [['revision_missing', `revisions/${store.first}`]],
    ],
    [
      'a file the manifest does not name',
      (root) => writeFileSync(path.join(root, `revisions/${store.first}/documents/extra.txt`), 'x'),
      [['revision_unexpected_file', `revisions/${store.first}/documents/extra.txt`]],
    ],
    [
      'a missing event',
      (root) => rmSync(path.join(root, 'publication/events/1.json')),
      [['event_missing', 'publication/events/1.json']],
    ],
    [
      'another event at the live seq',
      (root) =>
        writeFileSync(
          path.join(root, 'publication/events/2.json'),
          readFileText(root, 'publication/events/1.json').replace('"seq":1', '"seq":2'),
        ),
      [['event_mismatch', 'publication/events/2.json']],
    ],
    [
      'an event past live',
      (root) =>
        writeFileSync(
          path.join(root, 'publication/events/3.json'),
          readFileText(root, 'publication/events/2.json').replace('"seq":2', '"seq":3'),
        ),
      [['event_after_live', 'publication/events/3.json']],
    ],
    [
      'an event naming no revision',
      (root) => rmSync(path.join(root, `revisions/${store.first}`), { recursive: true }),
      [['event_revision_missing', 'publication/events/1.json']],
    ],
    [
      'an unreadable pointer',
      (root) => writeFileSync(path.join(root, 'publication/live.json'), '{'),
      [
        ['pointer_unreadable', undefined],
        ['event_after_live', 'publication/events/1.json'],
        ['event_after_live', 'publication/events/2.json'],
        ['pointer_missing', undefined],
      ],
    ],
    [
      'a pointer to no revision',
      (root) => rmSync(path.join(root, `revisions/${store.live}`), { recursive: true }),
      [
        ['live_missing', undefined],
        ['event_revision_missing', 'publication/events/2.json'],
        ['draft_base_missing', store.draftFile],
      ],
    ],
    [
      'a draft that does not read',
      (root) => writeFileSync(path.join(root, store.draftFile), '{'),
      [['draft_unreadable', store.draftFile]],
    ],
    [
      'a blob whose bytes changed',
      (root) => writeFileSync(path.join(root, blobFile), 'swapped'),
      [
        ['blob_hash_mismatch', blobFile],
        ['blob_missing', blobFile],
      ],
    ],
    [
      'a referenced blob that is gone',
      (root) => rmSync(path.join(root, blobFile)),
      [['blob_missing', blobFile]],
    ],
    [
      'an unknown file',
      (root) => writeFileSync(path.join(root, 'revisions/notes.txt'), 'x'),
      [['unexpected_file', 'revisions/notes.txt']],
    ],
    [
      'a missing store.json',
      (root) => rmSync(path.join(root, 'store.json')),
      [['store_layout_missing', 'store.json']],
    ],
    // Notes: a crash's leftovers, which repair removes or writes.
    [
      'a staging directory',
      (root) => mkdirSync(path.join(root, `revisions/.staging-${store.first}`)),
      [['staging_left', `revisions/.staging-${store.first}`]],
    ],
    [
      'a temporary file',
      (root) => writeFileSync(path.join(root, 'drafts/.x.json.abc.tmp'), ''),
      [['temp_left', 'drafts/.x.json.abc.tmp']],
    ],
    [
      'the live event file missing',
      (root) => rmSync(path.join(root, 'publication/events/2.json')),
      [['live_event_missing', 'publication/events/2.json']],
    ],
  ];
  for (const [what, change, expected] of cases) {
    const root = path.join(tempDir(t, 'store-verify-'), 'data');
    cpSync(store.root, root, { recursive: true });
    change(root);
    const report = await verify(root);
    const found = [...report.problems, ...report.notes].map((finding) => [
      finding.code,
      finding.path,
    ]);
    assert.deepEqual(found.sort(), [...expected].sort(), what);
  }
  // The store the copies came from is untouched.
  assert.deepEqual((await verify(store.root)).problems, []);
  assert.equal((await readLive(nodeFs, storePaths(store.root)))?.revisionId, store.live);
});
