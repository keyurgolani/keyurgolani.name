/**
 * Topology-driven density projection: maps timestamps to vertical positions,
 * compressing sparse intervals and expanding dense ones (when many parallel
 * events overlap in a window, we give it more room).
 *
 * Pure: no React, no DOM. Test in isolation.
 */

import type { LaneAssignment, LaneInputEvent } from './lanes';

const MS_PER_YEAR = 31_536_000_000;

export interface DensityProjectionOptions {
  /**
   * Minimum vertical step between consecutive unique timestamps. Default 280px.
   * Keeps single-event windows from collapsing visually.
   */
  minStep?: number;
  /**
   * Soft cap for how much a single year of elapsed time adds to the step.
   * Default 100px. Without a cap, sparse multi-decade gaps blow up the canvas.
   */
  maxYearStep?: number;
  /**
   * Pixels added per concurrent extra slot active in the interval.
   * Default 250px per additional slot.
   */
  pixelsPerExtraSlot?: number;
  /**
   * Final shrink factor applied to every step (use this to dial overall density).
   * Default 1/3.
   */
  globalShrink?: number;
  /**
   * Padding above the first timestamp. Default 0.
   */
  topPadding?: number;
}

export interface TimelineProjection {
  /** Map from timestamp → Y coordinate (top-down). */
  tsToY: Map<number, number>;
  /** Total vertical extent (last Y + topPadding). */
  height: number;
  /** Sorted unique timestamps used to build the map. */
  uniqueTimestamps: number[];
}

/**
 * Build a topology-driven Y projection for a set of events.
 *
 * Use the returned `tsToY.get(event.startTs)!` and `tsToY.get(event.endTs)!`
 * to position branches. The map is dense over `uniqueTimestamps` and
 * undefined elsewhere — interpolate yourself if you need intermediate Y.
 *
 * If you also want a "newest at top" inversion, pass the result through
 * `invertProjection(projection)`.
 */
export function computeDensityProjection<T extends LaneInputEvent>(
  events: readonly T[],
  assignments: readonly LaneAssignment<T>[],
  options: DensityProjectionOptions = {},
): TimelineProjection {
  const minStep = options.minStep ?? 280;
  const maxYearStep = options.maxYearStep ?? 100;
  const pixelsPerExtraSlot = options.pixelsPerExtraSlot ?? 250;
  const globalShrink = options.globalShrink ?? 1 / 3;
  const topPadding = options.topPadding ?? 0;

  if (events.length === 0) {
    return { tsToY: new Map(), height: topPadding, uniqueTimestamps: [] };
  }

  // Collect every distinct boundary the layout cares about.
  const tsSet = new Set<number>();
  for (const e of events) {
    tsSet.add(e.startTs);
    tsSet.add(e.endTs);
  }
  const uniqueTimestamps = Array.from(tsSet).sort((a, b) => a - b);

  const tsToY = new Map<number, number>();
  let cursorY = 0;
  tsToY.set(uniqueTimestamps[0]!, cursorY);

  for (let i = 0; i < uniqueTimestamps.length - 1; i++) {
    const ts = uniqueTimestamps[i]!;
    const next = uniqueTimestamps[i + 1]!;

    // Topological density: max slot occupied during this interval.
    let maxSlotInInterval = 0;
    for (const a of assignments) {
      if (a.event.startTs <= ts && a.event.endTs >= next) {
        if (a.slot > maxSlotInInterval) maxSlotInInterval = a.slot;
      }
    }

    const yearGap = Math.abs(next - ts) / MS_PER_YEAR;
    const timeStep = Math.round(Math.min(yearGap * 80, maxYearStep));
    const baseStep = minStep + 60 + timeStep;
    const densityStep =
      maxSlotInInterval > 1 ? (maxSlotInInterval - 1) * pixelsPerExtraSlot : 0;
    const totalStep = (baseStep + densityStep) * globalShrink;

    cursorY += totalStep;
    tsToY.set(next, cursorY);
  }

  // Apply top padding uniformly so callers get absolute coordinates.
  if (topPadding !== 0) {
    for (const [k, v] of tsToY) tsToY.set(k, v + topPadding);
  }

  return {
    tsToY,
    height: cursorY + topPadding,
    uniqueTimestamps,
  };
}

/**
 * Invert a projection so that newest timestamps sit at the top
 * (smaller Y) and oldest at the bottom (larger Y). Useful for
 * "Present → Past" reading order.
 */
export function invertProjection(projection: TimelineProjection): TimelineProjection {
  const { tsToY, height, uniqueTimestamps } = projection;
  const inverted = new Map<number, number>();
  for (const [ts, y] of tsToY) {
    inverted.set(ts, height - y);
  }
  return {
    tsToY: inverted,
    height,
    uniqueTimestamps: [...uniqueTimestamps].reverse(),
  };
}
