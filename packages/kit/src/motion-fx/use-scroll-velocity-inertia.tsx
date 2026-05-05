'use client';

import {
  useScroll,
  useVelocity,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion';

export interface ScrollVelocityInertiaOptions {
  /**
   * Velocity range mapped to outputs. Default `[-1000, 0, 1000]`.
   */
  velocityRange?: readonly [number, number, number];
  /**
   * Output range for the Y translation (in pixels). Default `[-30, 0, 30]`.
   */
  yRange?: readonly [number, number, number];
  /**
   * Output range for the rotateX (in degrees). Sign is inverted
   * relative to Y range to match scroll-direction expectations.
   * Default `[15, 0, -15]`.
   */
  rotateXRange?: readonly [number, number, number];
  /**
   * Spring config for the smoothed velocity input. Default
   * `{ damping: 50, stiffness: 400 }`.
   */
  spring?: { damping?: number; stiffness?: number; mass?: number };
}

export interface ScrollVelocityInertiaValues {
  /** Translates Y based on smoothed scroll velocity. Identity when scroll is idle. */
  y: MotionValue<number>;
  /** RotateX (degrees) tied to the same smoothed velocity. */
  rotateX: MotionValue<number>;
  /** The smoothed velocity itself, exposed for callers who want to derive more outputs. */
  smoothVelocity: MotionValue<number>;
}

/**
 * Wrap the "card stretches when the scroll wheel is spun" pattern into a
 * single hook. Returns motion values consumers can apply to a wrapper
 * `motion.div` via `style={{ y, rotateX }}`.
 *
 * Used by kinetic timelines and parallax cards. Reduced-motion handling is
 * the consumer's responsibility — typically gate the values behind an
 * `isActive && motion === 'full'` check or pass `velocityRange: [0,0,0]`.
 */
export function useScrollVelocityInertia(
  options: ScrollVelocityInertiaOptions = {},
): ScrollVelocityInertiaValues {
  const velocityRange = options.velocityRange ?? [-1000, 0, 1000];
  const yRange = options.yRange ?? [-30, 0, 30];
  const rotateXRange = options.rotateXRange ?? [15, 0, -15];
  const spring = {
    damping: options.spring?.damping ?? 50,
    stiffness: options.spring?.stiffness ?? 400,
    mass: options.spring?.mass ?? 1,
  };

  const { scrollY } = useScroll();
  const velocity = useVelocity(scrollY);
  const smoothVelocity = useSpring(velocity, spring);

  const y = useTransform(smoothVelocity, [...velocityRange], [...yRange]);
  const rotateX = useTransform(smoothVelocity, [...velocityRange], [...rotateXRange]);

  return { y, rotateX, smoothVelocity };
}
