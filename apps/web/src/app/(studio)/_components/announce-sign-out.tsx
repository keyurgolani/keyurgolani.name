'use client';

import { useEffect } from 'react';
import { announceSignedOut } from '~/lib/studio-fetch';

// The sign-in page's part in a native sign-out (row 88c-RC2): Studio's Sign out form posts
// auth.logout and lands here, with no script of the tab's own to tell the others. So once this
// page's script runs it posts `logout` on the tabs' channel, as a JavaScript sign-out does, and
// every Studio tab leaves. The page renders it only for a sign-out this origin sent it from
// (announcesSignOut), so no link from elsewhere can sign the owner's tabs out of Studio.

export function AnnounceSignOut() {
  useEffect(() => {
    try {
      announceSignedOut();
    } catch {
      // A browser with no BroadcastChannel has no other tab to tell.
    }
  }, []);
  return null;
}
