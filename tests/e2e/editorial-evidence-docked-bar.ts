import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Editorial Evidence's chapter bar on a phone, docked under the masthead down the page, on one
// tuple a spec file (a test's appOptions can't vary inside a file): its first and last links,
// focused from the keyboard, ring whole under the masthead, the ring starting at or below the
// masthead's foot and ending inside the bar, by default and under forced colours. With `rest`,
// the page at rest at 390 and 1440 keeps every box where it is with the bar token the page
// fits to the masthead and without it, and with no script the token is the stylesheet's own.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const ROWS = { default: 'none', 'forced-colors': 'active' } as const;
const annotation = [{ type: 'route', description: '/' }];
const tag = '@interaction';

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** The bar token as the stylesheet sets it, in px. */
const sheetToken = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-variant]')!;
    const probe = document.createElement('div');
    probe.style.cssText =
      'position: absolute; visibility: hidden; block-size: calc(var(--ui-control-height) + 2 * var(--space-2xs))';
    root.append(probe);
    const px = probe.getBoundingClientRect().height;
    probe.remove();
    return px;
  });

/** The docked-bar tests on `tuple`, designLanguage/colorScheme/typography/displayMode. */
export function dockedBar(tuple: string, { rest = false } = {}) {
  const [designLanguage, colorScheme, typography, displayMode] = tuple.split('/');
  test.use({
    viewport: { width: 390, height: 844 },
    appOptions: {
      portfolio: FIXTURE.files.portfolio,
      siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'editorial-evidence')
        .replace(/designLanguage: .*/, `designLanguage: ${designLanguage}`)
        .replace(/colorScheme: .*/, `colorScheme: ${colorScheme}`)
        .replace(/typography: .*/, `typography: ${typography}`)
        .replace(/displayMode: .*/, `displayMode: ${displayMode}`),
      sourceFiles: Object.fromEntries(
        FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
      ),
    },
  });

  for (const [row, forcedColors] of Object.entries(ROWS))
    test(
      `on ${tuple} at 390, ${row}, the chapter bar docked under the masthead rings its first and last links whole below the masthead's foot`,
      { annotation, tag },
      async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'light', forcedColors, contrast: 'no-preference' });
        await page.goto('/', { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        const links = page.locator('.ee-rail__link');
        for (const [link, end] of [
          [links.first(), 'start'],
          [links.last(), 'end'],
        ] as const) {
          // Docked, with the link brought into the bar's scroller by the scroller itself, and
          // focused without the page moving: the browser's own focus scroll can take the page
          // back to the bar's place in the flow, where nothing docks.
          await page.evaluate(() => window.scrollTo(0, 1500));
          await frames(page);
          await frames(page);
          await link.evaluate((element, at) => {
            const list = element.closest<HTMLElement>('.ee-rail__list')!;
            list.scrollLeft = at === 'start' ? 0 : list.scrollWidth;
          }, end);
          await page.keyboard.press('Shift');
          await link.evaluate((element: HTMLElement) => element.focus({ preventScroll: true }));
          await frames(page);
          const read = await link.evaluate((element) => {
            const style = getComputedStyle(element);
            const reach =
              Number.parseFloat(style.outlineWidth) +
              Math.max(0, Number.parseFloat(style.outlineOffset));
            const box = element.getBoundingClientRect();
            const head = document.querySelector('.ee-masthead')!.getBoundingClientRect();
            const bar = element.closest<HTMLElement>('.ee-rail')!;
            const barBox = bar.getBoundingClientRect();
            return {
              text: (element.textContent ?? '').trim(),
              docked: Math.abs(barBox.top - head.bottom) < 12,
              ringTop: box.top - reach,
              ringBottom: box.bottom + reach,
              masthead: head.bottom,
              barFoot:
                barBox.bottom - (Number.parseFloat(getComputedStyle(bar).borderBlockEndWidth) || 0),
            };
          });
          console.log(`docked bar on ${tuple}, ${row}: ${JSON.stringify(read)}`);
          expect(read.docked, `the bar is docked under the masthead (${read.text})`).toBe(true);
          expect(
            read.ringTop,
            `${read.text}'s ring starts at or below the masthead's foot`,
          ).toBeGreaterThanOrEqual(read.masthead - 0.5);
          expect(read.ringBottom, `${read.text}'s ring ends inside the bar`).toBeLessThanOrEqual(
            read.barFoot + 0.5,
          );
        }
      },
    );

  if (!rest) return;

  for (const width of [390, 1440] as const)
    test(
      `on ${tuple} at ${width}, at rest, the opening, the masthead, the bar and the first chapter's opener keep their boxes with the bar token fitted to the masthead and without it`,
      { annotation, tag },
      async ({ page }) => {
        await page.setViewportSize(width === 390 ? { width, height: 844 } : { width, height: 900 });
        await page.goto('/', { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        await frames(page);
        await frames(page);
        // Read as the page has it, then at once with the page's own token taken away, and back.
        const read = await page.evaluate(() => {
          const root = document.querySelector<HTMLElement>('[data-variant]')!;
          const spy = document.querySelector<HTMLElement>('.ee-spy')!;
          const boxes = () => ({
            ...Object.fromEntries(
              ['.ee-opening', '.ee-masthead', '.ee-rail', '.ee-chapter__open'].map((selector) => {
                const r = document.querySelector(selector)!.getBoundingClientRect();
                return [
                  selector,
                  [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10),
                ];
              }),
            ),
            line: Math.ceil(Number.parseFloat(getComputedStyle(spy).paddingBlockStart) || 0) + 1,
          });
          const fitted = root.style.getPropertyValue('--layout-ee-bar');
          const withToken = boxes();
          root.style.removeProperty('--layout-ee-bar');
          const without = boxes();
          if (fitted) root.style.setProperty('--layout-ee-bar', fitted);
          return { fitted, withToken, without, scrollY };
        });
        console.log(`at rest on ${tuple} at ${width}: ${JSON.stringify(read)}`);
        expect(read.scrollY).toBe(0);
        const { line: lineWith, ...with_ } = read.withToken;
        const { line: lineWithout, ...without } = read.without;
        expect(
          with_,
          `the boxes at rest (reading line ${lineWith} fitted, ${lineWithout} not)`,
        ).toEqual(without);
      },
    );

  test.describe('with no script', () => {
    test.use({ javaScriptEnabled: false });

    test(
      `on ${tuple} at 390, with no script, the bar token is the stylesheet's own and the chapter bar docks there`,
      { annotation, tag },
      async ({ page }) => {
        await page.goto('/', { waitUntil: 'load' });
        const token = await sheetToken(page);
        const read = await page.evaluate(() => {
          const root = document.querySelector<HTMLElement>('[data-variant]')!;
          window.scrollTo(0, 1500);
          return {
            inline: root.style.getPropertyValue('--layout-ee-bar'),
            minimum: Number.parseFloat(
              getComputedStyle(document.querySelector('.ee-masthead')!).minBlockSize,
            ),
            bar: document.querySelector('.ee-rail')!.getBoundingClientRect().top,
          };
        });
        expect(read.inline, 'no token set on the page').toBe('');
        expect(read.minimum).toBeCloseTo(token, 1);
        expect(read.bar).toBeCloseTo(token, 1);
      },
    );
  });
}
