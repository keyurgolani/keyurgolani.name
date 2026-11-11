// Unit tests for the e2e ring checks' measure (tests/quality/lib/a11y/ring-bands.ts, row 146): a
// known ring, painted here, read through measureRing, as Horizontal Cinema's ringContrast reads a
// focused stop's shots. A 2 px inset outline ring (offset -2, width 2) on a box whose bottom corners
// are rounded reads 2 px on every side, its centre line round the stop's, and every point of it strong, as the
// focus check's own centre line (ringCentreLine and centreLineChange) reads it whole. Its centre
// line's box is the stop's set in by a pixel, half the width less the offset.
//
// And a ring as Chromium painted it (row 146's probe, saved under fixtures/ring-bands): #scene-5's fold
// summary at 390, its bottom corners rounded 16 px on a fractional box. Its straight sides hold every
// point; round each arc the antialiasing leaves a few lone points under 3:1, which the arc rule (the
// coordinator's ruling, option 1: no two adjacent weak points on an arc, and the whole line at the
// gate's 0.9) holds strong. A stretch of a straight side gone, or a run of an arc, still fails.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadThresholds } from '../../quality/thresholds';
import { decodePng, type Image } from './lib/pixels';
import { centreLineChange, ringCentreLine, type LinePoint } from './lib/a11y/interaction';
import { measureRing, type RingSide } from './lib/a11y/ring-bands';

const SIDES = ['top', 'right', 'bottom', 'left'] as const satisfies readonly RingSide[];
const [W, H] = [230, 90];
const clip = { x: 0, y: 0, width: W, height: H };
const box = { x: 15, y: 15, width: 200, height: 60 };
const [ground, ink] = [
  [246, 236, 220],
  [107, 52, 21],
] as const;
const [offset, width] = [-2, 2];

/**
 * The focused and blurred shots of `box` with a `width` px outline ring `-offset` px inside its
 * edge, its bottom corners rounded `radius` px (the ring's arcs at the radius less the inset), at
 * one device pixel a CSS px: each pixel the ring covers, by 4x4 supersampling, mixed from the ground
 * to the ink.
 */
function shots(radius: number): { focused: Image; blurred: Image } {
  const blurred = { width: W, height: H, data: new Uint8Array(W * H * 4) };
  const focused = { width: W, height: H, data: new Uint8Array(W * H * 4) };
  // Inside the box set in by `inset`, its bottom corners at radius max(radius - inset, 0).
  const inside = (px: number, py: number, inset: number) => {
    const [l, t] = [box.x + inset, box.y + inset];
    const [r, b] = [box.x + box.width - inset, box.y + box.height - inset];
    if (px < l || px > r || py < t || py > b) return false;
    const rr = Math.max(radius - inset, 0);
    const cy = b - rr;
    if (rr === 0 || py <= cy) return true;
    if (px < l + rr) return Math.hypot(px - (l + rr), py - cy) <= rr;
    if (px > r - rr) return Math.hypot(px - (r - rr), py - cy) <= rr;
    return true;
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let cover = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const [px, py] = [x + (sx + 0.5) / 4, y + (sy + 0.5) / 4];
          if (inside(px, py, -(offset + width)) && !inside(px, py, -offset)) cover++;
        }
      const a = cover / 16;
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        blurred.data[i + c] = ground[c]!;
        focused.data[i + c] = Math.round(ground[c]! * (1 - a) + ink[c]! * a);
      }
      blurred.data[i + 3] = focused.data[i + 3] = 255;
    }
  return { focused, blurred };
}

const thresholds = loadThresholds();
const held = { nonText: thresholds.contrast.nonText, perimeterPx: thresholds.focus.perimeterPx };

for (const radius of [0, 4, 8, 16]) {
  const corners = [
    [0, 0],
    [0, 0],
    [radius, radius],
    [radius, radius],
  ] as const;
  const rounding = { corners, offset, width };

  test(`a 2 px inset outline ring with its bottom corners rounded ${radius} px reads 2 px on every side, its centre line the stop's, every point strong (row 146)`, () => {
    const { focused, blurred } = shots(radius);
    // The focus check's own centre line, round the stop's box, reads the ring whole.
    const sideOf = ({ nx, ny }: LinePoint): RingSide =>
      Math.abs(ny) >= Math.abs(nx) ? (ny < 0 ? 'top' : 'bottom') : nx > 0 ? 'right' : 'left';
    const line = ringCentreLine(box, corners, offset + width / 2);
    for (const side of SIDES) {
      const points = line.filter((point) => sideOf(point) === side);
      const { strong, total } = centreLineChange(
        focused,
        blurred,
        clip,
        points,
        held.nonText,
        width / 2,
      );
      assert.ok(total > 0 && strong === total, `the focus check's ${side}: ${strong}/${total}`);
    }
    // The e2e measure: each side's painted band 2 px across, the centre line its middles give the
    // focus check's, and every point on each side strong.
    const ring = measureRing(focused, blurred, clip, { box, rounding }, held);
    assert.deepEqual(ring.bands, { top: 2, right: 2, bottom: 2, left: 2 });
    const inset = -(offset + width / 2);
    assert.deepEqual(ring.box, {
      x: box.x + inset,
      y: box.y + inset,
      width: box.width - 2 * inset,
      height: box.height - 2 * inset,
    });
    for (const side of SIDES) {
      const { points, strong } = ring.sides[side];
      assert.ok(points > 0 && strong === points, `${side}: ${strong}/${points}`);
    }
  });
}

