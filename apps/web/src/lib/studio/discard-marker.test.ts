import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDiscard, DISCARD_MARKER_MAX_AGE, journalStorage } from './discard-marker';
import {
  JOURNAL_CLOCK_SKEW_MS,
  JOURNAL_KEY,
  JOURNAL_RETENTION_MS,
  readJournal,
  writeEntry,
  type JournalEntry,
} from './journal';

// The pending discard (row 88c-RC2, as the coordinator ruled it, 2026-11-10): a Sign out without
// JavaScript that chose to discard can't clear this browser's storage then, and Clear-Site-Data
// "storage" would clear the public site's preferences too. So the answer leaves an HttpOnly marker
// whose value is the sign-out's time T. Studio's pages read it as they render and hand T, and the
// time they rendered at, to their script, which prunes every journal entry saved before T, on the
// page's own clock, before anything reads the journal. It prunes once per T: the prune and its
// record, "applied T", are one write to the journal's own key, so a later page that renders the
// same T leaves alone what the new session has saved since. No script reads or writes a cookie.

/** A Storage over a Map; `failWrites` makes the next so many setItem calls throw. */
function memoryStorage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  const state = { failWrites: 0, writes: 0 };
  return {
    map,
    state,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (state.failWrites > 0) {
        state.failWrites -= 1;
        throw new Error('QuotaExceededError');
      }
      state.writes += 1;
      map.set(key, value);
    },
    removeItem: (key: string) => void map.delete(key),
  };
}

/** The sign-out's time on the server's clock. */
const T = Date.parse('2026-11-08T12:00:00Z');

const entry = (tabId: string, savedAt: number): JournalEntry => ({
  tabId,
  draftId: `drf_${'a'.repeat(32)}`,
  baseVersion: 3,
  documents: {
    portfolio: { format: 'yaml', sourceText: 'schemaVersion: 3\n# unsaved\n' },
    site: { format: 'json', sourceText: '{"schemaVersion": 2}\n' },
  },
  savedAt,
});

/** What the public site and Studio keep in localStorage besides the journal. */
const KEPT = {
  'portfolio.motion.paused': '1',
  'portfolio.shortcuts.single-key': 'off',
  'studio.task': 'appearance',
};

test("a pending discard prunes what was saved before the sign-out, and only the journal: the site's keys stay (row 88c-RC2)", () => {
  const storage = memoryStorage({
    [JOURNAL_KEY]: JSON.stringify([entry('tab-before-1', T - 60_000)]),
    ...KEPT,
  });
  // The page rendered just after the sign-out and its script runs a second later, on the same clock.
  assert.equal(applyDiscard(storage, { at: T, renderedAt: T + 5_000 }, T + 6_000), true);
  assert.deepEqual(readJournal(storage, T + 6_000), [], 'the entry saved before T is gone');
  for (const [key, value] of Object.entries(KEPT)) assert.equal(storage.map.get(key), value, key);
});

test('a discard applies once per marker value: sign out, sign in, save within the skew, reload, and the entry survives (row 88c-RC2)', () => {
  const storage = memoryStorage({ [JOURNAL_KEY]: JSON.stringify([entry('tab-before-1', T - 1)]) });
  // The client's clock runs 4 minutes ahead of the server's: the per-load skew from the render.
  const ahead = 4 * 60_000;
  const firstLoad = T + 10_000;
  const pending = { at: T, renderedAt: firstLoad };
  assert.equal(applyDiscard(storage, pending, firstLoad + ahead), true, 'the first load prunes');
  assert.deepEqual(readJournal(storage, firstLoad + ahead), []);
  // The new session saves within the skew window: on the client's clock, before T + skew.
  const saved = entry('tab-after-01', T + ahead - 30_000);
  writeEntry(storage, saved, firstLoad + ahead + 1_000);
  // A reload renders the same T: the discard was applied, so nothing goes.
  const reload = { at: T, renderedAt: firstLoad + 60_000 };
  assert.equal(applyDiscard(storage, reload, firstLoad + 60_000 + ahead), false, 'applied once');
  assert.deepEqual(readJournal(storage, firstLoad + 60_000 + ahead), [saved]);
  // journalStorage, as Studio reads through it, does the same.
  const read = journalStorage({ localStorage: storage }, reload, firstLoad + 60_000 + ahead);
  assert.deepEqual(readJournal(read!, firstLoad + 60_000 + ahead), [saved]);
});

test('a prune whose write fails leaves the journal and its record as they were, and the next load prunes once (row 88c-RC2)', () => {
  const before = JSON.stringify([entry('tab-before-1', T - 60_000)]);
  const storage = memoryStorage({ [JOURNAL_KEY]: before });
  const pending = { at: T, renderedAt: T + 5_000 };
  storage.state.failWrites = 1;
  assert.equal(applyDiscard(storage, pending, T + 6_000), false, 'the write failed');
  assert.equal(storage.map.get(JOURNAL_KEY), before, 'neither the prune nor the record landed');
  assert.equal(applyDiscard(storage, pending, T + 7_000), true, 'the next load prunes');
  assert.deepEqual(readJournal(storage, T + 7_000), []);
  assert.equal(applyDiscard(storage, pending, T + 8_000), false, 'and only once');
  assert.equal(storage.state.writes, 1, 'the prune and its record were one write');
});

test('a new discard, a later T, prunes again; no marker prunes nothing (row 88c-RC2)', () => {
  const storage = memoryStorage({ [JOURNAL_KEY]: JSON.stringify([entry('tab-before-1', T - 1)]) });
  assert.equal(applyDiscard(storage, null, T), false);
  assert.equal(readJournal(storage, T).length, 1, 'no marker, nothing pruned');
  assert.equal(applyDiscard(storage, { at: T, renderedAt: T }, T), true);
  const later = entry('tab-after-01', T + 60_000);
  writeEntry(storage, later, T + 61_000);
  const again = { at: T + 120_000, renderedAt: T + 120_000 };
  assert.equal(applyDiscard(storage, again, T + 120_000), true, 'a later sign-out prunes again');
  assert.deepEqual(readJournal(storage, T + 120_000), []);
});

test('Studio reads the journal through journalStorage: with a marker no draft from before the sign-out comes back, and storage out of reach is null (row 88c-RC2)', () => {
  const journal = JSON.stringify([entry('tab-before-1', T - 60_000)]);
  const unmarked = memoryStorage({ [JOURNAL_KEY]: journal });
  assert.equal(readJournal(journalStorage({ localStorage: unmarked }, null, T)!, T).length, 1);
  const marked = memoryStorage({ [JOURNAL_KEY]: journal });
  const read = journalStorage({ localStorage: marked }, { at: T, renderedAt: T }, T);
  assert.deepEqual(readJournal(read!, T), []);
  const refusing = {
    get localStorage(): Storage {
      throw new Error('SecurityError');
    },
  };
  assert.equal(journalStorage(refusing, { at: T, renderedAt: T }, T), null);
  // The marker outlives every entry it has to prune: the journal's own retention.
  assert.equal(DISCARD_MARKER_MAX_AGE, JOURNAL_RETENTION_MS / 1000);
  assert.ok(JOURNAL_CLOCK_SKEW_MS > 0);
});
