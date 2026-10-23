'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { MotionPolicy } from '@portfolio/schema';
import { useEnhancementRuntime, useFrameLoop } from '../runtime';

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

interface Pointer {
  x: number;
  y: number;
  haloX: number;
  haloY: number;
  hovering: boolean;
}

/**
 * Custom cursor: a hard-edged dot tracking the pointer instantly, plus a
 * larger halo that lags behind with spring damping. Halo scales up over
 * interactive elements (a, button, [data-cursor-hover]).
 *
 * Hidden on touch devices, under reduced motion, and until the page has
 * mounted. It runs on the kit runtime, so it holds still while the document
 * is hidden or the visitor paused motion. It follows the whole page, so it
 * has no root of its own to go offscreen.
 */
export function MagneticCursor({
  motionPreference = 'respect-os',
  dotSize = 6,
  haloSize = 36,
  color = 'currentColor',
  haloDamping = 0.18,
  hideSystemCursor = false,
}: MagneticCursorProps) {
  const runtime = useEnhancementRuntime({ motionPolicy: motionPreference });
  const coarsePointer = useSyncExternalStore(
    subscribeCoarsePointer,
    hasCoarsePointer,
    serverHasCoarsePointer,
  );
  const enabled = runtime.state !== 'static' && !coarsePointer;
  const active = enabled && runtime.state === 'active';
  const dotRef = useRef<HTMLDivElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);
  // Where the pointer is and where the halo trails it, kept across pauses.
  const pointer = useRef<Pointer | null>(null);

  useEffect(() => {
    if (!active) return;
    if (!pointer.current) {
      const x = window.innerWidth / 2;
      const y = window.innerHeight / 2;
      pointer.current = { x, y, haloX: x, haloY: y, hovering: false };
    }
    const at = pointer.current;
    function onMove(e: PointerEvent) {
      at.x = e.clientX;
      at.y = e.clientY;
      const target = e.target as HTMLElement | null;
      at.hovering = !!target?.closest('a, button, [data-cursor-hover]');
    }
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [active]);

  useEffect(() => {
    if (!enabled || !hideSystemCursor) return;
    document.documentElement.style.cursor = 'none';
    return () => {
      document.documentElement.style.cursor = '';
    };
  }, [enabled, hideSystemCursor]);

  useFrameLoop({ state: enabled ? runtime.state : 'static' }, () => {
    const at = pointer.current;
    if (!at) return;
    at.haloX += (at.x - at.haloX) * haloDamping;
    at.haloY += (at.y - at.haloY) * haloDamping;
    if (dotRef.current) {
      dotRef.current.style.transform = `translate3d(${at.x}px, ${at.y}px, 0) translate(-50%, -50%)`;
    }
    if (haloRef.current) {
      const scale = at.hovering ? 1.7 : 1;
      haloRef.current.style.transform = `translate3d(${at.haloX}px, ${at.haloY}px, 0) translate(-50%, -50%) scale(${scale})`;
      haloRef.current.style.opacity = at.hovering ? '0.85' : '0.5';
    }
  });

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
