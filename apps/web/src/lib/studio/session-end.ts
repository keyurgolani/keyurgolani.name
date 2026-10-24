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
