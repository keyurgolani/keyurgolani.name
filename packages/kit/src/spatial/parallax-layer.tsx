'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { useMotionPreference } from '../motion';
import type { MotionPreference } from '@portfolio/schema';

interface ParallaxLayerProps {
  children: ReactNode;
  motionPreference?: MotionPreference;
  /** Scroll multiplier (0 = locked, 1 = scrolls normally, -0.3 = drifts up slowly, etc.). */
  scrollSpeed?: number;
  /** How much pointer movement translates the layer (0-1). */
  mouseInfluence?: number;
  /** Apparent z-depth (also nudges scale slightly). */
  depth?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Translates its children based on scroll position and pointer movement to
 * create depth. Each ParallaxLayer gets its own speeds; stacking multiple
 * with different speeds yields the parallax effect.
 *
 * Reduced motion freezes everything (no scroll/pointer response).
 */
export function ParallaxLayer({
  children,
  motionPreference = 'respect-os',
  scrollSpeed = 0.1,
  mouseInfluence = 0.05,
  depth = 0,
  className,
  style,
}: ParallaxLayerProps) {
  const motion = useMotionPreference(motionPreference);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (motion === 'reduce') return;
    if (typeof window === 'undefined') return;

    let scrollOffset = 0;
    let targetMx = 0;
    let targetMy = 0;
    let curMx = 0;
    let curMy = 0;
    let raf = 0;

    function onScroll() {
      scrollOffset = window.scrollY * scrollSpeed;
    }

    function onMove(e: PointerEvent) {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      targetMx = (e.clientX / w - 0.5) * 2;
      targetMy = (e.clientY / h - 0.5) * 2;
    }

    function tick() {
      curMx += (targetMx - curMx) * 0.08;
      curMy += (targetMy - curMy) * 0.08;
      if (ref.current) {
        const tx = curMx * mouseInfluence * 40;
        const ty = curMy * mouseInfluence * 40 - scrollOffset;
        ref.current.style.transform = `translate3d(${tx}px, ${ty}px, ${depth}px)`;
      }
      raf = requestAnimationFrame(tick);
    }

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointermove', onMove, { passive: true });
    raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
    };
  }, [motion, scrollSpeed, mouseInfluence, depth]);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        willChange: 'transform',
        transformStyle: 'preserve-3d',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
