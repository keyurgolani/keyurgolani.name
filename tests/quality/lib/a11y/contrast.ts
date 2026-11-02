// Contrast where axe can't tell (#11, Slice 2, item 1, and the owner's
// [37]): text over a gradient, an image, a translucent surface, or a
// canvas comes back from axe's color-contrast rule as incomplete. Each such
// element is sampled with its glyphs hidden, and its text color, laid over
// every background pixel round its glyphs, must reach the text or
// large-text ratio of quality/thresholds.json against the worst one. One it
// can't sample fails too, so an incomplete result never passes by default.
//
// Round its glyphs is their mask dilated by HALO, inside its content box
// (the lead's ruling, 2026-10-28): decoration that touches or crowds a
// letter, a star, a dot, a rim or a rule, is its background, and decoration
// elsewhere in the box isn't. The mask is the text's own paint: the same
// clip shot twice more, the glyphs filled black and then white over the
// real background, everything else as the background shot has it, and the
// pixels where the two differ by GLYPH_COVERAGE in every channel. A text
// with no glyph pixel in its box is unresolved.
// Where the element renders high contrast, by its own presentation
// boundary's display mode or contrast, or by prefers-contrast: more, the
// ratios are the file's highContrast ones, 7 and 4.5, and axe's AAA rule,
// color-contrast-enhanced, runs beside color-contrast (run-cell.ts): its
// incomplete items come here with color-contrast's, each element once.
//
// Its neighbours' glyphs at the box's edge are hidden too (neighbourTexts):
// another in-flow text whose line box overlaps the sampled box by no more
// than NEIGHBOUR_MARGIN, across on the same line or down from the line
// above or below. A glyph with no side bearing, such as an en dash in an
// Arial-metric font right before a date, paints its antialiased edge inside
// the date's box, and that edge isn't the date's background. Text that
// overlaps the box further, or covers it, or sits out of flow (absolute or
// fixed), is the element's backdrop, such as a large numeral behind a
// heading, so it stays and is measured. The mark goes on the neighbour
// text's parent element and hides by fill alone, so no layout moves and no
// currentColor border or icon changes; the parent's own pseudo-element text
// is hidden with it, which only matters inside the edge band. Every mark,
// and the style that hides them, carries one call's key and comes off
// after each sample and when the call ends.
//
// What's painted over the box isn't its background when it's stuck: a
// fixed or sticky header or dock the element doesn't sit in, which a
// visitor scrolls out from under (covers.ts). The sampler scrolls
// the box clear of it, by the cover's edge and COVER_GAP, and reads again;
// one that still covers it leaves the box unresolved, which fails as one
// it can't sample, never as a ratio. A box its transforms or an ancestor's
// rotate or skew is sampled inside its own content quad (insideQuad), not
// the axis-aligned clip round it, whose corners hold its parent's paint;
// one in 3D, or split across lines, is unresolved.

import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { loadThresholds } from '../../../../quality/thresholds';
import { blend, contrast, decodePng, parseCssColor, pixel, type Image } from '../pixels';
import type { AxeResults } from '../records';
import { nodeSelector } from '../records';
import { clearOfStuckCovers } from './covers';
import type { Finding } from './interaction';

const thresholds = loadThresholds();
const PX_PER_PT = 4 / 3;

/**
 * The style that hides one call's marks, the sampled element's glyphs by
 * color and a neighbour's by fill, and that fills the element's glyphs
 * black or white, by its data-quality-mask, for its mask: by fill and
 * decoration alone, so a currentColor border or icon stays hidden in both.
 */
const hideCss = (key: string) =>
  `[data-quality-glyphs="${key}"], [data-quality-glyphs="${key}"] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; } [data-quality-neighbours="${key}"], [data-quality-neighbours="${key}"] * { -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; }${(
    ['black', 'white'] as const
  )
    .map((fill) => {
      const marked = `[data-quality-glyphs="${key}"][data-quality-mask="${fill}"]`;
      return ` ${marked}, ${marked} * { -webkit-text-fill-color: ${fill} !important; text-decoration-color: ${fill} !important; } ${marked}:is(text, tspan), ${marked} :is(text, tspan) { fill: ${fill} !important; }`;
    })
    .join('')}`;

/** A box in the viewport, in CSS pixels. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Another text near a sampled box: its line boxes, and whether it's out of flow (absolute or fixed). */
export interface NearText {
  readonly rects: readonly Box[];
  readonly outOfFlow: boolean;
}

