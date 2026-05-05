/**
 * SVG fork/merge bezier path builder. Pure string math.
 *
 * Given a central axis at `centerX` and a branch line at `branchX`, returns
 * three SVG path `d` strings that together form a smooth fork-trunk-merge:
 *
 *     centerX,startY ─╮
 *                     │ fork (cubic bezier)
 *                     ╰─→ branchX,joinTopY
 *                          │
 *                          │ trunk (straight)
 *                          │
 *                     ╭─← branchX,joinBottomY
 *                     │ merge (cubic bezier)
 *     centerX,endY ───╯
 *
 * Use cases beyond timelines: dependency graphs, river-flow diagrams,
 * any "axis with named departures" visualization.
 */

export interface BranchPathOptions {
  /**
   * Curve smoothness (0–1). 0.5 = control point at midpoint between fork
   * and branch-join. Higher = tighter corner; lower = looser sweep. Default 0.5.
   */
  curveSmoothness?: number;
  /**
   * Vertical distance over which the fork/merge curves run, in user units.
   * Larger values give roomier sweeps; smaller values yield tighter corners.
   * Default 60.
   */
  curveHeight?: number;
  /**
   * Fraction of the trunk to compress (shrink the straight middle). 0 = no
   * shrink (full trunk); 0.66 = trunk is 1/3 of the original height. Default 2/3.
   * Bias toward higher values when most events are short and you want the
   * curves to dominate the visual.
   */
  trunkShrink?: number;
}

export interface BranchPath {
  /** Cubic bezier from (centerX, startY) to (branchX, joinTopY). */
  fork: string;
  /** Straight segment from (branchX, joinTopY) to (branchX, joinBottomY). May be empty. */
  trunk: string;
  /** Cubic bezier from (branchX, joinBottomY) to (centerX, endY). */
  merge: string;
  /** The Y coordinate where the fork curve completes and the trunk starts. */
  joinTopY: number;
  /** The Y coordinate where the trunk ends and the merge curve begins. */
  joinBottomY: number;
}

/**
 * Build the three SVG paths that join an axis to a parallel branch line.
 */
export function buildBranchPath(opts: {
  centerX: number;
  branchX: number;
  startY: number;
  endY: number;
  options?: BranchPathOptions;
}): BranchPath {
  const { centerX, branchX, startY, endY } = opts;
  const curveHeight = opts.options?.curveHeight ?? 60;
  const curveSmoothness = opts.options?.curveSmoothness ?? 0.5;
  const trunkShrink = opts.options?.trunkShrink ?? 2 / 3;

  // Naive join points before shrinking.
  let rawJoinTopY = startY + curveHeight;
  let rawJoinBottomY = endY - curveHeight;

  // Apply trunk-shrink: pull the straight segment in by (originalHeight * shrink/2)
  // on each side. Clamp so we never invert the segment.
  const trunkHeight = Math.max(0, rawJoinBottomY - rawJoinTopY);
  const shrinkAmount = trunkHeight * trunkShrink;
  rawJoinTopY += shrinkAmount / 2;
  rawJoinBottomY -= shrinkAmount / 2;

  // For very short durations, snap both joins to the midpoint so the curves
  // meet cleanly without inverting.
  const midY = startY + (endY - startY) / 2;
  const joinTopY = Math.min(rawJoinTopY, midY);
  const joinBottomY = Math.max(rawJoinBottomY, midY);

  const forkDelta = joinTopY - startY;
  const mergeDelta = endY - joinBottomY;

  const forkControlY = startY + forkDelta * curveSmoothness;
  const mergeControlY = joinBottomY + mergeDelta * curveSmoothness;

  const fork =
    `M ${centerX} ${startY} ` +
    `C ${centerX} ${forkControlY}, ${branchX} ${forkControlY}, ${branchX} ${joinTopY}`;

  const trunk =
    joinBottomY > joinTopY
      ? `M ${branchX} ${joinTopY} L ${branchX} ${joinBottomY}`
      : '';

  const merge =
    `M ${branchX} ${joinBottomY} ` +
    `C ${branchX} ${mergeControlY}, ${centerX} ${mergeControlY}, ${centerX} ${endY}`;

  return { fork, trunk, merge, joinTopY, joinBottomY };
}

/**
 * Build a vertical axis path from (centerX, topY) to (centerX, bottomY).
 * Trivial helper for callers who want a single source of truth for axis geometry.
 */
export function buildAxisPath(centerX: number, topY: number, bottomY: number): string {
  return `M ${centerX} ${topY} L ${centerX} ${bottomY}`;
}
