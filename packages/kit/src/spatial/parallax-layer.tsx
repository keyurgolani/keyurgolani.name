'use client';

import { useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { MotionPolicy } from '@portfolio/schema';
import { useEnhancementRuntime, useFrameLoop } from '../runtime';

interface ParallaxLayerProps {
  children: ReactNode;
  motionPreference?: MotionPolicy;
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
 * It runs on the kit runtime: reduced motion freezes everything (no
 * scroll/pointer response), and it holds still while the document is
 * hidden, the layer is offscreen, or the visitor paused motion.
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
  const runtime = useEnhancementRuntime({ motionPolicy: motionPreference });
  const ref = useRef<HTMLDivElement | null>(null);
  const { attachRoot } = runtime;
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      ref.current = node;
      attachRoot(node);
    },
    [attachRoot],
  );
  // Where the scroll and the pointer put the layer, kept across pauses.
  const at = useRef({ scroll: 0, mx: 0, my: 0, curMx: 0, curMy: 0 });
  const active = runtime.state === 'active';

  useEffect(() => {
    if (!active) return;
    const target = at.current;
    function onScroll() {
      target.scroll = window.scrollY * scrollSpeed;
    }
    function onMove(e: PointerEvent) {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      target.mx = (e.clientX / w - 0.5) * 2;
      target.my = (e.clientY / h - 0.5) * 2;
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointermove', onMove);
    };
  }, [active, scrollSpeed]);

  useFrameLoop(runtime, () => {
    const target = at.current;
    target.curMx += (target.mx - target.curMx) * 0.08;
    target.curMy += (target.my - target.curMy) * 0.08;
    if (ref.current) {
      const tx = target.curMx * mouseInfluence * 40;
      const ty = target.curMy * mouseInfluence * 40 - target.scroll;
      ref.current.style.transform = `translate3d(${tx}px, ${ty}px, ${depth}px)`;
    }
  });

  return (
    <div
      ref={attach}
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
