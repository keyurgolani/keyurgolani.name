'use client';

import { useMemo } from 'react';
import { layoutWithLines } from '@chenglou/pretext';
import { usePrepared, type PreparedOptions } from './use-prepared';

/**
 * Compute the rendered height of a paragraph at a given width and line height.
 * Useful for marginalia alignment, masonry layouts, and any "I need to know
 * how tall this text will be before I render anything" case.
 */
export function useTextHeight(
  text: string,
  font: string,
  maxWidth: number,
  lineHeight: number,
  options?: PreparedOptions,
): { height: number; lineCount: number } | null {
  const prepared = usePrepared(text, font, options);
  return useMemo(() => {
    if (!prepared || !maxWidth || !lineHeight) return null;
    const { height, lineCount } = layoutWithLines(prepared, maxWidth, lineHeight);
    return { height, lineCount };
  }, [prepared, maxWidth, lineHeight]);
}
