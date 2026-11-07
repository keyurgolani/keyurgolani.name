import type { Frame, Page } from '@playwright/test';
import { WORD } from '../../packages/variant-horizontal-cinema/src/chapters';
import { expect } from '../harness/fixtures';

// Horizontal Cinema's scene model and the readers its browser specs share
// (redesign): the scenes in strip order, which one the page says is
// current, which one is on screen, the URL, history, focus, the live
// status, and whether the strip is pinned to the page's scroll.

export type Scope = Page | Frame;

/**
 * Everything the scene state shows, read in one go. `landed` says the page
 * has just landed on a link, a fresh load, or Back, and the reader hasn't
 * scrolled since: only then does the scene the link names keep the page
 * while it's at the top.
 */
export function read(scope: Scope, { landed = false }: { landed?: boolean } = {}) {
  return scope.evaluate((landed) => {
    const stage = document.querySelector<HTMLElement>('.hc-stage')!;
    const shell = document.querySelector<HTMLElement>('.hc-shell')!;
    const box = stage.getBoundingClientRect();
    const horizontal = ['auto', 'scroll'].includes(getComputedStyle(stage).overflowX);
    const scenes = [...document.querySelectorAll<HTMLElement>('.hc-track .hc-scene')];
    const blocks = [...document.querySelectorAll('.hc-minimap__blocks i')];
    const current = blocks.findIndex((block) => block.hasAttribute('data-now'));
    const rtl = getComputedStyle(stage).direction === 'rtl';
    // The scene on screen, by the page's own geometry: the one at the
    // stage's start, or, top to bottom, the one across the reading line.
    const start = (scene: HTMLElement) => {
      const at = scene.getBoundingClientRect();
      return rtl ? box.right - at.right : at.left - box.left;
    };
    const inset = Number.parseFloat(getComputedStyle(stage).scrollPaddingInlineStart) || 0;
    const atEnd = Math.abs(stage.scrollLeft) >= stage.scrollWidth - stage.clientWidth - 1;
    const line = innerHeight * 0.3;
    // At the strip's end no scene can reach the stage's start, so the last scene counts when it shows whole.
    const whole = (scene: HTMLElement) => {
      const at = scene.getBoundingClientRect();
      return at.left >= box.left - 1 && at.right <= box.right + 1;
    };
    const atStart = scenes.findIndex((scene) => Math.abs(start(scene) - inset) < 2);
    const last = scenes.length - 1;
    // Top to bottom, the scene across the reading line. Right after a link landing only, the
    // scene the link names keeps the page while it's still on screen at the top, so a short one
    // isn't passed over by the next one crossing the line, and at the page's foot on screen is
    // enough. The scene a link names is the one holding what it names, as the controller reads it.
    const reading = () => {
      const across = scenes.findLastIndex((scene) => scene.getBoundingClientRect().top <= line);
      if (!landed) return across;
      let id = '';
      try {
        id = decodeURIComponent(location.hash.slice(1));
      } catch {
        return across;
      }
      const target = id ? document.getElementById(id) : null;
      const named = target ? scenes.findIndex((scene) => scene.contains(target)) : -1;
      const at = named >= 0 ? scenes[named]!.getBoundingClientRect() : undefined;
      if (!at || at.bottom <= 0) return across;
      const foot =
        scrollY + innerHeight >= document.documentElement.scrollHeight - 2 && at.top < innerHeight;
      return (named < across && at.top <= line) || (named > across && foot) ? named : across;
    };
    const onScreen = !horizontal
      ? reading()
      : atStart >= 0
        ? atStart
        : atEnd && last >= 0 && whole(scenes[last]!)
          ? last
          : -1;
    return {
      scenes: scenes.map((scene) => scene.id),
      current,
      onScreen,
      atEnd,
      hash: location.hash,
      history: history.length,
      status: document.querySelector('.hc-scrub__status')?.textContent ?? '',
      focus: document.activeElement?.className ?? '',
      layout: horizontal ? 'horizontal' : 'vertical',
      pinned: shell.hasAttribute('data-pin'),
      fit: shell.getAttribute('data-fit'),
      along: Math.round(Math.abs(stage.scrollLeft)),
      scrollY: Math.round(scrollY),
    };
  }, landed);
}

