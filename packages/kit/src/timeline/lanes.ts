/**
 * Lane assignment for overlapping timeline events.
 *
 * Given items with start/end timestamps, distribute them across left/right
 * sides and slot lanes so visual collisions don't happen. Shorter items
 * claim inner slots first (slot 1 is closest to the central axis); longer
 * items get pushed outward when they overlap.
 *
 * Pure: no React, no DOM, no time. Test in isolation.
 */

export type Side = 'left' | 'right';

export interface LaneInputEvent {
  id: string;
  startTs: number;
  endTs: number;
}

export interface LaneAssignment<T extends LaneInputEvent = LaneInputEvent> {
  event: T;
  side: Side;
  slot: number;
}

export interface AssignTimelineLanesOptions {
  /** Sides to alternate between. Default: `['right', 'left']`. */
  sides?: readonly Side[];
  /**
   * Strategy for choosing the side of each event.
   *  - `alternate` — strict alternation in input order (default).
   *  - `balanced` — alternate but biased to whichever side has fewer slots in flight.
   *  - `single` — all events on `sides[0]`.
   */
  balance?: 'alternate' | 'balanced' | 'single';
}

interface SlotAssignment<T extends LaneInputEvent> {
  event: T;
  slot: number;
}

/**
 * Assign every event to a side and slot. Output preserves input order.
 *
 * Algorithm:
 *  1. Walk events in input order; assign sides per `balance` strategy.
 *  2. Per side: sort by duration ascending so shorter events claim slot 1
 *     before longer events have the chance to occupy it. This is what
 *     pushes long-running events visually outward.
 *  3. For each event in duration order, find the lowest slot index whose
 *     existing occupants don't overlap in time.
 */
export function assignTimelineLanes<T extends LaneInputEvent>(
  events: readonly T[],
  options: AssignTimelineLanesOptions = {},
): LaneAssignment<T>[] {
  if (events.length === 0) return [];

  const sides = options.sides ?? (['right', 'left'] as const);
  if (sides.length === 0) {
    throw new Error('assignTimelineLanes: options.sides must be non-empty');
  }
  const balance = options.balance ?? 'alternate';

  // 1. Side assignment.
  const withSides = new Array<{ event: T; side: Side }>(events.length);
  if (balance === 'single') {
    for (let i = 0; i < events.length; i++) {
      withSides[i] = { event: events[i]!, side: sides[0]! };
    }
  } else if (balance === 'alternate') {
    for (let i = 0; i < events.length; i++) {
      withSides[i] = { event: events[i]!, side: sides[i % sides.length]! };
    }
  } else {
    // balanced: pick the side with the fewest currently in-flight events at this start
    const counts: Record<Side, number> = { left: 0, right: 0 };
    for (let i = 0; i < events.length; i++) {
      const event = events[i]!;
      let bestSide = sides[0]!;
      let bestCount = Infinity;
      for (const candidate of sides) {
        const count = counts[candidate];
        if (count < bestCount) {
          bestSide = candidate;
          bestCount = count;
        }
      }
      counts[bestSide] += 1;
      withSides[i] = { event, side: bestSide };
    }
  }

  // 2. Slot allocation per side.
  const result: LaneAssignment<T>[] = new Array(events.length);

  for (const side of sides) {
    const sideItems = withSides
      .map((it, idx) => ({ it, idx }))
      .filter(({ it }) => it.side === side);

    // Sort by duration ascending; shorter events claim inner slots first.
    const byDuration = [...sideItems].sort((a, b) => {
      const durA = a.it.event.endTs - a.it.event.startTs;
      const durB = b.it.event.endTs - b.it.event.startTs;
      return durA - durB;
    });

    const occupants: SlotAssignment<T>[] = [];

    for (const { it, idx } of byDuration) {
      let slot = 1;
      while (true) {
        const conflict = occupants.find((occupant) => {
          if (occupant.slot !== slot) return false;
          return (
            it.event.startTs < occupant.event.endTs &&
            it.event.endTs > occupant.event.startTs
          );
        });
        if (!conflict) break;
        slot += 1;
      }
      occupants.push({ event: it.event, slot });
      result[idx] = { event: it.event, side: it.side, slot };
    }
  }

  return result;
}

/**
 * Returns the maximum slot used across all assignments, or 0 if empty.
 * Helpful for sizing the SVG canvas / determining outer-edge padding.
 */
export function maxSlot(assignments: readonly LaneAssignment[]): number {
  let max = 0;
  for (const a of assignments) if (a.slot > max) max = a.slot;
  return max;
}
