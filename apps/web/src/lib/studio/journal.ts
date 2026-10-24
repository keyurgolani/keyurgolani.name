import { DOCUMENT_NAMES, type SourceDocument, type SourceDocuments } from './documents';

// The local journal of unsaved edits (#8, Slice 1; refined Slice 2 item 3):
// what an editor holds that the store's draft doesn't, kept in this
// browser so a closed tab, a crash, or an ended session loses nothing.
//
// It's plaintext in localStorage for the site's origin. Any script running
// on the site's pages, and anyone at the machine, can read it until it
// expires or is discarded. What holds:
//
// - Studio's own key. It sits under STUDIO_STORAGE_PREFIX, which nothing on
//   the public site reads or writes, and Studio writes no other localStorage
//   key, no cookie, and never the #19 visitor preference.
// - Never rendered before authentication. Only the signed-in Studio shell
//   reads entries to show them, after requireOwnerPage let the page render.
//   The sign-in page only prunes: it drops what's expired and reads nothing
//   out.
// - One entry per tab. Each entry names the tab that wrote it, by an id in
//   that tab's sessionStorage, and a tab overwrites or removes only its own;
//   only an explicit discard at sign-out removes every tab's.
// - Bounded. An entry's time is its last edit's, not its last write's, so
//   opening Studio never extends it. One older than JOURNAL_RETENTION_MS,
//   one dated more than JOURNAL_CLOCK_SKEW_MS in the future, and one that
//   doesn't read are dropped whenever Studio or the sign-in page reads the
//   journal, before anything shows. Nothing removes an entry from storage
//   while no Studio page is open: until one is, it sits there expired.

/** The prefix of every key Studio writes to browser storage. The public site reads none of them. */
export const STUDIO_STORAGE_PREFIX = 'portfolio-studio:';
/** The journal's key, in localStorage. */
export const JOURNAL_KEY = `${STUDIO_STORAGE_PREFIX}journal:v1`;
/** The key of this tab's id, in sessionStorage. */
export const TAB_KEY = `${STUDIO_STORAGE_PREFIX}tab`;
/** How long an unsaved edit is kept after it was made: 7 days. */
export const JOURNAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** How far in the future an entry's time may be, for a clock that drifts: 5 minutes. */
export const JOURNAL_CLOCK_SKEW_MS = 5 * 60 * 1000;
/**
 * At most this many tabs' entries are kept: the oldest goes first, and the
 * shell says so when a write lets one go. Eight tabs of unsaved text is
 * more than one owner keeps open, and a bound keeps the journal small.
 */
export const JOURNAL_MAX_ENTRIES = 8;

/** One tab's unsaved text for one draft, and the draft version it was edited on. */
export interface JournalEntry {
  /** The tab that wrote it. */
  readonly tabId: string;
  readonly draftId: string;
  /** The version the edits started from: a save sends it as expectedVersion. */
  readonly baseVersion: number;
  readonly documents: SourceDocuments;
  /** When the last edit in it was made, in epoch milliseconds. */
  readonly savedAt: number;
}

/** The part of Web Storage the journal uses, so a test can stand in for it. */
export type JournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const TAB_ID = /^[A-Za-z0-9_-]{8,64}$/;

function isDocument(value: unknown): value is SourceDocument {
  if (!value || typeof value !== 'object') return false;
  const { format, sourceText } = value as Record<string, unknown>;
  return (format === 'yaml' || format === 'json') && typeof sourceText === 'string';
}

function isEntry(value: unknown): value is JournalEntry {
  if (!value || typeof value !== 'object') return false;
  const { tabId, draftId, baseVersion, documents, savedAt } = value as Record<string, unknown>;
  if (typeof tabId !== 'string' || !TAB_ID.test(tabId)) return false;
  if (typeof draftId !== 'string' || !/^drf_[0-9a-f]{32}$/.test(draftId)) return false;
  if (!Number.isSafeInteger(baseVersion) || (baseVersion as number) < 1) return false;
  if (!Number.isFinite(savedAt)) return false;
  if (!documents || typeof documents !== 'object') return false;
  const held = documents as Record<string, unknown>;
  if (Object.keys(held).some((name) => !(DOCUMENT_NAMES as readonly string[]).includes(name))) {
    return false;
  }
  return (
    isDocument(held.portfolio) &&
    isDocument(held.site) &&
    (held.media === undefined || isDocument(held.media))
  );
}

