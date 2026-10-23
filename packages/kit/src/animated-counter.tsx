'use client';

import { useRef, useState } from 'react';
import type { MotionPolicy } from '@portfolio/schema';
import { useEnhancementRuntime, useFrameLoop } from './runtime';

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
  motionPreference?: MotionPolicy;
  className?: string;
}

/**
 * Counts from 0 to `end` using a cubic ease-out, starting either on mount
 * (`startOnView: false`) or the first time the element scrolls into view
 * (default). Reduced-motion users see the final value immediately.
 *
 * No spring physics: a frame-loop ramp gives predictable end frames and is
 * light enough that running 4–8 of these on a stats grid costs nothing. It
 * runs on the kit runtime, so the ramp holds where it is while the document
 * is hidden, the counter is offscreen, or the visitor paused motion, picks up
 * from there, and ends its loop once it reaches `end`.
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
  // Without startOnView there's no root to watch, so it ramps once the page has mounted.
  const runtime = useEnhancementRuntime({ motionPolicy: motionPreference });
  const { attachRoot } = runtime;
  // How long the ramp has run, kept across pauses.
  const elapsed = useRef(0);
  const [ramp, setRamp] = useState({ value: 0, done: false });

  useFrameLoop(runtime, (_, delta) => {
    elapsed.current += delta;
    const t = Math.min(1, elapsed.current / durationMs);
    const eased = 1 - Math.pow(1 - t, 3);
    const next = end * eased;
    const rounded = decimals > 0 ? Number.parseFloat(next.toFixed(decimals)) : Math.round(next);
    setRamp({ value: rounded, done: t >= 1 });
    return t < 1;
  });

  // Reduced motion, and a finished ramp, show `end` itself.
  const reduced = runtime.state === 'static' && runtime.reason !== 'pending';
  const shown = reduced || ramp.done ? end : ramp.value;
  // A fixed locale, so the server's number matches the browser's during
  // hydration. #4 adds the portfolio's own locale.
  const formatted = decimals > 0 ? shown.toFixed(decimals) : shown.toLocaleString('en-US');
  return (
    <span
      ref={startOnView ? attachRoot : undefined}
      className={className}
      aria-label={`${prefix ?? ''}${end}${suffix ?? ''}`}
    >
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
