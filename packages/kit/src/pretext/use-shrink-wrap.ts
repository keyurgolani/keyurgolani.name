'use client';

import { useMemo } from 'react';
import { measureNaturalWidth } from '@chenglou/pretext';
import { usePrepared, type PreparedOptions } from './use-prepared';

/**
 * Returns the natural (widest forced-line) width of the text — the tightest
 * container width that doesn't introduce any new line breaks.
 *
 * Use it to size a heading or quote container exactly to its content.
 */
export function useShrinkWrap(
  text: string,
  font: string,
  options?: PreparedOptions,
): number | null {
  const prepared = usePrepared(text, font, options);
  return useMemo(() => {
    if (!prepared) return null;
    return measureNaturalWidth(prepared);
  }, [prepared]);
}
