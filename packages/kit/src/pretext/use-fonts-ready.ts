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
    if (typeof document === 'undefined') return;
    if (!document.fonts?.ready) {
      setReady(true);
      return;
    }
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return ready;
}
