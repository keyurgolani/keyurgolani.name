'use client';

import { useRef } from 'react';
import { useInView } from 'framer-motion';

export interface ViewportCenterActiveOptions {
  /**
   * IntersectionObserver-style margin string. The default
   * `'-40% 0px -40% 0px'` activates an element only while it occupies the
   * vertical center band of the viewport. Framer-motion narrows this to
   * a `${number}${"px"|"%"}` template internally at runtime.
   */
  margin?: string;
  /** Trigger only the first time the element enters. Default false. */
  once?: boolean;
}

export interface ViewportCenterActive {
  ref: React.RefObject<HTMLDivElement | null>;
  /** True while the element occupies the center band. */
  isActive: boolean;
}

/**
 * "Element is in the viewport center" hook. Wraps Framer's `useInView` with
 * a sensible margin default for scroll-tied highlight effects.
 *
 *   const { ref, isActive } = useViewportCenterActive();
 *   <motion.div ref={ref} animate={{ scale: isActive ? 1.05 : 1 }}>
 */
export function useViewportCenterActive(
  options: ViewportCenterActiveOptions = {},
): ViewportCenterActive {
  const margin = options.margin ?? '-40% 0px -40% 0px';
  const once = options.once ?? false;
  const ref = useRef<HTMLDivElement | null>(null);
  // Framer's `margin` is typed as a strict template literal (`${number}px|%`).
  // We accept a plain string at the API surface and trust the runtime parser.
  const isActive = useInView(ref, { margin: margin as never, once });
  return { ref, isActive };
}