/** Whether `entry`, which reads, may stay at `now`: neither past its retention nor from the future. */
function current(entry: JournalEntry, now: number): boolean {
  return (
    now - entry.savedAt <= JOURNAL_RETENTION_MS && entry.savedAt - now <= JOURNAL_CLOCK_SKEW_MS
  );
}

function store(storage: JournalStorage, entries: readonly JournalEntry[]): boolean {
  try {
    if (entries.length === 0) storage.removeItem(JOURNAL_KEY);
    else storage.setItem(JOURNAL_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

/**
 * Every entry that may stay at `now`, newest first. Storage keeps only
 * those: one that doesn't read, is past its retention, or is from the
 * future is removed as this reads. Storage that throws reads as none.
 */
export function readJournal(storage: JournalStorage, now: number): JournalEntry[] {
  let text: string | null;
  try {
    text = storage.getItem(JOURNAL_KEY);
  } catch {
    return [];
  }
  if (text === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const all: unknown[] = Array.isArray(parsed) ? parsed : [];
  const kept = all
    .filter((entry): entry is JournalEntry => isEntry(entry) && current(entry, now))
    .filter(
      (entry, index, list) => list.findIndex((other) => other.tabId === entry.tabId) === index,
    )
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, JOURNAL_MAX_ENTRIES);
  if (kept.length !== all.length || !Array.isArray(parsed)) store(storage, kept);
  return kept;
}

/** Drops what may not stay, as the sign-in page and the shell do before anything shows. */
export function pruneJournal(storage: JournalStorage, now: number): void {
  readJournal(storage, now);
}

/** Writes `entry` as its tab's, keeping every other tab's. Returns false when storage refused it. */
export function writeEntry(storage: JournalStorage, entry: JournalEntry, now: number): boolean {
  const others = readJournal(storage, now).filter((other) => other.tabId !== entry.tabId);
  return store(storage, [entry, ...others].slice(0, JOURNAL_MAX_ENTRIES));
}

/**
 * The entries writing `entry` would let go, oldest first: another tab's,
 * past the JOURNAL_MAX_ENTRIES newest. The shell says so when there are any.
 */
export function dropsOnWrite(
  storage: JournalStorage,
  entry: JournalEntry,
  now: number,
): JournalEntry[] {
  const others = readJournal(storage, now).filter((other) => other.tabId !== entry.tabId);
  return others.slice(JOURNAL_MAX_ENTRIES - 1).reverse();
}

/** Removes the entry `tabId` wrote, and nothing else. */
export function removeEntry(storage: JournalStorage, tabId: string, now: number): void {
  const entries = readJournal(storage, now);
  if (entries.some((entry) => entry.tabId === tabId)) {
    store(
      storage,
      entries.filter((entry) => entry.tabId !== tabId),
    );
  }
}

/** Removes every tab's entry: the owner's explicit discard at sign-out. */
export function clearJournal(storage: JournalStorage): void {
  try {
    storage.removeItem(JOURNAL_KEY);
  } catch {
    // Nothing to keep: storage that refuses holds no entry either.
  }
}

/**
 * The entry a tab restores for `draftId`: its own first, else the newest
 * another tab left for that draft, as a closed tab or a crash leaves one,
 * else the newest for any draft, which the shell offers as an orphan.
 */
export function entryFor(
  entries: readonly JournalEntry[],
  tabId: string,
  draftId: string | null,
): JournalEntry | null {
  return (
    entries.find((entry) => entry.tabId === tabId) ??
    entries.find((entry) => entry.draftId === draftId) ??
    entries[0] ??
    null
  );
}

const randomId = () => crypto.randomUUID().replace(/-/g, '');

/** This tab's id, from its sessionStorage, made the first time; one in memory where that throws. */
export function tabId(
  session: Pick<Storage, 'getItem' | 'setItem'> | null,
  random: () => string = randomId,
): string {
  try {
    const kept = session?.getItem(TAB_KEY);
    if (kept && TAB_ID.test(kept)) return kept;
  } catch {
    return random();
  }
  return newTabId(session, random);
}

/**
 * A new id for this tab, kept in its sessionStorage in place of the one
 * there: for a duplicated tab, whose sessionStorage, and so whose id, is a
 * copy of the tab it came from.
 */
export function newTabId(
  session: Pick<Storage, 'setItem'> | null,
  random: () => string = randomId,
): string {
  const made = random();
  try {
    session?.setItem(TAB_KEY, made);
  } catch {
    // Kept in memory alone: the tab still writes under it.
  }
  return made;
}
