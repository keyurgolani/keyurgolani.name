'use client';

import { useEffect, useState } from 'react';

/**
 * Tracks whether the document's web fonts have finished loading. Pretext
 * measurements depend on the actual rendered font, so callers must wait for
 * this before measuring (otherwise widths are computed with fallback fonts).
 */
export function useFontsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // Without the Font Loading API there is nothing to wait for.
    const fontsReady: Promise<unknown> = document.fonts?.ready ?? Promise.resolve();
    fontsReady.then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return ready;
}
