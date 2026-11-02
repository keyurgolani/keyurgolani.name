import type { RuntimeState } from '@portfolio/kit/runtime';
import type { PlaneModel } from './model';

// The spatial stage's scene (#16), as data: the Contents tile's planes, one
// for each board of the page, each a slab with a block for each of its
// tiles, the same drawing the server's still makes. Its size is bounded,
// whatever the portfolio holds: at most MAX_PLANES planes and MAX_BLOCKS
// blocks in all, and no particles, so nothing the owner adds can grow what
// the GPU draws past them. Pure, so a render is the same on every load.

/** The color roles the scene reads from the boundary. */
export const SCENE_ROLES = [
  'canvas',
  'surface-subtle',
  'border-subtle',
  'border-default',
  'text-primary',
  'accent',
] as const;
export type SceneRole = (typeof SCENE_ROLES)[number];

/** The most planes and blocks the stage draws. */
export const MAX_PLANES = 6;
export const MAX_BLOCKS = 48;

/** A plane's footprint, in the still's drawing units: its width along the columns and depth along the rows. */
export const FOOTPRINT = { width: 112, depth: 64, slab: 2.5 } as const;

/** One block: its box, in the plane's units, from the plane's corner, and its top's role. */
export interface SceneBlock {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly top: SceneRole;
}

export interface ScenePlane {
  /** Whether it's the overview's, the board the visitor is on, whose blocks stand taller. */
  readonly raised: boolean;
  readonly blocks: readonly SceneBlock[];
}

export interface Scene {
  readonly planes: readonly ScenePlane[];
}

const GAP = 1.1;

const TOPS: Readonly<Record<string, SceneRole>> = {
  plain: 'canvas',
  ink: 'text-primary',
  accent: 'accent',
};

/**
 * The scene for the Contents tile's planes, the first as the visitor's own:
 * each model's blocks in its footprint, raised by the share of the grid they
 * cover, as the still raises them. Planes past MAX_PLANES and blocks past
 * MAX_BLOCKS are left out.
 */
export function buildScene(models: readonly PlaneModel[]): Scene {
  let left = MAX_BLOCKS;
  const planes = models.slice(0, MAX_PLANES).map((model, index) => {
    const raised = index === 0;
    const cell = { x: FOOTPRINT.width / model.columns, z: FOOTPRINT.depth / model.rows };
    const blocks = model.blocks.slice(0, Math.max(left, 0)).map((block) => {
      const area = (block.c1 - block.c0 + 1) * (block.r1 - block.r0 + 1);
      const share = Math.min(area / (model.columns * model.rows), 0.5);
      return {
        x: block.c0 * cell.x + GAP,
        z: block.r0 * cell.z + GAP,
        width: (block.c1 - block.c0 + 1) * cell.x - 2 * GAP,
        depth: (block.r1 - block.r0 + 1) * cell.z - 2 * GAP,
        height: (raised ? 4 : 2.5) + share * (raised ? 18 : 10),
        top: TOPS[block.tone] ?? 'canvas',
      };
    });
    left -= blocks.length;
    return { raised, blocks };
  });
  return { planes };
}

/** The twelve edges of a box of `size` about its centre, as line-segment pairs. */
export function boxEdges(size: readonly [number, number, number]): Float32Array {
  const [x, y, z] = size.map((n) => n / 2) as [number, number, number];
  const corners = [
    [-x, -y, -z],
    [x, -y, -z],
    [x, -y, z],
    [-x, -y, z],
    [-x, y, -z],
    [x, y, -z],
    [x, y, z],
    [-x, y, z],
  ] as const;
  const pairs = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ] as const;
  return new Float32Array(pairs.flatMap(([a, b]) => [...corners[a], ...corners[b]]));
}

/**
 * What the canvas is told: active while the picture has a version not yet
 * drawn, paused once it has, and whatever the runtime says otherwise.
 */
export function onDemand(runtime: RuntimeState, version: unknown, drawn: unknown): RuntimeState {
  if (runtime !== 'active') return runtime;
  return drawn === version ? 'paused' : 'active';
}
