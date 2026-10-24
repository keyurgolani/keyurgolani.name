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
  /** Re-checks the session, then shows the page again or ends it. */
  readonly recheck: () => void;
}

/** The pagehide and pageshow listeners for `env`. */
export function pageCacheHandlers(env: PageCacheEnv) {
  return {
    pagehide(event: Pick<PageTransitionEvent, 'persisted'>) {
      env.flush();
      if (event.persisted) env.hide();
    },
    pageshow(event: Pick<PageTransitionEvent, 'persisted'>) {
      if (!event.persisted) return;
      env.hide();
      env.recheck();
    },
  };
}
