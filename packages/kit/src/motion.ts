'use client';

import {
  createContext,
  createElement,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { MotionPolicy } from '@portfolio/schema';
import { documentInputs, SERVER_INPUTS, subscribeDocument } from './runtime/store';

export type ResolvedMotion = 'reduce' | 'full';

/** The site's motion policy, which a variant's root provides from its render input. */
const MotionPolicyContext = createContext<MotionPolicy>('respect-os');

/**
 * Gives every motion hook below it the site's motion policy. A variant wraps
 * its page in it with `input.presentation.motionPolicy`, so a
 * `reduce` policy reaches each component without threading it through props.
 */
export function MotionPolicyProvider({
  policy = 'respect-os',
  children,
}: {
  policy?: MotionPolicy;
  children?: ReactNode;
}) {
  return createElement(MotionPolicyContext.Provider, { value: policy }, children);
}

/** The policy the nearest MotionPolicyProvider gives, else `respect-os`. */
export function useProvidedMotionPolicy(): MotionPolicy {
  return useContext(MotionPolicyContext);
}

// The OS's preference comes from the kit runtime's one document store
// (runtime/store.ts), so every hook and effect on the page reads the same value.
const osPrefersReducedMotion = () => documentInputs().osReduced;
const serverPrefersReducedMotion = () => SERVER_INPUTS.osReduced;

/**
 * Resolve the effective motion mode for a session.
 *
 *   motion policy        OS prefers-reduced-motion         result
 *   ─────────────        ──────────────────────────        ──────
 *   reduce               (any)                             reduce
 *   respect-os           true                              reduce
 *   respect-os           false                             full
 *
 * No policy turns motion on past an OS reduce preference. The policy is the
 * one MotionPolicyProvider gives (else `respect-os`), and a component's own
 * `policy` can only add a `reduce` to it: either one at `reduce` reduces, so
 * a component's `respect-os` default never undoes a site's `reduce`. Defaults
 * to `full` during SSR and hydration to avoid layout-shift (unless the policy
 * is `reduce`); the OS value takes over right after hydration and follows
 * later changes.
 *
 * This is the preference, not whether an effect may run now: an effect
 * runs on useEnhancementRuntime from `@portfolio/kit/runtime`, which also
 * pauses it while it's hidden, offscreen, or paused by the visitor, and
 * keeps it static until the page has mounted.
 */
export function useMotionPreference(policy?: MotionPolicy): ResolvedMotion {
  const provided = useContext(MotionPolicyContext);
  const osReduce = useSyncExternalStore(
    subscribeDocument,
    osPrefersReducedMotion,
    serverPrefersReducedMotion,
  );
  const reduce = policy === 'reduce' || provided === 'reduce';

  return shouldReduceMotion(reduce ? 'reduce' : 'respect-os', osReduce) ? 'reduce' : 'full';
}

/**
 * Synchronous-on-server, OS-respecting variant of useMotionPreference. Useful
 * for components that need the resolved value as a boolean prop without
 * ceremony.
 */
export function shouldReduceMotion(policy: MotionPolicy, osReduce: boolean): boolean {
  return policy === 'reduce' || osReduce;
}
