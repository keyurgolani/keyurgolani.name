'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useMotionPreference } from '../motion';
import type { MotionPolicy } from '@portfolio/schema';

const COARSE_POINTER_QUERY = '(pointer: coarse)';

function subscribeCoarsePointer(onChange: () => void): () => void {
  const mq = window.matchMedia(COARSE_POINTER_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function hasCoarsePointer(): boolean {
  return window.matchMedia(COARSE_POINTER_QUERY).matches;
}

// The server can't see the pointer, so it renders no cursor.
function serverHasCoarsePointer(): boolean {
  return true;
}

interface MagneticCursorProps {
  motionPreference?: MotionPolicy;
  /** Inner dot diameter (px). */
  dotSize?: number;
  /** Outer halo diameter (px). */
  haloSize?: number;
  /** Color of dot + halo. */
  color?: string;
  /** Spring damping for the halo (0-1). Lower = more lag. */
  haloDamping?: number;
  /** Hide system cursor entirely while this is mounted. */
  hideSystemCursor?: boolean;
}

/**
 * Custom cursor: a hard-edged dot tracking the pointer instantly, plus a
 * larger halo that lags behind with spring damping. Halo scales up over
 * interactive elements (a, button, [data-cursor-hover]).
 *
 * Hidden on touch devices and when motion preference resolves to `reduce`.
 */
export function MagneticCursor({
  motionPreference = 'respect-os',
  dotSize = 6,
  haloSize = 36,
  color = 'currentColor',
  haloDamping = 0.18,
  hideSystemCursor = false,
}: MagneticCursorProps) {
  const motion = useMotionPreference(motionPreference);
  const coarsePointer = useSyncExternalStore(
    subscribeCoarsePointer,
    hasCoarsePointer,
    serverHasCoarsePointer,
  );
  const enabled = motion !== 'reduce' && !coarsePointer;
  const dotRef = useRef<HTMLDivElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;

    let dotX = window.innerWidth / 2;
    let dotY = window.innerHeight / 2;
    let haloX = dotX;
    let haloY = dotY;
    let raf = 0;
    let hovering = false;

    function onMove(e: PointerEvent) {
      dotX = e.clientX;
      dotY = e.clientY;
      const target = e.target as HTMLElement | null;
      hovering = !!target?.closest('a, button, [data-cursor-hover]');
    }

    function tick() {
      haloX += (dotX - haloX) * haloDamping;
      haloY += (dotY - haloY) * haloDamping;
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${dotX}px, ${dotY}px, 0) translate(-50%, -50%)`;
      }
      if (haloRef.current) {
        const scale = hovering ? 1.7 : 1;
        haloRef.current.style.transform = `translate3d(${haloX}px, ${haloY}px, 0) translate(-50%, -50%) scale(${scale})`;
        haloRef.current.style.opacity = hovering ? '0.85' : '0.5';
      }
      raf = requestAnimationFrame(tick);
    }

    window.addEventListener('pointermove', onMove, { passive: true });
    raf = requestAnimationFrame(tick);

    if (hideSystemCursor) document.documentElement.style.cursor = 'none';

    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
      if (hideSystemCursor) document.documentElement.style.cursor = '';
    };
  }, [enabled, haloDamping, hideSystemCursor]);

  if (!enabled) return null;

  return (
    <>
      <div
        ref={haloRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: haloSize,
          height: haloSize,
          borderRadius: '50%',
          border: `1px solid ${color}`,
          pointerEvents: 'none',
          zIndex: 9998,
          transition: 'opacity 0.2s ease',
          willChange: 'transform, opacity',
          mixBlendMode: 'difference',
        }}
      />
      <div
        ref={dotRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: dotSize,
          height: dotSize,
          borderRadius: '50%',
          background: color,
          pointerEvents: 'none',
          zIndex: 9999,
          willChange: 'transform',
          mixBlendMode: 'difference',
        }}
      />
    </>
  );
}
