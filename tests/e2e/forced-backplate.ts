import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { contrast, decodePng, pixel, type Rgb } from '../quality/lib/pixels';

// Text under forced colours, judged in pixels. The browser lays a backplate of the palette's Canvas
// under every line of text, so a word reads when its glyphs stand off that backplate and vanishes
// when it's painted in the backplate's own colour (Canvas on Canvas). Each text's box is shot as it
// paints and with the text hidden; what changes is the text and its backplate, and the glyphs are
// judged against the backplate, or against the ground where there's none (glyphRatio).

/** The text ratio a word's glyphs reach against their backplate. */
export const TEXT_RATIO = 4.5;

/**
 * The ratio a text's glyphs reach against what they sit on, from its box shot as it paints (`shot`)
 * and with the text hidden (`bare`), `canvas` the palette's Canvas. Where the text lays a backplate
 * (most of what changes is Canvas), the glyphs are what the backplate holds that isn't Canvas: every
 * pixel inside the change or enclosed by it, its blended rim left out, against Canvas; a word in
 * Canvas reads 1:1. With no
 * backplate (an unadjusted part, or a word on the page's own Canvas), each changed pixel against the
 * ground under it.
 */
export function glyphRatio(
  shot: ReturnType<typeof decodePng>,
  bare: ReturnType<typeof decodePng>,
  canvas: Rgb,
): number {
  const { width, height } = shot;
  const n = width * height;
  const same = (a: Rgb, b: Rgb) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const changed = new Uint8Array(n);
  let count = 0;
  let plate = 0;
  for (let i = 0; i < n; i += 1) {
    if (!same(pixel(shot, i), pixel(bare, i))) {
      changed[i] = 1;
      count += 1;
      if (contrast(pixel(shot, i), canvas) < 1.1) plate += 1;
    }
  }
  if (count === 0) return 1;
  let ratio = 1;
  if (plate * 2 < count) {
    for (let i = 0; i < n; i += 1)
      if (changed[i]) ratio = Math.max(ratio, contrast(pixel(shot, i), pixel(bare, i)));
    return ratio;
  }
  // The backplate's region: the change and what it encloses (not reached from the box's edge).
  const outside = new Uint8Array(n);
  const queue: number[] = [];
  for (let x = 0; x < width; x += 1) queue.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y += 1) queue.push(y * width, y * width + width - 1);
  while (queue.length) {
    const i = queue.pop()!;
    if (outside[i] || changed[i]) continue;
    outside[i] = 1;
    const x = i % width;
    if (x > 0) queue.push(i - 1);
    if (x < width - 1) queue.push(i + 1);
    if (i >= width) queue.push(i - width);
    if (i < (height - 1) * width) queue.push(i + width);
  }
  // Only the backplate's inside: its rim, where its edge blends into the ground, isn't a glyph.
  const inside = (i: number) => {
    const x = i % width;
    const y = (i - x) / width;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || outside[ny * width + nx])
          return false;
      }
    }
    return true;
  };
  for (let i = 0; i < n; i += 1) {
    if (inside(i)) ratio = Math.max(ratio, contrast(pixel(shot, i), canvas));
  }
  return ratio;
}

/** A judged text: where it is, its words, and its glyphs' ratio, or why it wasn't judged. */
export interface Judged {
  readonly mark: string;
  readonly words: string;
  readonly ratio: number | null;
  readonly unjudged?: string;
}

/**
 * Each shown text marked `data-forced-text` (or the one marked `only`), judged: scrolled to the
 * viewport's middle, its words' box shot as it paints and again with its own words hidden (their
 * glyphs and backplate, not the element's ground), and, where the two differ (the text paints
 * there), its glyphs against its backplate. A text that paints nothing
 * where it lies (no opacity, no box, collapsed, clipped or covered) isn't judged, and says why.
 */
