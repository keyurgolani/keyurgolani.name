// Unit tests for the e2e ring checks' measure (tests/quality/lib/a11y/ring-bands.ts, row 146): a
// known ring, painted here, read through measureRing, as Horizontal Cinema's ringContrast reads a
// focused stop's shots. A 2 px inset outline ring (offset -2, width 2) on a box whose bottom corners
// are rounded reads 2 px on every side, its centre line round the stop's, and every point of it strong, as the
// focus check's own centre line (ringCentreLine and centreLineChange) reads it whole. Its centre
// line's box is the stop's set in by a pixel, half the width less the offset.

import assert from 'node:assert/strict';
import test from 'node:test';
import { loadThresholds } from '../../quality/thresholds';
import type { Image } from './lib/pixels';
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
