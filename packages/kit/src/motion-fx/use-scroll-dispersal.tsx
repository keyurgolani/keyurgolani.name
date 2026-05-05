'use client';

import {
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { useMemo } from 'react';

export interface ScrollDispersalOptions {
  /**
   * The element's anchored CSS position as a `{ x, y }` percent pair
   * (`{ x: '20%', y: '70%' }`). The dispersal direction is computed as
   * the radial vector from viewport center (50%, 50%) to this anchor.
   */
  position: { x: string; y: string };
  /**
   * How far (in CSS pixels) the element drifts at the end of the dispersal
   * range. The actual translation is `maxDispersal × normalizedDirection ×
   * multiplier`. Default 500.
   */
  maxDispersal?: number;
  /**
   * Per-element multiplier on the dispersal distance. Lets the variant
   * scatter different elements at different rates without changing
   * `maxDispersal` globally. Default 1.
   */
  multiplier?: number;
  /**
   * Scroll-Y range (`[start, end]`) over which the dispersal interpolates.
   * Default `[0, 600]`.
   */
  scrollRange?: readonly [number, number];
  /**
   * Output range for opacity at the four breakpoints
   * `[0, 0.4×end, 0.7×end, end]`. Default `[1, 0.85, 0.4, 0]`.
   */
  opacityCurve?: readonly [number, number, number, number];
  /**
   * Output range for scale at `[0, end]`. Default `[1, 0.75]`.
   */
  scaleRange?: readonly [number, number];
  /**
   * Spring config for the smoothed motion values. Defaults match a soft
   * page-zero feel: `x/y { stiffness: 80, damping: 20, mass: 0.8 }`,
   * `opacity { stiffness: 100, damping: 30, mass: 0.5 }`,
   * `scale { stiffness: 100, damping: 25, mass: 0.5 }`.
   */
  spring?: {
    motion?: { stiffness?: number; damping?: number; mass?: number };
    opacity?: { stiffness?: number; damping?: number; mass?: number };
    scale?: { stiffness?: number; damping?: number; mass?: number };
  };
  /**
   * When `false`, all returned motion values output identity (no movement,
   * full opacity, scale 1). Use this to gate dispersal on
   * `prefers-reduced-motion` from the consuming variant.
   */
  enabled?: boolean;
}

export interface ScrollDispersalValues {
  x: MotionValue<number>;
  y: MotionValue<number>;
  opacity: MotionValue<number>;
  scale: MotionValue<number>;
}

/**
 * Returns spring-smoothed motion values that disperse an anchored element
 * outward from viewport center as the page scrolls past. Apply to a
 * `motion.div` via `style={{ x, y, opacity, scale }}`.
 *
 * Direction is radial from center: an element pinned at `{ x: '20%', y: '70%' }`
 * drifts down-and-left; one at `{ x: '85%', y: '15%' }` drifts up-and-right.
 * Distance from center is normalized so corner elements travel further than
 * near-center ones — feels organic, not uniform.
 *
 * Reduced-motion: pass `enabled: false` to freeze every output to its identity
 * value while keeping the same hook contract.
 */
export function useScrollDispersal(options: ScrollDispersalOptions): ScrollDispersalValues {
  const {
    position,
    maxDispersal = 500,
    multiplier = 1,
    scrollRange = [0, 600],
    opacityCurve = [1, 0.85, 0.4, 0],
    scaleRange = [1, 0.75],
    spring,
    enabled = true,
  } = options;

  const direction = useMemo(() => {
    const px = parseFloat(position.x);
    const py = parseFloat(position.y);
    const dx = px - 50;
    const dy = py - 50;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const normalized = Math.min(dist / 50, 1);
    return {
      x: dx !== 0 ? (dx / Math.abs(dx)) * normalized : 0,
      y: dy !== 0 ? (dy / Math.abs(dy)) * normalized : 0,
    };
  }, [position.x, position.y]);

  const motionSpring = {
    stiffness: spring?.motion?.stiffness ?? 80,
    damping: spring?.motion?.damping ?? 20,
    mass: spring?.motion?.mass ?? 0.8,
  };
  const opacitySpring = {
    stiffness: spring?.opacity?.stiffness ?? 100,
    damping: spring?.opacity?.damping ?? 30,
    mass: spring?.opacity?.mass ?? 0.5,
  };
  const scaleSpring = {
    stiffness: spring?.scale?.stiffness ?? 100,
    damping: spring?.scale?.damping ?? 25,
    mass: spring?.scale?.mass ?? 0.5,
  };

  const { scrollY } = useScroll();

  const xRange: [number, number] = enabled
    ? [0, maxDispersal * direction.x * multiplier]
    : [0, 0];
  const yRange: [number, number] = enabled
    ? [0, maxDispersal * direction.y * multiplier]
    : [0, 0];
  const enabledOpacity: [number, number, number, number] = enabled
    ? [opacityCurve[0], opacityCurve[1], opacityCurve[2], opacityCurve[3]]
    : [1, 1, 1, 1];
  const enabledScale: [number, number] = enabled
    ? [scaleRange[0], scaleRange[1]]
    : [1, 1];

  const opacityStops: [number, number, number, number] = [
    scrollRange[0],
    scrollRange[1] * 0.4,
    scrollRange[1] * 0.7,
    scrollRange[1],
  ];

  const rawX = useTransform(scrollY, [...scrollRange], xRange);
  const rawY = useTransform(scrollY, [...scrollRange], yRange);
  const rawOpacity = useTransform(scrollY, opacityStops, enabledOpacity);
  const rawScale = useTransform(scrollY, [...scrollRange], enabledScale);

  const x = useSpring(rawX, motionSpring);
  const y = useSpring(rawY, motionSpring);
  const opacity = useSpring(rawOpacity, opacitySpring);
  const scale = useSpring(rawScale, scaleSpring);

  return { x, y, opacity, scale };
}
