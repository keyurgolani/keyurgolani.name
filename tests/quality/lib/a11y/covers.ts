// Stuck covers (#11, Slice 2): a fixed or sticky header or dock painted
// over an element it doesn't hold, which a visitor scrolls out from under.
// What the contrast sampler and the focus check read under one is the
// cover, not the element's background or its ring, so each scrolls the
// element clear of it first, by the cover's edge and COVER_GAP, and reads
// again, and puts the page back where it was once it has read. The page
// scrolls only where the element still fits in the viewport past the
// cover; a cover that leaves it no room, such as a full-height rail, stays.
// One that still covers it leaves a text's contrast unresolved; a ring the
// page can't scroll clear is measured where a visitor sees it, and one the
// scroll took out of view is unresolved. Whether a cover hides a focused
// control from a visitor is the occlusion check's (interaction.ts), which
// reads the page before this scrolls it.

import type { Locator, Page } from '@playwright/test';

/** How far past a stuck cover's edge the page scrolls a box, in CSS pixels. */
export const COVER_GAP = 8;

/**
 * What covers `el` and `margin` round it, read in the page. It hit-tests a
 * grid of points in each of the element's own line boxes, so a wrapped
 * inline's empty corners don't count, and in the band `margin` round them,
 * where a ring would be: the stack from the top, with pointer events forced
 * on, down to the element, its descendant, or its ancestor. A layer above it
 * that paints, is fixed or sticky itself or under a fixed or sticky
 * ancestor the element doesn't share, and doesn't span the whole viewport
 * (a grain or tint over every text, which is part of what a visitor reads
 * it on), covers it: a stuck header or dock, which scrolling moves the box
 * out from under. A layer the stack shows under the element in its line
 * boxes, such as a fixed glow behind raised text, is its backdrop, in the
 * band round it too; so is a layer in flow, such as a numeral behind or
 * over a heading, which moves with it. The outermost stuck box's path, and
 * the top and bottom of what covers it, or null.
 */
export function stuckCoverScript(
  el: Element,
  margin: number,
): { path: string; top: number; bottom: number } | null {
  const style = document.createElement('style');
  style.textContent = '*, *::before, *::after { pointer-events: auto !important; }';
  document.head.append(style);
  try {
    const boxes = [...el.getClientRects()].filter((r) => r.width >= 1 && r.height >= 1);
    const inner: [number, number][] = [];
    const band: [number, number][] = [];
    for (const r of boxes) {
      const grid = (left: number, top: number, right: number, bottom: number) => {
        const [x0, x1] = [Math.max(0, left), Math.min(innerWidth, right)];
        const [y0, y1] = [Math.max(0, top), Math.min(innerHeight, bottom)];
        if (x1 - x0 < 1 || y1 - y0 < 1) return [];
        const points: [number, number][] = [];
        for (const fx of [0.05, 0.3, 0.5, 0.7, 0.95]) {
          for (const fy of [0.05, 0.5, 0.95])
            points.push([x0 + (x1 - x0) * fx, y0 + (y1 - y0) * fy]);
        }
        return points;
      };
      inner.push(...grid(r.left, r.top, r.right, r.bottom));
      if (margin > 0) {
        // The ring's band: a strip along each side.
        band.push(
          ...grid(r.left - margin, r.top - margin, r.right + margin, r.top),
          ...grid(r.left - margin, r.bottom, r.right + margin, r.bottom + margin),
          ...grid(r.left - margin, r.top, r.left, r.bottom),
          ...grid(r.right, r.top, r.right + margin, r.bottom),
        );
      }
    }
    const stuckBox = (layer: Element): Element | null => {
      const s = getComputedStyle(layer);
      const fill = s.backgroundColor;
      const filled = fill !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(fill);
      const paints =
        Number(s.opacity) > 0.05 &&
        (filled ||
          s.backgroundImage !== 'none' ||
          layer.matches('img, svg, video, canvas, iframe, input, select, textarea, button') ||
          [...layer.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()));
      if (!paints) return null;
      const lr = layer.getBoundingClientRect();
      if (lr.x <= 1 && lr.y <= 1 && lr.right >= innerWidth - 1 && lr.bottom >= innerHeight - 1)
        return null;
      // The outermost fixed or sticky box the element doesn't share: what the box must clear.
      let edge: Element | null = null;
      for (let up: Element | null = layer; up && !up.contains(el); up = up.parentElement) {
        const position = getComputedStyle(up).position;
        if (position === 'fixed' || position === 'sticky') edge = up;
      }
      return edge;
    };
    // What the stack shows under the element where it is: never a cover.
    const under = new Set<Element>();
    const over: Element[] = [];
    for (const [px, py] of inner) {
      let reached = false;
      for (const layer of document.elementsFromPoint(px, py)) {
        if (layer === el || el.contains(layer)) {
          reached = true;
          continue;
        }
        if (layer.contains(el)) break;
        if (reached) {
          under.add(layer);
          continue;
        }
        const edge = stuckBox(layer);
        if (edge) {
          over.push(edge);
          break;
        }
      }
    }
    for (const [px, py] of band) {
      for (const layer of document.elementsFromPoint(px, py)) {
        if (layer === el || el.contains(layer) || layer.contains(el)) break;
        if (under.has(layer)) continue;
        const edge = stuckBox(layer);
        if (edge && !under.has(edge)) {
          over.push(edge);
          break;
        }
      }
    }
    if (over.length === 0) return null;
    const found = over[0]!;
    let coverTop = Infinity;
    let coverBottom = -Infinity;
    for (const edge of over) {
      const er = edge.getBoundingClientRect();
      coverTop = Math.min(coverTop, er.top);
      coverBottom = Math.max(coverBottom, er.bottom);
    }
    const parts: string[] = [];
    for (let node: Element | null = found; node && node !== document.documentElement;) {
      if (node.id) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      const index = node.parentElement ? [...node.parentElement.children].indexOf(node) + 1 : 1;
      parts.unshift(`${node.localName}:nth-child(${index})`);
      node = node.parentElement;
    }
    return { path: parts.join(' > '), top: coverTop, bottom: coverBottom };
  } finally {
    style.remove();
  }
}

