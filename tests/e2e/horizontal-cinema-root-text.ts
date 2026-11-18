import type { Page } from '@playwright/test';
import { WORD } from '../../packages/variant-horizontal-cinema/src/chapters';

// Horizontal Cinema's pages read with the root text at a given size, as the reflow reads do: what
// the window holds, and what reaches furthest past it.

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** Loads `route`, sets the root text to `size`, and lets the layout settle. */
export async function open(page: Page, route: string, size: string) {
  await page.goto(route, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    (value) => document.documentElement.style.setProperty('font-size', value, 'important'),
    size,
  );
  await frames(page);
  await page.waitForTimeout(250);
  await frames(page);
}

/**
 * As open(), for a page with no script: a frame callback never runs there, so the layout is given
 * time to settle rather than frames.
 */
export async function openStill(page: Page, route: string, size: string) {
  await page.goto(route, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(
    (value) => document.documentElement.style.setProperty('font-size', value, 'important'),
    size,
  );
  await page.waitForTimeout(500);
}

/** The page's scroll width against the window, and what reaches furthest past it. */
export const reach = (page: Page) =>
  page.evaluate(() => {
    const html = document.documentElement;
    let furthest: { at: string; right: number } | null = null;
    for (const element of document.body.querySelectorAll('*')) {
      const right = element.getBoundingClientRect().right;
      if (right > html.clientWidth + 1 && (!furthest || right > furthest.right)) {
        const name = `${element.localName}${element.id ? `#${element.id}` : ''}${[
          ...element.classList,
        ]
          .slice(0, 2)
          .map((c) => `.${c}`)
          .join('')}`;
        furthest = { at: name, right: Math.round(right) };
      }
    }
    return { scroll: html.scrollWidth, window: html.clientWidth, furthest };
  });

/**
 * With every record section open, what in the home's full record runs past the window's edge,
 * where its scene clips it out of sight: each such element's name and right edge, widest first.
 */
export async function pastTheRecord(page: Page) {
  await page.evaluate(() => {
    for (const details of document.querySelectorAll<HTMLDetailsElement>('details[data-record]'))
      details.open = true;
  });
  await frames(page);
  return page.evaluate(() => {
    const edge = document.documentElement.clientWidth + 1;
    const past: { at: string; right: number }[] = [];
    for (const element of document.querySelectorAll('.hc-record *')) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.right <= edge) continue;
      const name = `${element.localName}${element.id ? `#${element.id}` : ''}${[
        ...element.classList,
      ]
        .slice(0, 2)
        .map((c) => `.${c}`)
        .join('')}`;
      past.push({ at: name, right: Math.round(box.right) });
    }
    return past.sort((a, b) => b.right - a.right).slice(0, 8);
  });
}

/**
 * The credits' name as it shows: its font size and its line's width, in px; the widest of its words
 * kept whole; and each word set on more than one line, a word broken inside itself. A word is a run
 * a line may not break, as the fit check reads it.
 */
export const creditsName = (page: Page) =>
  page.evaluate((word) => {
    const name = document.querySelector<HTMLElement>('.hc-credits__name')!;
    const range = document.createRange();
    const broken: string[] = [];
    let widest = 0;
    const texts = document.createTreeWalker(name, NodeFilter.SHOW_TEXT);
    for (let node = texts.nextNode(); node; node = texts.nextNode()) {
      for (const match of (node.textContent ?? '').matchAll(new RegExp(word, 'gu'))) {
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const lines = new Set(
          [...range.getClientRects()]
            .filter((box) => box.width > 0)
            .map((box) => Math.round(box.top)),
        );
        if (lines.size > 1) broken.push(match[0]);
        else widest = Math.max(widest, range.getBoundingClientRect().width);
      }
    }
    return {
      name: name.textContent,
      size: Number.parseFloat(getComputedStyle(name).fontSize),
      width: Math.round(name.clientWidth),
      widest: Math.round(widest),
      broken,
    };
  }, WORD.source);

/**
 * The credits' name against its scene: each line of it that runs past the scene's box or the
 * window, and whether the name's own box scrolls or ellipsizes what it holds, so a part of it would
 * be clipped out of sight.
 */
export const nameInScene = (page: Page) =>
  page.evaluate(() => {
    const name = document.querySelector<HTMLElement>('.hc-credits__name')!;
    const scene = name.closest<HTMLElement>('.hc-credits')!.getBoundingClientRect();
    const edge = document.documentElement.clientWidth;
    const range = document.createRange();
    range.selectNodeContents(name);
    const past = [...range.getClientRects()]
      .filter((box) => box.width > 0)
      .filter(
        (box) =>
          box.left < Math.max(scene.left, 0) - 0.5 || box.right > Math.min(scene.right, edge) + 0.5,
      )
      .map((box) => [Math.round(box.left), Math.round(box.right)]);
    const style = getComputedStyle(name);
    return {
      past,
      scrolls: name.scrollWidth > name.clientWidth + 1,
      ellipsis: style.textOverflow === 'ellipsis',
      wrap: style.overflowWrap,
    };
  });
