import { JOURNAL_RETENTION_MS, journalState, storeJournal, type JournalStorage } from './journal';

// The pending discard (row 88c-RC2, as the coordinator ruled it, 2026-11-10). Studio's Sign out
// without JavaScript can choose to discard this browser's unsaved changes, but nothing can clear
// storage then, and Clear-Site-Data "storage" would clear the public site's preferences with it.
// So auth.logout's answer to that choice leaves this marker cookie (server/owner/cookie.ts), whose
// value is the sign-out's time T, HttpOnly: no script reads or writes it. Studio's pages read it as
// they render, the sign-in page and /studio, and hand T and the time they rendered at to their
// script. That script prunes every journal entry saved before T, on the page's own clock (the
// per-load skew from the render), before anything reads the journal, and records "applied T" in
// the journal's own key in the same write. A later page that renders the same T prunes nothing,
// so what the new session saved since is never touched. The marker isn't dropped: it lapses at
// the journal's retention, as every entry it could cover does.

/** The marker's name over https, and over the http test mode the session cookie also has. */
export const DISCARD_MARKERS = ['__Host-studio_discard', 'studio_discard'] as const;

/** How long the marker lasts: the journal's own retention, so it outlives every entry it prunes. */
export const DISCARD_MARKER_MAX_AGE = JOURNAL_RETENTION_MS / 1000;

/** The marker's name, for an origin served over https or not. */
export function discardMarkerName(secure: boolean): (typeof DISCARD_MARKERS)[number] {
  return secure ? DISCARD_MARKERS[0] : DISCARD_MARKERS[1];
}

/** A discard a page found owed as it rendered: the sign-out's time, and the page's render time. */
export interface PendingDiscard {
  readonly at: number;
  readonly renderedAt: number;
}

/** The sign-out's time a marker's value names, as a page reads it from its request; else null. */
export function discardMarkerAt(value: string | undefined): number | null {
  return value !== undefined && /^\d{1,16}$/.test(value) ? Number(value) : null;
}

/**
 * Applies `pending` to the journal once: prunes every entry saved at or before its time, on this
 * page's clock (`now`, against the server's render time), and records it applied, in one write.
 * True when it pruned; false with nothing owed, one already applied, or a write storage refused,
 * which leaves the journal and its record as they were for the next page.
 */
export function applyDiscard(
  storage: JournalStorage,
  pending: PendingDiscard | null,
  now: number = Date.now(),
): boolean {
  if (pending === null) return false;
  const state = journalState(storage, now);
  if (state === null || state.record?.discardApplied === pending.at) return false;
  const before = pending.at + (now - pending.renderedAt);
  const kept = state.entries.filter((entry) => entry.savedAt > before);
  return storeJournal(storage, kept, { discardApplied: pending.at });
}

/**
 * The journal's storage, with the page's pending discard applied first: every read of the journal
 * goes through this, so no draft a discard owed comes back. Null where storage can't be reached.
 */
export function journalStorage<S extends JournalStorage>(
  env: { readonly localStorage: S },
  pending: PendingDiscard | null,
  now: number = Date.now(),
): S | null {
  let storage: S;
  try {
    storage = env.localStorage;
  } catch {
    return null;
  }
  applyDiscard(storage, pending, now);
  return storage;
}
