import { clearJournal, JOURNAL_RETENTION_MS, type JournalStorage } from './journal';

// The pending discard (row 88c-RC2, as the coordinator narrowed it). Studio's Sign out without
// JavaScript can choose to discard this browser's unsaved changes, but nothing can clear storage
// then, and Clear-Site-Data "storage" would clear the public site's preferences with it. So
// auth.logout's answer to that choice leaves this marker cookie (server/owner/cookie.ts), and
// Studio's next script, on the sign-in page or in the shell, reads it first: it clears exactly
// what the JavaScript dialog's discard clears, the journal, before any draft is restored, then
// drops the marker. Script must read and drop it, so it isn't HttpOnly; it says only that a
// discard is owed, and SameSite=Strict keeps it off other sites' requests.

/** The marker's name over https, and over the http test mode the session cookie also has. */
export const DISCARD_MARKERS = ['__Host-studio_discard', 'studio_discard'] as const;

/** How long the marker lasts: the journal's own retention, so it outlives every entry it clears. */
export const DISCARD_MARKER_MAX_AGE = JOURNAL_RETENTION_MS / 1000;

/** What the marker reads and writes: document.cookie, or a test's. */
export interface CookieJar {
  cookie: string;
}

/** The marker's name, for an origin served over https or not. */
export function discardMarkerName(secure: boolean): (typeof DISCARD_MARKERS)[number] {
  return secure ? DISCARD_MARKERS[0] : DISCARD_MARKERS[1];
}

/**
 * Applies a pending discard: with the marker set, clears the journal and drops the marker, and
 * returns true. With storage out of reach the marker stays for the next script, as nothing was
 * cleared.
 */
export function applyPendingDiscard(jar: CookieJar, storage: JournalStorage | null): boolean {
  let names: string[];
  try {
    names = jar.cookie.split(';').map((part) => part.trim().split('=')[0] ?? '');
  } catch {
    return false;
  }
  const pending = DISCARD_MARKERS.filter((name) => names.includes(name));
  if (pending.length === 0 || storage === null) return false;
  clearJournal(storage);
  for (const name of pending) {
    jar.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Strict${name.startsWith('__Host-') ? '; Secure' : ''}`;
  }
  return true;
}

/**
 * The journal's storage, with any pending discard applied first: every read of the journal goes
 * through this, so no draft a discard owed comes back. Null where storage can't be reached.
 */
export function journalStorage<S extends JournalStorage>(env: {
  readonly document: CookieJar;
  readonly localStorage: S;
}): S | null {
  let storage: S;
  try {
    storage = env.localStorage;
  } catch {
    return null;
  }
  applyPendingDiscard(env.document, storage);
  return storage;
}