/**
 * Scrolls the page so `el`'s box clears a stuck cover from `top` to
 * `bottom`, by `gap`: to below it or above it, whichever leaves the box in
 * the viewport, the shorter way when both do. A cover that leaves room for
 * it neither way, such as a full-height rail, scrolls nothing. Whether it
 * scrolled. Runs in the browser.
 */
export function scrollClearScript(
  el: Element,
  { top, bottom, gap }: { top: number; bottom: number; gap: number },
): boolean {
  const r = el.getBoundingClientRect();
  const scroller = document.scrollingElement ?? document.documentElement;
  // Scrolling by `below` puts the box's top at the cover's bottom and the gap; by `above`, its
  // bottom at the cover's top less the gap.
  const below = r.top - (bottom + gap);
  const above = r.bottom - (top - gap);
  const fitsBelow = bottom + gap + r.height <= innerHeight;
  const fitsAbove = top - gap - r.height >= 0;
  if (!fitsBelow && !fitsAbove) return false;
  const by =
    fitsBelow && fitsAbove
      ? Math.abs(below) <= Math.abs(above)
        ? below
        : above
      : fitsBelow
        ? below
        : above;
  const before = scroller.scrollTop;
  scroller.scrollBy({ top: by, behavior: 'instant' });
  return scroller.scrollTop !== before;
}

/** What clearOfStuckCovers() found: the cover, whether the page scrolled, and what still covers it. */
export interface Clearance {
  /** The stuck cover over it before any scroll, or null. */
  readonly found: string | null;
  /** The page scrolled to clear it; the caller puts it back once it has read. */
  readonly scrolled: boolean;
  /** What still covers it after the scroll, or null. */
  readonly still: string | null;
}

/** Two frames, for a scroll to paint before a screenshot. */
const twoFrames = (page: Page) =>
  page
    .evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    )
    .catch(() => undefined);

/**
 * Whether a stuck cover sits over `locator`'s element, or `margin` round
 * it: if one does, and the element fits past it, the page scrolls it clear,
 * waits for the frames that paints, and reads again.
 */
export async function clearOfStuckCovers(
  page: Page,
  locator: Locator,
  margin = 0,
): Promise<Clearance> {
  // tsx names a script's inner functions with a helper the page doesn't have.
  await page.evaluate('globalThis.__name ??= (f) => f');
  const read = () =>
    locator.evaluate(stuckCoverScript, margin, { timeout: 2_000 }).catch(() => null);
  const cover = await read();
  if (!cover) return { found: null, scrolled: false, still: null };
  const scrolled = await locator
    .evaluate(
      scrollClearScript,
      { top: cover.top, bottom: cover.bottom, gap: COVER_GAP + margin },
      { timeout: 2_000 },
    )
    .catch(() => false);
  if (!scrolled) return { found: cover.path, scrolled, still: cover.path };
  await twoFrames(page);
  return { found: cover.path, scrolled, still: (await read())?.path ?? null };
}