/**
 * Waits for scene `index` (from 0) to be current and on screen, or held at
 * the strip's end. `landed`, right after a link landing, as read() takes it.
 */
export async function expectAt(
  scope: Scope,
  index: number,
  { landed = false }: { landed?: boolean } = {},
): Promise<void> {
  await expect
    .poll(async () => {
      const state = await read(scope, { landed });
      return {
        current: state.current,
        shows:
          state.onScreen === index ||
          (state.atEnd && state.onScreen >= 0 && state.onScreen <= index),
      };
    })
    .toEqual({ current: index, shows: true });
}

/** Waits for the live status to name scene `index` (from 0) of `total`. */
export async function expectAnnounced(scope: Scope, index: number, total: number): Promise<void> {
  await expect
    .poll(async () => (await read(scope)).status)
    .toMatch(new RegExp(`, ${index + 1} of ${total}$`));
}

/** Loads a page and waits for the live controller to be on it. */
export async function load(scope: Page, url = '/'): Promise<void> {
  await scope.goto(url, { waitUntil: 'load' });
  await expect(scope.locator('[data-variant]')).toHaveAttribute(
    'data-variant',
    'horizontal-cinema',
  );
  await expect(scope.locator('.hc-scrub[data-live]')).toHaveCount(1);
  await scope.evaluate(() => document.fonts.ready);
}

/** Records whether each arrow, Home, or End keydown was cancelled, after every handler ran. */
export async function watchKeys(scope: Scope): Promise<void> {
  await scope.evaluate(() => {
    const page = window as Window & { __keys?: boolean[] };
    page.__keys = [];
    window.addEventListener('keydown', (event) => {
      if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
        page.__keys!.push(event.defaultPrevented);
      }
    });
  });
}

export const keys = (scope: Scope) =>
  scope.evaluate(() => (window as Window & { __keys?: boolean[] }).__keys ?? []);

/**
 * Every heading word in the strip's scenes that sits on more than one line:
 * the word, as the fit check reads it (chapters' WORD), in two boxes. A
 * heading broken inside a word doesn't fit its scene.
 */
export const brokenHeadingWords = (scope: Scope) =>
  scope.evaluate(
    ([source, flags]) => {
      const broken: string[] = [];
      const range = document.createRange();
      for (const heading of document.querySelectorAll('.hc-track .hc-scene :is(h1, h2, h3, h4)')) {
        const scene = heading.closest('.hc-scene')!.id;
        const texts = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
        for (let node = texts.nextNode(); node; node = texts.nextNode()) {
          for (const match of (node.textContent ?? '').matchAll(new RegExp(source, flags))) {
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            const lines = new Set(
              [...range.getClientRects()]
                .filter((box) => box.width > 0)
                .map((box) => Math.round(box.top)),
            );
            if (lines.size > 1) broken.push(`${scene}: ${match[0]}`);
          }
        }
      }
      return broken;
    },
    [WORD.source, WORD.flags] as const,
  );

/**
 * A rail that can't hold its labels, for the fallback's own tests: a style that spaces every chapter
 * label's letters far apart, so even its short form runs past its share. It goes in at
 * DOMContentLoaded, after the page's deferred scripts have run, not before its first script, so the
 * strip stacks from a fit that measures once it's in: the load relayout at the latest.
 */
export async function crowdRail(page: Page): Promise<void> {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '.hc-minimap__label { letter-spacing: 3em; }';
      document.head.append(style);
    });
  });
}

