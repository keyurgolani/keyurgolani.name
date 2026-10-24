import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from './documents';
import {
  draftSession,
  expectedVersion,
  INITIAL_SESSION,
  isDirty,
  type DraftSession,
  type SessionAction,
} from './draft-session';
import type { JournalEntry } from './journal';
import { draft, LIVE_REVISION, OTHER_DRAFT_ID } from './test-support';

// The editing session over #3's working draft (#8, Slice 1): a save carries
// the version Studio read, a stale one meets the newer version without
// overwriting it, and both stay recoverable until the owner chooses.

const LIVE = {
  state: 'live',
  liveRevisionId: LIVE_REVISION,
  servingRevisionId: LIVE_REVISION,
  seq: 4,
} as const;

const run = (actions: readonly SessionAction[], from: DraftSession = INITIAL_SESSION) =>
  actions.reduce(draftSession, from);

const loaded = (version = 2, journal: JournalEntry | null = null): SessionAction => ({
  type: 'loaded',
  draft: draft(version),
  live: LIVE,
  journal,
});

const mine = (text: string): SessionAction => ({
  type: 'edited',
  name: 'portfolio',
  sourceText: text,
});

test('a loaded draft is clean, and an edit is unsaved until a save returns it', () => {
  const ready = run([loaded()]);
  assert.equal(ready.phase, 'ready');
  assert.equal(isDirty(ready), false);
  assert.equal(expectedVersion(ready), 2);
  const edited = run([mine('schemaVersion: 3\n# mine\n')], ready);
  assert.equal(isDirty(edited), true);
  const saved = run(
    [{ type: 'save-started' }, { type: 'saved', draft: draft(3, 'schemaVersion: 3\n# mine\n') }],
    edited,
  );
  assert.equal(isDirty(saved), false);
  assert.equal(expectedVersion(saved), 3, 'the next save carries the version it returned');
});

test("a stale save meets the newer version, and neither the newer draft nor this tab's text is lost", () => {
  const edited = run([loaded(2), mine('schemaVersion: 3\n# mine\n')]);
  const conflicted = run(
    [
      { type: 'save-started' },
      { type: 'conflicted', theirs: draft(3, 'schemaVersion: 3\n# theirs\n') },
    ],
    edited,
  );
  // This tab still holds its text, and still names version 2 as what it read.
  assert.equal(conflicted.local!.portfolio.sourceText, 'schemaVersion: 3\n# mine\n');
  assert.equal(expectedVersion(conflicted), 2);
  // The newer draft is held whole, the draft's other fields with it.
  assert.equal(conflicted.conflict!.version, 3);
  assert.equal(conflicted.conflict!.documents.portfolio.sourceText, 'schemaVersion: 3\n# theirs\n');
  assert.equal(conflicted.conflict!.baseRevisionId, edited.draft!.baseRevisionId);
  assert.equal(conflicted.saving, false);
});

test('keep mine saves on top of the newer version; take theirs puts it in the editor', () => {
  const conflicted = run([
    loaded(2),
    mine('schemaVersion: 3\n# mine\n'),
    { type: 'conflicted', theirs: draft(3, 'schemaVersion: 3\n# theirs\n') },
  ]);
  const kept = run([{ type: 'keep-mine' }], conflicted);
  assert.equal(kept.conflict, null);
  assert.equal(expectedVersion(kept), 3, 'the next save goes over version 3');
  assert.equal(kept.local!.portfolio.sourceText, 'schemaVersion: 3\n# mine\n');
  assert.equal(isDirty(kept), true);

  const taken = run([{ type: 'take-theirs' }], conflicted);
  assert.equal(taken.conflict, null);
  assert.equal(expectedVersion(taken), 3);
  assert.equal(taken.local!.portfolio.sourceText, 'schemaVersion: 3\n# theirs\n');
  assert.equal(isDirty(taken), false);
});

