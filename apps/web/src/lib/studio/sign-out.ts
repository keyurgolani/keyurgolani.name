import {
  SIGNED_OUT_LOCATION,
  STORE_FAILED_LOCATION,
  type SignOutChoice,
  type StudioFetchOptions,
} from '~/lib/studio-fetch';

// Signing out of Owner Studio (#8, row 88): auth.logout through studioFetch,
// with the page's CSRF token and the owner's choice for the journal, which
// studioFetch tells every other tab once the server has answered. The owner
// shell imports this statically, so Sign out never waits on the owner
// adapter's chunk, which loads after the shell has hydrated and may never
// come; the adapter's own signOut is this function too. It says what the
// server did (row 88b): 'ended' only when its answer says it ended the
// session, 'store_failed' for any other answer that signed this browser out,
// as when its store couldn't end it, and false when it didn't sign out, so
// the cookie is still there.

type Fetch = (name: string, options?: StudioFetchOptions) => Promise<Response>;

/** How a sign-out the server answered went: it ended the session, or its store couldn't. */
export type SignedOut = 'ended' | 'store_failed';

/** What a sign-out came to: how the server signed this browser out, or false when it didn't. */
export type SignOutResult = SignedOut | false;

/** Whether `body` is exactly auth.logout's answer for a session it ended. */
function ended(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const { data, ...rest } = body as { data?: unknown };
  if (Object.keys(rest).length > 0 || typeof data !== 'object' || data === null) return false;
  const keys = Object.keys(data);
  return keys.length === 1 && (data as { signedOut?: unknown }).signedOut === true;
}

/**
 * Signs out with `choice`. A 200 clears this browser's cookie whatever it
 * says, so one that isn't exactly the ended answer is 'store_failed': it
 * never claims the server ended a session it didn't say it ended.
 */
export async function signOutWith(
  studioFetch: Fetch,
  csrfToken: string,
  choice: SignOutChoice,
): Promise<SignOutResult> {
  let response: Response;
  try {
    response = await studioFetch('auth.logout', { body: {}, csrfToken, signOut: choice });
  } catch {
    return false;
  }
  if (!response.ok) return false;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return 'store_failed';
  }
  return ended(body) ? 'ended' : 'store_failed';
}

/** The sign-in page each answer goes to. Both callers, the shell and its load alert, go through it. */
const SIGNED_OUT_LOCATIONS: Readonly<Record<SignedOut, string>> = Object.freeze({
  ended: SIGNED_OUT_LOCATION,
  store_failed: STORE_FAILED_LOCATION,
});

/** Where a tab goes once the server signed it out, by how that went. */
export function signedOutLocation(how: SignedOut): string {
  return SIGNED_OUT_LOCATIONS[how];
}
