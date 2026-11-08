import type { Frame, Locator, Page } from '@playwright/test';
import { WORD } from '../../packages/variant-horizontal-cinema/src/chapters';
import { loadThresholds } from '../../quality/thresholds';
import { expect, test } from '../harness/fixtures';
import {
  centreLineChange,
  clipAround,
  frames as drawn,
  ringCentreLine,
  type LinePoint,
} from '../quality/lib/a11y/interaction';
import { inPage, type Active, type Box } from '../quality/lib/a11y/probe';
import { decodePng } from '../quality/lib/pixels';

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

/**
 * Waits in the page, frame by frame, for scene `index` (from 0) to reach the stage's start, within
 * 1 px, and resolves at once, at most `ms` on: the moment a snap arrives, before the controller's
 * own settle, which a poll from outside the page samples only now and then. False if it never does.
 */
export function arrivedAt(scope: Scope, index: number, ms = 5000): Promise<boolean> {
  return scope.evaluate(
    async ([index, ms]) => {
      const stage = document.querySelector<HTMLElement>('.hc-stage')!;
      const scene = document.querySelectorAll<HTMLElement>('.hc-track .hc-scene')[index];
      if (!scene) return false;
      const rtl = getComputedStyle(stage).direction === 'rtl';
      const inset = Number.parseFloat(getComputedStyle(stage).scrollPaddingInlineStart) || 0;
      const end = performance.now() + ms;
      while (performance.now() < end) {
        const box = stage.getBoundingClientRect();
        const at = scene.getBoundingClientRect();
        if (Math.abs((rtl ? box.right - at.right : at.left - box.left) - inset) <= 1) return true;
        await new Promise((done) => requestAnimationFrame(done));
      }
      return false;
    },
    [index, ms] as const,
  );
}

/**
 * Whether scene `index` (from 0) is held at the strip's end: its start can't reach the stage's start,
 * since the strip's travel ends before it does. read() names the last scene on screen there, so
 * expectAt can't see such a scene; expectHeldAtEnd checks its own contract instead.
 */
export function heldAtEnd(scope: Scope, index: number): Promise<boolean> {
  return scope.evaluate((index) => {
    const stage = document.querySelector<HTMLElement>('.hc-stage')!;
    const scene = document.querySelectorAll<HTMLElement>('.hc-track .hc-scene')[index];
    if (!scene || !['auto', 'scroll'].includes(getComputedStyle(stage).overflowX)) return false;
    const rtl = getComputedStyle(stage).direction === 'rtl';
    const box = stage.getBoundingClientRect();
    const at = scene.getBoundingClientRect();
    const inset = Number.parseFloat(getComputedStyle(stage).scrollPaddingInlineStart) || 0;
    const offset =
      (rtl ? box.right - at.right : at.left - box.left) - inset + Math.abs(stage.scrollLeft);
    return offset > stage.scrollWidth - stage.clientWidth + 1;
  }, index);
}

/**
 * Waits for a scene held at the strip's end (heldAtEnd) to hold as the strip's end holds it: the
 * strip at its end, the scene current, and focus on a link of its own that shows in the stage.
 */
export async function expectHeldAtEnd(scope: Scope, index: number): Promise<void> {
  await expect
    .poll(() =>
      scope.evaluate((index) => {
        const stage = document.querySelector<HTMLElement>('.hc-stage')!;
        const box = stage.getBoundingClientRect();
        const scene = document.querySelectorAll<HTMLElement>('.hc-track .hc-scene')[index];
        const active = document.activeElement as HTMLElement | null;
        const link = active?.matches('a[href]') && scene?.contains(active) ? active : null;
        const at = link?.getBoundingClientRect();
        const blocks = [...document.querySelectorAll('.hc-minimap__blocks i')];
        return {
          atEnd: Math.abs(stage.scrollLeft) >= stage.scrollWidth - stage.clientWidth - 1,
          current: blocks.findIndex((block) => block.hasAttribute('data-now')),
          focused: link !== null,
          shown:
            at !== undefined &&
            at.width > 0 &&
            at.left >= box.left - 0.5 &&
            at.right <= box.right + 0.5 &&
            at.top >= 0 &&
            at.bottom <= window.innerHeight,
        };
      }, index),
    )
    .toEqual({ atEnd: true, current: index, focused: true, shown: true });
}