test("this browser's journal comes back over the saved draft, and as a conflict when another tab saved since", () => {
  const documents = {
    ...sourceOf(draft(2)),
    portfolio: { format: 'yaml', sourceText: 'mine\n' },
  } as const;
  const entry = (baseVersion: number): JournalEntry => ({
    tabId: 'tab-aaaaaaaa',
    draftId: draft(2).draftId,
    baseVersion,
    documents,
    savedAt: 0,
  });
  const restored = run([loaded(2, entry(2))]);
  assert.equal(restored.restored, true);
  assert.equal(restored.local!.portfolio.sourceText, 'mine\n');
  assert.equal(restored.conflict, null);
  assert.equal(isDirty(restored), true);

  const behind = run([loaded(3, entry(2))]);
  assert.equal(behind.local!.portfolio.sourceText, 'mine\n', 'the journal is still in the editor');
  assert.equal(behind.conflict!.version, 3, 'version 3 is the conflict to resolve');

  // A journal that says what the draft already says is nothing to restore.
  const same = run([loaded(2, { ...entry(2), documents: sourceOf(draft(2)) })]);
  assert.equal(same.restored, false);
});

test("a journal for a draft that isn't the working one is kept aside until the owner takes it or lets it go", () => {
  const orphan: JournalEntry = {
    tabId: 'tab-bbbbbbbb',
    draftId: OTHER_DRAFT_ID,
    baseVersion: 5,
    documents: { ...sourceOf(draft(5)), portfolio: { format: 'yaml', sourceText: 'old\n' } },
    savedAt: 0,
  };
  const withMedia: SessionAction = {
    type: 'loaded',
    draft: draft(1, 'schemaVersion: 3\n', { media: 'assets: []\n' }),
    live: LIVE,
    journal: orphan,
  };
  const aside = run([withMedia]);
  assert.equal(aside.orphan, orphan);
  assert.equal(aside.local!.portfolio.sourceText, 'schemaVersion: 3\n');
  const adopted = run([{ type: 'adopt-orphan' }], aside);
  assert.equal(adopted.orphan, null);
  assert.equal(adopted.local!.portfolio.sourceText, 'old\n');
  // The working draft's media document stays, since a save replaces every document.
  assert.equal(adopted.local!.media!.sourceText, 'assets: []\n');
  assert.equal(run([{ type: 'drop-orphan' }], aside).orphan, null);
});

test('a media document is edited and saved with the rest', () => {
  const ready = run([
    {
      type: 'loaded',
      draft: draft(1, 'p\n', { media: 'assets: []\n' }),
      live: LIVE,
      journal: null,
    },
    { type: 'edited', name: 'media', sourceText: 'assets:\n  - id: a\n' },
  ]);
  assert.equal(ready.local!.media!.sourceText, 'assets:\n  - id: a\n');
  assert.equal(isDirty(ready), true);
  // A draft without one takes no edit to it.
  const none = run([loaded(1), { type: 'edited', name: 'media', sourceText: 'x' }]);
  assert.equal(none.local!.media, undefined);
});

test('a draft started from the live revision takes its text into the editor', () => {
  const empty = run([{ type: 'loaded', draft: null, live: LIVE, journal: null }]);
  assert.equal(empty.local, null);
  assert.equal(isDirty(empty), false);
  const started = run([{ type: 'saved', draft: draft(1) }], empty);
  assert.deepEqual(started.local, sourceOf(draft(1)));
  assert.equal(isDirty(started), false);
});

test('an ended session drops the draft, the editor, and the live state, and takes nothing more but a load', () => {
  const ended = run([loaded(), mine('x'), { type: 'expired' }]);
  assert.equal(ended.phase, 'expired');
  assert.equal(ended.draft, null);
  assert.equal(ended.local, null);
  assert.equal(ended.live, null);
  assert.equal(run([mine('y'), { type: 'saved', draft: draft(9) }], ended), ended);
  assert.equal(run([loaded()], ended).phase, 'ready');
});
