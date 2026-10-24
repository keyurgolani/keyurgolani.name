import { DEFAULT_RETURN_TO, safeReturnTo, signInLocation } from '~/server/return-to';

// The Studio client's transport (#2): every Studio page sends its
// operations to /api/studio/<name> through studioFetch. A command goes as
// JSON with the page's CSRF token. On a 401 it posts `logout` to the other
// Studio tabs and dispatches a cancelable `studio:auth-required` event; when
// no listener cancels it (#8 does, to keep its journal first), it goes to
// sign-in with `session_ended`, keeping the Studio path the page was on.
// After a sign-out it posts `logout` too, so every tab leaves Studio. A tab
// posts and listens on one channel of its own, which never hears what it
// posts itself, so its own 401 or sign-out never sends it away as another
// tab's would. It never writes a response to persistent browser storage,
// and asks the HTTP cache to keep none either.

/** The BroadcastChannel Studio tabs share. */
export const SESSION_CHANNEL = 'studio-session';
/** The message every other tab leaves Studio on. */
export const SIGNED_OUT = 'logout';
/**
 * What the owner chose at sign-out for the local journal of unsaved edits
 * (#8): `discard` tells every other tab to drop its unsaved text rather than
 * keep it, so no tab writes back what the owner discarded.
 */
export type SignOutChoice = 'keep' | 'discard';
/** The sign-out message that carries `choice`. */
export const signedOutMessage = (choice: SignOutChoice) => `${SIGNED_OUT}:${choice}`;

/** The choice a sign-out message carries, null for a plain one, or undefined for any other message. */
export function signOutChoice(data: unknown): SignOutChoice | null | undefined {
  if (data === SIGNED_OUT) return null;
  if (data === signedOutMessage('keep')) return 'keep';
  if (data === signedOutMessage('discard')) return 'discard';
  return undefined;
}
/** The event a 401 dispatches on window before studioFetch goes to sign-in. */
export const AUTH_REQUIRED = 'studio:auth-required';

export interface StudioFetchOptions {
  /** A command's input, sent as JSON. A query sends none. */
  readonly body?: unknown;
  /** The page's CSRF token, which every command needs. */
  readonly csrfToken?: string;
  /** A query's input, as search parameters. */
  readonly query?: Readonly<Record<string, string>>;
  /** Lets the request outlive the page, as a command sent on pagehide must. */
  readonly keepalive?: boolean;
  /** For auth.logout: the owner's choice for the journal, which the other tabs hear. */
  readonly signOut?: SignOutChoice;
}

/** The part of a BroadcastChannel a tab uses: one per tab, to post and to listen. */
export type TabChannel = Pick<
  BroadcastChannel,
  'postMessage' | 'addEventListener' | 'removeEventListener'
>;

/** What studioFetch reaches in the browser, so a test can stand in for it. */
export interface StudioFetchEnv {
  readonly fetch: typeof fetch;
  /** This tab's channel on SESSION_CHANNEL, which reaches every other tab, and never this one. */
  readonly channel: TabChannel;
  /** Dispatches `event` on window, returning false when a listener cancelled it. */
  readonly dispatch: (event: Event) => boolean;
  /** The path and query the page is on. */
  readonly here: () => string;
  readonly navigate: (location: string) => void;
}

/** studioFetch over `env`. */
export function createStudioFetch(env: StudioFetchEnv) {
  return async function studioFetch(
    name: string,
    { body, csrfToken, query, keepalive, signOut }: StudioFetchOptions = {},
  ): Promise<Response> {
    const command = body !== undefined;
    const search = query ? `?${new URLSearchParams(query)}` : '';
    const headers: Record<string, string> = {};
    if (command) headers['content-type'] = 'application/json';
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
    const response = await env.fetch(`/api/studio/${encodeURIComponent(name)}${search}`, {
      method: command ? 'POST' : 'GET',
      headers,
      body: command ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(keepalive ? { keepalive: true } : {}),
    });
    if (response.status === 401) {
      env.channel.postMessage(SIGNED_OUT);
      if (env.dispatch(new Event(AUTH_REQUIRED, { cancelable: true }))) {
        env.navigate(signInLocation('session_ended', safeReturnTo(env.here())));
      }
    } else if (name === 'auth.logout' && response.ok) {
      env.channel.postMessage(signOut ? signedOutMessage(signOut) : SIGNED_OUT);
    }
    return response;
  };
}

/** This tab's channel, made the first time it's needed and kept as long as the page. */
let tabChannel: BroadcastChannel | undefined;

function browser(): StudioFetchEnv {
  return {
    fetch: (input, init) => fetch(input, init),
    channel: (tabChannel ??= new BroadcastChannel(SESSION_CHANNEL)),
    dispatch: (event) => window.dispatchEvent(event),
    here: () => `${window.location.pathname}${window.location.search}`,
    navigate: (location) => window.location.assign(location),
  };
}

/** Sends the Studio operation `name` from a Studio page. */
export function studioFetch(name: string, options?: StudioFetchOptions): Promise<Response> {
  return createStudioFetch(browser())(name, options);
}

/**
 * Leaves Studio when another tab signs out or loses its session: to sign-in
 * with `signed_out`, keeping the path this tab was on. It listens on the
 * channel this tab posts on, so it never hears this tab's own. Returns the
 * unsubscribe.
 */
export function leaveOnSignOut(
  env: Pick<StudioFetchEnv, 'channel' | 'here' | 'navigate'> = browser(),
): () => void {
  const listener = (event: MessageEvent) => {
    if (signOutChoice(event.data) !== undefined) {
      env.navigate(signInLocation('signed_out', safeReturnTo(env.here())));
    }
  };
  env.channel.addEventListener('message', listener);
  return () => env.channel.removeEventListener('message', listener);
}

/**
 * Calls `listener` when another tab signs out or loses its session, and
 * leaves the page where it is: a page that keeps local work, such as
 * /studio/preview (#7, Slice 4), says the session expired instead of going
 * to sign-in. Returns the unsubscribe.
 */
export function onSignedOut(
  listener: (choice: SignOutChoice | null) => void,
  env: Pick<StudioFetchEnv, 'channel'> = browser(),
): () => void {
  const handle = (event: MessageEvent) => {
    const choice = signOutChoice(event.data);
    if (choice !== undefined) listener(choice);
  };
  env.channel.addEventListener('message', handle);
  return () => env.channel.removeEventListener('message', handle);
}

/**
 * Tells every other Studio tab the session ended, as a 401 does, for a page
 * that learns it another way: /studio/preview (#7, Slice 4), when a grant's
 * status says its session ended. Never for what another tab said, or two
 * tabs would tell each other forever.
 */
export function announceSignedOut(env: Pick<StudioFetchEnv, 'channel'> = browser()): void {
  env.channel.postMessage(SIGNED_OUT);
}

/** Where a page goes once its own sign-out succeeds. */
export const SIGNED_OUT_LOCATION = signInLocation('signed_out', DEFAULT_RETURN_TO);
