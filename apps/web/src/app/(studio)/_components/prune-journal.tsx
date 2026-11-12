'use client';

import { useEffect } from 'react';
import { journalStorage, type PendingDiscard } from '~/lib/studio/discard-marker';
import { pruneJournal } from '~/lib/studio/journal';

// The sign-in page's part in the journal of unsaved edits (#8, Slice 1):
// it drops what may not stay, an expired entry or one from the future, as
// the page loads. It reads nothing out of the journal and renders nothing,
// so no unsaved text shows before authentication.

export function PruneJournal({ pending }: { readonly pending: PendingDiscard | null }) {
  useEffect(() => {
    try {
      // A pending discard first (row 88c-RC2): a Sign out without JavaScript that chose to discard
      // lands here, and what was saved before it goes, once, before anything else reads it.
      const storage = journalStorage(window, pending);
      if (storage) pruneJournal(storage, Date.now());
    } catch {
      // Storage that refuses holds nothing to prune.
    }
  }, [pending]);
  return null;
}
