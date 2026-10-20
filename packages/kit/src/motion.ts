'use client';

import { useSyncExternalStore } from 'react';
import type { MotionPolicy } from '@portfolio/schema';

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
 *   motion policy        OS prefers-reduced-motion         result
 *   ─────────────        ──────────────────────────        ──────
 *   reduce               (any)                             reduce
 *   respect-os           true                              reduce
 *   respect-os           false                             full
 *
 * No policy turns motion on past an OS reduce preference. Defaults to `full`
 * during SSR and hydration to avoid layout-shift; the OS value takes over
 * right after hydration and follows later changes.
 */
export function useMotionPreference(policy: MotionPolicy = 'respect-os'): ResolvedMotion {
  const osReduce = useSyncExternalStore(
    subscribeReducedMotion,
    osPrefersReducedMotion,
    serverPrefersReducedMotion,
  );

  return shouldReduceMotion(policy, osReduce) ? 'reduce' : 'full';
}

/**
 * Synchronous-on-server, OS-respecting variant of useMotionPreference. Useful
 * for components that need the resolved value as a boolean prop without
 * ceremony.
 */
export function shouldReduceMotion(policy: MotionPolicy, osReduce: boolean): boolean {
  return policy === 'reduce' || osReduce;
}
