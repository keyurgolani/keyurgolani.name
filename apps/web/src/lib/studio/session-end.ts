import { safeReturnTo, signInLocation, type SignInState } from '~/server/return-to';

// What the Studio shell does when its session ends (#8, Slice 1; refined
// Slice 8 item 2): on a 401 from any request, on another tab's sign-out or
// lost session, or on a back-forward cache restore whose session no longer
// counts. In this order: the journal takes the editor's unsaved text, the
// protected data and any preview frame leave the page, the title goes back
// to one that names nothing of the portfolio, and the page goes to sign-in
// with the Studio path it was on as `returnTo`.

/** The title a Studio page shows once its session ends: nothing of the portfolio in it. */
export const NEUTRAL_TITLE = 'Portfolio Studio';

export interface SessionEndEnv {
  /** Writes the editor's unsaved text to the journal, if it has any. */
  readonly flush: () => void;
  /** Drops the draft, the live state, and every preview frame from the page. */
  readonly drop: () => void;
  readonly setTitle: (title: string) => void;
  /** The path and query the page is on. */
  readonly here: () => string;
  readonly navigate: (location: string) => void;
}

/** Ends the page's session: `session_ended` when it lapsed, `signed_out` when another tab signed out. */
export function endSession(
  env: SessionEndEnv,
  why: Extract<SignInState, 'session_ended' | 'signed_out'>,
): void {
  env.flush();
  env.drop();
  env.setTitle(NEUTRAL_TITLE);
  env.navigate(signInLocation(why, safeReturnTo(env.here())));
}

/** How long a plain sign-out from another tab waits for that tab's choice to follow it. */
export const CHOICE_WAIT_MS = 500;

/**
 * What a tab does with another tab's sign-out: `discard` drops this tab's unsaved text too,
 * `keep` keeps it. A plain one, with no choice, is a session that lapsed elsewhere, or a tab
 * whose own sign-out sent one first, as its preview's grant ending does: it waits
 * CHOICE_WAIT_MS for a choice, which wins, so a discard the owner chose is never undone by
 * this tab writing its text back as it leaves. One ending only: what comes after is done.
 */
export function signOutListener(env: {
  readonly discard: () => void;
  readonly keep: () => void;
  readonly wait: (run: () => void, ms: number) => () => void;
}): {
  readonly heard: (choice: 'keep' | 'discard' | null) => void;
  readonly stop: () => void;
} {
  let done = false;
  let cancel: (() => void) | null = null;
  const finish = (run: () => void) => {
    if (done) return;
    done = true;
    cancel?.();
    cancel = null;
    run();
  };
  return {
    heard: (choice) => {
      if (choice === 'discard') finish(env.discard);
      else if (choice === 'keep') finish(env.keep);
      else if (!done && cancel === null) {
        cancel = env.wait(() => finish(env.keep), CHOICE_WAIT_MS);
      }
    },
    stop: () => {
      cancel?.();
      cancel = null;
    },
  };
}
