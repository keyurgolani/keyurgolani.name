'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Observe an element's content-box width. Returns a ref callback and the
 * current width (0 before mount or while ref is unattached).
 */
export function useElementWidth<T extends HTMLElement>(): readonly [
  (node: T | null) => void,
  number,
] {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);

  const ref = useCallback((node: T | null) => {
    setEl(node);
  }, []);

  useEffect(() => {
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  return [ref, width] as const;
}
