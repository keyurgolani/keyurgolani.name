import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Editorial Evidence's chapter bar at 390 on a phone, on Primer Inspired, Signal Paper, Shell
// Mono, dark, under more contrast: its links run past the window's edge in a scroller, and Tab
// from the first to the last brings each into the scroller with its ring whole inside it, as a
// keyboard walk down the page finds the bar in the flow. On the complete contract fixture.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'editorial-evidence')
      .replace(/designLanguage: .*/, 'designLanguage: primer-inspired')
      .replace(/colorScheme: .*/, 'colorScheme: signal-paper')
      .replace(/typography: .*/, 'typography: shell-mono')
      .replace(/displayMode: .*/, 'displayMode: dark'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

test(
  "at 390 on a phone, Tab from the chapter bar's first link to its last keeps each link's ring whole inside the bar's scroller",
  { annotation: [{ type: 'route', description: '/' }], tag: '@interaction' },
  async ({ page }) => {
    await page.emulateMedia({ contrast: 'more' });
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    // The bar in the flow and in view, half way down the window.
    await page.evaluate(() => {
      const bar = document.querySelector('.ee-rail')!;
      window.scrollTo(0, scrollY + bar.getBoundingClientRect().top - 400);
    });
    await frames(page);
    const links = page.locator('.ee-rail__link');
    const count = await links.count();
    expect(count, 'the bar has links').toBeGreaterThan(1);
    await page.keyboard.press('Shift');
    await links.first().focus();
    await frames(page);
    const reads = [];
    for (let at = 0; at < count; at += 1) {
      if (at > 0) {
        await page.keyboard.press('Tab');
        await frames(page);
      }
      reads.push(
        await page.evaluate(() => {
          const link = document.activeElement as HTMLElement;
          const list = link.closest<HTMLElement>('.ee-rail__list');
          const style = getComputedStyle(link);
          const reach =
            Number.parseFloat(style.outlineWidth) +
            Math.max(0, Number.parseFloat(style.outlineOffset));
          const box = link.getBoundingClientRect();
          const clip = list?.getBoundingClientRect();
          return {
            text: (link.textContent ?? '').trim(),
            inBar: list !== null,
            ring: [box.left - reach, box.right + reach],
            scroller: clip ? [clip.left, clip.right] : null,
            scrollLeft: list?.scrollLeft ?? null,
          };
        }),
      );
    }
    console.log(`bar tab: ${JSON.stringify(reads)}`);
    for (const read of reads) {
      expect(read.inBar, `${read.text} is a bar link`).toBe(true);
      const [left, right] = read.ring as [number, number];
      const [start, end] = read.scroller as [number, number];
      expect(left, `${read.text}'s ring starts inside the scroller`).toBeGreaterThanOrEqual(
        start - 0.5,
      );
      expect(right, `${read.text}'s ring ends inside the scroller`).toBeLessThanOrEqual(end + 0.5);
    }
  },
);
