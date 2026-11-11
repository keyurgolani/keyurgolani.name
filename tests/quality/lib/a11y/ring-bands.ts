import type { Active, Box } from './probe';
import { centreLineChange, ringCentreLine, type LinePoint } from './interaction';
import { pixel, type Image } from '../pixels';

// A focused stop's outline ring measured on two shots of it, focused and blurred, side by side along
// its centre line: Horizontal Cinema's e2e ring checks' measure (tests/e2e/horizontal-cinema-model.ts
// ringContrast takes the shots and calls measureRing). Pure, on the images, so a unit can read a
// known ring through it.

/** A side of a focus ring, as its centre line's normal points out from the box. */
export type RingSide = 'top' | 'right' | 'bottom' | 'left';

/** A ring measured along its centre line, side by side, and the line's own box. */
export interface RingContrast {
  /** Each side's points in view, and how many of them the focus change takes to 3:1. */
  readonly sides: Readonly<Record<RingSide, { readonly points: number; readonly strong: number }>>;
  /** Each side's painted band, how many device pixels across (0 where the paint left the side untouched). */
  readonly bands: Readonly<Record<RingSide, number>>;
  /** The box the centre line runs round: the border box set out by the offset and half the width. */
  readonly box: Box;
}

/** A side's painted band: the device rows (top, bottom) or columns (left, right) its changed pixels cover. */
interface Band {
  readonly from: number;
  readonly to: number;
}

/**
 * Where the paint put each side of the ring, in device pixels: for the top and bottom, the outermost run of rows, from
 * the clip's edge in toward the box's middle, in which a pixel changes between the focused and the blurred clip; for the
 * left and right, the outermost run of columns. A row is read only across the box's columns clear of its corners, and a
 * column only across its rows clear of them: `reach` CSS px (the ring's offset and width) in from each end, a device
 * pixel more, so the other sides' ring, which an inset ring lays inside the box's span, never counts toward a side.
 * The outermost run, so a change inside the ring (a text or underline colour) never widens it. A side with no changed
 * row or column has no band.
 *
 * SNAP RULE (draft, row 90b's :234, pending #220's CI Linux diagnosis, zz-kgn-hc-234-diag's painted edges): Chromium
 * paints a straight outline on whole device pixels, its edges snapped from the box's fractional ones, so the ring's
 * band is the changed pixels' rows or columns, not the box set out by the offset. DIAG-CONFIRMED RULE: (placeholder:
 * the rounding the diag's painted edges show, such as round-half-up of each fractional edge, replaces or confirms
 * this read of the changed pixels).
 */
export function paintedBands(
  focused: Image,
  blurred: Image,
  clip: Box,
  box: Box,
  reach: number,
): Record<RingSide, Band | null> {
  const scale = focused.width / clip.width;
  const changed = (column: number, row: number) => {
    const i = row * focused.width + column;
    const [a, b] = [pixel(focused, i), pixel(blurred, i)];
    return a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2];
  };
  const clear = Math.ceil(reach * scale) + 1;
  const span = (from: number, to: number, size: number) => {
    const out: number[] = [];
    for (
      let at = Math.max(0, Math.ceil(from) + clear);
      at <= Math.min(size - 1, Math.floor(to) - clear);
      at++
    )
      out.push(at);
    return out;
  };
  const [left, right] = [(box.x - clip.x) * scale, (box.x + box.width - clip.x) * scale];
  const [top, bottom] = [(box.y - clip.y) * scale, (box.y + box.height - clip.y) * scale];
  const columns = span(left, right, focused.width);
  const rows = span(top, bottom, focused.height);
  const rowChanged = (row: number) => columns.some((column) => changed(column, row));
  const columnChanged = (column: number) => rows.some((row) => changed(column, row));
  // From `from` toward `to` (exclusive), by `step`: the first run of indices that pass `test`.
  const run = (
    from: number,
    to: number,
    step: 1 | -1,
    test: (at: number) => boolean,
  ): Band | null => {
    let at = from;
    while (at !== to && !test(at)) at += step;
    if (at === to) return null;
    const first = at;
    while (at !== to && test(at)) at += step;
    const last = at - step;
    return { from: Math.min(first, last), to: Math.max(first, last) };
  };
  const [midX, midY] = [Math.floor((left + right) / 2), Math.floor((top + bottom) / 2)];
  return {
    top: run(0, midY + 1, 1, rowChanged),
    bottom: run(focused.height - 1, midY, -1, rowChanged),
    left: run(0, midX + 1, 1, columnChanged),
    right: run(focused.width - 1, midX, -1, columnChanged),
  };
}