/**
 * What on the bar under the stage overlaps or runs out of its box, by the boxes the page draws: a
 * chapter label's text past the bar's inner box, over the next label, or over the bar's other
 * parts (the transport, the position text, the credits), and the position text or the credits past
 * the bar. A label counts only the text a visitor sees: a part clipped away, the years a short rail
 * hides (kept for assistive technology), doesn't. The position text and the credits count by their
 * own boxes, since the position text keeps one width as its title changes. A chapter's contents,
 * shown only on hover or focus, don't count. Empty where the bar isn't shown.
 */
export function railClashes(scope: Scope) {
  return scope.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('.hc-scrub');
    if (!bar || bar.offsetParent === null) return [];
    const outer = bar.getBoundingClientRect();
    const style = getComputedStyle(bar);
    const left = outer.left + (Number.parseFloat(style.paddingLeft) || 0);
    const right = outer.right - (Number.parseFloat(style.paddingRight) || 0);
    const drawn = (element: Element) => {
      if (element.matches('.hc-scrub__status, .hc-scrub__credits'))
        return element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect();
    };
    // A label's text as it shows: the rects of its text, less any inside an element clipped away.
    // A range's rects ignore a clip, so the hidden years would otherwise count at their full width.
    const shown = (label: Element): DOMRect => {
      const hidden = (node: Node) => {
        for (let at = node.parentElement; at && at !== label.parentElement; at = at.parentElement)
          if (getComputedStyle(at).clipPath !== 'none') return true;
        return false;
      };
      const rects: DOMRect[] = [];
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim() || hidden(node)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        rects.push(...[...range.getClientRects()].filter((box) => box.width > 0));
      }
      if (rects.length === 0) return new DOMRect();
      const l = Math.min(...rects.map((box) => box.left));
      const t = Math.min(...rects.map((box) => box.top));
      return new DOMRect(
        l,
        t,
        Math.max(...rects.map((box) => box.right)) - l,
        Math.max(...rects.map((box) => box.bottom)) - t,
      );
    };
    const meet = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 0.5 &&
      b.left < a.right - 0.5 &&
      a.top < b.bottom - 0.5 &&
      b.top < a.bottom - 0.5;
    const clashes: string[] = [];
    const ends = [
      ...bar.querySelectorAll('.hc-scrub__transport, .hc-scrub__status, .hc-scrub__credits'),
    ];
    const labels = [...bar.querySelectorAll('.hc-minimap__label')];
    // The labels run in the bar's inline direction: right to left, each one's start is its right edge.
    const rtl = getComputedStyle(bar).direction === 'rtl';
    const inlineStart = (box: DOMRect) => (rtl ? -box.right : box.left);
    const inlineEnd = (box: DOMRect) => (rtl ? -box.left : box.right);
    labels.forEach((label, index) => {
      const text = label.textContent ?? '';
      const at = shown(label);
      if (at.left < left - 0.5 || at.right > right + 0.5) clashes.push(`${text} past the bar`);
      if (index > 0 && inlineStart(at) < inlineEnd(shown(labels[index - 1]!)) - 0.5)
        clashes.push(`${text} over the label before it`);
      for (const end of ends)
        if (meet(at, drawn(end))) clashes.push(`${text} over ${end.className}`);
    });
    for (const end of ends) {
      const at = drawn(end);
      if (at.width > 0 && (at.left < left - 0.5 || at.right > right + 0.5))
        clashes.push(`${end.className} past the bar`);
    }
    return [...new Set(clashes)];
  });
}

/**
 * Widens only the rail's years, as a wider face would, by `spacing` of letter-spacing: how far a
 * fixture's own years must go to crowd its rail. As with crowdRail, the style goes in at
 * DOMContentLoaded, so a fit that measures once it's in, the load relayout at the latest, reads it.
 */
export async function widenRailYears(page: Page, spacing = '1.5em'): Promise<void> {
  await page.addInitScript((spacing) => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = `.hc-minimap__years { letter-spacing: ${spacing}; }`;
      document.head.append(style);
    });
  }, spacing);
}
