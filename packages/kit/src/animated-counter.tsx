'use client';

import { useEffect, useRef, useState } from 'react';
import { useMotionPreference } from './motion';
import type { MotionPreference } from '@portfolio/schema';

export interface AnimatedCounterProps {
  /** Target numeric value to count up to. */
  end: number;
  /** Animation duration in milliseconds. Default 1800. */
  durationMs?: number;
  /** Optional prefix (e.g. `$`, `~`). */
  prefix?: string;
  /** Optional suffix (e.g. `+`, `K`, `B`). */
  suffix?: string;
  /** Decimal places. Default 0 (rounded integer). */
  decimals?: number;
  /** Start the count when the element scrolls into view. Default true. */
  startOnView?: boolean;
  /** Override portfolio motion preference; default `respect-os`. */
  motionPreference?: MotionPreference;
  className?: string;
}

/**
 * Counts from 0 to `end` using a cubic ease-out, starting either on mount
 * (`startOnView: false`) or the first time the element scrolls into view
 * (default). Reduced-motion users see the final value immediately.
 *
 * No spring physics — a `requestAnimationFrame` ramp gives predictable end
 * frames and is light enough that running 4–8 of these on a stats grid
 * costs nothing.
 */
export function AnimatedCounter({
  end,
  durationMs = 1800,
  prefix,
  suffix,
  decimals = 0,
  startOnView = true,
  motionPreference,
  className,
}: AnimatedCounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(0);
  const reduce = useMotionPreference(motionPreference) === 'reduce';

  useEffect(() => {
    if (reduce) {
      setValue(end);
      return;
    }
    const el = ref.current;
    if (!el) return;

    let cancelled = false;

    function ramp() {
      const start = performance.now();
      const tick = (now: number) => {
        if (cancelled) return;
        const t = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - t, 3);
        const next = end * eased;
        const rounded =
          decimals > 0 ? Number.parseFloat(next.toFixed(decimals)) : Math.round(next);
        setValue(rounded);
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    if (!startOnView) {
      ramp();
      return () => {
        cancelled = true;
      };
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        ramp();
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [end, durationMs, decimals, startOnView, reduce]);

  const formatted = decimals > 0 ? value.toFixed(decimals) : value.toLocaleString();
  return (
    <span
      ref={ref}
      className={className}
      aria-label={`${prefix ?? ''}${end}${suffix ?? ''}`}
    >
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