/**
 * The ring on `focused` against `blurred`, both shots of `clip`, for the stop `active` (its box and
 * rounding as the probe read them), at the non-text contrast `nonText` and the focus check's
 * perimeterPx: see ringContrast (tests/e2e/horizontal-cinema-model.ts) for how it's measured.
 */
export function measureRing(
  focused: Image,
  blurred: Image,
  clip: Box,
  active: Pick<Active, 'box' | 'rounding'>,
  thresholds: { readonly nonText: number; readonly perimeterPx: number },
): RingContrast {
  if (!active.rounding) throw new Error('measureRing measures an outline ring');
  const width = active.rounding.width ?? 0;
  const ratio = thresholds.nonText;
  const scale = focused.width / clip.width;
  const need = Math.ceil(thresholds.perimeterPx * scale);
  const bands = paintedBands(
    focused,
    blurred,
    clip,
    active.box,
    Math.abs(active.rounding.offset) + width,
  );
  // Each side's band, at least `need` device pixels across, widened outward from the box.
  const across = (side: RingSide): Band | null => {
    const band = bands[side];
    if (!band || band.to - band.from + 1 >= need) return band;
    const short = need - (band.to - band.from + 1);
    return side === 'top' || side === 'left'
      ? { from: band.from - short, to: band.to }
      : { from: band.from, to: band.to + short };
  };
  // A band's middle and half its width, in CSS px, on the clip's axis for that side.
  const middle = (side: RingSide) => {
    const band = across(side);
    if (!band) return null;
    const origin = side === 'top' || side === 'bottom' ? clip.y : clip.x;
    return {
      at: origin + (band.from + band.to + 1) / 2 / scale,
      half: (band.to - band.from + 1) / 2 / scale,
    };
  };
  const distance = active.rounding.offset + width / 2;
  const [t, r, b, l] = (['top', 'right', 'bottom', 'left'] as const).map(middle);
  // The box whose ring, at the computed distance, runs down the painted bands' middles; where a side
  // has no band, the box's own edge stands.
  const { x, y, width: wide, height } = active.box;
  const x0 = l ? l.at + distance : x;
  const y0 = t ? t.at + distance : y;
  const x1 = r ? r.at - distance : x + wide;
  const y1 = b ? b.at - distance : y + height;
  const snapped = { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
  const line = ringCentreLine(snapped, active.rounding.corners, distance);
  // A corner's arc goes to the side its normal points out from most.
  const sideOf = ({ nx, ny }: LinePoint): RingSide =>
    Math.abs(ny) >= Math.abs(nx) ? (ny < 0 ? 'top' : 'bottom') : nx > 0 ? 'right' : 'left';
  const halves = { top: t, right: r, bottom: b, left: l };
  const sides = Object.fromEntries(
    (['top', 'right', 'bottom', 'left'] as const).map((side) => {
      const points = line.filter((point) => sideOf(point) === side);
      const band = halves[side];
      if (!band) {
        const { total } = centreLineChange(focused, blurred, clip, points, ratio, width / 2);
        return [side, { points: total, strong: 0 }];
      }
      const { strong, total } = centreLineChange(focused, blurred, clip, points, ratio, band.half);
      return [side, { points: total, strong }];
    }),
  ) as RingContrast['sides'];
  const painted = Object.fromEntries(
    (['top', 'right', 'bottom', 'left'] as const).map((side) => {
      const band = bands[side];
      return [side, band ? band.to - band.from + 1 : 0];
    }),
  ) as RingContrast['bands'];
  return {
    sides,
    bands: painted,
    box: {
      x: snapped.x - distance,
      y: snapped.y - distance,
      width: snapped.width + 2 * distance,
      height: snapped.height + 2 * distance,
    },
  };
}
