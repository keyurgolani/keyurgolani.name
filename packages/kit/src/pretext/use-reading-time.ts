import { useMemo } from 'react';

const WORDS_PER_MINUTE = 230;

/**
 * Pure server-safe reading-time estimate. Independent of pretext, no DOM
 * access — just word count. Use this from server components.
 */
export function readingTimeFor(text: string | undefined | null): number | null {
  if (!text) return null;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (!words) return null;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/**
 * Memoized client-side variant of `readingTimeFor`. Use only when reading
 * time depends on dynamic body content that changes during the session;
 * otherwise prefer `readingTimeFor` to keep components server-rendered.
 */
export function useReadingTime(text: string | undefined | null): number | null {
  return useMemo(() => readingTimeFor(text), [text]);
}
