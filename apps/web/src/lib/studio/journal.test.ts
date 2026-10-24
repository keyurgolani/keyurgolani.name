import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearJournal,
  entryFor,
  JOURNAL_CLOCK_SKEW_MS,
  JOURNAL_KEY,
  JOURNAL_MAX_ENTRIES,
  JOURNAL_RETENTION_MS,
  pruneJournal,
  readJournal,
  removeEntry,
  STUDIO_STORAGE_PREFIX,
  TAB_KEY,
  tabId,
  writeEntry,
  type JournalEntry,
  type JournalStorage,
} from './journal';

// The local journal of unsaved edits (#8, Slice 1): Studio's own key, one
// entry per tab, each dated by its last edit and dropped 7 days after it, or
// at once when it's from the future, and nothing that doesn't read comes
// back.

function memory(): JournalStorage & {
  readonly items: Map<string, string>;
  setItem: (key: string, value: string) => void;
} {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

const NOW = Date.UTC(2026, 9, 23, 12);
const HOUR = 60 * 60 * 1000;
const DRAFT = `drf_${'a'.repeat(32)}`;
const OTHER = `drf_${'b'.repeat(32)}`;
const entry = (tab: string, savedAt = NOW - 1000, draftId = DRAFT): JournalEntry => ({
  tabId: tab,
  draftId,
  baseVersion: 3,
  documents: {
    portfolio: { format: 'yaml', sourceText: `schemaVersion: 3\n# ${tab}\n` },
    site: { format: 'json', sourceText: '{"schemaVersion": 2}\n' },
  },
  savedAt,
});
const stored = (storage: ReturnType<typeof memory>) =>
  JSON.parse(storage.items.get(JOURNAL_KEY) ?? '[]') as JournalEntry[];

test("it keeps entries under Studio's own key, which nothing on the public site reads", () => {
  const storage = memory();
  assert.equal(writeEntry(storage, entry('tab-aaaaaaaa'), NOW), true);
  assert.deepEqual([...storage.items.keys()], [JOURNAL_KEY]);
  assert.ok(JOURNAL_KEY.startsWith(STUDIO_STORAGE_PREFIX));
  assert.ok(TAB_KEY.startsWith(STUDIO_STORAGE_PREFIX));
  // Neither the v1 theme key the public script read, nor the kit's pause key.
  for (const publicKey of ['portfolio:theme', 'portfolio.motion.paused']) {
    assert.ok(!publicKey.startsWith(STUDIO_STORAGE_PREFIX), publicKey);
  }
  assert.deepEqual(readJournal(storage, NOW), [entry('tab-aaaaaaaa')]);
});

test("a tab writes and removes only its own entry; a discard removes every tab's", () => {
  const storage = memory();
  writeEntry(storage, entry('tab-aaaaaaaa', NOW - 2000), NOW);
  writeEntry(storage, entry('tab-bbbbbbbb', NOW - 1000), NOW);
  // Newest first, one each.
  assert.deepEqual(
    readJournal(storage, NOW).map((each) => each.tabId),
    ['tab-bbbbbbbb', 'tab-aaaaaaaa'],
  );
  writeEntry(storage, { ...entry('tab-aaaaaaaa'), baseVersion: 4 }, NOW);
  assert.equal(readJournal(storage, NOW).length, 2, 'a rewrite replaces only its own');
  removeEntry(storage, 'tab-aaaaaaaa', NOW);
  assert.deepEqual(
    readJournal(storage, NOW).map((each) => each.tabId),
    ['tab-bbbbbbbb'],
  );
  removeEntry(storage, 'tab-cccccccc', NOW);
  assert.equal(readJournal(storage, NOW).length, 1, "a tab with no entry removes nobody's");
  clearJournal(storage);
  assert.equal(storage.items.size, 0);
});

test('an entry is kept 7 days from its last edit, and pruning removes it at rest once older', () => {
  const storage = memory();
  assert.equal(JOURNAL_RETENTION_MS, 7 * 24 * HOUR);
  writeEntry(storage, entry('tab-aaaaaaaa', NOW - 165 * HOUR), NOW);
  // Reading it, as opening Studio does, never moves its time.
  assert.equal(readJournal(storage, NOW)[0]!.savedAt, NOW - 165 * HOUR);
  assert.equal(stored(storage)[0]!.savedAt, NOW - 165 * HOUR);
  assert.equal(readJournal(storage, NOW - 165 * HOUR + JOURNAL_RETENTION_MS).length, 1);
  pruneJournal(storage, NOW - 165 * HOUR + JOURNAL_RETENTION_MS + 1);
  assert.equal(storage.items.size, 0, 'past 7 days it is gone from storage');
});

test('an entry from the future, beyond 5 minutes of clock skew, is dropped', () => {
  assert.equal(JOURNAL_CLOCK_SKEW_MS, 5 * 60 * 1000);
  const storage = memory();
  storage.setItem(
    JOURNAL_KEY,
    JSON.stringify([
      entry('tab-aaaaaaaa', NOW + JOURNAL_CLOCK_SKEW_MS),
      entry('tab-bbbbbbbb', NOW + JOURNAL_CLOCK_SKEW_MS + 1),
    ]),
  );
  assert.deepEqual(
    readJournal(storage, NOW).map((each) => each.tabId),
    ['tab-aaaaaaaa'],
  );
  assert.deepEqual(
    stored(storage).map((each) => each.tabId),
    ['tab-aaaaaaaa'],
  );
});

test("what doesn't read is removed: bad JSON, an object, a missing document, a stray key, or a bad id", () => {
  for (const text of [
    '{not json',
    JSON.stringify(entry('tab-aaaaaaaa')),
    JSON.stringify([
      { ...entry('tab-aaaaaaaa'), documents: { portfolio: entry('x').documents.portfolio } },
    ]),
    JSON.stringify([
      {
        ...entry('tab-aaaaaaaa'),
        documents: { ...entry('x').documents, extra: entry('x').documents.site },
      },
    ]),
    JSON.stringify([{ ...entry('tab-aaaaaaaa'), draftId: 'drf_short' }]),
    JSON.stringify([{ ...entry('tab-aaaaaaaa'), tabId: 'x' }]),
    JSON.stringify([{ ...entry('tab-aaaaaaaa'), baseVersion: 0 }]),
  ]) {
    const storage = memory();
    storage.setItem(JOURNAL_KEY, text);
    assert.deepEqual(readJournal(storage, NOW), [], text);
    assert.equal(storage.items.size, 0, text);
  }
});

test(`at most ${JOURNAL_MAX_ENTRIES} tabs' entries are kept, the oldest going first`, () => {
  const storage = memory();
  for (let index = 0; index < JOURNAL_MAX_ENTRIES + 2; index += 1) {
    writeEntry(storage, entry(`tab-${String(index).padStart(8, '0')}`, NOW - 10_000 + index), NOW);
  }
  const kept = readJournal(storage, NOW);
  assert.equal(kept.length, JOURNAL_MAX_ENTRIES);
  assert.ok(!kept.some((each) => each.tabId === 'tab-00000000'));
});

test("a tab restores its own entry, else another tab's for the working draft, else the newest as an orphan", () => {
  const mine = entry('tab-aaaaaaaa', NOW - 3000);
  const theirs = entry('tab-bbbbbbbb', NOW - 2000);
  const otherDraft = entry('tab-cccccccc', NOW - 1000, OTHER);
  const all = [otherDraft, theirs, mine];
  assert.equal(entryFor(all, 'tab-aaaaaaaa', DRAFT), mine);
  assert.equal(entryFor(all, 'tab-dddddddd', DRAFT), theirs);
  assert.equal(entryFor([otherDraft], 'tab-dddddddd', DRAFT), otherDraft);
  assert.equal(entryFor([], 'tab-dddddddd', DRAFT), null);
});

test("a tab's id is made once and kept in its sessionStorage", () => {
  const session = memory();
  let made = 0;
  const random = () => `madetab${(made += 1)}`;
  const first = tabId(session, random);
  assert.equal(first, 'madetab1');
  assert.equal(session.items.get(TAB_KEY), 'madetab1');
  assert.equal(tabId(session, random), 'madetab1');
  assert.equal(made, 1);
});

test('storage that refuses reads as none and writes nothing, without throwing', () => {
  const refusing: JournalStorage = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {
      throw new Error('SecurityError');
    },
  };
  assert.deepEqual(readJournal(refusing, NOW), []);
  assert.equal(writeEntry(refusing, entry('tab-aaaaaaaa'), NOW), false);
  assert.doesNotThrow(() => clearJournal(refusing));
  assert.doesNotThrow(() => removeEntry(refusing, 'tab-aaaaaaaa', NOW));
});
