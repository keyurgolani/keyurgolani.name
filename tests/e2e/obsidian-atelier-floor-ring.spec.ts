import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';

// Obsidian Atelier's case page, /work/project-name: the installation's room title stands on the
// floor, which the section's ::after paints a step darker than the wall, and its catalogue line's
// link, the way back to the work's place on home, took the platform's ring in the scheme's focus
// colour, which falls under 3:1 against the floor in light: the quality cells read its focus change
// at 0 of about 300 pixels at 3:1 at 390, 1024 and 1440, in light and system. Focused from the
// keyboard, as the quality walk's Tab focuses it, the walk's own focus check finds nothing on it, and
// its ring, outline included, stays 2 px clear of the words either side of it in the line (the
// comma after it), so focus covers no glyph; at rest the link's words and the comma set as one run,
// as with no rule on the link; and focus nudges the line along but never wraps it anew: in light,
// system (a light OS) and dark, at 1440, 1024 and 390. On the complete contract fixture, on the quality cells' pack (platform-neutral, Warm
// Parchment, humanist-ui) by the visitor's cookie, read back from what rendered, dark by its own
// color-scheme too.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const CASE = '/work/project-name';
const READ_ONLY = { type: 'profile', description: 'read-only' };
const tag = '@interaction';

/** The records' target, as the walk's probe names it. */
const TARGET =
  '#oa--case-project-name-installation > div:nth-child(2) > p:nth-child(1) > a:nth-child(1)';

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'obsidian-atelier'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  colorScheme: 'light',
});

/** The case under the quality cells' pack in `mode`, by the visitor's cookie, and what rendered. */
async function load(page: Page, origin: string, mode: string): Promise<void> {
  await page.context().addCookies([
    {
      name: 'portfolio_appearance',
      value: new URLSearchParams({ scheme: 'warm-parchment', mode }).toString(),
      url: origin,
    },
  ]);
  await page.goto(CASE, { waitUntil: 'load' });
  const boundary = page.locator('[data-variant]').first();
  await expect(boundary).toHaveAttribute('data-variant', 'obsidian-atelier');
  await expect(boundary).toHaveAttribute('data-design-language', 'platform-neutral');
  await expect(boundary).toHaveAttribute('data-color-scheme', 'warm-parchment');
  await expect(boundary).toHaveAttribute('data-typography', 'humanist-ui');
  await expect(boundary).toHaveAttribute('data-display-mode', mode);
  if (mode === 'dark')
    expect(await boundary.evaluate((el) => getComputedStyle(el).colorScheme)).toBe('dark');
  await expect(page.locator('.oa-chrome')).toHaveAttribute('data-oa-script', '');
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Where the link's line sets: the nearest glyph before and after the link in it, the link's own last
 * glyph (one-character Range rects, [left, top, right, bottom]), how many lines the line takes, and
 * the link's top.
 */
function setting(target: Locator) {
  return target.evaluate((el) => {
    const line = el.closest('.oa-no')!;
    const box = (r: DOMRect | null) => (r ? [r.left, r.top, r.right, r.bottom] : null);
    const glyph = (node: Node, i: number) => {
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      return range.getBoundingClientRect();
    };
    let before: DOMRect | null = null;
    let after: DOMRect | null = null;
    let last: DOMRect | null = null;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      const at = el.compareDocumentPosition(node);
      if (el.contains(node)) {
        const i = text.trimEnd().length - 1;
        if (i >= 0) last = glyph(node, i);
      } else if (at & Node.DOCUMENT_POSITION_PRECEDING) {
        const i = text.trimEnd().length - 1;
        if (i >= 0) before = glyph(node, i);
      } else if (at & Node.DOCUMENT_POSITION_FOLLOWING && !after) {
        const i = text.length - text.trimStart().length;
        if (i < text.length) after = glyph(node, i);
      }
    }
    const range = document.createRange();
    range.selectNodeContents(line);
    const tops = new Set(
      [...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)),
    );
    return {
      before: box(before),
      after: box(after),
      last: box(last),
      lines: tops.size,
      top: el.getBoundingClientRect().top,
    };
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const) {
  for (const mode of ['light', 'system', 'dark'] as const) {
    test(
      `in ${mode} at ${viewport.width}, the installation's catalogue link on the floor, focused from the keyboard, passes the focus check and rings clear of the words beside it, which at rest set as before`,
      { annotation: [{ type: 'route', description: '/work/[slug]' }, READ_ONLY], tag },
      async ({ page, app }) => {
        await page.setViewportSize(viewport);
        await load(page, app.origin, mode);
        const target = page.locator(TARGET);
        await expect(target).toHaveCount(1);
        // The link stands on the installation's floor, in its room title's catalogue line.
        expect(await target.evaluate((el) => el.matches('.oa-installation__title .oa-no a'))).toBe(
          true,
        );
        await target.scrollIntoViewIfNeeded();
        // At rest: the link's words and the comma after it set as one run, as with no rule on the
        // link at all, so no gap between its last glyph and the comma.
        const rest = await setting(target);
        await page.keyboard.press('Shift');
        await target.focus();
        expect(await target.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
        const active = await inPage<Active>(page, { kind: 'active' });
        expect(active.path).toBe(TARGET);
        const focused = await setting(target);
        // The ring's outer box, outline included.
        const ring = [
          active.box.x - active.reach,
          active.box.y - active.reach,
          active.box.x + active.box.width + active.reach,
          active.box.y + active.box.height + active.reach,
        ];
        // A glyph on the ring's line counts; one on another line is clear of it. 2 px, to the layout's
        // 1/64 px.
        const sameLine = (glyph: number[]) => glyph[1]! < ring[3]! && glyph[3]! > ring[1]!;
        const ROOM = 2 - 1 / 64;
        const { before, after } = focused;
        const read = {
          findings: await focusFindings(page, active),
          clearBefore: !before || !sameLine(before) || ring[0]! - before[2]! >= ROOM,
          clearAfter: !after || !sameLine(after) || after[0]! - ring[2]! >= ROOM,
          restSetsAsOneRun:
            !rest.after || !rest.last || Math.abs(rest.after[0]! - rest.last[2]!) <= 0.5,
          // Focus may nudge the line along by the ring's room, never wrap it anew.
          focusKeepsTheLines:
            focused.lines === rest.lines && Math.abs(focused.top - rest.top) <= 0.5,
        };
        const why = `the focus check and the ring's room ${JSON.stringify({ ring, rest, focused })}`;
        expect(read, why).toEqual({
          findings: [],
          clearBefore: true,
          clearAfter: true,
          restSetsAsOneRun: true,
          focusKeepsTheLines: true,
        });
      },
    );
  }
}
