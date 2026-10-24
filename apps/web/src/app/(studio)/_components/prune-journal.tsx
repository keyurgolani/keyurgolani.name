'use client';

import { useEffect } from 'react';
import { pruneJournal } from '~/lib/studio/journal';

// The sign-in page's part in the journal of unsaved edits (#8, Slice 1):
// it drops what may not stay, an expired entry or one from the future, as
// the page loads. It reads nothing out of the journal and renders nothing,
// so no unsaved text shows before authentication.

export function PruneJournal() {
  useEffect(() => {
    try {
      pruneJournal(window.localStorage, Date.now());
    } catch {
      // Storage that refuses holds nothing to prune.
    }
  }, []);
  return null;
}
