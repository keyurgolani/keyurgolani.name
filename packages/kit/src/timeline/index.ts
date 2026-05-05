/**
 * Timeline-layout primitives shared across variants.
 *
 * Pure data utilities (no React, no DOM, no time):
 *   - assignTimelineLanes — overlap-free side+slot allocation
 *   - computeDensityProjection — topology-driven Y mapping
 *   - invertProjection — newest-at-top transformation
 *   - buildBranchPath — fork/trunk/merge SVG path strings
 *   - buildAxisPath — central axis path string
 *   - inferKindFromText — generalized keyword classifier
 *
 * React wrappers (presentational, no animation built in):
 *   - TimelineAxis — SVG <path> for the central axis
 *   - TimelineBranch — three SVG <path>s with optional render-prop slots
 *   - layoutBranchCard — coordinates for a foreignObject-based card
 *
 * The pure utilities are framework-agnostic and unit-tested. The React
 * wrappers stay deliberately presentational — variants compose their own
 * cards, gradients, and animations on top.
 */

export {
  assignTimelineLanes,
  maxSlot,
  type Side,
  type LaneInputEvent,
  type LaneAssignment,
  type AssignTimelineLanesOptions,
} from './lanes';

export {
  computeDensityProjection,
  invertProjection,
  type DensityProjectionOptions,
  type TimelineProjection,
} from './density';

export {
  buildBranchPath,
  buildAxisPath,
  type BranchPath,
  type BranchPathOptions,
} from './paths';

export {
  inferKindFromText,
  type ClassifyRules,
  type ClassifyOptions,
} from './classify';

export {
  TimelineAxis,
  TimelineBranch,
  layoutBranchCard,
  type TimelineAxisProps,
  type TimelineBranchProps,
} from './react';
