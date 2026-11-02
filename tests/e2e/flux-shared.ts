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