/** expectAt, or for a scene held at the strip's end, expectHeldAtEnd. */
async function expectAtOrHeld(page: Page, index: number): Promise<void> {
  if (await heldAtEnd(page, index)) await expectHeldAtEnd(page, index);
  else await expectAt(page, index);
}

/**
 * From a scene's last link, mid-strip, Tab goes on into a later scene, as a keyboard walk does: a
 * foot's Next, or a chapter's own list. Read as the walk reads it, two frames and 50 ms on and then
 * frame by frame for 800 ms, the stop is shown in the stage, never moves more than a pixel, keeps
 * focus, and once the strip rests its scene is current and announced. A scene held at the strip's
 * end, where none reaches the stage's start, holds as the end holds it (expectHeldAtEnd), on either
 * side of the key. Returns how many Tabs crossed.
 * With `back`, the same from a scene's first link, Shift+Tab back into an earlier scene. `from`, the
 * scenes it sets out from, each holding a link: by default, four spread through the complete fixture.
 */
export async function tabIntoLaterScenes(
  page: Page,
  { back = false, from: starts }: { back?: boolean; from?: readonly number[] } = {},
): Promise<number> {
  const { scenes } = await read(page);
  const total = scenes.length;
  let crossed = 0;
  for (const from of starts ?? (back ? [3, 6, 9, 12] : [2, 5, 8, 11])) {
    const links = page.locator(`#${scenes[from]} a[href]`);
    await (back ? links.first() : links.last()).focus();
    await expectAtOrHeld(page, from);
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
    const seen = await page.evaluate(async (ids) => {
      const frame = () => new Promise((done) => requestAnimationFrame(done));
      await frame();
      await frame();
      await new Promise((done) => setTimeout(done, 50));
      const active = document.activeElement as HTMLElement;
      const to = ids.findIndex((id) => document.getElementById(id)?.contains(active));
      const first = active.getBoundingClientRect();
      const stage = document.querySelector('.hc-stage')!.getBoundingClientRect();
      const shown =
        first.width > 0 &&
        first.left >= stage.left - 0.5 &&
        first.right <= stage.right + 0.5 &&
        first.top >= 0 &&
        first.bottom <= window.innerHeight;
      let moved = 0;
      const end = performance.now() + 800;
      while (performance.now() < end) {
        await frame();
        const now = active.getBoundingClientRect();
        moved = Math.max(moved, Math.abs(now.left - first.left), Math.abs(now.top - first.top));
      }
      return { to, shown, still: moved <= 1, focused: document.activeElement === active };
    }, scenes);
    if (seen.to < 0 || (back ? seen.to >= from : seen.to <= from)) continue;
    crossed += 1;
    expect(
      seen,
      `${back ? 'Shift+Tab' : 'Tab'} from ${scenes[from]} into ${scenes[seen.to]}`,
    ).toEqual({
      to: seen.to,
      shown: true,
      still: true,
      focused: true,
    });
    await expectAtOrHeld(page, seen.to);
    await expectAnnounced(page, seen.to, total);
  }
  return crossed;
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

/** The two layouts the fit check leaves a desktop strip in. */
export type Layout = 'pinned' | 'stacked';

/** The marks each layout carries, whole: the stage's direction, the pin, the fit's mark, the bar. */
const LAYOUTS = {
  // Across the stage and pinned to the page's scroll, nothing over, the bar under the stage shown.
  pinned: { layout: 'horizontal', pinned: true, fit: null, bar: true },
  // Top to bottom, unpinned, the fit's mark over, and no bar: nothing of the rail is drawn.
  stacked: { layout: 'vertical', pinned: false, fit: 'over', bar: false },
} as const;

const marks = async (scope: Scope) => {
  const { layout, pinned, fit } = await read(scope);
  const bar = await scope.evaluate(
    () => document.querySelector<HTMLElement>('.hc-scrub')?.offsetParent != null,
  );
  return { layout, pinned, fit, bar };
};

const layoutOf = (seen: Awaited<ReturnType<typeof marks>>): Layout | undefined =>
  (Object.keys(LAYOUTS) as Layout[]).find((name) =>
    Object.entries(LAYOUTS[name]).every(([key, value]) => seen[key as keyof typeof seen] === value),
  );

/**
 * The layout the strip has rendered, read from its own marks, with that layout's whole contract
 * checked: pinned, or stacked, as LAYOUTS has them. Anything else fails, naming what it saw. The
 * layout found goes on the test as a 'layout' annotation, so a CI read shows which contract the test
 * checked. Only for a test whose layout can differ by platform (the complete fixture at 1024 by 768
 * pins on macOS, and its layout on CI Linux is CI's to show); a test that needs one layout asserts
 * that one instead, at a width or on a fixture where it holds on both. `wait` polls until a layout
 * holds; without it, the page is read once, as it is now.
 */
export async function renderedLayout(
  scope: Scope,
  { wait = true }: { wait?: boolean } = {},
): Promise<Layout> {
  let seen = await marks(scope);
  if (wait) {
    await expect
      .poll(async () => {
        seen = await marks(scope);
        return layoutOf(seen) ?? JSON.stringify(seen);
      })
      .toMatch(/^(pinned|stacked)$/);
  }
  const layout = layoutOf(seen);
  expect(layout, `neither layout's marks: ${JSON.stringify(seen)}`).toBeDefined();
  test.info().annotations.push({ type: 'layout', description: layout! });
  return layout!;
}

/** Waits for the strip to render `layout`, its whole contract as LAYOUTS has it. */
export async function expectLayout(scope: Scope, layout: Layout): Promise<void> {
  await expect.poll(() => marks(scope)).toEqual(LAYOUTS[layout]);
}

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

/** Two frames drawn: what a settle waits for after the fonts are in. */
export const frames = (scope: Scope) =>
  scope.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/**
 * Sets the window to `size` and waits for the strip's refit on it: the controller refits a frame
 * after its own settle (150 ms) from the last resize. The page's wait is a timer set in a resize
 * listener added after the controller's, so it's set after the controller's own on every resize and
 * can only fire after it, and two frames after that the refit has run: an order, not a race.
 */
export async function resizeTo(page: Page, size: { width: number; height: number }) {
  const was = page.viewportSize();
  if (was && was.width === size.width && was.height === size.height)
    throw new Error(`the window is already ${size.width} by ${size.height}`);
  await page.evaluate(() => {
    const w = window as unknown as { __hcRefitted?: Promise<void> };
    w.__hcRefitted = new Promise<void>((done) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      window.addEventListener('resize', () => {
        clearTimeout(timer);
        timer = setTimeout(
          () => requestAnimationFrame(() => requestAnimationFrame(() => done())),
          400,
        );
      });
    });
  });
  await page.setViewportSize(size);
  await page.evaluate(() => (window as unknown as { __hcRefitted: Promise<void> }).__hcRefitted);
}

