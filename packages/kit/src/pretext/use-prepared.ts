'use client';

import { useMemo } from 'react';
import { prepareWithSegments, type PreparedTextWithSegments } from '@chenglou/pretext';
import { useFontsReady } from './use-fonts-ready';

export interface PreparedOptions {
  whiteSpace?: 'normal' | 'pre-wrap';
  wordBreak?: 'normal' | 'keep-all';
  letterSpacing?: number;
}

/**
 * Prepare a text+font for repeated cheap layout calls. Re-prepares only when
 * text, font, or options change AND fonts have loaded.
 */
export function usePrepared(
  text: string,
  font: string,
  options?: PreparedOptions,
): PreparedTextWithSegments | null {
  const fontsReady = useFontsReady();

  const ws = options?.whiteSpace;
  const wb = options?.wordBreak;
  const ls = options?.letterSpacing;

  // fontsReady is false on the server and during hydration, so measurement
  // only ever runs in the browser.
  return useMemo(() => {
    if (!fontsReady || !text) return null;
    return prepareWithSegments(text, font, {
      whiteSpace: ws,
      wordBreak: wb,
      letterSpacing: ls,
    });
  }, [text, font, fontsReady, ws, wb, ls]);
}
