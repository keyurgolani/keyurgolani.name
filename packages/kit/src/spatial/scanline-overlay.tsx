'use client';

import type { CSSProperties } from 'react';
import type { MotionPolicy } from '@portfolio/schema';
import { runtimeAnimation, useEnhancementRuntime } from '../runtime';

interface ScanlineOverlayProps {
  motionPreference?: MotionPolicy;
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
 * The scanlines slowly scroll vertically, on the kit runtime: they stand
 * still on the server, until the page has mounted, and under reduced motion,
 * and the scroll pauses while the document is hidden or the visitor paused
 * motion.
 */
export function ScanlineOverlay({
  motionPreference = 'respect-os',
  // The boundary's own colors (#19, Slice 4), so the lines and the vignette
  // follow the scheme and the display mode.
  scanlineColor = 'color-mix(in oklab, var(--color-text-primary) 6%, transparent)',
  scanlineSpacing = 3,
  scrollSpeed = 8,
  chromaticAberration = false,
  vignette = true,
  tint,
  opacity = 1,
  zIndex = 2,
}: ScanlineOverlayProps) {
  const runtime = useEnhancementRuntime({ motionPolicy: motionPreference });
  const { attachRoot } = runtime;
  // Static, the lines stand still; paused, they hold where they are (runtime/animation.ts).
  const { state } = runtime;

  const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    zIndex,
    opacity,
    backgroundImage: `repeating-linear-gradient(0deg, transparent 0, transparent ${scanlineSpacing - 1}px, ${scanlineColor} ${scanlineSpacing - 1}px, ${scanlineColor} ${scanlineSpacing}px)`,
    ...runtimeAnimation(state, { name: 'scanline-scroll', seconds: scrollSpeed }),
    mixBlendMode: 'screen',
  };

  return (
    <>
      <div ref={attachRoot} aria-hidden="true" style={overlayStyle} />
      {vignette ? (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            zIndex: zIndex - 1,
            background:
              'radial-gradient(ellipse at center, transparent 0%, transparent 55%, color-mix(in oklab, var(--color-scrim) 50%, transparent) 100%)',
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
        ${
          chromaticAberration
            ? `[data-crt-filter] { filter: drop-shadow(1px 0 0 color-mix(in oklab, var(--color-data-categorical-1) 35%, transparent)) drop-shadow(-1px 0 0 color-mix(in oklab, var(--color-data-categorical-2) 35%, transparent)); }`
            : ''
        }
      `}</style>
    </>
  );
}
