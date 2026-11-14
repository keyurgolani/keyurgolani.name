import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import type { Page } from '@playwright/test';
import { expect } from '../harness/fixtures';

// What Flux's browser specs share (flux.spec.ts, flux-long-text.spec.ts and
// the flux-contact-title-*.spec.ts files): a contract fixture served with Flux
// selected, the overflow check, and the checks on an owner's contact title.
//
// `.fx { overflow-x: clip }` holds the page's scroll width at the window's,
// so a scrollWidth check can't fail on Flux: the overflow check measures
// every line of text, against the nearest box that clips it.

/** A contract fixture served with Flux selected. */
export function appFor(fixture: ReturnType<typeof contractFixture>) {
  const dir = path.dirname(fixture.files.portfolio);
  return {
    portfolio: fixture.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(fixture.files.site, 'utf8'), 'flux'),
    sourceFiles: Object.fromEntries(
      fixture.unitFiles.map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]),
    ),
  };
}

/**
 * Every line of text that runs past the window's inline edges, as `<text>: <left>..<right>`,
 * each measured against the nearest box that clips it (an ellipsised tab word stops at its
 * own box). The field, the pool, the drop and text hidden for assistive technology are left out.
 */
export const textPastTheEdges = () => {
  const width = window.innerWidth;
  const root = document.querySelector('.fx')!;
  const out: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    const parent = node.parentElement;
    if (!text || !parent) continue;
    if (parent.closest('.fx-field, .fx-pool, .fx-drop, .fx-bar__drop, .fx-hidden, [hidden]'))
      continue;
    // The visitor's Appearance panel while it's shut: it floats, so its closed content lays out past
    // the window, and shows nowhere. Every other closed fold's text is still measured, as a reader
    // who opens it would see it.
    if (parent.closest('[data-visitor-control-slot] details:not([open])')) continue;
    let right = Infinity;
    let left = -Infinity;
    for (let el: Element | null = parent; el && el !== root; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        right = -Infinity;
        break;
      }
      if (style.overflowX === 'hidden' || style.overflowX === 'clip') {
        const box = el.getBoundingClientRect();
        right = Math.min(right, box.right);
        left = Math.max(left, box.left);
      }
    }
    if (right === -Infinity) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width === 0) continue;
      const shownLeft = Math.max(rect.left, left);
      const shownRight = Math.min(rect.right, right);
      if (shownRight > width + 0.5 || shownLeft < -0.5)
        out.push(`${text.slice(0, 40)}: ${Math.round(shownLeft)}..${Math.round(shownRight)}`);
    }
  }
  return out;
};

/**
 * The complete fixture with its contact section titled `title`, served with Flux selected: the
 * title is Contact's sheet word, the one tab word an owner writes. Each title is its own spec
 * file, since a worker-scoped appOptions can't be set in a describe.
 */
export function appWithContactTitle(title: string) {
  const fixture = contractFixture('complete');
  const doc = parse(readFileSync(fixture.files.portfolio, 'utf8')) as {
    sections: { kind: string; title?: string }[];
  };
  const contact = doc.sections.find((section) => section.kind === 'contact');
  if (!contact) throw new Error('the complete fixture has no contact section');
  contact.title = title;
  const portfolio = path.join(
    mkdtempSync(path.join(tmpdir(), 'flux-contact-title-')),
    'portfolio.yml',
  );
  writeFileSync(portfolio, stringify(doc));
  return { ...appFor(fixture), portfolio };
}

