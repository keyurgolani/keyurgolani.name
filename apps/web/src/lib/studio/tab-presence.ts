import { STUDIO_STORAGE_PREFIX } from './journal';

// Which Studio tabs are open (#8, Slice 1), so a tab restores the journal
// entry another tab left only once that tab is gone, as a closed tab or a
// crash leaves one, and never takes over the text of a tab that's still
// open and still holds it. Each tab holds a Web Lock named for its id for
// as long as it lives; the browser lets it go when the tab closes or
// crashes. Where the browser has no Web Locks, every other tab counts as
// open, so nothing is taken over: a tab keeps its own entry, and loses
// nothing.

const LOCK_PREFIX = `${STUDIO_STORAGE_PREFIX}tab:`;

/** The part of the Web Locks API presence uses, so a test can stand in for it. */
export interface Locks {
  request(name: string, callback: () => Promise<void>): Promise<unknown>;
  query(): Promise<{ held?: readonly { name?: string }[] }>;
}

function browserLocks(): Locks | null {
  try {
    return (navigator as Navigator & { locks?: Locks }).locks ?? null;
  } catch {
    return null;
  }
}

/** Holds `tabId`'s lock for the rest of the page's life. */
export function holdTab(tabId: string, locks: Locks | null = browserLocks()): void {
  if (!locks) return;
  void locks.request(`${LOCK_PREFIX}${tabId}`, () => new Promise<void>(() => {})).catch(() => {});
}

/**
 * The ids of the Studio tabs open now, or null when the browser can't tell,
 * in which case the caller treats every other tab as open.
 */
export async function openTabs(locks: Locks | null = browserLocks()): Promise<Set<string> | null> {
  if (!locks) return null;
  try {
    const { held = [] } = await locks.query();
    return new Set(
      held
        .map(({ name }) => name ?? '')
        .filter((name) => name.startsWith(LOCK_PREFIX))
        .map((name) => name.slice(LOCK_PREFIX.length)),
    );
  } catch {
    return null;
  }
}

/** Whether a tab may take over the entry `tabId` left: its own, or one whose tab is known to be gone. */
export function mayRestore(tabId: string, own: string, open: ReadonlySet<string> | null): boolean {
  return tabId === own || (open !== null && !open.has(tabId));
}