export async function judgeTexts(page: Page, only?: string): Promise<Judged[]> {
  const marks = await page.$$eval(
    only === undefined ? '[data-forced-text]' : `[data-forced-text="${only}"]`,
    (els) =>
      els.map((el) => ({
        mark: el.getAttribute('data-forced-text')!,
        words: (el.textContent ?? '').trim().slice(0, 32),
      })),
  );
  const view = page.viewportSize() ?? { width: 1024, height: 768 };
  const canvas = (await page.evaluate(() => {
    const sample = document.createElement('span');
    sample.style.color = 'Canvas';
    document.body.append(sample);
    const rgb = getComputedStyle(sample).color.match(/\d+/g)!.slice(0, 3).map(Number);
    sample.remove();
    return rgb;
  })) as unknown as Rgb;
  const judged: Judged[] = [];
  for (const { mark, words } of marks) {
    const box = await page.evaluate((m) => {
      const el = document.querySelector(`[data-forced-text="${m}"]`)!;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      let opacity = 1;
      for (let at: Element | null = el; at; at = at.parentElement)
        opacity *= Number(getComputedStyle(at).opacity);
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, opacity };
    }, mark);
    if (box.opacity === 0) {
      judged.push({ mark, words, ratio: null, unjudged: 'no opacity' });
      continue;
    }
    if (box.width < 4 || box.height < 4) {
      judged.push({ mark, words, ratio: null, unjudged: 'no box' });
      continue;
    }
    const x = Math.max(0, Math.floor(box.x));
    const y = Math.max(0, Math.floor(box.y));
    const clip = {
      x,
      y,
      width: Math.min(view.width - x, Math.ceil(box.x + box.width) - x),
      height: Math.min(view.height - y, Math.ceil(box.y + box.height) - y),
    };
    if (clip.width < 2 || clip.height < 2) {
      judged.push({ mark, words, ratio: null, unjudged: 'outside the viewport' });
      continue;
    }
    const shot = decodePng(await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }));
    // Hides the word's own glyphs, and with them its backplate, by wrapping its text in an unstyled
    // element made invisible: the element's own ground (a chip, a plate, a button) stays, so what
    // changes is the word and its backplate over that ground.
    const hide = (on: boolean) =>
      page.evaluate(
        ([m, v]) => {
          const el = document.querySelector<HTMLElement>(`[data-forced-text="${m}"]`)!;
          if (v) {
            for (const node of [...el.childNodes]) {
              if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
              const wrap = document.createElement('x-forced-glyphs');
              wrap.style.setProperty('visibility', 'hidden');
              node.replaceWith(wrap);
              wrap.append(node);
            }
          } else {
            for (const wrap of el.querySelectorAll(':scope > x-forced-glyphs')) {
              wrap.replaceWith(...wrap.childNodes);
            }
          }
        },
        [mark, on] as const,
      );
    await hide(true);
    const bare = decodePng(await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }));
    await hide(false);
    let paints = false;
    for (let i = 0; i < shot.data.length && !paints; i += 1) paints = shot.data[i] !== bare.data[i];
    if (!paints) {
      judged.push({ mark, words, ratio: null, unjudged: 'paints nothing where it lies' });
      continue;
    }
    judged.push({ mark, words, ratio: glyphRatio(shot, bare, canvas) });
  }
  return judged;
}

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

/** The app options that serve the complete fixture in composition `id`. */
export function fixtureIn(id: string) {
  return {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), id),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  };
}

export const annotation = (route: string) => [
  { type: 'route', description: route },
  { type: 'profile', description: 'read-only' },
];

/** Each route, palette and width a forced-colours read covers. */
export const FORCED_CASES = (['/', '/work/project-name'] as const).flatMap((route) =>
  (['light', 'dark'] as const).flatMap((palette) =>
    [1024, 390].map((width) => ({ route, palette, width })),
  ),
);

