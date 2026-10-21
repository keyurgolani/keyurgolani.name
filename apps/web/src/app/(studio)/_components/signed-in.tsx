'use client';

import { useEffect, useState } from 'react';
import { leaveOnSignOut, SIGNED_OUT_LOCATION, studioFetch } from '~/lib/studio-fetch';

// The placeholder Studio page's client part (#2): Sign out, through
// studioFetch, and leaving Studio when another tab signs out. #8 replaces
// both with the Studio shell.

export function SignedIn({ csrfToken }: { csrfToken: string }) {
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => leaveOnSignOut(), []);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await studioFetch('auth.logout', { body: {}, csrfToken });
      if (response.ok) {
        window.location.assign(SIGNED_OUT_LOCATION);
        return;
      }
    } catch {
      // The same notice as a refused sign-out, below.
    }
    setBusy(false);
    setFailed(true);
  }

  return (
    <>
      <button
        type="button"
        className="studio-button"
        aria-disabled={busy ? true : undefined}
        onClick={signOut}
      >
        Sign out
      </button>
      <p className="studio-alert" role="alert" hidden={!failed}>
        {failed ? "Couldn't sign out. Try again." : null}
      </p>
    </>
  );
}