const FIXTURES = new URL('./fixtures/ring-bands/', import.meta.url);
const painted = JSON.parse(
  readFileSync(new URL('scene-5-summary-390.json', FIXTURES), 'utf8'),
) as Record<
  'light' | 'dark',
  {
    readonly box: { x: number; y: number; width: number; height: number };
    readonly clip: { x: number; y: number; width: number; height: number };
    readonly rounding: {
      readonly corners: readonly (readonly [number, number])[];
      readonly offset: number;
      readonly width: number;
    };
  }
>;
/** The probe's two shots of the summary's clip in `mode`, and where it lay. */
function chromium(mode: 'light' | 'dark') {
  const read = (shot: string) =>
    decodePng(readFileSync(new URL(`scene-5-summary-390-${mode}.${shot}.png`, FIXTURES)));
  return { ...painted[mode], focused: read('focused'), blurred: read('blurred') };
}
/** `focused` with the pixels `gone` picks (CSS px in the clip) set back to `blurred`'s: the ring missing there. */
function without(
  { focused, blurred, clip }: { focused: Image; blurred: Image; clip: { x: number; y: number } },
  gone: (x: number, y: number) => boolean,
): Image {
  const data = new Uint8Array(focused.data);
  for (let row = 0; row < focused.height; row++)
    for (let column = 0; column < focused.width; column++) {
      if (!gone(clip.x + column + 0.5, clip.y + row + 0.5)) continue;
      const i = (row * focused.width + column) * 4;
      data.set(blurred.data.subarray(i, i + 4), i);
    }
  return { width: focused.width, height: focused.height, data };
}
const whole = (ring: ReturnType<typeof measureRing>) =>
  Object.fromEntries(
    SIDES.map((side) => [side, ring.sides[side].strong === ring.sides[side].points]),
  );

for (const mode of ['light', 'dark'] as const) {
  test(`#scene-5's fold summary as Chromium painted it in ${mode} at 390 reads whole: every straight point strong, each arc's lone antialiased misses held by the arc rule (row 146)`, () => {
    const shot = chromium(mode);
    const ring = measureRing(shot.focused, shot.blurred, shot.clip, shot, held);
    assert.deepEqual(ring.bands, { top: 2, right: 2, bottom: 2, left: 2 });
    assert.deepEqual(
      whole(ring),
      { top: true, right: true, bottom: true, left: true },
      JSON.stringify(ring),
    );
  });

  test(`#scene-5's fold summary in ${mode} with a stretch of its right side's ring gone reads its right side weak (row 146)`, () => {
    const shot = chromium(mode);
    const right = shot.box.x + shot.box.width;
    const focused = without(shot, (x, y) => x > right - 4 && x < right + 1 && y > 400 && y < 420);
    const ring = measureRing(focused, shot.blurred, shot.clip, shot, held);
    assert.equal(whole(ring).right, false, JSON.stringify(ring));
  });

  test(`#scene-5's fold summary in ${mode} with a run of its bottom-right arc gone reads that corner weak (row 146)`, () => {
    const shot = chromium(mode);
    const radius = shot.rounding.corners[2]![0];
    const [cx, cy] = [shot.box.x + shot.box.width - radius, shot.box.y + shot.box.height - radius];
    // The arc between 20 and 50 degrees below the horizontal: a run of several adjacent points.
    const focused = without(shot, (x, y) => {
      const [dx, dy] = [x - cx, y - cy];
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      return Math.hypot(dx, dy) > radius - 5 && angle > 20 && angle < 50;
    });
    const ring = measureRing(focused, shot.blurred, shot.clip, shot, held);
    const sides = whole(ring);
    assert.ok(!sides.right || !sides.bottom, JSON.stringify(ring));
  });
}
