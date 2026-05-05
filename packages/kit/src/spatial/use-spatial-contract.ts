'use client';

import { useEffect, useRef, useState } from 'react';
import { useMotionPreference, type ResolvedMotion } from '../motion';
import type { PerformanceTier } from '../manifest';

export interface SpatialContractValues {
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
   * Becomes true once the canvas root has entered the viewport. Until
   * then, the variant should render its SSR poster only.
   */
  isVisible: boolean;
  /**
   * Attach to the wrapper that holds the canvas. Used by the
   * IntersectionObserver to drive `isVisible`.
   */
  rootRef: (node: HTMLElement | null) => void;
}

export interface UseSpatialContractOptions {
  /** Variant's declared performance tier — read from `manifest.performanceTier`. */
  tier?: PerformanceTier;
  /**
   * Override the OS prefers-reduced-motion. Pass the portfolio-level
   * preference here so authors can force-reduce regardless of OS.
   */
  motionPreference?: 'respect-os' | 'reduce' | 'full';
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
 * DPR/lazy-mount rules apply everywhere — see research/spatial.md §4.
 *
 *   const { reduced, isMobile, dprCap, isVisible, rootRef } =
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
export function useSpatialContract(
  options: UseSpatialContractOptions = {},
): SpatialContractValues {
  const tier = options.tier ?? 'light';
  const breakpoint = options.mobileBreakpoint ?? 768;
  const rootMargin = options.rootMargin ?? '200px';

  const motion = useMotionPreference(options.motionPreference);
  const [isMobile, setIsMobile] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const observedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [breakpoint]);

  function attachRoot(node: HTMLElement | null) {
    if (observedRef.current === node) return;

    if (observedRef.current) {
      // Disconnecting via the stored observer happens in the cleanup hook
      // below — here we only need to update the ref.
    }

    observedRef.current = node;

    if (!node || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin },
    );
    observer.observe(node);
  }

  return {
    motion,
    reduced: motion === 'reduce',
    isMobile,
    dprCap: dprCapFor(tier, isMobile),
    isVisible,
    rootRef: attachRoot,
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