/** Contact's tab, measured: its word's lines and size, its drip against them, and its top. */
const contactTab = () => {
  const sheet = document.querySelector('.fx-sheet[data-sheet="contact"]')!;
  const tab = sheet.querySelector('.fx-sheet__tab')!.getBoundingClientRect();
  const word = sheet.querySelector('.fx-sheet__word')!;
  const drip = sheet.querySelector('.fx-sheet__drip')!.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(word);
  const lines = [...range.getClientRects()].filter((rect) => rect.width > 0);
  // The lowest line of text on the sheet (or plain sheet) before Contact's.
  let above = -Infinity;
  const before = sheet.previousElementSibling;
  if (before) {
    const walker = document.createTreeWalker(before, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || node.parentElement?.closest('.fx-hidden, [hidden]'))
        continue;
      const text = document.createRange();
      text.selectNodeContents(node);
      for (const rect of text.getClientRects())
        if (rect.width > 0) above = Math.max(above, rect.bottom);
    }
  }
  // Step 3 as the browser resolves it here (the token is a clamp()).
  const probe = document.createElement('span');
  probe.style.fontSize = 'var(--type-step-3)';
  sheet.append(probe);
  const step3 = parseFloat(getComputedStyle(probe).fontSize);
  probe.remove();
  return {
    word: word.textContent,
    size: parseFloat(getComputedStyle(word).fontSize),
    step3,
    lines: new Set(lines.map((rect) => Math.round(rect.top))).size,
    dripOnWord: lines.some(
      (rect) =>
        rect.left < drip.right &&
        drip.left < rect.right &&
        rect.top < drip.bottom &&
        drip.top < rect.bottom,
    ),
    tabTop: tab.top,
    above,
  };
};

/**
 * The checks on an owner's contact title (code review delta 2), on a page at its width: no line
 * of the page runs past the window's edges, the tab's drip clears its word (FX-M16), the word is
 * never under step 3, and the tab, however many lines it takes, stays below the last line of the
 * sheet above it.
 */
export async function expectContactTitleFits(page: Page, title: string) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const tab = await page.evaluate(contactTab);
  expect(tab.word).toBe(title);
  expect(await page.evaluate(textPastTheEdges)).toEqual([]);
  expect(tab.dripOnWord, 'the drip clears the word').toBe(false);
  expect(tab.size, 'never under step 3').toBeGreaterThanOrEqual(tab.step3 - 0.5);
  expect(tab.tabTop, `${tab.lines} lines: the tab's top under the text above`).toBeGreaterThan(
    tab.above,
  );
}

/**
 * The phone dock as shown: each visible word of its name tab (its text, its box and its content,
 * the lines it shows, the width it takes on one line, and its type and leading against the label
 * role's in the bar), the bar's height, a focus ring's reach, and the root's scroll-padding at the
 * window's block end.
 */
const dockName = () => {
  const shown = (el: Element) => {
    if (el.getClientRects().length === 0) return false;
    for (let at: Element | null = el; at; at = at.parentElement)
      if (getComputedStyle(at).visibility === 'hidden') return false;
    return true;
  };
  // The label role's own type in the bar, as the tabs take it.
  const nav = document.querySelector('#fx--bar .fx-bar__nav')!;
  const label = document.createElement('span');
  label.dataset.typeRole = 'label';
  label.textContent = 'x';
  nav.append(label);
  const role = getComputedStyle(label);
  const roleType = { fontSize: role.fontSize, lineHeight: role.lineHeight };
  label.remove();
  const words = [...document.querySelectorAll<HTMLElement>('#fx--bar .fx-tab--name .fx-tab__word')]
    .filter(shown)
    .map((word) => {
      const box = word.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(word);
      // The lines it shows: a clamp lays out the rest below its box.
      const lines = new Set(
        [...range.getClientRects()]
          .filter((rect) => rect.width > 0 && rect.bottom <= box.bottom + 1)
          .map((rect) => Math.round(rect.top)),
      ).size;
      // The width the name takes on one line, at its own type.
      const probe = word.cloneNode(true) as HTMLElement;
      probe.style.cssText = [
        'position: absolute',
        'display: inline',
        'visibility: hidden',
        'white-space: nowrap',
        'max-inline-size: none',
      ].join('; ');
      word.parentElement!.append(probe);
      const oneLine = probe.getBoundingClientRect().width;
      probe.remove();
      const style = getComputedStyle(word);
      return {
        text: word.textContent?.trim() ?? '',
        clientWidth: word.clientWidth,
        scrollWidth: word.scrollWidth,
        clientHeight: word.clientHeight,
        scrollHeight: word.scrollHeight,
        width: box.width,
        lines,
        oneLine,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        roleType,
      };
    });
  const fx = getComputedStyle(document.querySelector('.fx')!);
  return {
    words,
    bar: document.querySelector('#fx--bar')!.getBoundingClientRect().height,
    reach:
      parseFloat(fx.getPropertyValue('--ui-focus-offset')) +
      parseFloat(fx.getPropertyValue('--ui-focus-width')),
    reserve: parseFloat(getComputedStyle(document.documentElement).scrollPaddingBlockEnd) || 0,
  };
};

