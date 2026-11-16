import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { appFor } from './flux-shared';

// The Flux stack's looks, for the fixture long-text, one file per fixture,
// since appOptions is worker-scoped. PROOF_LOOK_OUT names the dir.
// complete: the case page /work/project-name at 1440x900 and 1024x768, 100% and 200% root text
//   (case sheet spacing, facts); the same page at 320x568 (the unavailable picture's label); the
//   home page at 390x844, the #talks fold blurred and focused, default and contrast-more; the
//   #stats fold's More summary reached by Tab at 390 (the dock's reserve); the dock.
// long-text and missing-media: the dock.
// The dock: 320x568 and 390x844 at 100%, and 390x844 at 200%, light and dark, at the opening and
//   with a sheet being read, clipped to the bar, with the name word's lines and boxes beside it.

const FIXTURE = 'long-text' as 'complete' | 'long-text' | 'missing-media';
test.use({ appOptions: appFor(contractFixture(FIXTURE)) });
const OUT = process.env.PROOF_LOOK_OUT ?? 'look';

const settle = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
const rootText = (page: Page, scale: number) =>
  scale === 1
    ? Promise.resolve()
    : page.evaluate(
        (s) => document.documentElement.style.setProperty('font-size', `${s * 100}%`, 'important'),
        scale,
      );
const save = (stem: string, read: unknown) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${stem}.json`), JSON.stringify(read, null, 1));
  return path.join(OUT, `${stem}.png`);
};

for (const [width, height, scale] of [
  [320, 568, 1],
  [390, 844, 1],
  [390, 844, 2],
] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`dock: ${FIXTURE} / at ${width}x${height}, root text ${scale * 100}%, ${scheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height });
      await page.goto('/', { waitUntil: 'networkidle' });
      await rootText(page, scale);
      await page.evaluate(() => document.fonts.ready);
      await settle(page);
      for (const state of ['opening', 'reading'] as const) {
        if (state === 'reading') {
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
          await settle(page);
          await page.waitForTimeout(300);
        }
        const read = await page.evaluate(() => {
          const bar = document.querySelector('#fx--bar')!.getBoundingClientRect();
          const word = document.querySelector<HTMLElement>('#fx--bar .fx-tab--name .fx-tab__word');
          const tab = document.querySelector('#fx--bar .fx-tab--name');
          const range = document.createRange();
          if (word) range.selectNodeContents(word);
          const box = word?.getBoundingClientRect();
          return {
            bar: { top: bar.top, height: bar.height },
            reserve: getComputedStyle(document.documentElement).scrollPaddingBlockEnd,
            rootFontSize: getComputedStyle(document.documentElement).fontSize,
            name: word?.textContent?.trim() ?? null,
            shown: word ? word.getClientRects().length > 0 : false,
            word: box
              ? {
                  width: box.width,
                  height: box.height,
                  clientWidth: word!.clientWidth,
                  scrollWidth: word!.scrollWidth,
                  clientHeight: word!.clientHeight,
                  scrollHeight: word!.scrollHeight,
                  lines: new Set(
                    [...range.getClientRects()]
                      .filter((r) => r.width > 0 && r.bottom <= box.bottom + 1)
                      .map((r) => Math.round(r.top)),
                  ).size,
                  fontSize: getComputedStyle(word!).fontSize,
                  lineHeight: getComputedStyle(word!).lineHeight,
                }
              : null,
            tab: tab
              ? (({ width: w, height: h }) => ({ width: w, height: h }))(
                  tab.getBoundingClientRect(),
                )
              : null,
          };
        });
        const stem = `dock-${FIXTURE}-${width}x${height}-text${scale * 100}-${scheme}-${state}`;
        const top = Math.max(0, read.bar.top - 16);
        await page.screenshot({
          path: save(stem, read),
          clip: { x: 0, y: top, width, height: height - top },
        });
        expect(read.bar.height).toBeGreaterThan(0);
      }
    });
  }
}

