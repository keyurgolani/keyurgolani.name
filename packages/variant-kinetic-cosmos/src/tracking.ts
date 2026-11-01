// Which stop the dock is at (redesign, stream E, code review P2 M1): pure, so a unit test can
// hold it on the boxes a page would give it.

/** A stop's box against the window, as the dock reads it. */
export interface StopBox {
  readonly top: number;
  readonly bottom: number;
}

/**
 * The stop at a line `line` px down the window, by index: the one under the line, or else the
 * last one the line has passed; -1 above the first. Stops that share a row (the same top, as a
 * case's hung stops do from 64rem) are one place: the one the address names (`named`), else the
 * row's first, whichever way the visitor came in.
 */
export function currentStop(boxes: readonly StopBox[], line: number, named = -1): number {
  let at = boxes.findIndex((box) => box.top <= line && box.bottom > line);
  if (at < 0) {
    boxes.forEach((box, index) => {
      if (box.top <= line) at = index;
    });
  }
  if (at < 0) return -1;
  const top = boxes[at]!.top;
  const row = boxes.flatMap((box, index) => (Math.abs(box.top - top) < 1 ? [index] : []));
  return row.includes(named) ? named : row[0]!;
}
