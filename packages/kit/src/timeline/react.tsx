'use client';

import type { CSSProperties, ReactNode, SVGProps } from 'react';
import { buildAxisPath, buildBranchPath, type BranchPath, type BranchPathOptions } from './paths';

/**
 * SVG vertical-axis line. Position via the parent SVG's coordinate space.
 *
 * Variants restyle freely via `stroke`, `strokeWidth`, `className`.
 */
export interface TimelineAxisProps
  extends Omit<SVGProps<SVGPathElement>, 'd'> {
  centerX: number;
  topY: number;
  bottomY: number;
}

export function TimelineAxis({
  centerX,
  topY,
  bottomY,
  stroke = 'currentColor',
  strokeWidth = 2,
  fill = 'none',
  ...rest
}: TimelineAxisProps) {
  return (
    <path
      d={buildAxisPath(centerX, topY, bottomY)}
      stroke={stroke}
      strokeWidth={strokeWidth}
      fill={fill}
      {...rest}
    />
  );
}

/**
 * Three SVG paths (fork → trunk → merge) connecting a central axis to a
 * branch line. Variants supply per-segment styling and may pass render-props
 * for animation. The component itself is presentational and side-effect-free.
 */
export interface TimelineBranchProps {
  centerX: number;
  branchX: number;
  startY: number;
  endY: number;
  pathOptions?: BranchPathOptions;
  /** Fork curve stroke. Default `currentColor`. */
  forkStroke?: string;
  /** Trunk segment stroke. Default `currentColor`. */
  trunkStroke?: string;
  /** Merge curve stroke. Default `currentColor`. */
  mergeStroke?: string;
  strokeWidth?: number;
  opacity?: number;
  /**
   * Per-segment render-prop. Receives the `d` attribute and a default
   * `<path>` element; consumers can wrap it in framer-motion or apply
   * `pathLength` animations for entrance.
   */
  renderSegment?: (input: {
    segment: 'fork' | 'trunk' | 'merge';
    d: string;
    defaultElement: ReactNode;
  }) => ReactNode;
  className?: string;
  /** Optional `id` prefix for path-level keys (useful for gradients). */
  idPrefix?: string;
}

export function TimelineBranch(props: TimelineBranchProps) {
  const {
    centerX,
    branchX,
    startY,
    endY,
    pathOptions,
    forkStroke = 'currentColor',
    trunkStroke = 'currentColor',
    mergeStroke = 'currentColor',
    strokeWidth = 2,
    opacity = 1,
    renderSegment,
    className,
    idPrefix,
  } = props;

  const built = buildBranchPath({ centerX, branchX, startY, endY, options: pathOptions });

  function makePath(seg: 'fork' | 'trunk' | 'merge', d: string, stroke: string) {
    if (!d) return null;
    const el = (
      <path
        key={`${idPrefix ?? ''}${seg}`}
        d={d}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        fill="none"
        opacity={opacity}
        className={className}
      />
    );
    if (!renderSegment) return el;
    return (
      <g key={`${idPrefix ?? ''}${seg}-wrap`}>
        {renderSegment({ segment: seg, d, defaultElement: el })}
      </g>
    );
  }

  return (
    <>
      {makePath('fork', built.fork, forkStroke)}
      {makePath('trunk', built.trunk, trunkStroke)}
      {makePath('merge', built.merge, mergeStroke)}
    </>
  );
}

/**
 * Re-export the geometry the branch produced so consumers can position
 * cards/markers at the join points without re-running the math.
 */
export type { BranchPath };

/**
 * Convenience layout helper for foreignObject-based card placement.
 *
 *   <foreignObject {...layoutBranchCard({ branchX, startY, endY, side, expanded })}>
 *     <YourCard />
 *   </foreignObject>
 */
export function layoutBranchCard(input: {
  branchX: number;
  startY: number;
  endY: number;
  side: 'left' | 'right';
  cardWidth: number;
  cardHeight: number;
  /** Extra padding around the card so animations / shadows don't clip. Default 40. */
  pad?: number;
}): { x: number; y: number; width: number; height: number; style: CSSProperties } {
  const pad = input.pad ?? 40;
  const centerY = (input.startY + input.endY) / 2;
  const y = centerY - input.cardHeight / 2;
  const xOffset = input.side === 'right' ? input.cardWidth / 2 : input.cardWidth / 2;
  // For an opened (large) card on the right, anchor at branchX (left edge).
  // For an opened card on the left, anchor at branchX - cardWidth.
  // Default (collapsed) — center on branchX.
  const x = input.branchX - xOffset;
  return {
    x: x - pad,
    y: y - pad,
    width: input.cardWidth + pad * 2,
    height: input.cardHeight + pad * 2,
    style: { overflow: 'visible' },
  };
}
