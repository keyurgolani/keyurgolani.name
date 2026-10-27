'use client';

import { useEffect, useState } from 'react';
import type { MotionPolicy } from '@portfolio/schema';
import type { VariantManifest } from '@portfolio/variant-contract';
import type { ResolvedMotion } from '../motion';
import { useEnhancementRuntime, type EnhancementRuntime } from '../runtime';

/** The manifest's runtime cost class. */
type PerformanceTier = VariantManifest['performanceTier'];

export interface SpatialContractValues {
  /**
   * The kit runtime the canvas runs on: loop through `useFrameLoop(runtime, ...)`
   * so frames run only while it's active.
   */
  runtime: EnhancementRuntime;
  /** Resolved motion mode — `reduce` should freeze loops/cameras. */
  motion: ResolvedMotion;
  /** Convenience boolean. True iff `motion === 'reduce'`. */
  reduced: boolean;
  /** True when viewport <= mobileBreakpoint. */
  isMobile: boolean;
  /**
   * Device-pixel-ratio cap as `[min, max]`. Mobile is capped to keep
   * fragment-shader cost bounded. Desktop uses the runtime DPR.
   */
  dprCap: [number, number];
  /**
   * Becomes true once the canvas root has first been in view on a mounted
   * page, and stays true. Until then, the variant should render its SSR
   * poster only.
   */
  isVisible: boolean;
  /**
   * Attach to the wrapper that holds the canvas: the runtime's root, whose
   * visibility pauses it and drives `isVisible`.
   */
  rootRef: (node: Element | null) => void;
}

export interface UseSpatialContractOptions {
  /** Variant's declared performance tier — read from `manifest.performanceTier`. */
  tier?: PerformanceTier;
  /**
   * The site's motion policy. `reduce` reduces motion regardless of the OS;
   * `respect-os` (the default) follows prefers-reduced-motion.
   */
  motionPreference?: MotionPolicy;
  /** Width breakpoint in px below which `isMobile === true`. Default 768. */
  mobileBreakpoint?: number;
  /**
   * Margin around the viewport for IntersectionObserver. Default `'200px'`
   * so canvases warm up just before they scroll in.
   */
  rootMargin?: string;
}

const HEAVY_TIER_DPR_CAP_MOBILE: [number, number] = [1, 1];
const MEDIUM_TIER_DPR_CAP_MOBILE: [number, number] = [1, 1.25];
const LIGHT_TIER_DPR_CAP_MOBILE: [number, number] = [1, 1.5];
const DESKTOP_DPR_CAP: [number, number] = [1, 2];

/**
 * Single source of truth for the platform's spatial contract.
 *
 * Every spatial variant uses this hook so the same SSR/reduced-motion/
 * DPR/lazy-mount rules apply everywhere — see research/spatial.md §4. It
 * sits on the kit runtime, so `reduced` and `isVisible` are the runtime's,
 * and `runtime` pauses the canvas's loop with everything else on the page.
 *
 *   const { runtime, reduced, isMobile, dprCap, isVisible, rootRef } =
 *     useSpatialContract({ tier: manifest.performanceTier });
 *
 *   return (
 *     <div ref={rootRef} className="hero">
 *       <SsrPoster />
 *       {isVisible && !reduced ? (
 *         <Canvas dpr={dprCap}>...scene...</Canvas>
 *       ) : null}
 *     </div>
 *   );
 */
export function useSpatialContract(options: UseSpatialContractOptions = {}): SpatialContractValues {
  const tier = options.tier ?? 'light';
  const breakpoint = options.mobileBreakpoint ?? 768;
  const rootMargin = options.rootMargin ?? '200px';

  const runtime = useEnhancementRuntime({
    motionPolicy: options.motionPreference,
    rootMargin,
  });
  const reduced = runtime.state === 'static' && runtime.reason === 'reduced';
  const [isMobile, setIsMobile] = useState(false);
  const [seen, setSeen] = useState(false);
  // Once it has been in view on a mounted page, it stays visible.
  const { inView } = runtime;
  if (inView && !seen) setSeen(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [breakpoint]);

  return {
    runtime,
    motion: reduced ? 'reduce' : 'full',
    reduced,
    isMobile,
    dprCap: dprCapFor(tier, isMobile),
    isVisible: seen || inView,
    rootRef: runtime.attachRoot,
  };
}

function dprCapFor(tier: PerformanceTier, isMobile: boolean): [number, number] {
  if (!isMobile) return DESKTOP_DPR_CAP;
  switch (tier) {
    case 'heavy':
      return HEAVY_TIER_DPR_CAP_MOBILE;
    case 'medium':
      return MEDIUM_TIER_DPR_CAP_MOBILE;
    case 'light':
    default:
      return LIGHT_TIER_DPR_CAP_MOBILE;
  }
}
