'use client';

import { useEffect, useState } from 'react';
import type { MotionPreference } from '@portfolio/schema';

export type ResolvedMotion = 'reduce' | 'full';

/**
 * Resolve the effective motion mode for a session.
 *
 *   portfolio pref       OS prefers-reduced-motion         result
 *   ──────────────       ──────────────────────────        ──────
 *   reduce               (any)                             reduce
 *   full                 (any)                             full
 *   respect-os           true                              reduce
 *   respect-os           false                             full
 *
 * Defaults to `full` during SSR to avoid layout-shift on hydration; the OS
 * value is read once on mount.
 */
export function useMotionPreference(portfolioPref: MotionPreference = 'respect-os'): ResolvedMotion {
  const [osReduce, setOsReduce] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setOsReduce(mq.matches);
    const handler = () => setOsReduce(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  if (portfolioPref === 'reduce') return 'reduce';
  if (portfolioPref === 'full') return 'full';
  return osReduce ? 'reduce' : 'full';
}

/**
 * Synchronous-on-server, OS-respecting variant of useMotionPreference. Useful
 * for components that need the resolved value as a boolean prop without
 * ceremony.
 */
export function shouldReduceMotion(portfolioPref: MotionPreference, osReduce: boolean): boolean {
  if (portfolioPref === 'reduce') return true;
  if (portfolioPref === 'full') return false;
  return osReduce;
}
