'use client';

import { useCallback, useRef } from 'react';
import { useMotionValue, useSpring, type MotionValue } from 'framer-motion';

export interface MouseTiltOptions {
  /** Maximum tilt in degrees. Default 5. */
  maxDegrees?: number;
  /** Spring config for the tilt motion values. */
  spring?: { stiffness?: number; damping?: number };
  /** When true (default), tilts are applied. Set false to freeze (e.g., for reduced motion). */
  enabled?: boolean;
}

export interface MouseTiltValues {
  /** Container ref — attach this to the element you want tilted. */
  ref: React.RefObject<HTMLDivElement | null>;
  /** Apply via `style={{ rotateX }}`. */
  rotateX: MotionValue<number>;
  /** Apply via `style={{ rotateY }}`. */
  rotateY: MotionValue<number>;
  /** Pointer X relative to the container, in pixels. Useful for radial-gradient hover glow. */
  mouseX: MotionValue<number>;
  /** Pointer Y relative to the container, in pixels. */
  mouseY: MotionValue<number>;
  /** Pass to `onMouseMove` of the same element (or a child). */
  onMouseMove: (e: React.MouseEvent<HTMLElement>) => void;
  /** Pass to `onMouseLeave` to reset rotation. */
  onMouseLeave: () => void;
}

/**
 * Mouse-tracked 3D card tilt. Returns spring-smoothed `rotateX`/`rotateY`
 * motion values plus pointer position values (useful for radial-gradient
 * hover-glow effects).
 *
 * Apply as:
 *
 *   const tilt = useMouseTilt();
 *   <motion.div ref={tilt.ref} onMouseMove={tilt.onMouseMove}
 *               onMouseLeave={tilt.onMouseLeave}
 *               style={{ perspective: 1000, rotateX: tilt.rotateX, rotateY: tilt.rotateY }}>
 *     ...
 *   </motion.div>
 */
export function useMouseTilt(options: MouseTiltOptions = {}): MouseTiltValues {
  const maxDegrees = options.maxDegrees ?? 5;
  const enabled = options.enabled ?? true;
  const springConfig = {
    stiffness: options.spring?.stiffness ?? 300,
    damping: options.spring?.damping ?? 40,
  };

  const ref = useRef<HTMLDivElement | null>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);

  const springRotateX = useSpring(rotateX, springConfig);
  const springRotateY = useSpring(rotateY, springConfig);

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (!enabled) return;
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      mouseX.set(x);
      mouseY.set(y);
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      // Negative Y for natural "tilt toward the cursor" feel.
      rotateX.set(((cy - y) / cy) * maxDegrees);
      rotateY.set(((x - cx) / cx) * maxDegrees);
    },
    [enabled, mouseX, mouseY, rotateX, rotateY, maxDegrees],
  );

  const onMouseLeave = useCallback(() => {
    rotateX.set(0);
    rotateY.set(0);
  }, [rotateX, rotateY]);

  return {
    ref,
    rotateX: springRotateX,
    rotateY: springRotateY,
    mouseX,
    mouseY,
    onMouseMove,
    onMouseLeave,
  };
}
