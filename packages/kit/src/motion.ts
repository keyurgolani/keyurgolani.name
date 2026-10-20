'use client';

import { useSyncExternalStore } from 'react';
import type { MotionPreference } from '@portfolio/schema';

export type ResolvedMotion = 'reduce' | 'full';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function osPrefersReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function serverPrefersReducedMotion(): boolean {
  return false;
}

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
 * Defaults to `full` during SSR and hydration to avoid layout-shift; the OS
 * value takes over right after hydration and follows later changes.
 */
export function useMotionPreference(
  portfolioPref: MotionPreference = 'respect-os',
): ResolvedMotion {
  const osReduce = useSyncExternalStore(
    subscribeReducedMotion,
    osPrefersReducedMotion,
    serverPrefersReducedMotion,
  );

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