if (FIXTURE === 'complete') {
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
  ] as const) {
    for (const scale of [1, 2]) {
      test(`case: /work/project-name at ${width}x${height}, root text ${scale * 100}%`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
        await page.setViewportSize({ width, height });
        await page.goto('/work/project-name', { waitUntil: 'networkidle' });
        await rootText(page, scale);
        await settle(page);
        const read = await page.evaluate(() => ({
          pageScrollWidth: document.documentElement.scrollWidth,
          innerWidth,
        }));
        await page.screenshot({
          path: save(`case-${width}x${height}-text${scale * 100}`, read),
          fullPage: true,
        });
      });
    }
  }

  test('case: /work/project-name at 320x568, the unavailable pictures', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/work/project-name', { waitUntil: 'networkidle' });
    const figure = page.locator('.fx-frame figure').first();
    await figure.scrollIntoViewIfNeeded();
    await settle(page);
    const read = await page.evaluate(() =>
      [...document.querySelectorAll('.fx-frame figure > .pf-media-box')].map((box) => {
        const r = box.getBoundingClientRect();
        const label = box.querySelector('.pf-media-box__label');
        return {
          box: { width: r.width, height: r.height },
          label: label
            ? { scrollHeight: label.scrollHeight, clientHeight: label.clientHeight }
            : null,
        };
      }),
    );
    await page.screenshot({ path: save('case-320x568-pictures', read), fullPage: true });
  });

  const TALKS = '#talks > details:nth-child(1) > summary:nth-child(1)';
  for (const contrast of ['no-preference', 'more'] as const) {
    test(`home: the #talks fold at 390x844, contrast ${contrast}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce', contrast });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/', { waitUntil: 'networkidle' });
      const summary = page.locator(TALKS);
      await summary.scrollIntoViewIfNeeded();
      await page.evaluate(() => scrollBy(0, -200));
      await settle(page);
      const box = (await summary.boundingBox())!;
      const clip = { x: 0, y: Math.max(0, box.y - 60), width: 390, height: box.height + 140 };
      await page.screenshot({ path: save(`talks-390-${contrast}-blurred`, { box }), clip });
      await page.keyboard.press('Tab');
      await summary.focus();
      await settle(page);
      const read = await page.evaluate((s) => {
        const el = document.querySelector(s)!;
        const r = el.getBoundingClientRect();
        const next = el.closest('section')!.nextElementSibling?.querySelector('summary');
        return {
          focusVisible: el.matches(':focus-visible'),
          gapToNext: next ? next.getBoundingClientRect().top - r.bottom : null,
        };
      }, TALKS);
      await page.screenshot({ path: save(`talks-390-${contrast}-focused`, read), clip });
      expect(read.focusVisible).toBe(true);
    });
  }

  test('home: the #stats fold reached by Tab at 390x844, over the dock', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'networkidle' });
    const stats = page.locator('#stats summary').first();
    await stats.scrollIntoViewIfNeeded();
    // Its summary just under the dock, then reached from the control before it, as Tab does.
    await page.evaluate(() => {
      const s = document.querySelector('#stats summary')!;
      const bar = document.querySelector('#fx--bar')!.getBoundingClientRect();
      scrollBy(0, s.getBoundingClientRect().top - bar.top + 2);
    });
    await settle(page);
    await page.evaluate(() => {
      const s = document.querySelector<HTMLElement>('#stats summary')!;
      const all = [...document.querySelectorAll<HTMLElement>('a[href], summary, button')];
      all[all.indexOf(s) - 1]?.focus();
    });
    await page.keyboard.press('Tab');
    await settle(page);
    const read = await page.evaluate(() => {
      const s = document.activeElement!.getBoundingClientRect();
      const bar = document.querySelector('#fx--bar')!.getBoundingClientRect();
      return {
        focused: document.activeElement?.matches('#stats summary') ?? false,
        summaryBottom: s.bottom,
        barTop: bar.top,
        clearance: bar.top - s.bottom,
      };
    });
    await page.screenshot({ path: save('stats-390-tab', read) });
  });
}
