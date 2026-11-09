import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPendingDiscard, DISCARD_MARKER_MAX_AGE, journalStorage } from './discard-marker';
import { JOURNAL_KEY, JOURNAL_RETENTION_MS, readJournal, type JournalEntry } from './journal';

// The pending discard (row 88c-RC2, as the coordinator narrowed it): a Sign out without JavaScript
// that chose to discard can't clear this browser's storage then, and Clear-Site-Data "storage"
// would clear the public site's preferences too. So the answer leaves a marker cookie, and
// Studio's next script, on the sign-in page or in the shell, reads it first: it clears exactly
// what the JavaScript dialog's discard clears, the journal, before any draft is restored, then
// drops the marker.

/** A Storage over a Map. */
function memoryStorage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

/** document.cookie as a jar: reads give `cookies`, writes are kept in order. */
function cookieJar(cookies: string) {
  const writes: string[] = [];
  return {
    writes,
    get cookie() {
      return cookies;
    },
    set cookie(value: string) {
      writes.push(value);
    },
  };
}

const NOW = Date.parse('2026-11-08T12:00:00Z');
/** An entry that reads, as journal.test.ts's: with no marker, it would come back. */
const entry: JournalEntry = {
  tabId: 'tab-aaaaaaaa',
  draftId: `drf_${'a'.repeat(32)}`,
  baseVersion: 3,
  documents: {
    portfolio: { format: 'yaml', sourceText: 'schemaVersion: 3\n# unsaved\n' },
    site: { format: 'json', sourceText: '{"schemaVersion": 2}\n' },
  },
  savedAt: NOW - 60_000,
};

/** What the public site and Studio keep in localStorage besides the journal. */
const KEPT = {
  'portfolio.motion.paused': '1',
  'portfolio.shortcuts.single-key': 'off',
  'studio.task': 'appearance',
};

test("a pending-discard marker clears the journal, and only the journal, then drops itself; the appearance and display-mode cookie and the site's keys stay (row 88c-RC2)", () => {
  for (const marker of ['__Host-studio_discard', 'studio_discard']) {
    const storage = memoryStorage({ [JOURNAL_KEY]: JSON.stringify([entry]), ...KEPT });
    const jar = cookieJar(`portfolio_appearance=dark; ${marker}=1; other=x`);
    assert.equal(applyPendingDiscard(jar, storage), true, marker);
    assert.equal(storage.map.has(JOURNAL_KEY), false, `${marker}: the journal cleared`);
    for (const [key, value] of Object.entries(KEPT)) {
      assert.equal(storage.map.get(key), value, `${marker}: ${key} kept`);
    }
    // Only the marker is written, expired with its own attributes; nothing touches the
    // appearance cookie (HttpOnly in a browser, so script never sees it anyway).
    assert.equal(jar.writes.length, 1, marker);
    assert.match(jar.writes[0]!, new RegExp(`^${marker}=; Path=/; Max-Age=0; SameSite=Strict`));
    assert.equal(jar.writes[0]!.endsWith('; Secure'), marker.startsWith('__Host-'), marker);
    assert.ok(!jar.writes.some((write) => write.startsWith('portfolio_appearance')), marker);
  }
});

test('with no marker nothing is cleared, and with storage out of reach the marker stays for the next script (row 88c-RC2)', () => {
  const storage = memoryStorage({ [JOURNAL_KEY]: JSON.stringify([entry]), ...KEPT });
  const plain = cookieJar('portfolio_appearance=dark; studio_discardx=1');
  assert.equal(applyPendingDiscard(plain, storage), false);
  assert.ok(storage.map.has(JOURNAL_KEY));
  assert.deepEqual(plain.writes, []);
  const marked = cookieJar('studio_discard=1');
  assert.equal(applyPendingDiscard(marked, null), false);
  assert.deepEqual(marked.writes, [], 'the marker waits for storage');
});

test('no draft comes back after a discard: the journal Studio reads through journalStorage is empty once a marker was pending (row 88c-RC2)', () => {
  const storage = memoryStorage({ [JOURNAL_KEY]: JSON.stringify([entry]), ...KEPT });
  const jar = cookieJar('studio_discard=1');
  // The same journal without a marker gives the entry back: what the marker stops.
  const unmarked = memoryStorage({ [JOURNAL_KEY]: JSON.stringify([entry]) });
  const without = journalStorage({ document: cookieJar(''), localStorage: unmarked });
  assert.equal(readJournal(without!, NOW).length, 1, 'the entry reads');
  const read = journalStorage({ document: jar, localStorage: storage });
  assert.deepEqual(readJournal(read!, NOW), []);
  assert.equal(jar.writes.length, 1, 'the marker dropped');
  // And the marker outlives every entry it has to clear: the journal's own retention.
  assert.equal(DISCARD_MARKER_MAX_AGE, JOURNAL_RETENTION_MS / 1000);
});
