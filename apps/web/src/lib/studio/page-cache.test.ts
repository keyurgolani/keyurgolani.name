import test from 'node:test';
import assert from 'node:assert/strict';
import { clearJournal, readJournal, writeEntry, type JournalEntry } from './journal';
import { pageCacheHandlers, restoredMayKeep } from './page-cache';

// The shell around the back-forward cache (#8, Slice 1): a page going into
// it hides before it's frozen, and a restored one stays hidden until its
// session checks out, then writes its text back only if nothing let it go
// meanwhile. Headless Chromium doesn't restore reliably, so the handlers
// are tested here, apart from the browser.

test("a restored page whose session didn't check out writes its text back only while its own entry is still there", () => {
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
  const now = Date.UTC(2026, 9, 23, 12);
  const entry: JournalEntry = {
    tabId: 'tab-cached01',
    draftId: `drf_${'a'.repeat(32)}`,
    baseVersion: 2,
    documents: {
      portfolio: { format: 'yaml', sourceText: 'schemaVersion: 3\n# cached\n' },
      site: { format: 'yaml', sourceText: 'schemaVersion: 2\n' },
    },
    savedAt: now - 1000,
  };
  // Going into the cache, the page wrote its entry; the session then ended on its own.
  writeEntry(storage, entry, now);
  assert.equal(restoredMayKeep(readJournal(storage, now), 'tab-cached01'), true);
  // Another tab's discard at sign-out, which the cached page never heard, took every entry.
  clearJournal(storage);
  assert.equal(restoredMayKeep(readJournal(storage, now), 'tab-cached01'), false);
  // Another tab's entry is never this one's.
  writeEntry(storage, { ...entry, tabId: 'tab-another1' }, now);
  assert.equal(restoredMayKeep(readJournal(storage, now), 'tab-cached01'), false);
  assert.equal(restoredMayKeep(readJournal(storage, now), null), false);
});

function record() {
  const calls: string[] = [];
  const handlers = pageCacheHandlers({
    hide: () => calls.push('hide'),
    flush: () => calls.push('flush'),
    cancelPending: () => calls.push('cancel'),
    recheck: () => calls.push('recheck'),
  });
  return { calls, handlers };
}

test('a page going into the cache keeps the journal, cancels the write waiting on a pause, then hides before it is frozen', () => {
  const { calls, handlers } = record();
  handlers.pagehide({ persisted: true });
  assert.deepEqual(calls, ['flush', 'cancel', 'hide']);
});

test('a page that unloads for good keeps the journal, cancels the waiting write, and hides nothing', () => {
  const { calls, handlers } = record();
  handlers.pagehide({ persisted: false });
  assert.deepEqual(calls, ['flush', 'cancel']);
});

test('a journal write waiting on a pause never runs after a restore, so a discard made meanwhile stays (#123 review)', () => {
  // A page's timers as the cache freezes them: they run once it's restored.
  const timers = new Map<number, () => void>();
  let next = 0;
  let pending: number | null = null;
  const writes: string[] = [];
  const flush = () => writes.push('write');
  // The shell's pause timer: a write once typing pauses.
  pending = ++next;
  timers.set(pending, flush);
  const handlers = pageCacheHandlers({
    hide: () => {},
    flush,
    cancelPending: () => {
      if (pending !== null) timers.delete(pending);
      pending = null;
    },
    recheck: () => {},
  });
  handlers.pagehide({ persisted: true });
  assert.deepEqual(writes, ['write'], 'pagehide writes the journal once');
  // Meanwhile another tab's discard removes the entry; then the page is restored, and its timers run.
  writes.length = 0;
  handlers.pageshow({ persisted: true });
  for (const run of timers.values()) run();
  assert.deepEqual(writes, [], 'nothing writes the entry back');
});

test('a restored page stays hidden and re-checks its session; a first load does neither', () => {
  const { calls, handlers } = record();
  handlers.pageshow({ persisted: false });
  assert.deepEqual(calls, []);
  handlers.pageshow({ persisted: true });
  assert.deepEqual(calls, ['hide', 'recheck']);
});
