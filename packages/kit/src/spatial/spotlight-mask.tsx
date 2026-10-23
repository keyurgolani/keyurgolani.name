'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { MotionPolicy } from '@portfolio/schema';
import { useEnhancementRuntime, useFrameLoop } from '../runtime';

interface SpotlightMaskProps {
  motionPreference?: MotionPolicy;
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
 * Uses CSS custom properties (--mx, --my) updated once a frame so the
 * gradient stays in sync with the cursor without causing reflows. It runs on
 * the kit runtime: under reduced motion it takes `reducedFallback`, a touch
 * screen holds it at the center, and it holds still while the document is
 * hidden or the visitor paused motion.
 */
export function SpotlightMask({
  motionPreference = 'respect-os',
  radius = 280,
  intensity = 0.88,
  damping = 0.22,
  shade = '#000',
  reducedFallback = 'static-center',
}: SpotlightMaskProps) {
  const runtime = useEnhancementRuntime({
    motionPolicy: motionPreference,
    requires: ['fine-pointer'],
  });
  const ref = useRef<HTMLDivElement | null>(null);
  const { attachRoot } = runtime;
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      ref.current = node;
      attachRoot(node);
    },
    [attachRoot],
  );
  const reduced = runtime.state === 'static' && runtime.reason === 'reduced';
  const follows = runtime.eligible && runtime.state === 'active';
  // Where the pointer is and where the spotlight trails it, kept across pauses.
  const pointer = useRef<{ x: number; y: number; curX: number; curY: number } | null>(null);

  // Reduced motion lifts the mask for 'visible'; otherwise it stays at the
  // center the CSS falls back to, or where the spotlight last was.
  useEffect(() => {
    const element = ref.current;
    if (!element || !reduced || reducedFallback !== 'visible') return;
    element.style.opacity = '0';
    return () => {
      element.style.opacity = '';
    };
  }, [reduced, reducedFallback]);

  useEffect(() => {
    if (!follows) return;
    if (!pointer.current) {
      const x = window.innerWidth / 2;
      const y = window.innerHeight / 2;
      pointer.current = { x, y, curX: x, curY: y };
    }
    const at = pointer.current;
    function onMove(e: PointerEvent) {
      at.x = e.clientX;
      at.y = e.clientY;
    }
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [follows]);

  useFrameLoop({ state: runtime.eligible ? runtime.state : 'static' }, () => {
    const at = pointer.current;
    if (!at || !ref.current) return;
    at.curX += (at.x - at.curX) * damping;
    at.curY += (at.y - at.curY) * damping;
    ref.current.style.setProperty('--mx', `${at.curX}px`);
    ref.current.style.setProperty('--my', `${at.curY}px`);
  });

  return (
    <div
      ref={attach}
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