/**
 * Scene `index`'s offset where the reader holds it: pinned, its start from the stage's start, inset
 * and all; top to bottom, its top from the window's.
 */
export function sceneOffset(scope: Scope, index: number): Promise<number> {
  return scope.evaluate((index) => {
    const stage = document.querySelector<HTMLElement>('.hc-stage')!;
    const scene = document.querySelectorAll<HTMLElement>('.hc-track .hc-scene')[index]!;
    const at = scene.getBoundingClientRect();
    if (!['auto', 'scroll'].includes(getComputedStyle(stage).overflowX)) return at.top;
    const box = stage.getBoundingClientRect();
    const rtl = getComputedStyle(stage).direction === 'rtl';
    const inset = Number.parseFloat(getComputedStyle(stage).scrollPaddingInlineStart) || 0;
    return (rtl ? box.right - at.right : at.left - box.left) - inset;
  }, index);
}

/** What resizeWith() does inside the burst: press the strip's Next, or follow a link to a fragment. */
export type DuringResize = { readonly press: 'Next scene' } | { readonly hash: string };

/**
 * Sets the window to `size` and, at the first resize event that comes, inside the burst whose
 * settle the strip's refit waits for, does `during` in the page: a resize listener added after the
 * controller's runs straight after it, so `during` comes between the burst's first resize and its
 * refit by the event's own order, not a timer. Then waits for the refit as resizeTo() does.
 */
