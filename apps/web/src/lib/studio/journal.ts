import { DOCUMENT_NAMES, type SourceDocument, type SourceDocuments } from './documents';

// The local journal of unsaved edits (#8, Slice 1; refined Slice 2 item 3):
// what the editor holds that the store's draft doesn't, kept in this
// browser so a closed tab, a crash, or an ended session loses nothing.
//
// - Studio's own key. It sits under STUDIO_STORAGE_PREFIX, which nothing on
//   the public site reads, and Studio writes no other key, no cookie, and
//   never the #19 visitor preference.
// - Never before authentication. Only the signed-in Studio shell reads or
//   writes it, after requireOwnerPage let the page render; sign-in never
//   touches it.
// - Bounded. An entry older than JOURNAL_RETENTION_MS is dropped the next
//   time Studio reads the journal, and one that doesn't read is dropped too.
// - Sign-out asks the owner whether to keep or discard it.

/** The prefix of every key Studio writes to browser storage. The public site reads none of them. */
export const STUDIO_STORAGE_PREFIX = 'portfolio-studio:';
/** The journal's key. */
export const JOURNAL_KEY = `${STUDIO_STORAGE_PREFIX}journal:v1`;
/** How long an unsaved edit is kept: 7 days. */
export const JOURNAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** One draft's unsaved text, and the draft version it was edited on. */
export interface JournalEntry {
  readonly draftId: string;
  /** The version the edits started from: a save sends it as expectedVersion. */
  readonly baseVersion: number;
  readonly documents: SourceDocuments;
  /** When it was written, in epoch milliseconds. */
  readonly savedAt: number;
}

/** The part of Web Storage the journal uses, so a test can stand in for it. */
export type JournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isDocument(value: unknown): value is SourceDocument {
  if (!value || typeof value !== 'object') return false;
  const { format, sourceText } = value as Record<string, unknown>;
  return (format === 'yaml' || format === 'json') && typeof sourceText === 'string';
}

function isEntry(value: unknown): value is JournalEntry {
  if (!value || typeof value !== 'object') return false;
  const { draftId, baseVersion, documents, savedAt } = value as Record<string, unknown>;
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

/**
 * The journal's entry, or null: none written, one that doesn't read, or one
 * past its retention, which this removes. Storage that throws, as a browser
 * that refuses it does, reads as none.
 */
export function readJournal(storage: JournalStorage, now: number): JournalEntry | null {
  let text: string | null;
  try {
    text = storage.getItem(JOURNAL_KEY);
  } catch {
    return null;
  }
  if (text === null) return null;
  let entry: unknown;
  try {
    entry = JSON.parse(text);
  } catch {
    entry = null;
  }
  if (!isEntry(entry) || now - entry.savedAt > JOURNAL_RETENTION_MS) {
    clearJournal(storage);
    return null;
  }
  return entry;
}

/** Writes `entry`, replacing what the journal held. Returns false when storage refused it. */
export function writeJournal(storage: JournalStorage, entry: JournalEntry): boolean {
  try {
    storage.setItem(JOURNAL_KEY, JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
}

/** Removes the journal's entry. */
export function clearJournal(storage: JournalStorage): void {
  try {
    storage.removeItem(JOURNAL_KEY);
  } catch {
    // Nothing to keep: storage that refuses holds no entry either.
  }
}
