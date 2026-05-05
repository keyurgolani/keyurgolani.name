import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

interface HolographicPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Tone of the panel: 'dark' = obsidian glass, 'light' = pearl. */
  tone?: 'dark' | 'light';
  /** Adds horizontal scanline overlay. */
  scanlines?: boolean;
  /** Glow color around the edge. */
  glow?: string;
  /** Override blur amount (px). */
  blur?: number;
  /** Border thickness. */
  borderWeight?: 1 | 2;
}

/**
 * Frosted-glass card with optional scanline overlay and an edge glow. The
 * holographic feel comes from layering: blurred backdrop + faint border +
 * edge gradient + optional scanlines.
 *
 * Pure CSS — no client logic, safe in server components.
 */
export function HolographicPanel({
  children,
  tone = 'dark',
  scanlines = false,
  glow,
  blur = 18,
  borderWeight = 1,
  className,
  style,
  ...rest
}: HolographicPanelProps) {
  const base: CSSProperties = {
    position: 'relative',
    backdropFilter: `blur(${blur}px) saturate(140%)`,
    WebkitBackdropFilter: `blur(${blur}px) saturate(140%)`,
    background:
      tone === 'dark'
        ? 'linear-gradient(180deg, rgba(20,22,30,0.55) 0%, rgba(10,12,18,0.45) 100%)'
        : 'linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(240,240,245,0.45) 100%)',
    border: `${borderWeight}px solid ${
      tone === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
    }`,
    borderRadius: 4,
    boxShadow: glow
      ? `0 0 28px -8px ${glow}, inset 0 1px 0 ${tone === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.6)'}`
      : `inset 0 1px 0 ${tone === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.6)'}`,
    overflow: 'hidden',
    color: tone === 'dark' ? '#ebe7df' : '#1a1a1a',
    ...style,
  };

  return (
    <div className={cn('holographic-panel', className)} style={base} {...rest}>
      {children}
      {scanlines ? (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background:
              'repeating-linear-gradient(0deg, transparent 0, transparent 2px, rgba(255,255,255,0.025) 2px, rgba(255,255,255,0.025) 3px)',
            mixBlendMode: 'overlay',
          }}
        />
      ) : null}
    </div>
  );
}
