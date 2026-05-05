'use client';

import { useEffect, useState } from 'react';
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
  const [prepared, setPrepared] = useState<PreparedTextWithSegments | null>(null);

  const ws = options?.whiteSpace;
  const wb = options?.wordBreak;
  const ls = options?.letterSpacing;

  useEffect(() => {
    if (!fontsReady) return;
    if (typeof document === 'undefined') return;
    if (!text) {
      setPrepared(null);
      return;
    }
    const next = prepareWithSegments(text, font, {
      whiteSpace: ws,
      wordBreak: wb,
      letterSpacing: ls,
    });
    setPrepared(next);
  }, [text, font, fontsReady, ws, wb, ls]);

  return prepared;
}
