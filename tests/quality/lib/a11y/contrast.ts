// Contrast where axe can't tell (#11, Slice 2, item 1, and the owner's
// [37]): text over a gradient, an image, a translucent surface, or a
// canvas comes back from axe's color-contrast rule as incomplete. Each such
// element is sampled with its glyphs hidden, and its text color, laid over
// every background pixel in its content box, must reach the text or
// large-text ratio of quality/thresholds.json against the worst one. One it
// can't sample fails too, so an incomplete result never passes by default.
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
          (el, { key, near, query, boundary }) => {
            const style = getComputedStyle(el);
            const high =
              window.matchMedia(query).matches ||
              el.closest('[data-appearance-boundary]')?.matches(boundary) === true;
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
              mode: high ? ('high-contrast' as const) : ('normal' as const),
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
      const need = neededRatio(sample.fontSize, sample.fontWeight, sample.mode);
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