/**
 * How far another text's line box may overlap a sampled box, or stop short
 * of it, and still be an edge to hide, in CSS pixels: a glyph's antialiased
 * edge, or a little overhang.
 */
export const NEIGHBOUR_MARGIN = 2;

/**
 * Whether `rect` paints only into `box`'s edge band: beside it on the same
 * line, overlapping it across by at most NEIGHBOUR_MARGIN, or above or below
 * it, overlapping it down by at most that, a gap within the margin counting
 * too. A rect that overlaps further both ways, or covers the box, doesn't.
 */
export function reaches(rect: Box, box: Box): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  const m = NEIGHBOUR_MARGIN;
  const across = Math.min(rect.x + rect.width, box.x + box.width) - Math.max(rect.x, box.x);
  const down = Math.min(rect.y + rect.height, box.y + box.height) - Math.max(rect.y, box.y);
  const edge = (overlap: number) => overlap > -m && overlap <= m;
  return (edge(across) && down > -m) || (edge(down) && across > -m);
}

/** The other texts, by index, to hide while `box` is sampled: each in-flow one with a line box at its edge. */
export function neighbourTexts(texts: readonly NearText[], box: Box): number[] {
  return texts.flatMap((text, at) =>
    !text.outOfFlow && text.rects.some((rect) => reaches(rect, box)) ? [at] : [],
  );
}

/** axe's AA contrast rule, and its AAA one, which runs where the page renders high contrast. */
export const CONTRAST_RULE = 'color-contrast';
export const ENHANCED_CONTRAST_RULE = 'color-contrast-enhanced';

/** Whether text is held to the normal ratios or to quality/thresholds.json's highContrast ones. */
export type ContrastMode = 'normal' | 'high-contrast';

/** The query under which every boundary renders high contrast, as the platform stylesheet has it. */
export const MORE_CONTRAST = '(prefers-contrast: more)';

/** A presentation boundary that renders high contrast: the mode, or data-contrast="more". */
export const HIGH_CONTRAST_BOUNDARY =
  '[data-appearance-boundary][data-display-mode="high-contrast"], [data-appearance-boundary][data-contrast="more"]';

interface Sample {
  readonly color: string;
  /** What the element's own boundary renders, or prefers-contrast: more for the whole page. */
  readonly mode: ContrastMode;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly box: Box;
  /** The other texts near the box, in the order the page keeps them. */
  readonly texts: readonly NearText[];
  /** Its transforms and its ancestors' are 2D. */
  readonly flat: boolean;
  /** They rotate or skew it, so its box isn't on the axes. */
  readonly turned: boolean;
  /** Its content box on screen when turned, if it has one quad; `box` is then the quad's bounds. */
  readonly quad: Quad | null;
}

/**
 * The worst ratio of `color` over the background in the PNG `shot`, or
 * null for an empty one. With `inside`, only the pixels it keeps, by column
 * and row in the image, count; null when it keeps none.
 */
export function worstRatio(
  shot: Uint8Array,
  color: string,
  inside?: (column: number, row: number, image: Image) => boolean,
): number | null {
  const parsed = parseCssColor(color);
  const image = decodePng(shot);
  if (!parsed || image.width * image.height === 0) return null;
  let worst = 21;
  let counted = 0;
  for (let i = 0; i < image.width * image.height; i++) {
    if (inside && !inside(i % image.width, Math.floor(i / image.width), image)) continue;
    counted++;
    const under = pixel(image, i);
    worst = Math.min(worst, contrast(blend(parsed.rgb, parsed.alpha, under), under));
  }
  return counted > 0 ? worst : null;
}

/**
 * How far round its glyphs a text's background counts, in CSS pixels: a
 * decoration that touches or crowds a letter is its background, and one
 * further off in its box isn't.
 */
export const HALO = 2;

/**
 * How much of a pixel a glyph must cover to be in its mask: the share of
 * 255 by which its white and black renders differ, in every channel.
 */
export const GLYPH_COVERAGE = 0.2;

/**
 * The glyph mask of a text from two shots of one clip, its glyphs filled
 * black in `black` and white in `white` over the same background: 1 where
 * they differ by GLYPH_COVERAGE of 255 in every channel, which only its
 * glyphs' paint does. Null when the shots aren't the same size.
 */
