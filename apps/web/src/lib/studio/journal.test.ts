import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearJournal,
  JOURNAL_KEY,
  JOURNAL_RETENTION_MS,
  readJournal,
  STUDIO_STORAGE_PREFIX,
  writeJournal,
  type JournalEntry,
  type JournalStorage,
} from './journal';

// The local journal of unsaved edits (#8, Slice 1): Studio's own key,
// bounded to 7 days, and nothing that doesn't read comes back.

function memory(): JournalStorage & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

const NOW = Date.UTC(2026, 9, 23, 12);
const ENTRY: JournalEntry = {
  draftId: `drf_${'a'.repeat(32)}`,
  baseVersion: 3,
  documents: {
    portfolio: { format: 'yaml', sourceText: 'schemaVersion: 3\n# mine\n' },
    site: { format: 'json', sourceText: '{"schemaVersion": 2}\n' },
  },
  savedAt: NOW - 1000,
};

test("it keeps one entry under Studio's own key, which nothing on the public site reads", () => {
  const storage = memory();
  assert.equal(writeJournal(storage, ENTRY), true);
  assert.deepEqual([...storage.items.keys()], [JOURNAL_KEY]);
  assert.ok(JOURNAL_KEY.startsWith(STUDIO_STORAGE_PREFIX));
  // Neither the v1 theme key the public script read, nor the kit's pause key.
  for (const publicKey of ['portfolio:theme', 'portfolio.motion.paused']) {
    assert.ok(!publicKey.startsWith(STUDIO_STORAGE_PREFIX), publicKey);
  }
  assert.deepEqual(readJournal(storage, NOW), ENTRY);
});

test('an entry is kept for 7 days, and one past that is removed when Studio reads it', () => {
  const storage = memory();
  assert.equal(JOURNAL_RETENTION_MS, 7 * 24 * 60 * 60 * 1000);
  writeJournal(storage, { ...ENTRY, savedAt: NOW - JOURNAL_RETENTION_MS });
  assert.ok(readJournal(storage, NOW), 'exactly 7 days old is kept');
  writeJournal(storage, { ...ENTRY, savedAt: NOW - JOURNAL_RETENTION_MS - 1 });
  assert.equal(readJournal(storage, NOW), null);
  assert.equal(storage.items.size, 0, 'and it is gone from storage');
});

test("an entry that doesn't read is removed: bad JSON, a missing document, a stray key, or a bad id", () => {
  for (const text of [
    '{not json',
    JSON.stringify({ ...ENTRY, documents: { portfolio: ENTRY.documents.portfolio } }),
    JSON.stringify({ ...ENTRY, documents: { ...ENTRY.documents, extra: ENTRY.documents.site } }),
    JSON.stringify({ ...ENTRY, draftId: 'drf_short' }),
    JSON.stringify({ ...ENTRY, baseVersion: 0 }),
    JSON.stringify({
      ...ENTRY,
      documents: { ...ENTRY.documents, site: { format: 'toml', sourceText: '' } },
    }),
  ]) {
    const storage = memory();
    storage.setItem(JOURNAL_KEY, text);
    assert.equal(readJournal(storage, NOW), null, text);
    assert.equal(storage.items.size, 0, text);
  }
});

test('a media document comes back with the rest', () => {
  const storage = memory();
  const withMedia: JournalEntry = {
    ...ENTRY,
    documents: { ...ENTRY.documents, media: { format: 'yaml', sourceText: 'assets: []\n' } },
  };
  writeJournal(storage, withMedia);
  assert.deepEqual(readJournal(storage, NOW), withMedia);
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
  assert.equal(readJournal(refusing, NOW), null);
  assert.equal(writeJournal(refusing, ENTRY), false);
  assert.doesNotThrow(() => clearJournal(refusing));
});
