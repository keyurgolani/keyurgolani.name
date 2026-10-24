import test from 'node:test';
import assert from 'node:assert/strict';
import {
  draftSession,
  INITIAL_SESSION,
  type DraftSession,
  type SessionAction,
} from './draft-session';
import { stateLines, type StateId } from './state-model';
import { BASE_REVISION, BLOCKING, draft, LIVE_REVISION, WARNING } from './test-support';

// The textual state model (#8, Slice 1; AC1): seven lines, always, and each
// state the owner has to tell apart says so in words, so no two states
// read the same and none is told by tone alone.

const live = (revision: string | null, state: 'live' | 'empty' | 'degraded' = 'live') => ({
  state,
  liveRevisionId: revision,
  servingRevisionId: state === 'degraded' ? BASE_REVISION : revision,
  seq: revision ? 4 : null,
});

const session = (actions: readonly SessionAction[]): DraftSession =>
  actions.reduce(draftSession, INITIAL_SESSION);

const text = (from: DraftSession, id: StateId) =>
  stateLines(from).find((line) => line.id === id)!.text;

const SAVED = session([
  { type: 'loaded', draft: draft(2), live: live(BASE_REVISION), journal: null },
]);
const DIRTY = session([
  { type: 'loaded', draft: draft(2), live: live(BASE_REVISION), journal: null },
  { type: 'edited', name: 'portfolio', sourceText: 'changed\n' },
]);
const FAILED = session([
  {
    type: 'loaded',
    draft: draft(2, 'p\n', { diagnostics: [BLOCKING, WARNING] }),
    live: live(BASE_REVISION),
    journal: null,
  },
]);

test('there are seven lines, one per state, in order', () => {
  assert.deepEqual(
    stateLines(SAVED).map((line) => line.id),
    ['local', 'draft', 'preview', 'checks', 'publish', 'published', 'live'],
  );
});

test('local unsaved edits, a saved draft, and no draft at all each read differently', () => {
  assert.equal(text(SAVED, 'local'), 'No unsaved changes.');
  assert.equal(text(DIRTY, 'local'), 'Unsaved changes, kept in this browser until you save.');
  assert.equal(text(SAVED, 'draft'), 'Saved draft, version 2.');
  const none = session([{ type: 'loaded', draft: null, live: live(null, 'empty'), journal: null }]);
  assert.equal(text(none, 'draft'), 'No saved draft yet.');
  const conflicted = session([
    { type: 'loaded', draft: draft(2), live: live(BASE_REVISION), journal: null },
    { type: 'edited', name: 'portfolio', sourceText: 'mine\n' },
    { type: 'conflicted', theirs: draft(3) },
  ]);
  assert.match(text(conflicted, 'local'), /conflict with a newer saved draft/);
});

test('a preview is never live, and says what it shows', () => {
  assert.equal(text(SAVED, 'preview'), 'A preview shows the saved draft, and is never live.');
  assert.equal(
    text(DIRTY, 'preview'),
    'A preview shows the saved draft, not your unsaved changes, and is never live.',
  );
});

test('validation failed and ready to publish read differently, and publishing says it is not open yet', () => {
  assert.equal(
    text(FAILED, 'checks'),
    'Validation failed: 1 finding in the saved draft blocks publishing.',
  );
  assert.equal(text(FAILED, 'publish'), 'Not ready to publish: validation failed.');
  assert.equal(text(SAVED, 'checks'), 'The saved draft validates.');
  assert.equal(
    text(SAVED, 'publish'),
    "Ready to publish version 2. Publishing from Studio isn't open yet.",
  );
  assert.equal(text(DIRTY, 'publish'), 'Not ready to publish: it has unsaved changes.');
  assert.match(text(DIRTY, 'checks'), /Save to check your changes\.$/);
});

test('the published revision the draft starts from and the revision live now are told apart', () => {
  assert.equal(
    text(SAVED, 'published'),
    `The draft starts from published revision ${BASE_REVISION.slice(0, 16)}.`,
  );
  assert.equal(text(SAVED, 'live'), `Revision ${BASE_REVISION.slice(0, 16)}, number 4, is live.`);
  const moved = session([
    { type: 'loaded', draft: draft(2), live: live(LIVE_REVISION), journal: null },
  ]);
  assert.equal(
    text(moved, 'live'),
    `Revision ${LIVE_REVISION.slice(0, 16)}, number 4, is live. It has changed since the draft started.`,
  );
  const degraded = session([
    { type: 'loaded', draft: draft(2), live: live(LIVE_REVISION, 'degraded'), journal: null },
  ]);
  assert.match(
    text(degraded, 'live'),
    /can't be served, so rev_1{12}, the last known good, serves/,
  );
});

test('every scenario reads differently on some line: no two states differ by tone alone', () => {
  const scenarios = [SAVED, DIRTY, FAILED];
  const read = (from: DraftSession) =>
    stateLines(from)
      .map((line) => line.text)
      .join('\n');
  assert.equal(new Set(scenarios.map(read)).size, scenarios.length);
  for (const from of scenarios) {
    for (const line of stateLines(from)) {
      const sameText = scenarios
        .flatMap((other) => stateLines(other))
        .filter((other) => other.id === line.id && other.text === line.text);
      assert.ok(
        sameText.every((other) => other.tone === line.tone),
        `${line.id}: ${line.text}`,
      );
    }
  }
});
