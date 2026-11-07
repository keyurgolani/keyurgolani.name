import type { SignOutChoice, StudioFetchOptions } from '~/lib/studio-fetch';

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