export async function resizeWith(
  page: Page,
  size: { width: number; height: number },
  during: DuringResize,
): Promise<void> {
  await page.evaluate((during) => {
    const w = window as unknown as { __hcRefitted?: Promise<void> };
    let ran = false;
    w.__hcRefitted = new Promise<void>((done) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      window.addEventListener('resize', () => {
        if (!ran) {
          ran = true;
          if ('hash' in during) location.hash = during.hash;
          else {
            // The button the accessibility tree names so: its label, or its text.
            const named = (button: HTMLButtonElement) =>
              (button.getAttribute('aria-label') ?? button.textContent ?? '').trim();
            const button = [...document.querySelectorAll('button')].find(
              (one) => named(one) === during.press,
            );
            if (!button) throw new Error(`no button named ${during.press}`);
            button.click();
          }
        }
        clearTimeout(timer);
        timer = setTimeout(
          () => requestAnimationFrame(() => requestAnimationFrame(() => done())),
          400,
        );
      });
    });
  }, during);
  await page.setViewportSize(size);
  await page.evaluate(() => (window as unknown as { __hcRefitted: Promise<void> }).__hcRefitted);
}

/**
 * Stacked by touch in the strip's room, the bar's walk: the scene count, the press, and the checks
 * after each press, that the status names the scene stepped to and the minimap marks its chapter.
 * The bar lies in flow after the scenes, so each press is the button's own click, with no scroll to
 * the bar first: a tap there would scroll the page to the bar, and the scene in view at the bar would
 * be the one named.
 */
async function stackedWalk(page: Page) {
  const total = await page.locator('.hc-track .hc-scene').count();
  const perChapter = await page
    .locator('.hc-minimap__chapter')
    .evaluateAll((chapters) =>
      chapters.map((chapter) => chapter.querySelectorAll('.hc-minimap__blocks i').length),
    );
  const chapterOf = (index: number) => {
    let left = index;
    for (const [chapter, count] of perChapter.entries()) {
      if (left < count) return chapter;
      left -= count;
    }
    return perChapter.length - 1;
  };
  const status = page.locator('.hc-scrub__status');
  const current = page.locator('.hc-minimap__chapter a[aria-current="location"]');
  const press = (name: string) => page.getByRole('button', { name }).dispatchEvent('click');
  const check = async (index: number) => {
    await expect(status).toHaveText(new RegExp(`(?<!\\d)${index + 1} of ${total}$`));
    await expect(current).toHaveCount(1);
    expect(
      await page
        .locator('.hc-minimap__chapter')
        .evaluateAll((chapters) =>
          chapters.findIndex((chapter) => chapter.querySelector('a[aria-current="location"]')),
        ),
    ).toBe(chapterOf(index));
  };
  return { total, press, check };
}

/**
 * The bar's Next from scene `from` to scene `to` (indices; the first and the last by default), checked
 * after each press as stackedWalk checks: the page must already be on `from`, which is checked first,
 * and Next is disabled where the walk ends on the last scene. Returns the scenes it stepped through.
 */
export async function stepNextStacked(
  page: Page,
  { from = 0, to }: { from?: number; to?: number } = {},
): Promise<number> {
  const { total, press, check } = await stackedWalk(page);
  const end = to ?? total - 1;
  await check(from);
  let stepped = 0;
  for (let index = from + 1; index <= end; index++) {
    await press('Next scene');
    await check(index);
    stepped += 1;
  }
  if (end === total - 1) {
    await expect(page.getByRole('button', { name: 'Next scene' })).toBeDisabled();
  }
  return stepped;
}

/**
 * The bar's Previous from scene `from` back to scene `to` (indices; the last and the first by default),
 * checked after each press as stackedWalk checks: the page must already be on `from`, which is
 * checked first, with Next disabled there when it's the last. Returns the scenes it stepped through.
 */
export async function stepPreviousStacked(
  page: Page,
  { from, to = 0 }: { from?: number; to?: number } = {},
): Promise<number> {
  const { total, press, check } = await stackedWalk(page);
  const start = from ?? total - 1;
  await check(start);
  if (start === total - 1) {
    await expect(page.getByRole('button', { name: 'Next scene' })).toBeDisabled();
  }
  let stepped = 0;
  for (let index = start - 1; index >= to; index--) {
    await press('Previous scene');
    await check(index);
    stepped += 1;
  }
  return stepped;
}