/** Opens `route` at `width` under forced colours in the system's `palette`. */
export async function openForced(
  page: Page,
  { route, palette, width }: { route: string; palette: 'light' | 'dark'; width: number },
): Promise<void> {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 768 });
  await page.emulateMedia({
    colorScheme: palette,
    forcedColors: 'active',
    reducedMotion: 'reduce',
  });
  await page.goto(route, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

/**
 * Each shown text `selectors` match whose words vanish into their backplate (under the text
 * ratio, or painting nothing where they lie while shown), as `<words>: <why>`; and how many it
 * judged, so a list that found nothing can't pass.
 */
export async function vanishedAmong(
  page: Page,
  selectors: readonly string[],
): Promise<{ judged: number; vanished: string[] }> {
  await page.evaluate((list) => {
    let at = 0;
    for (const el of document.querySelectorAll(list.join(', '))) {
      if (!el.textContent?.trim() || !el.getClientRects().length) continue;
      el.setAttribute('data-forced-text', String(at));
      at += 1;
    }
  }, selectors);
  const judged = await judgeTexts(page);
  return {
    judged: judged.length,
    vanished: judged
      .filter((item) => item.ratio === null || item.ratio < TEXT_RATIO)
      .map(
        (item) =>
          `${item.words}: ${item.ratio === null ? item.unjudged : `${item.ratio.toFixed(2)}:1`}`,
      ),
  };
}

/** The ratio a drawing (a stroke, a fill, a border, a part's own ground) reaches on its ground. */
export const DRAWING_RATIO = 3;

/**
 * Each of `selectors`' first shown match, judged as a drawing on its ground: with every word on the
 * page hidden (no glyphs and no backplates, a part's ::before and ::after left out with them), its
 * box is shot as it paints and again with the part itself hidden, and each pixel that changes is
 * judged against the ground under it. A part that changes nothing when hidden draws in its
 * ground's own colour. Returns how many it judged and each drawing under the ratio, as
 * `<selector>: <why>`, so a list that found nothing can't pass.
 */
export async function drawingsAmong(
  page: Page,
  selectors: readonly string[],
): Promise<{ judged: number; lost: string[] }> {
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent =
      '*::before, *::after { visibility: hidden !important; } x-forced-glyphs { visibility: hidden !important; }';
    document.head.append(style);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (node.textContent?.trim()) nodes.push(node as Text);
    for (const node of nodes) {
      const parent = node.parentElement;
      if (!parent) continue;
      if (parent instanceof SVGElement) {
        parent.style.setProperty('visibility', 'hidden', 'important');
        continue;
      }
      const wrap = document.createElement('x-forced-glyphs');
      node.replaceWith(wrap);
      wrap.append(node);
    }
  });
  const view = page.viewportSize() ?? { width: 1024, height: 768 };
  let judged = 0;
  const lost: string[] = [];
  for (const selector of selectors) {
    const box = await page.evaluate((s) => {
      const el = [...document.querySelectorAll<HTMLElement | SVGElement>(s)].find(
        (one) => one.getClientRects().length > 0,
      );
      if (!el) return null;
      el.setAttribute('data-forced-drawing', '');
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, selector);
    if (!box) continue;
    judged += 1;
    const x = Math.max(0, Math.floor(box.x) - 1);
    const y = Math.max(0, Math.floor(box.y) - 1);
    const clip = {
      x,
      y,
      width: Math.min(view.width, Math.ceil(box.x + box.width) + 1) - x,
      height: Math.min(view.height, Math.ceil(box.y + box.height) + 1) - y,
    };
    if (clip.width < 2 || clip.height < 2) {
      lost.push(`${selector}: outside the viewport`);
      continue;
    }
    const shoot = async () =>
      decodePng(await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }));
    const shot = await shoot();
    const hide = (on: boolean) =>
      page.evaluate((v) => {
        const el = document.querySelector<HTMLElement | SVGElement>('[data-forced-drawing]')!;
        if (v) el.style.setProperty('visibility', 'hidden', 'important');
        else el.style.removeProperty('visibility');
      }, on);
    await hide(true);
    const bare = await shoot();
    await hide(false);
    await page.evaluate(() =>
      document.querySelector('[data-forced-drawing]')?.removeAttribute('data-forced-drawing'),
    );
    let ratio = 0;
    for (let i = 0; i < shot.width * shot.height; i += 1)
      ratio = Math.max(ratio, contrast(pixel(shot, i), pixel(bare, i)));
    if (ratio < DRAWING_RATIO)
      lost.push(
        `${selector}: ${ratio <= 1 ? 'draws in the colour of its ground' : `${ratio.toFixed(2)}:1`}`,
      );
  }
  return { judged, lost };
}
