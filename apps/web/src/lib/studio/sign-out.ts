import {
  SIGNED_OUT_LOCATION,
  type SignOutChoice,
  type StudioFetchOptions,
} from '~/lib/studio-fetch';

// Signing out of Owner Studio (#8, row 88): auth.logout through studioFetch,
// with the page's CSRF token and the owner's choice for the journal, which
// studioFetch tells every other tab once the server has answered. The owner
// shell imports this statically, so Sign out never waits on the owner
// adapter's chunk, which loads after the shell has hydrated and may never
// come; the adapter's own signOut is this function too.

type Fetch = (name: string, options?: StudioFetchOptions) => Promise<Response>;

/** Signs out with `choice`: true once the server answered as signed out, false otherwise. */
export async function signOutWith(
  studioFetch: Fetch,
  csrfToken: string,
  choice: SignOutChoice,
): Promise<boolean> {
  let response: Response;
  try {
    response = await studioFetch('auth.logout', { body: {}, csrfToken, signOut: choice });
  } catch {
    return false;
  }
  return response.ok;
}

/** How a sign-out the server answered went: it ended the session, or its store couldn't. */
export type SignedOut = 'ended' | 'store_failed';

/** The sign-in page each answer goes to. Both callers, the shell and its load alert, go through it. */
const SIGNED_OUT_LOCATIONS: Readonly<Record<SignedOut, string>> = Object.freeze({
  ended: SIGNED_OUT_LOCATION,
  store_failed: SIGNED_OUT_LOCATION,
});

/** Where a tab goes once the server signed it out, by how that went. */
export function signedOutLocation(how: SignedOut): string {
  return SIGNED_OUT_LOCATIONS[how];
}
