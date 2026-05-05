'use client';

import { useEffect, useRef } from 'react';
import { useMotionPreference } from '../motion';
import type { MotionPreference } from '@portfolio/schema';

interface SpotlightMaskProps {
  motionPreference?: MotionPreference;
  /** Spotlight radius in px. */
  radius?: number;
  /** 0-1 — opacity of the dark-out region. Higher = more dramatic reveal. */
  intensity?: number;
  /** Spring damping (0-1, lower = more lag). */
  damping?: number;
  /** Color of the dark-out region. */
  shade?: string;
  /** When motion is reduced, behavior: 'visible' (no spotlight) or 'static-center' (fixed center). */
  reducedFallback?: 'visible' | 'static-center';
}

/**
 * Fullscreen mask that follows the pointer with a circular spotlight cutout.
 * Everything outside the spotlight darkens to `shade × intensity`.
 *
 * Uses CSS custom properties (--mx, --my) updated from a rAF-throttled
 * pointer handler so the gradient stays in sync with the cursor without
 * causing reflows.
 */
export function SpotlightMask({
  motionPreference = 'respect-os',
  radius = 280,
  intensity = 0.88,
  damping = 0.22,
  shade = '#000',
  reducedFallback = 'static-center',
}: SpotlightMaskProps) {
  const motion = useMotionPreference(motionPreference);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (motion === 'reduce') {
      if (!ref.current) return;
      if (reducedFallback === 'visible') {
        ref.current.style.opacity = '0';
      } else {
        ref.current.style.setProperty('--mx', '50%');
        ref.current.style.setProperty('--my', '50%');
      }
      return;
    }

    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    if (isTouch) {
      if (ref.current) {
        ref.current.style.setProperty('--mx', '50%');
        ref.current.style.setProperty('--my', '50%');
      }
      return;
    }

    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 2;
    let curX = targetX;
    let curY = targetY;
    let raf = 0;

    function onMove(e: PointerEvent) {
      targetX = e.clientX;
      targetY = e.clientY;
    }

    function tick() {
      curX += (targetX - curX) * damping;
      curY += (targetY - curY) * damping;
      if (ref.current) {
        ref.current.style.setProperty('--mx', `${curX}px`);
        ref.current.style.setProperty('--my', `${curY}px`);
      }
      raf = requestAnimationFrame(tick);
    }

    window.addEventListener('pointermove', onMove, { passive: true });
    raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
    };
  }, [motion, damping, reducedFallback]);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 1,
        background: `radial-gradient(circle ${radius}px at var(--mx, 50%) var(--my, 50%), transparent 0, transparent ${radius * 0.6}px, ${shade} ${radius * 1.6}px)`,
        opacity: intensity,
        transition: 'opacity 0.3s ease',
        willChange: 'background',
      }}
    />
  );
}