/**
 * The checks on the phone dock's name tab, on the home page at a window and a root text size, at
 * the opening and with a sheet being read: each word of the name that shows holds the whole name
 * in the page, never runs past its tab on a line, takes a second line only where one line
 * wouldn't fit its box, shows at most two and is cut only on its second, and keeps the label
 * role's type and leading; the link is shown with the whole name as its accessible name, or gone
 * whole (no box, not focusable); and the root reserves at
 * least the bar's height and a focus ring's reach at the window's block end, so Tab scrolls a
 * control clear of it. With script on or off: it waits by the clock, not by frames.
 */
export async function expectDockHoldsItsName(
  page: Page,
  { width, height, text = 1 }: { width: number; height: number; text?: number },
) {
  await page.setViewportSize({ width, height });
  await page.goto('/', { waitUntil: 'networkidle' });
  if (text !== 1)
    await page.evaluate(
      (scale) =>
        document.documentElement.style.setProperty('font-size', `${scale * 100}%`, 'important'),
      text,
    );
  await page.waitForTimeout(300);
  const name = await page
    .locator('#fx--bar .fx-tab--name .fx-tab__word')
    .evaluate((word) => word.textContent?.trim() ?? '');
  expect(name.length, 'the dock carries a name').toBeGreaterThan(0);
  // The link is the name's: where it shows, its accessible name is the whole name; with no room
  // it goes whole, no box and nothing to focus, so the dock never holds a link without a name.
  const link = page.locator('#fx--bar .fx-tab--name');
  const expectLink = async (state: string) => {
    if (await link.isVisible()) {
      await expect(link, `${state}: the link's accessible name`).toHaveAccessibleName(name);
      return;
    }
    const gone = await link.evaluate((el) => {
      (el as HTMLElement).focus({ preventScroll: true });
      const focused = document.activeElement === el;
      (el as HTMLElement).blur();
      return { boxes: el.getClientRects().length, focused };
    });
    expect(gone, `${state}: a name with no room leaves no link behind`).toEqual({
      boxes: 0,
      focused: false,
    });
  };
  const states: Record<string, ReturnType<typeof dockName>> = {};
  await expectLink('opening');
  states.opening = await page.evaluate(dockName);
  // A sheet being read: with script, the dock shows its destination beside the name.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
  await page.waitForTimeout(300);
  await expectLink('reading');
  states.reading = await page.evaluate(dockName);
  for (const [state, dock] of Object.entries(states)) {
    for (const word of dock.words) {
      const at = `${state}: "${word.text}"`;
      expect(word.text, `${at} is the whole name in the page`).toBe(name);
      expect(word.scrollWidth, `${at} never runs past its tab on a line`).toBeLessThanOrEqual(
        word.clientWidth,
      );
      if (word.lines > 1)
        expect(word.oneLine, `${at} wraps only where one line doesn't fit`).toBeGreaterThan(
          word.width + 0.5,
        );
      expect(word.lines, `${at} shows at most two lines`).toBeLessThanOrEqual(2);
      if (word.scrollHeight > word.clientHeight + 1)
        expect(word.lines, `${at} is cut only on its second line`).toBe(2);
      expect(word.fontSize, `${at} type`).toBe(word.roleType.fontSize);
      expect(word.lineHeight, `${at} leading`).toBe(word.roleType.lineHeight);
    }
    expect(
      dock.reserve,
      `${state}: the reserve holds the bar (${dock.bar}px) and a ring`,
    ).toBeGreaterThanOrEqual(dock.bar + dock.reach);
  }
}
