/**
 * Lanes for a chronology from its authored threads (#14). Each entry's lane
 * is its `thread`'s, never inferred from its words: entries with no thread
 * run in the trunk, lane 0, and each thread takes the next lane in the order
 * it first appears. When every entry has a thread, the first one's thread is
 * the trunk. A chronology with more threads than `maxLanes` puts the rest in
 * the last lane, so a composition draws at most that many.
 *
 * An entry that branches from, or merges into, an entry in another lane
 * says which lane, so a composition can draw the fork or the join; one that
 * names an entry the list doesn't hold, or one in its own lane, has none.
 *
 * Pure: no React, no DOM, no time. The order of `entries` is kept.
 */

export interface ThreadedEntry {
  readonly id: string;
  readonly thread?: string;
  readonly branchesFrom?: string;
  readonly mergesInto?: string;
}

export interface ThreadLane<T extends ThreadedEntry = ThreadedEntry> {
  readonly entry: T;
  /** 0 for the trunk, then one per thread, up to `maxLanes - 1`. */
  readonly lane: number;
  /** The lane of the entry this one branches from, when it's another lane. */
  readonly branchesFromLane?: number;
  /** The lane of the entry this one merges into, when it's another lane. */
  readonly mergesIntoLane?: number;
}

export interface ThreadLanesOptions {
  /** The most lanes to draw, the trunk included. Default 4. */
  readonly maxLanes?: number;
}

export function threadLanes<T extends ThreadedEntry>(
  entries: readonly T[],
  { maxLanes = 4 }: ThreadLanesOptions = {},
): ThreadLane<T>[] {
  if (!Number.isInteger(maxLanes) || maxLanes < 1) {
    throw new Error('threadLanes: maxLanes must be a whole number of at least 1');
  }
  const lanes = new Map<string | undefined, number>();
  const trunk = entries.some((entry) => entry.thread === undefined)
    ? undefined
    : entries[0]?.thread;
  lanes.set(trunk, 0);
  for (const entry of entries) {
    if (!lanes.has(entry.thread)) lanes.set(entry.thread, Math.min(lanes.size, maxLanes - 1));
  }
  const laneOf = new Map(entries.map((entry) => [entry.id, lanes.get(entry.thread)!]));
  const other = (lane: number, ref: string | undefined) => {
    const found = ref === undefined ? undefined : laneOf.get(ref);
    return found !== undefined && found !== lane ? found : undefined;
  };
  return entries.map((entry) => {
    const lane = laneOf.get(entry.id)!;
    const branchesFromLane = other(lane, entry.branchesFrom);
    const mergesIntoLane = other(lane, entry.mergesInto);
    return {
      entry,
      lane,
      ...(branchesFromLane !== undefined ? { branchesFromLane } : {}),
      ...(mergesIntoLane !== undefined ? { mergesIntoLane } : {}),
    };
  });
}

/** How many lanes `lanes` uses: one more than the highest. */
export function laneCount(lanes: readonly ThreadLane[]): number {
  return lanes.reduce((most, { lane }) => Math.max(most, lane + 1), 0);
}
