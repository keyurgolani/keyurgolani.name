import { seededRandom } from '@portfolio/kit/sections';

// The orrery's geometry (redesign, stream E): pure numbers for the opening
// stage's map, worked out once on the server from how many rings and
// sections the page has and the render's seed, so the server, a preview
// frame, and a browser render draw the same picture. The map is one
// coordinate space, MAP_WIDTH by MAP_HEIGHT, which the stylesheet holds at
// that aspect ratio, so a plate placed by percentage and a body drawn in the
// SVG stay registered at every width the map is drawn at.

export const MAP_WIDTH = 1296;
export const MAP_HEIGHT = 380;

/** The orrery's center, and the tilt of its plane, in degrees. */
// 850 leaves the halo's right end inside the map, so the stage's edge never clips it.
export const CENTER = Object.freeze({ x: 850, y: 182 });
export const TILT = -9;
/** How flat the orbital plane looks: an orbit's height over its width. */
export const FLATTEN = 0.34;

/** Each ring's radius, by its place among the rings drawn: the first is the innermost. */
const RADII = [138, 222, 314, 396] as const;

/** Where each ring's anchor body sits on its orbit, as an angle from the start of the orbit, in degrees. */
const ANCHOR_ANGLES = [168, 150, 136, 122] as const;

/**
 * The plates' rows, as a share of the map's height, and where their leaders
 * start and bend. They leave the map's top quarter to the legend's caption.
 */
export const PLATE_ROWS = [0.28, 0.46, 0.64, 0.82] as const;
/** The closing's Contact plate, under the rings' and inside the map's foot: it has no leader. */
export const CLOSING_PLATE_ROW = 0.95;
export const LEADER_START = 262;
const LEADER_KNEE = [610, 586, 560, 534] as const;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** A point on the flattened orbit of radius `r` at `angle`, in the map's space. */
export function orbitPoint(r: number, angle: number): { x: number; y: number } {
  const local = { x: r * Math.cos(radians(angle)), y: r * FLATTEN * Math.sin(radians(angle)) };
  const tilt = radians(TILT);
  return {
    x: CENTER.x + local.x * Math.cos(tilt) - local.y * Math.sin(tilt),
    y: CENTER.y + local.x * Math.sin(tilt) + local.y * Math.cos(tilt),
  };
}

export interface OrbitGeometry {
  /** Its place among the rings drawn, from 0. */
  readonly index: number;
  readonly radius: number;
  readonly anchor: { readonly x: number; readonly y: number };
  /** Where its leader starts, beside its plate. */
  readonly start: { readonly x: number; readonly y: number };
  /** The leader from its plate to its anchor, as an SVG path. */
  readonly leader: string;
  /** The trail its anchor leaves along the orbit behind it, as an SVG path. */
  readonly trail: string;
  /** Its section bodies' angles, in degrees, around the unflattened orbit. */
  readonly bodies: readonly number[];
  /** The plate's row, as a share of the map's height. */
  readonly row: number;
}

const round = (value: number) => Math.round(value * 10) / 10;

/** The arc of the flattened orbit from `from` to `to` degrees, as an SVG path. */
function arc(r: number, from: number, to: number): string {
  const steps = 12;
  const points = Array.from({ length: steps + 1 }, (_, step) =>
    orbitPoint(r, from + ((to - from) * step) / steps),
  );
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${round(point.x)} ${round(point.y)}`)
    .join(' ');
}

/** Each drawn ring's orbit, anchor, leader, trail, and bodies. `counts` is each ring's section count. */
export function orbitGeometry(counts: readonly number[]): OrbitGeometry[] {
  return counts.slice(0, RADII.length).map((count, index) => {
    const radius = RADII[index]!;
    const angle = ANCHOR_ANGLES[index]!;
    const anchor = orbitPoint(radius, angle);
    const row = PLATE_ROWS[index]!;
    const y = row * MAP_HEIGHT;
    const leader = `M${LEADER_START} ${round(y)} H${LEADER_KNEE[index]} L${round(anchor.x)} ${round(anchor.y)}`;
    // Bodies spread evenly round the orbit, each ring turned a little from the last.
    const offset = 24 + index * 37;
    const bodies = Array.from({ length: Math.max(count, 1) }, (_, body) =>
      round(offset + (360 * body) / Math.max(count, 1)),
    );
    return {
      index,
      radius,
      anchor: { x: round(anchor.x), y: round(anchor.y) },
      start: { x: LEADER_START, y: round(y) },
      leader,
      trail: arc(radius, angle, angle + 34),
      bodies,
      row,
    };
  });
}

export interface Star {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/** A bounded field of stars, the same for the same seed: never more than `count`, whatever the window. */
export function starField(seed: number, count: number, width: number, height: number): Star[] {
  const random = seededRandom(seed);
  return Array.from({ length: count }, () => ({
    x: round(random() * width),
    y: round(random() * height),
    r: random() < 0.82 ? 1 : 1.6,
  }));
}
