import assert from 'node:assert/strict';
import test from 'node:test';
import { openingRead, railDocked } from '../scroll-spy';

// The running head's two single-box watches decide from a delivery of their IntersectionObserver.
// A browser hands an observer every entry queued since its last delivery, oldest first, so a page
// that goes down to where the rail docks and back to the top, or into a chapter and back, before
// the observer's task runs (a busy main thread) delivers both entries in one call. Each watch
// reads where its box is now, the delivery's last entry: read from the first, the rail took
// itself for docked at the top of the issue and left its fold, and the opening was out of view
// back at the top, so the chapter read on the way stayed marked.

/** An entry as delivered: whether it intersects, its ratio, and its box's and the root's tops. */
const entry = (isIntersecting: boolean, intersectionRatio: number, top: number, rootTop: number) =>
  ({
    isIntersecting,
    intersectionRatio,
    boundingClientRect: { top } as DOMRectReadOnly,
    rootBounds: { top: rootTop } as DOMRectReadOnly,
  }) as IntersectionObserverEntry;

test("the rail's dock watch reads a delivery's latest entry: docked and then not is undocked, and the other way round docked", () => {
  // The rail's sticky top is 120 px down; its observer's band starts a pixel under the rounded top.
  const stick = 120;
  const band = Math.ceil(stick) + 1;
  // At its sticky top, cut by the band: docked.
  const docked = entry(true, 0.92, stick, band);
  // Back at the top of the issue, below the window: not docked, and the rail folds.
  const away = entry(false, 0, 960, band);
  assert.equal(railDocked([docked], stick), true);
  assert.equal(railDocked([away], stick), false);
  assert.equal(railDocked([docked, away], stick), false, 'docked, then back at the top');
  assert.equal(railDocked([away, docked], stick), true, 'at the top, then docked');
});

test("the opening's watch reads a delivery's latest entry: out of view and then under the line is read, and the other way round not", () => {
  // The reading line is 100 px down; the watch's window starts there.
  const line = 100;
  // In view with its top under the line: the opening is read, and no chapter is marked.
  const under = entry(true, 0.6, line + 24, line);
  // Out of view above, the first chapter read on the line.
  const out = entry(false, 0, -800, line);
  // In view but over the line: the places on the line decide, not this watch.
  const over = entry(true, 0.8, line - 20, line);
  assert.equal(openingRead([under], line), true);
  assert.equal(openingRead([out], line), false);
  assert.equal(openingRead([over], line), false);
  assert.equal(openingRead([out, under], line), true, 'in the chapter, then back at the top');
  assert.equal(openingRead([under, out], line), false, 'at the top, then in the chapter');
});
