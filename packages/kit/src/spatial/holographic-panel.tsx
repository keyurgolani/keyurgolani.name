import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

interface HolographicPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Adds horizontal scanline overlay. */
  scanlines?: boolean;
  /** Glow color around the edge. The boundary's accent unless given. */
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
 * Its glass, border, text, and corner are the document boundary's (#19,
 * Slice 4): the overlay surface, the subtle border, the primary text, and
 * the card radius, so it's dark glass in a dark mode and pearl in a light
 * one, with no tone of its own.
 *
 * Pure CSS — no client logic, safe in server components.
 */
export function HolographicPanel({
  children,
  scanlines = false,
  glow,
  blur = 18,
  borderWeight = 1,
  className,
  style,
  ...rest
}: HolographicPanelProps) {
  const highlight = 'color-mix(in oklab, var(--color-text-primary) 6%, transparent)';
  const base: CSSProperties = {
    position: 'relative',
    backdropFilter: `blur(${blur}px) saturate(140%)`,
    WebkitBackdropFilter: `blur(${blur}px) saturate(140%)`,
    background:
      'linear-gradient(180deg, color-mix(in oklab, var(--color-surface-overlay) 55%, transparent) 0%, color-mix(in oklab, var(--color-surface-overlay) 45%, transparent) 100%)',
    border: `${borderWeight}px solid var(--color-border-subtle)`,
    borderRadius: 'var(--ui-radius-card)',
    boxShadow: `0 0 28px -8px ${glow ?? 'var(--color-accent)'}, inset 0 1px 0 ${highlight}`,
    overflow: 'hidden',
    color: 'var(--color-text-primary)',
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
            background: `repeating-linear-gradient(0deg, transparent 0, transparent 2px, color-mix(in oklab, var(--color-text-primary) 2.5%, transparent) 2px, color-mix(in oklab, var(--color-text-primary) 2.5%, transparent) 3px)`,
            mixBlendMode: 'overlay',
          }}
        />
      ) : null}
    </div>
  );
}
