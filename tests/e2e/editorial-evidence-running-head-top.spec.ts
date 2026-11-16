import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Editorial Evidence's running head and chapter index follow the place being read: the one on
// the reading line, under the sticky chrome. Where nothing covers that line at the very top of
// the page, as under more contrast at 1440 on this tuple, a jump from a chapter back to the top
// left that chapter marked, and its section links shown, since the opening never crossed the
// line on the way. Back at the top, the running head and the index read as they do on arrival,
// no chapter marked; each chapter is still marked while it's read; and read slowly from the top
// into the first chapter and back, the mark moves once each way. On the complete contract
// fixture, Art Deco on Blue Orange Color Safe in Drafting Grotesk, high contrast.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [{ type: 'route', description: '/' }];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'editorial-evidence')
      .replace(/designLanguage: .*/, 'designLanguage: art-deco')
      .replace(/colorScheme: .*/, 'colorScheme: blue-orange-color-safe')
      .replace(/typography: .*/, 'typography: drafting-grotesk')
      .replace(/displayMode: .*/, 'displayMode: high-contrast'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const CASES = [
  { width: 1440, height: 900, contrast: 'no-preference' },
  { width: 1440, height: 900, contrast: 'more' },
  { width: 390, height: 844, contrast: 'more' },
] as const;

/** What the running head and the chapter index say now. */
const reading = (page: Page) =>
  page.evaluate(() => ({
    current: [...document.querySelectorAll<HTMLElement>('[data-ee-rail][data-current]')].map(
      (entry) => entry.dataset.eeRail ?? '',
    ),
    chapter: document.querySelector('[data-ee-folio-chapter]')?.textContent ?? null,
    section: document.querySelector('[data-ee-folio-section]')?.textContent ?? null,
    sections: [...document.querySelectorAll('.ee-rail__sections a')].filter(
      (link) => link.getClientRects().length > 0,
    ).length,
  }));

/** Waits for the page's observers to deliver after a scroll. */
const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 300))),
      ),
  );

for (const { width, height, contrast } of CASES) {
  const row = contrast === 'more' ? ', under more contrast' : '';
  test(
    `at ${width}${row}, back at the top from the fourth chapter the running head and the chapter index read as on arrival, and each chapter is marked while it's read`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ contrast });
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await settle(page);
      const arrival = await reading(page);
      expect(arrival.current, 'no chapter is marked on arrival').toEqual([]);
      // Each chapter, its opener brought just under the reading line, is the one marked.
      const chapters = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-ee-chapter]')].map(
          (chapter) => chapter.dataset.eeChapter ?? '',
        ),
      );
      expect(chapters.length, 'the issue has chapters').toBeGreaterThan(3);
      for (const [index, n] of chapters.entries()) {
        // A chapter near the page's end whose opener can't reach the line is read some other way.
        const reached = await page.evaluate((index) => {
          const spy = document.querySelector<HTMLElement>('.ee-spy');
          const line = Math.ceil(Number.parseFloat(getComputedStyle(spy!).paddingBlockStart) || 0);
          const opener = document
            .querySelectorAll<HTMLElement>('[data-ee-chapter]')
            [index]?.querySelector<HTMLElement>('.ee-chapter__open');
          window.scrollTo(0, scrollY + (opener?.getBoundingClientRect().top ?? 0) - line + 8);
          return (opener?.getBoundingClientRect().top ?? Infinity) <= line;
        }, index);
        if (!reached) continue;
        await settle(page);
        expect((await reading(page)).current, `reading chapter ${n}`).toEqual([n]);
      }
      // Straight back to the top, in one jump.
      await page.evaluate(() => window.scrollTo(0, 0));
      await settle(page);
      expect(await reading(page), 'back at the top').toEqual(arrival);
    },
  );

  test(
    `at ${width}${row}, read from the top down into the first chapter and back a few pixels at a time, the chapter index marks it once and lets it go once, with no flicker at the opening's edges`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ contrast });
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await settle(page);
      // Every change to what's marked or what the running head says, as it happens.
      const seen = await page.evaluate(async () => {
        const now = () =>
          [
            [...document.querySelectorAll<HTMLElement>('[data-ee-rail][data-current]')]
              .map((entry) => entry.dataset.eeRail ?? '')
              .join(','),
            document.querySelector('[data-ee-folio-chapter]')?.textContent ?? '',
            document.querySelector('[data-ee-folio-section]')?.textContent ?? '',
          ].join(' | ');
        const log = [now()];
        const watch = new MutationObserver(() => {
          if (log.at(-1) !== now()) log.push(now());
        });
        watch.observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
          attributeFilter: ['data-current'],
        });
        const frame = () =>
          new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        const spy = document.querySelector<HTMLElement>('.ee-spy');
        const line = Math.ceil(Number.parseFloat(getComputedStyle(spy!).paddingBlockStart) || 0);
        const opener = document.querySelector<HTMLElement>('[data-ee-chapter] .ee-chapter__open');
        const end = scrollY + (opener?.getBoundingClientRect().top ?? 0) - line + 8;
        for (let y = 0; y <= end; y += 3) {
          window.scrollTo(0, y);
          await frame();
        }
        window.scrollTo(0, end);
        await frame();
        const down = log.splice(0);
        log.push(now());
        for (let y = end; y >= 0; y -= 3) {
          window.scrollTo(0, y);
          await frame();
        }
        window.scrollTo(0, 0);
        await new Promise((done) => setTimeout(done, 300));
        watch.disconnect();
        return { down, up: log };
      });
      const first = await page.evaluate(
        () => document.querySelector<HTMLElement>('[data-ee-chapter]')?.dataset.eeChapter ?? '',
      );
      const current = (each: string) => each.split(' | ')[0];
      expect(seen.down.map(current), 'reading down').toEqual(['', first]);
      expect(seen.up.map(current), 'reading back up').toEqual([first, '']);
    },
  );
}
