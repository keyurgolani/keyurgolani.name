'use client';

import { useMemo } from 'react';
import { measureLineStats } from '@chenglou/pretext';
import { usePrepared, type PreparedOptions } from './use-prepared';

export interface TextStats {
  lineCount: number;
  maxLineWidth: number;
}

/**
 * Line count + widest line for a given paragraph at a given column width.
 * Recomputed on text/font/width change. Cheap arithmetic via pretext.
 */
export function useTextStats(
  text: string,
  font: string,
  maxWidth: number,
  options?: PreparedOptions,
): TextStats | null {
  const prepared = usePrepared(text, font, options);
  return useMemo(() => {
    if (!prepared || !maxWidth || maxWidth <= 0) return null;
    return measureLineStats(prepared, maxWidth);
  }, [prepared, maxWidth]);
}
