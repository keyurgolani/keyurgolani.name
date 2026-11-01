// The field's geometry (brief §5.10, step 3; FX-M19): the framing poses of
// the concept's field-spec.json (P-0 round 3, V10/_scripts/flux), as a typed
// constant, re-placed for the composition's layout. It's content-independent:
// every circle sits in space the layout reserves for any owner's content
// (the band right of the capped headline, the column-6 gutter beside the
// plate, the corners and the phone's right channel), so the server draws the
// same still for every portfolio (N4), with no text measured and no pose
// baked from the sample's line ends. The concept's pass rules, which poured
// circles onto measured text anchors, are gone with that bake; the drift
// moves a few circles inside the reserved space instead.
//
// Units: one field unit (u) per mode, `1vw` from 64rem and `max(1vmin,
// 0.6vmax)` below it, as the spec has them. x is measured inward from the
// named side (mirrored in a right-to-left page by the stylesheet), y down
// from the top of the opening or from its foot, both in u; r in u.

export type Mode = 'w' | 'm' | 't' | 'p';
export type Side = 'right' | 'left';
export type Origin = 'top' | 'foot';

/** One circle: [x, y, r] in field units. */
export type Circle = readonly [x: number, y: number, r: number];

export interface InkPose {
  readonly side: Side;
  readonly origin: Origin;
  /** The still mass, which never moves. */
  readonly frame: readonly Circle[];
  /**
   * The drifting lobe: circles that travel together along the ink's drift
   * and merge with the still mass and part from it. Its first keyframe is
   * where it's drawn, so the still is the drift's first frame (FX-M19).
   */
  readonly lobe: readonly Circle[];
  /** How far the lobe travels at the drift's turn, in u. */
  readonly travel: readonly [dx: number, dy: number];
}

export interface ModePose {
  /** The ink of signature-start (a) and of signature-end (b). */
  readonly a: InkPose;
  readonly b: InkPose;
}

/** The goo filter (one, rendered once): the blur in u and the alpha threshold. */
export const GOO = Object.freeze({ sigma: 1.6, slope: 40, offset: -18 });

/** The wide amber, from the foot in column 6 (the wide pose and the narrow-wide one). */
const WIDE_AMBER: InkPose = {
  side: 'left',
  origin: 'foot',
  frame: [
    [47, 6, 9],
    [44, -4, 5.4],
    [50.4, -1, 6],
    [53.6, 3.6, 5.2],
    [42.6, -9.6, 3.4],
  ],
  lobe: [
    [45.8, -14.2, 2.8],
    [44.4, -18.6, 2.3],
  ],
  travel: [0.8, 5.2],
};

/**
 * The field per mode: wide (80rem and up), narrow-wide (64 to 80rem), tablet
 * (40 to 64rem) and phone.
 */