export function glyphMask(black: Image, white: Image): Uint8Array | null {
  if (black.width !== white.width || black.height !== white.height) return null;
  const mask = new Uint8Array(black.width * black.height);
  const least = GLYPH_COVERAGE * 255;
  for (let i = 0; i < mask.length; i++) {
    let lowest = 255;
    for (let channel = 0; channel < 3; channel++)
      lowest = Math.min(lowest, white.data[i * 4 + channel]! - black.data[i * 4 + channel]!);
    if (lowest >= least) mask[i] = 1;
  }
  return mask;
}

/** `mask`, `width` pixels a row, dilated by a disc of `radius` pixels: each pixel whose center is that close to one in it. */
export function dilate(mask: Uint8Array, width: number, radius: number): Uint8Array {
  const height = width > 0 ? mask.length / width : 0;
  const reach = Math.floor(radius);
  const disc: [number, number][] = [];
  for (let dy = -reach; dy <= reach; dy++)
    for (let dx = -reach; dx <= reach; dx++)
      if (dx * dx + dy * dy <= radius * radius + 1e-9) disc.push([dx, dy]);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const [column, row] = [i % width, Math.floor(i / width)];
    for (const [dx, dy] of disc) {
      const [x, y] = [column + dx, row + dy];
      if (x >= 0 && x < width && y >= 0 && y < height) out[y * width + x] = 1;
    }
  }
  return out;
}

/**
 * The pixels within HALO of a text's glyphs, from its black and white PNG
 * shots of `clip`, as a filter for worstRatio(): HALO is in CSS pixels, so
 * by the shot's own scale. Null when the shots aren't the same size, and
 * `glyphs` 0 when no glyph paints in the clip.
 */
export function glyphHalo(
  black: Uint8Array,
  white: Uint8Array,
  clip: Box,
): { glyphs: number; inside: (column: number, row: number, image: Image) => boolean } | null {
  const [dark, light] = [decodePng(black), decodePng(white)];
  const mask = glyphMask(dark, light);
  if (!mask || clip.width <= 0) return null;
  const halo = dilate(mask, dark.width, (HALO * dark.width) / clip.width);
  return {
    glyphs: mask.reduce((sum, on) => sum + on, 0),
    inside: (column, row, image) =>
      image.width === dark.width &&
      image.height === dark.height &&
      halo[row * dark.width + column] === 1,
  };
}

/**
 * A box drawn rotated or skewed: its content box in its own coordinates,
 * centered on the origin (left, right, top, bottom), and the 2D linear map
 * (a, b, c, d, as DOMMatrix names them) its transforms and its ancestors'
 * put it through, about its center on screen, (cx, cy) in the viewport.
 */
