// What the Studio shell does around the back-forward cache (#8, Slice 1;
// refined Slice 8 item 2). A page going into it hides its protected parts
// before it's frozen, synchronously, so a restore never paints the draft
// for a frame, which Safari restores even for a no-store page. A restored
// page stays hidden until its session checks out again.

export interface PageCacheEnv {
  /** Hides the draft, the editor, and the state model, at once. */
  readonly hide: () => void;
  /** Writes the journal, as any pagehide does. */
  readonly flush: () => void;
  /**
   * Cancels a journal write still waiting for a pause in typing. A page
   * frozen in the cache keeps its timers, which would run once it's
   * restored, before its session checks out, and could write back an entry
   * a discard removed meanwhile.
   */
  readonly cancelPending: () => void;
  /** Re-checks the session, then shows the page again or ends it. */
  readonly recheck: () => void;
}

/**
 * Whether a restored page whose session didn't check out may write its text
 * back to the journal: only while the entry it wrote going into the cache is
 * still there. A cached page can miss another tab's discard at sign-out,
 * which removed every entry, and its own going means the owner let it go, or
 * another tab took it over; either way, writing it back would bring back
 * what's gone.
 */
export function restoredMayKeep(
  entries: readonly { readonly tabId: string }[],
  own: string | null,
): boolean {
  return own !== null && entries.some((entry) => entry.tabId === own);
}

/** The pagehide and pageshow listeners for `env`. */
export function pageCacheHandlers(env: PageCacheEnv) {
  return {
    pagehide(event: Pick<PageTransitionEvent, 'persisted'>) {
      env.flush();
      env.cancelPending();
      if (event.persisted) env.hide();
    },
    pageshow(event: Pick<PageTransitionEvent, 'persisted'>) {
      if (!event.persisted) return;
      env.hide();
      env.recheck();
    },
  };
}