/** The index of the scene whose id is `id`, read from the page; it must be there. */
export async function sceneIndexStacked(page: Page, id: string): Promise<number> {
  const ids = await page
    .locator('.hc-track .hc-scene')
    .evaluateAll((scenes) => scenes.map((scene) => scene.id));
  expect(ids).toContain(id);
  return ids.indexOf(id);
}

/** A fresh load of the page at scene `index` (the last by default), by the scene's own fragment. */
export async function loadAtStacked(page: Page, index?: number): Promise<void> {
  const scenes = page.locator('.hc-track .hc-scene');
  const id = await (index === undefined ? scenes.last() : scenes.nth(index)).getAttribute('id');
  expect(id).toBeTruthy();
  // A fresh document, not a same-page fragment change.
  await page.goto('about:blank');
  await load(page, `/#${id}`);
  await expect(page).toHaveURL(new RegExp(`#${id}$`));
}

/**
 * The bar's Next from the first scene to the last and Previous back, in one test: for a strip short
 * enough to walk both ways inside a test's budget. Returns the scenes it stepped through.
 */
export async function stepAcrossStacked(page: Page): Promise<number> {
  return (await stepNextStacked(page)) + (await stepPreviousStacked(page));
}

/** A side of a focus ring, as its centre line's normal points out from the box. */
export type RingSide = 'top' | 'right' | 'bottom' | 'left';

/** A ring measured along its centre line, side by side, and the line's own box. */
export interface RingContrast {
  /** Each side's points in view, and how many of them the focus change takes to 3:1. */
  readonly sides: Readonly<Record<RingSide, { readonly points: number; readonly strong: number }>>;
  /** The box the centre line runs round: the border box set out by the offset and half the width. */
  readonly box: Box;
}

/**
 * The focused stop's outline ring, along its centre line, side by side: the focus check's own
 * measure (tests/quality/lib/a11y/interaction.ts ringCentreLine and centreLineChange, at the
 * non-text contrast threshold), on its shots in its order. A focused shot of the box and as far as
 * the ring reaches, a pixel more; the blur, two frames, and the blurred shot; then focus back, as a
 * script gives it, so the stop still shows its ring. Decoded here, in Node. It reports and asserts
 * nothing: the verdict is focusFindings()'s, and these numbers say which side a red one fails on.
 */
export async function ringContrast(page: Page, locator: Locator): Promise<RingContrast> {
  if (!(await locator.evaluate((element) => element === document.activeElement)))
    throw new Error('ringContrast measures the stop that has focus');
  const active = await inPage<Active>(page, { kind: 'active' });
  const width = active.rounding?.width ?? 0;
  if (!active.rounding || width === 0) throw new Error(`${active.path} has no outline ring`);
  const clip = clipAround(active.box, Math.ceil(active.reach) + 1, page.viewportSize()!);
  if (!clip) throw new Error(`${active.path} is out of the viewport`);
  const shot = async () =>
    decodePng(await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }));
  await drawn(page);
  const focused = await shot();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await drawn(page);
  const blurred = await shot();
  await locator.evaluate((element: HTMLElement) => element.focus());
  const distance = active.rounding.offset + width / 2;
  const line = ringCentreLine(active.box, active.rounding.corners, distance);
  // A corner's arc goes to the side its normal points out from most.
  const sideOf = ({ nx, ny }: LinePoint): RingSide =>
    Math.abs(ny) >= Math.abs(nx) ? (ny < 0 ? 'top' : 'bottom') : nx > 0 ? 'right' : 'left';
  const ratio = loadThresholds().contrast.nonText;
  const sides = Object.fromEntries(
    (['top', 'right', 'bottom', 'left'] as const).map((side) => {
      const points = line.filter((point) => sideOf(point) === side);
      const { strong, total } = centreLineChange(focused, blurred, clip, points, ratio, width / 2);
      return [side, { points: total, strong }];
    }),
  ) as RingContrast['sides'];
  const { x, y, width: across, height } = active.box;
  return {
    sides,
    box: {
      x: x - distance,
      y: y - distance,
      width: across + 2 * distance,
      height: height + 2 * distance,
    },
  };
}
