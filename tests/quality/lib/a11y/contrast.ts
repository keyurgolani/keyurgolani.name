// Contrast where axe can't tell (#11, Slice 2, item 1, and the owner's
// [37]): text over a gradient, an image, a translucent surface, or a
// canvas comes back from axe's color-contrast rule as incomplete. Each such
// element is sampled with its glyphs hidden, and its text color, laid over
// every background pixel in its content box, must reach the text or
// large-text ratio of quality/thresholds.json against the worst one. One it
// can't sample fails too, so an incomplete result never passes by default.
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

import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { loadThresholds } from '../../../../quality/thresholds';
import { blend, contrast, decodePng, parseCssColor, pixel } from '../pixels';
import type { AxeResults } from '../records';
import { nodeSelector } from '../records';
import type { Finding } from './interaction';

const thresholds = loadThresholds();
const PX_PER_PT = 4 / 3;

/** The style that hides one call's marks: the sampled element's glyphs by color, a neighbour's by fill. */
const hideCss = (key: string) =>
  `[data-quality-glyphs="${key}"], [data-quality-glyphs="${key}"] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; } [data-quality-neighbours="${key}"], [data-quality-neighbours="${key}"] * { -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; }`;

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

interface Sample {
  readonly color: string;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly box: Box;
  /** The other texts near the box, in the order the page keeps them. */
  readonly texts: readonly NearText[];
}

/** The worst ratio of `color` over the background in the PNG `shot`, or null for an empty one. */
export function worstRatio(shot: Uint8Array, color: string): number | null {
  const parsed = parseCssColor(color);
  const image = decodePng(shot);
  if (!parsed || image.width * image.height === 0) return null;
  let worst = 21;
  for (let i = 0; i < image.width * image.height; i++) {
    const under = pixel(image, i);
    worst = Math.min(worst, contrast(blend(parsed.rgb, parsed.alpha, under), under));
  }
  return worst;
}

/** The ratio text needs at `fontSize` px and `fontWeight`: large text's, or normal text's. */
export function neededRatio(
  fontSize: number,
  fontWeight: number,
): { rule: 'text' | 'large-text'; ratio: number } {
  const { text, largeText, largeTextPt, largeBoldTextPt, largeBoldWeight } = thresholds.contrast;
  const large =
    fontSize >= largeTextPt * PX_PER_PT - 0.01 ||
    (fontSize >= largeBoldTextPt * PX_PER_PT - 0.01 && fontWeight >= largeBoldWeight);
  return large ? { rule: 'large-text', ratio: largeText } : { rule: 'text', ratio: text };
}

/** Whether axe names `node` inside a frame: its target has a part for each document, the frame's first. */
export const inFrame = (node: { readonly target: readonly unknown[] }): boolean =>
  node.target.length > 1;

/** How many incomplete color-contrast items axe names inside a frame. */
export function framedItems(results: Pick<AxeResults, 'incomplete'>): number {
  const nodes = results.incomplete.find((rule) => rule.id === 'color-contrast')?.nodes ?? [];
  return nodes.filter(inFrame).length;
}

/**
 * Each incomplete color-contrast element resolved against its worst
 * background pixel. With `framed`, for a surface whose frame's document
 * other cells cover, the items inside a frame are left out first, before
 * anything samples; every item in the page itself stays.
 */
export async function incompleteContrastFindings(
  page: Page,
  results: Pick<AxeResults, 'incomplete'>,
  framed = false,
): Promise<Finding[]> {
  const incomplete = results.incomplete.find((rule) => rule.id === 'color-contrast')?.nodes ?? [];
  const nodes = framed ? incomplete.filter((node) => !inFrame(node)) : incomplete;
  if (nodes.length === 0) return [];
  const findings: Finding[] = [];
  // This call's key: its style, its marks, and the texts the page keeps between calls carry it.
  const key = randomBytes(6).toString('hex');
  const near = `__qualityNearTexts_${key}`;
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
      await locator.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => undefined);
      const sample = await locator
        .evaluate(
          (el, { key, near }) => {
            const style = getComputedStyle(el);
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
            return {
              color:
                fill && fill !== style.color && !/^rgba?\(0, 0, 0, 0\)$/.test(fill)
                  ? fill
                  : style.color,
              fontSize: Number.parseFloat(style.fontSize) || 0,
              fontWeight: Number(style.fontWeight) || 400,
              box: { x, y, width: right - x, height: bottom - y },
              texts,
            };
          },
          { key, near },
          { timeout: 2_000 },
        )
        .catch(() => null as Sample | null);
      if (!sample || sample.box.width < 1 || sample.box.height < 1) {
        await unmark();
        await unmarkNeighbours();
        unresolved('it has no box in the viewport to sample');
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
      const shot = await page.screenshot({
        clip: sample.box,
        animations: 'disabled',
        caret: 'hide',
      });
      await unmark();
      await unmarkNeighbours();
      const worst = worstRatio(shot, sample.color);
      const need = neededRatio(sample.fontSize, sample.fontWeight);
      if (worst === null) unresolved(`its color ${sample.color} isn't one the sampler reads`);
      else if (worst < need.ratio) {
        findings.push({
          gate: 'contrast',
          rule: need.rule,
          path: selector,
          expected: `${need.ratio}:1`,
          actual: `${worst.toFixed(2)}:1 against its worst background pixel`,
        });
      }
    }
  } finally {
    await page.evaluate(
      ({ key, near }) => {
        document.querySelector(`style[data-quality-glyphs="${key}"]`)?.remove();
        for (const el of document.querySelectorAll(
          `[data-quality-glyphs="${key}"], [data-quality-neighbours="${key}"]`,
        )) {
          if (el.getAttribute('data-quality-glyphs') === key)
            el.removeAttribute('data-quality-glyphs');
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
