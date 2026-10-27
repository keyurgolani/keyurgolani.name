'use client';

import { useMemo } from 'react';
import { layoutNextLineRange, materializeLineRange, type LayoutCursor } from '@chenglou/pretext';
import { usePrepared, type PreparedOptions } from './use-prepared';

export interface Obstacle {
  /** Top edge of obstacle, in pixels from the start of the paragraph. */
  top: number;
  /** Bottom edge of obstacle. */
  bottom: number;
  /** Width of obstacle (text wraps in `columnWidth - obstacleWidth`). */
  width: number;
  /** 'left' = obstacle on left, text flows on right. 'right' = vice versa. */
  side: 'left' | 'right';
}

export interface FlowLine {
  text: string;
  width: number;
  /** Absolute Y position relative to paragraph top. */
  y: number;
  /** The width budget that produced this line. */
  budget: number;
  /** Whether this line is "narrow" because of the obstacle. */
  narrow: boolean;
}

/**
 * Lay out a paragraph that wraps around a floating obstacle (image, callout,
 * pull quote). Returns each line's text + measured width + Y-position.
 *
 * Lines beside the obstacle use the narrower width; lines below use the full
 * column width. Line height is fixed (no per-line variation).
 */
export function useFlowAroundObstacle(
  text: string,
  font: string,
  columnWidth: number,
  lineHeight: number,
  obstacle: Obstacle | null,
  options?: PreparedOptions,
): { lines: FlowLine[]; height: number } | null {
  const prepared = usePrepared(text, font, options);

  return useMemo(() => {
    if (!prepared || !columnWidth || !lineHeight) return null;
    const lines: FlowLine[] = [];
    let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
    let y = 0;

    const widthAt = (yPos: number) => {
      if (!obstacle) return columnWidth;
      if (yPos + lineHeight <= obstacle.top || yPos >= obstacle.bottom) {
        return columnWidth;
      }
      return Math.max(columnWidth - obstacle.width, 0);
    };

    while (true) {
      const budget = widthAt(y);
      if (budget <= 0) {
        y += lineHeight;
        continue;
      }
      const range = layoutNextLineRange(prepared, cursor, budget);
      if (range === null) break;
      const line = materializeLineRange(prepared, range);
      lines.push({
        text: line.text,
        width: line.width,
        y,
        budget,
        narrow: budget < columnWidth,
      });
      cursor = range.end;
      y += lineHeight;
      if (lines.length > 5000) break; // safety
    }

    return { lines, height: y };
  }, [prepared, columnWidth, lineHeight, obstacle]);
}