export const FIELD: Readonly<Record<Mode, ModePose>> = Object.freeze({
  // 1440 x 900 reference, u = 14.4 px, from 80rem. The headline is capped at columns 1 to
  // 9 (72u from the start); the pink keeps right of it and above the plate's
  // caption. The amber rises from the foot in column 6 and its gutter, left
  // of the plate and behind its drop (FX-S34), clear of the proof line on columns 1 to 4.
  w: {
    a: {
      side: 'right',
      origin: 'top',
      frame: [
        [2.8, -2.8, 25],
        [18.8, 11.8, 8.3],
        [4.2, 27.2, 7.2],
        [2.9, 34.7, 3.5],
        [13.2, 9.7, 4.9],
        [9.7, 6.9, 4.2],
        [15.9, 4.9, 3.8],
        [7.6, 13.9, 4.4],
        [11.1, 18.1, 4.2],
        [14.6, 8.3, 3.5],
        [6.2, 21.2, 3.6],
        [10.4, 4.2, 3.2],
      ],
      lobe: [
        [24.6, 3.6, 3.4],
        [21.6, 17.6, 2.6],
      ],
      travel: [-2.4, 3.2],
    },
    b: WIDE_AMBER,
  },
  // 1024 x 768 reference, u = 10.24 px, to just under 80rem (SF7). The bar's
  // tools end about 13u from the right edge here (they're capped with the
  // bar, so the margin grows with the width), and the wide pink reached into
  // them. So the pink keeps within 11u of the edge down to the bar's foot
  // (7u), pours off the top corner there, and swells left below the bar, as
  // the concept's 1024 frame has it: the same reach as the wide pose from
  // 9u down. The amber is the wide one.
  m: {
    a: {
      side: 'right',
      origin: 'top',
      frame: [
        [-2, -2, 13],
        [4, 19, 13],
        [18.8, 15.5, 8.3],
        [4.2, 27.2, 7.2],
        [2.9, 34.7, 3.5],
        [13.2, 12.4, 4.9],
        [7.6, 9.6, 4.2],
        [16.4, 11.6, 3.8],
        [7.6, 13.9, 4.4],
        [11.1, 18.1, 4.2],
        [14.6, 11.2, 3.5],
        [6.2, 21.2, 3.6],
        [5.4, 3.4, 3.2],
      ],
      lobe: [
        [24.4, 12, 3.4],
        [21.6, 19.6, 2.6],
      ],
      travel: [-2.4, 3.2],
    },
    b: WIDE_AMBER,
  },
  // 768 x 1024 reference, u = 7.68 px. The headline is capped at 10 columns
  // and the lede at 9, so the pink pours down the right channel; the amber
  // rises from the foot between the proof and the plate. The pink's top starts
  // below the bar's tools, which end under 6u from the edge here (SF7).
  t: {
    a: {
      side: 'right',
      origin: 'top',
      frame: [
        [-4.2, 22, 15.6],
        [4.4, 31, 8.6],
        [2.6, 44.2, 7.2],
        [3.4, 54.4, 3.8],
        [-1.5, 16, 9.1],
        [8.6, 16.2, 7.4],
        [1, 25, 6.5],
        [2.2, 38, 5.8],
      ],
      lobe: [
        [7.4, 21.2, 4.2],
        [6, 48.6, 2.6],
      ],
      travel: [-1.6, 4.4],
    },
    b: {
      side: 'left',
      origin: 'foot',
      frame: [
        [47, 2, 7],
        [43, -3, 4.6],
        [51, 1, 5.2],
        [45.6, -8.4, 3.2],
      ],
      lobe: [
        [46.6, -12, 2.6],
        [45.4, -15.6, 2.3],
      ],
      travel: [0.8, 3.6],
    },
  },
  // 390 x 844 reference, u = 5.064 px. The headline and lede are capped at
  // 85% of the width, so the pink pours down the 15% channel on the right
  // and over the top band; the amber leans in from the same edge further
  // down, beside the call to action.
  p: {
    a: {
      side: 'right',
      origin: 'top',
      frame: [
        [9.9, -5.9, 20.7],
        [31.6, -7.9, 15.8],
        [1, 11.9, 8.3],
        [0.4, 23.3, 7.1],
        [0.6, 34, 6.1],
        [1, 43.8, 5.3],
        [1.4, 52.5, 4.5],
        [1.6, 60.2, 3.8],
        [11.9, 2, 9.9],
        [19.8, 0, 9.1],
        [5.9, 7.9, 7.1],
      ],
      lobe: [
        [3.6, 68.4, 2.8],
        [2.6, 73.6, 2.3],
      ],
      travel: [0.4, 4.8],
    },
    b: {
      side: 'right',
      origin: 'top',
      frame: [
        [-3, 92, 11],
        [3.4, 101, 6.6],
        [0.6, 108.6, 5.4],
        [4.6, 86.6, 4.2],
      ],
      // Its drip ends a space-l clear of the drop's shoulder, never just short of it: two shapes
      // nearly meeting read as a missed merge (design review, P2 carry).
      lobe: [
        [7.4, 96.2, 2.4],
        [5.6, 108.4, 2.2],
      ],
      travel: [-1.2, 2.8],
    },
  },
});

/** The pad round a pose's box, in u: three blurs, so no edge thins before the threshold. */
export const PAD = 3 * GOO.sigma + 2;

export interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The box every circle of a pose fills, at rest and at the drift's turn, padded. */
export function poseBox(pose: InkPose): Box {
  const [dx, dy] = pose.travel;
  const circles = [
    ...pose.frame,
    ...pose.lobe,
    ...pose.lobe.map(([x, y, r]): Circle => [x + dx, y + dy, r]),
  ];
  const box = circles.reduce(
    (acc, [x, y, r]) => ({
      minX: Math.min(acc.minX, x - r),
      minY: Math.min(acc.minY, y - r),
      maxX: Math.max(acc.maxX, x + r),
      maxY: Math.max(acc.maxY, y + r),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  return {
    minX: box.minX - PAD,
    minY: box.minY - PAD,
    maxX: box.maxX + PAD,
    maxY: box.maxY + PAD,
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * A circle in its pose's own drawing, which runs left to right: against the
 * right side, x is drawn back from the box's far edge; against the left,
 * forward from its near one. y runs down from the box's top either way.
 */
export function drawn(pose: InkPose, [x, y, r]: Circle): { cx: number; cy: number; r: number } {
  const box = poseBox(pose);
  const cx = pose.side === 'right' ? box.maxX - x : x - box.minX;
  return { cx: round(cx), cy: round(y - box.minY), r };
}

/** The drawing's size and where it sits against its side and origin, in u. */
export function placement(pose: InkPose): {
  readonly width: number;
  readonly height: number;
  /** From the named side to the drawing's near edge (negative: past the edge). */
  readonly side: number;
  /** From the top to its top, or from the foot to its bottom (negative: past the edge). */
  readonly origin: number;
} {
  const box = poseBox(pose);
  return {
    width: round(box.maxX - box.minX),
    height: round(box.maxY - box.minY),
    side: round(box.minX),
    origin: round(pose.origin === 'top' ? box.minY : -box.maxY),
  };
}