export interface Quad {
  readonly cx: number;
  readonly cy: number;
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** How far inside a rotated content box a pixel's center must be: its antialiased edge isn't its background. */
export const QUAD_INSET = 1;

/**
 * Whether the pixel at `column`, `row` of a shot of `clip` has its center
 * inside `quad`, QUAD_INSET in from its edge: the pixels a rotated box's
 * text sits on, and none of its parent's around it, which an axis-aligned
 * clip takes in at the corners.
 */
export function insideQuad(
  quad: Quad,
  clip: Box,
): (column: number, row: number, image: Image) => boolean {
  const det = quad.a * quad.d - quad.b * quad.c;
  return (column, row, image) => {
    if (Math.abs(det) < 1e-9) return false;
    const x = clip.x + ((column + 0.5) * clip.width) / image.width - quad.cx;
    const y = clip.y + ((row + 0.5) * clip.height) / image.height - quad.cy;
    const u = (quad.d * x - quad.c * y) / det;
    const v = (-quad.b * x + quad.a * y) / det;
    return (
      u >= quad.left + QUAD_INSET &&
      u <= quad.right - QUAD_INSET &&
      v >= quad.top + QUAD_INSET &&
      v <= quad.bottom - QUAD_INSET
    );
  };
}

/** The contrast rule a sampled element fails, as the exceptions file names it (lib/exceptions.ts). */
export type ContrastRule =
  'text' | 'large-text' | 'high-contrast-text' | 'high-contrast-large-text';

/**
 * The ratio text needs at `fontSize` px and `fontWeight` in `mode`: large
 * text's, or normal text's, from the file's highContrast ratios when the
 * element renders high contrast.
 */
export function neededRatio(
  fontSize: number,
  fontWeight: number,
  mode: ContrastMode = 'normal',
): { rule: ContrastRule; ratio: number } {
  const { largeTextPt, largeBoldTextPt, largeBoldWeight } = thresholds.contrast;
  const { text, largeText } =
    mode === 'high-contrast' ? thresholds.contrast.highContrast : thresholds.contrast;
  const large =
    fontSize >= largeTextPt * PX_PER_PT - 0.01 ||
    (fontSize >= largeBoldTextPt * PX_PER_PT - 0.01 && fontWeight >= largeBoldWeight);
  const prefix = mode === 'high-contrast' ? 'high-contrast-' : '';
  return large
    ? { rule: `${prefix}large-text`, ratio: largeText }
    : { rule: `${prefix}text`, ratio: text };
}

/**
 * Whether anything on the page renders high contrast: prefers-contrast:
 * more, or a presentation boundary in the mode or at data-contrast="more".
 * Runs in the browser.
 */
export function rendersHighContrastScript({
  query,
  boundary,
}: {
  readonly query: string;
  readonly boundary: string;
}): boolean {
  return window.matchMedia(query).matches || document.querySelector(boundary) !== null;
}

/**
 * Whether each element `selectors` names renders high contrast: every one
 * under prefers-contrast: more, and otherwise each whose own presentation
 * boundary, the closest, renders it. A null selector, for a node in a frame
 * or shadow root, or one that matches nothing, says false there. Runs in
 * the browser.
 */
export function elementsHighContrastScript({
  query,
  boundary,
  selectors,
}: {
  readonly query: string;
  readonly boundary: string;
  readonly selectors: readonly (string | null)[];
}): boolean[] {
  const more = window.matchMedia(query).matches;
  return selectors.map((selector) => {
    if (more) return true;
    const el = selector === null ? null : document.querySelector(selector);
    return el?.closest('[data-appearance-boundary]')?.matches(boundary) === true;
  });
}

/**
 * `results` with color-contrast-enhanced's violations kept only on the
 * elements that render high contrast, so a nested boundary in another
 * mode, or a node the page can't read, stays under color-contrast's AA
 * ratios alone.
 */
export async function highContrastViolations<T extends Pick<AxeResults, 'violations'>>(
  page: Page,
  results: T,
): Promise<T> {
  const at = results.violations.findIndex((rule) => rule.id === ENHANCED_CONTRAST_RULE);
  if (at === -1) return results;
  const rule = results.violations[at]!;
  const high = await page.evaluate(elementsHighContrastScript, {
    query: MORE_CONTRAST,
    boundary: HIGH_CONTRAST_BOUNDARY,
    selectors: rule.nodes.map(nodeSelector),
  });
  const nodes = rule.nodes.filter((_, index) => high[index]);
  const violations = [...results.violations];
  if (nodes.length === 0) violations.splice(at, 1);
  else violations[at] = { ...rule, nodes };
  return { ...results, violations };
}

/**
 * The incomplete contrast items, color-contrast's and color-contrast-
 * enhanced's, each element once, by its target: the sampler holds each to
 * the ratios its own mode needs, whichever rule named it.
 */
export function incompleteContrastNodes(
  results: Pick<AxeResults, 'incomplete'>,
): AxeResults['incomplete'][number]['nodes'] {
  const seen = new Set<string>();
  return results.incomplete
    .filter((rule) => rule.id === CONTRAST_RULE || rule.id === ENHANCED_CONTRAST_RULE)
    .flatMap((rule) => rule.nodes)
    .filter((node) => {
      const key = JSON.stringify(node.target);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Whether axe names `node` inside a frame: its target has a part for each document, the frame's first. */
export const inFrame = (node: { readonly target: readonly unknown[] }): boolean =>
  node.target.length > 1;

/** How many incomplete contrast items axe names inside a frame. */
export function framedItems(results: Pick<AxeResults, 'incomplete'>): number {
  return incompleteContrastNodes(results).filter(inFrame).length;
}

/**
 * Each incomplete contrast element resolved against its worst background
 * pixel, at the ratios its own mode needs. With `framed`, for a surface
 * whose frame's document other cells cover, the items inside a frame are
 * left out first, before anything samples; every item in the page itself
 * stays.
 */
export async function incompleteContrastFindings(
  page: Page,
  results: Pick<AxeResults, 'incomplete'>,
  framed = false,
): Promise<Finding[]> {
  const incomplete = incompleteContrastNodes(results);
  const nodes = framed ? incomplete.filter((node) => !inFrame(node)) : incomplete;
  if (nodes.length === 0) return [];
  const findings: Finding[] = [];
  // This call's key: its style, its marks, and the texts the page keeps between calls carry it.
  const key = randomBytes(6).toString('hex');
  const near = `__qualityNearTexts_${key}`;
  // tsx names a script's inner functions with a helper the page doesn't have.
  await page.evaluate('globalThis.__name ??= (f) => f');
  await page.evaluate(
    ({ css, key }) => {
      const style = document.createElement('style');
      style.dataset.qualityGlyphs = key;
      style.textContent = css;
      document.head.append(style);
    },
    { css: hideCss(key), key },
  );
  /** Takes this call's neighbour marks off, and the texts the page kept. */
  const unmarkNeighbours = () =>
    page.evaluate(
      ({ key, near }) => {
        for (const el of document.querySelectorAll(`[data-quality-neighbours="${key}"]`))
          el.removeAttribute('data-quality-neighbours');
        delete (window as unknown as Record<string, unknown>)[near];
      },
      { key, near },
    );
  try {
    for (const node of nodes) {
      const selector = nodeSelector(node);
      const unresolved = (actual: string) =>
        findings.push({
          gate: 'contrast',
          rule: 'text',
          path: selector ?? undefined,
          expected: 'a contrast measured against its worst background pixel',
          actual,
        });
      if (!selector) {
        unresolved("axe named it inside a frame or shadow root, which the sampler can't reach");
        continue;
      }
      const locator = page.locator(selector).first();
      const unmark = () =>
        locator.evaluate((el) => el.removeAttribute('data-quality-glyphs')).catch(() => undefined);
      // Where the page was, which it goes back to once this element is read.
      const at = await page.evaluate(() => [scrollX, scrollY] as const).catch(() => null);
      try {
        await locator.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => undefined);
        // A stuck header or dock over it isn't its background: scroll it clear, or say so.
        const cover = await clearOfStuckCovers(page, locator);
        if (cover.still) {
          unresolved(
            cover.scrolled
              ? `unresolved: ${cover.still}, fixed or sticky, still covers it once it's scrolled clear, so its background can't be sampled`
              : `unresolved: ${cover.still}, fixed or sticky, covers it, and leaves no room in the viewport to scroll it clear, so its background can't be sampled`,
          );
          continue;
        }
        const sample = await locator
          .evaluate(
            (el, { key, near, query, boundary }) => {
              const style = getComputedStyle(el);
              const high =
                window.matchMedia(query).matches ||
                el.closest('[data-appearance-boundary]')?.matches(boundary) === true;
              // The 2D map its transforms and its ancestors' put it through: CSS
              // applies translate, rotate, scale, then transform, and each
              // ancestor's after its child's. Only rotation and skew matter here,
              // as they take the box off the axes; a 3D one can't be sampled.
              let matrix = new DOMMatrix();
              let flat = true;
              for (let up: Element | null = el; up; up = up.parentElement) {
                const s = getComputedStyle(up);
                let own = new DOMMatrix(s.transform === 'none' ? undefined : s.transform);
                if (s.scale && s.scale !== 'none') {
                  const [sx = 1, sy = sx, sz = 1] = s.scale.split(/\s+/).map(Number);
                  if (sz !== 1) flat = false;
                  own = new DOMMatrix().scale(sx, sy).multiply(own);
                }
                if (s.rotate && s.rotate !== 'none') {
                  const parts = s.rotate.trim().split(/\s+/);
                  const angle = parts.pop()!;
                  const axis = parts.join(' ');
                  const value = Number.parseFloat(angle);
                  const deg = angle.endsWith('grad')
                    ? value * 0.9
                    : angle.endsWith('rad')
                      ? (value * 180) / Math.PI
                      : angle.endsWith('turn')
                        ? value * 360
                        : value;
                  if (axis && axis !== 'z' && axis !== '0 0 1') flat = false;
                  own = new DOMMatrix().rotate(deg).multiply(own);
                }
                if (!own.is2D) flat = false;
                matrix = own.multiply(matrix);
              }
              const turned = Math.abs(matrix.b) > 1e-6 || Math.abs(matrix.c) > 1e-6;
              const r = el.getBoundingClientRect();
              const fill = style.webkitTextFillColor;
              const x = Math.max(
                0,
                r.x +
                  (Number.parseFloat(style.borderLeftWidth) || 0) +
                  (Number.parseFloat(style.paddingLeft) || 0),
              );
              const y = Math.max(
                0,
                r.y +
                  (Number.parseFloat(style.borderTopWidth) || 0) +
                  (Number.parseFloat(style.paddingTop) || 0),
              );
              const right = Math.min(
                innerWidth,
                r.right -
                  (Number.parseFloat(style.borderRightWidth) || 0) -
                  (Number.parseFloat(style.paddingRight) || 0),
              );
              const bottom = Math.min(
                innerHeight,
                r.bottom -
                  (Number.parseFloat(style.borderBottomWidth) || 0) -
                  (Number.parseFloat(style.paddingBottom) || 0),
              );
              el.setAttribute('data-quality-glyphs', key);
              // The other texts whose parent's box comes near this one, with their line boxes and
              // whether an ancestor the element doesn't share takes them out of flow, which
              // neighbourTexts() picks from; the page keeps them for the next call.
              const nodes: Text[] = [];
              const texts: {
                rects: { x: number; y: number; width: number; height: number }[];
                outOfFlow: boolean;
              }[] = [];
              const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
              for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                const text = node as Text;
                if (!text.data.trim() || el.contains(text) || !text.parentElement) continue;
                const parent = text.parentElement.getBoundingClientRect();
                const empty = parent.width === 0 && parent.height === 0;
                if (
                  !empty &&
                  (parent.right < x - 8 ||
                    parent.left > right + 8 ||
                    parent.bottom < y - 8 ||
                    parent.top > bottom + 8)
                ) {
                  continue;
                }
                let outOfFlow = false;
                for (
                  let up: Element | null = text.parentElement;
                  up && !up.contains(el);
                  up = up.parentElement
                ) {
                  const position = getComputedStyle(up).position;
                  if (position === 'absolute' || position === 'fixed') outOfFlow = true;
                }
                const range = document.createRange();
                range.selectNodeContents(text);
                nodes.push(text);
                texts.push({
                  rects: [...range.getClientRects()].map((rect) => ({
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                  })),
                  outOfFlow,
                });
              }
              (window as unknown as Record<string, Text[]>)[near] = nodes;
              // A rotated or skewed box: its own content box, through the map, about its
              // center, which the map keeps at its bounding box's center; the clip is that
              // quad's bounds, and only the pixels inside it count. An inline box split
              // across lines has no one quad.
              let quad: Quad | null = null;
              let box = { x, y, width: right - x, height: bottom - y };
              if (turned && el instanceof HTMLElement && el.getClientRects().length === 1) {
                const [w, h] = [el.offsetWidth / 2, el.offsetHeight / 2];
                const side = (name: string) =>
                  (Number.parseFloat(style.getPropertyValue(`border-${name}-width`)) || 0) +
                  (Number.parseFloat(style.getPropertyValue(`padding-${name}`)) || 0);
                quad = {
                  cx: r.x + r.width / 2,
                  cy: r.y + r.height / 2,
                  a: matrix.a,
                  b: matrix.b,
                  c: matrix.c,
                  d: matrix.d,
                  left: -w + side('left'),
                  right: w - side('right'),
                  top: -h + side('top'),
                  bottom: h - side('bottom'),
                };
                const corners = [
                  [quad.left, quad.top],
                  [quad.right, quad.top],
                  [quad.right, quad.bottom],
                  [quad.left, quad.bottom],
                ].map(([u, v]) => [
                  quad!.cx + quad!.a * u! + quad!.c * v!,
                  quad!.cy + quad!.b * u! + quad!.d * v!,
                ]);
                const qx = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[0]!))));
                const qy = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[1]!))));
                const qr = Math.min(innerWidth, Math.ceil(Math.max(...corners.map((p) => p[0]!))));
                const qb = Math.min(innerHeight, Math.ceil(Math.max(...corners.map((p) => p[1]!))));
                box = { x: qx, y: qy, width: qr - qx, height: qb - qy };
              }
              return {
                mode: high ? ('high-contrast' as const) : ('normal' as const),
                color:
                  fill && fill !== style.color && !/^rgba?\(0, 0, 0, 0\)$/.test(fill)
                    ? fill
                    : style.color,
                fontSize: Number.parseFloat(style.fontSize) || 0,
                fontWeight: Number(style.fontWeight) || 400,
                box,
                texts,
                flat,
                turned,
                quad,
              };
            },
            { key, near, query: MORE_CONTRAST, boundary: HIGH_CONTRAST_BOUNDARY },
            { timeout: 2_000 },
          )
          .catch(() => null as Sample | null);
        if (!sample || sample.box.width < 1 || sample.box.height < 1) {
          await unmark();
          await unmarkNeighbours();
          unresolved('it has no box in the viewport to sample');
          continue;
        }
        // An axis-aligned clip of a rotated box takes in what's round it at the corners.
        if (!sample.flat || (sample.turned && !sample.quad)) {
          await unmark();
          await unmarkNeighbours();
          unresolved(
            sample.flat
              ? 'unresolved: it is rotated or skewed across more than one line box, so it has no one quad to sample inside'
              : 'unresolved: it is transformed in 3D, so its box on screen has no 2D quad to sample inside',
          );
          continue;
        }
        // Hide the neighbours' glyphs at the box's edge, by their fill, so no layout moves.
        await page.evaluate(
          ({ key, near, hide }) => {
            const nodes = (window as unknown as Record<string, Text[] | undefined>)[near] ?? [];
            for (const at of hide)
              nodes[at]?.parentElement?.setAttribute('data-quality-neighbours', key);
          },
          { key, near, hide: neighbourTexts(sample.texts, sample.box) },
        );
        const capture = () =>
          page.screenshot({ clip: sample.box, animations: 'disabled', caret: 'hide' });
        const shot = await capture();
        // Its glyphs alone, filled black and then white over the same background, for their mask.
        const masked = async (fill: 'black' | 'white') => {
          await locator.evaluate((el, fill) => el.setAttribute('data-quality-mask', fill), fill);
          return capture();
        };
        const black = await masked('black');
        const white = await masked('white');
        await locator
          .evaluate((el) => el.removeAttribute('data-quality-mask'))
          .catch(() => undefined);
        await unmark();
        await unmarkNeighbours();
        const halo = glyphHalo(black, white, sample.box);
        if (!halo || halo.glyphs === 0) {
          unresolved(
            halo
              ? 'unresolved: none of its glyphs paints inside its box, so there is no halo round them to sample'
              : "unresolved: its glyphs' shots and its background's aren't the same size",
          );
          continue;
        }
        const quad = sample.quad ? insideQuad(sample.quad, sample.box) : undefined;
        const worst = worstRatio(
          shot,
          sample.color,
          (column, row, image) =>
            halo.inside(column, row, image) && (!quad || quad(column, row, image)),
        );
        const need = neededRatio(sample.fontSize, sample.fontWeight, sample.mode);
        if (worst === null)
          unresolved(
            !parseCssColor(sample.color)
              ? `its color ${sample.color} isn't one the sampler reads`
              : sample.quad
                ? 'unresolved: its rotated content box holds no whole pixel round its glyphs to sample'
                : "unresolved: its background's shot holds no pixel round its glyphs",
          );
        else if (worst < need.ratio) {
          findings.push({
            gate: 'contrast',
            rule: need.rule,
            path: selector,
            expected: `${need.ratio}:1`,
            actual: `${worst.toFixed(2)}:1 against its worst background pixel`,
          });
        }
      } finally {
        if (at) {
          await page
            .evaluate(([x, y]) => scrollTo({ left: x, top: y, behavior: 'instant' }), at)
            .catch(() => undefined);
        }
      }
    }
  } finally {
    await page.evaluate(
      ({ key, near }) => {
        document.querySelector(`style[data-quality-glyphs="${key}"]`)?.remove();
        for (const el of document.querySelectorAll(
          `[data-quality-glyphs="${key}"], [data-quality-neighbours="${key}"]`,
        )) {
          if (el.getAttribute('data-quality-glyphs') === key) {
            el.removeAttribute('data-quality-glyphs');
            el.removeAttribute('data-quality-mask');
          }
          if (el.getAttribute('data-quality-neighbours') === key)
            el.removeAttribute('data-quality-neighbours');
        }
        delete (window as unknown as Record<string, unknown>)[near];
      },
      { key, near },
    );
  }
  return findings;
}
