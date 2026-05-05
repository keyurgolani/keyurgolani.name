'use client';

import type { CSSProperties } from 'react';
import { useMotionPreference } from '../motion';
import type { MotionPreference } from '@portfolio/schema';

interface ScanlineOverlayProps {
  motionPreference?: MotionPreference;
  /** Scanline color (rgba). */
  scanlineColor?: string;
  /** Distance between scanlines (px). */
  scanlineSpacing?: number;
  /** Scroll speed for scanline animation (s per pass). */
  scrollSpeed?: number;
  /** Adds chromatic aberration drop-shadow filter. */
  chromaticAberration?: boolean;
  /** Adds vignette darkening at edges. */
  vignette?: boolean;
  /** Tint color overlay (rgba). */
  tint?: string;
  /** Opacity of the entire overlay. */
  opacity?: number;
  /** z-index. */
  zIndex?: number;
}

/**
 * Pure-CSS CRT/scanline filter overlay. Stacked layers:
 *   1. Repeating gradient scanlines (vertical)
 *   2. Optional chromatic-aberration drop-shadow on contained content
 *   3. Optional vignette (radial dark gradient at edges)
 *   4. Optional tint
 *
 * The scanlines slowly scroll vertically. Reduced motion stops the scroll.
 */
export function ScanlineOverlay({
  motionPreference = 'respect-os',
  scanlineColor = 'rgba(255, 255, 255, 0.06)',
  scanlineSpacing = 3,
  scrollSpeed = 8,
  chromaticAberration = false,
  vignette = true,
  tint,
  opacity = 1,
  zIndex = 2,
}: ScanlineOverlayProps) {
  const motion = useMotionPreference(motionPreference);
  const animate = motion === 'full';

  const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    zIndex,
    opacity,
    backgroundImage: `repeating-linear-gradient(0deg, transparent 0, transparent ${scanlineSpacing - 1}px, ${scanlineColor} ${scanlineSpacing - 1}px, ${scanlineColor} ${scanlineSpacing}px)`,
    animation: animate ? `scanline-scroll ${scrollSpeed}s linear infinite` : undefined,
    mixBlendMode: 'screen',
  };

  return (
    <>
      <div aria-hidden="true" style={overlayStyle} />
      {vignette ? (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            zIndex: zIndex - 1,
            background: 'radial-gradient(ellipse at center, transparent 0%, transparent 55%, rgba(0,0,0,0.5) 100%)',
          }}
        />
      ) : null}
      {tint ? (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            zIndex: zIndex - 2,
            background: tint,
            mixBlendMode: 'multiply',
          }}
        />
      ) : null}
      <style>{`
        @keyframes scanline-scroll {
          from { background-position: 0 0; }
          to   { background-position: 0 ${scanlineSpacing * 4}px; }
        }
        ${chromaticAberration
          ? `[data-crt-filter] { filter: drop-shadow(1px 0 0 rgba(255,0,80,0.35)) drop-shadow(-1px 0 0 rgba(0,200,255,0.35)); }`
          : ''}
      `}</style>
    </>
  );
}
