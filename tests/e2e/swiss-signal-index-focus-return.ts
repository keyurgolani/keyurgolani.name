import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';

// Row 108: the quality cell swiss-signal complete /work/project-name x platform-neutral high-contrast at
// 390x844 default recorded keyboard/focus-return on the Index button, intermittently (1 of 4 on
// 0742c1dde). Tab past the sheet's last control closes it, and its button gets focus back: the close came
// in one task and the return in a later one (a setTimeout), so whatever read focus in between, the
// harness's check among them, found it on the element after the sheet. Deterministic, not by luck: right
// after every hidePopover() call, a microtask notes where focus is, which is the end of the close's own
// task. Focus is on the button there. Two guards keep the other exits as they are: Shift+Tab off the
// sheet's first link goes to its button, the browser's own move, and leaves the sheet open; a pointer click
// outside closes it and leaves focus where the click put it, with no late return to the button. The specs
// calling this are swiss-signal-index-focus-return-{hc390,system1440}.spec.ts, one tuple a file, as each
// is a server of its own.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const SHEET = '#ss--index';

export function defineFocusReturn(
  displayMode: 'system' | 'high-contrast',
  cases: readonly (readonly [number, number, boolean])[],
) {
  test.use({
    appOptions: {
      portfolio: FIXTURE.files.portfolio,
      siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'swiss-signal')
        .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
        .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
        .replace(/typography: .*/, 'typography: humanist-ui')
        .replace(/displayMode: .*/, `displayMode: ${displayMode}`),
      sourceFiles: Object.fromEntries(
        FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
      ),
    },
  });

  const WHERE = `(() => {
  const log = [];
  Object.defineProperty(window, '__ssHideLog', { value: log });
  const hide = HTMLElement.prototype.hidePopover;
  HTMLElement.prototype.hidePopover = function (...args) {
    const out = hide.apply(this, args);
    queueMicrotask(() => {
      const el = document.activeElement;
      log.push(el ? el.localName + [...el.classList].map((c) => '.' + c).join('') : 'none');
    });
    return out;
  };
})();`;

  const hideLog = (page: Page) =>
    page.evaluate(() => (window as unknown as { __ssHideLog: string[] }).__ssHideLog.splice(0));
  const isOpen = (page: Page) =>
    page.locator(SHEET).evaluate((sheet) => sheet.matches(':popover-open'));

  /** The page live, the Index opened from the keyboard, the hide log empty. */
  async function openFromKeyboard(page: Page) {
    await page.addInitScript(WHERE);
    await page.goto('/work/project-name', { waitUntil: 'networkidle' });
    await expect(page.locator('.ss')).toHaveAttribute('data-ss-live', '');
    const button = page.locator('.ss-index__button');
    await button.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => isOpen(page)).toBe(true);
    await hideLog(page);
    return button;
  }

  for (const [width, height, mobile] of cases)
    test.describe(`at ${width}, ${displayMode}`, () => {
      test.use({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
      const annotation = [{ type: 'route', description: '/work/project-name' }];

      test(
        "Tab past the Index sheet's last control closes it and gives focus back to its button in the same task",
        { annotation },
        async ({ page }) => {
          const button = await openFromKeyboard(page);
          await page.locator(`${SHEET} :is(a, button):visible`).last().focus();
          await hideLog(page);
          await page.keyboard.press('Tab');
          await expect.poll(() => isOpen(page)).toBe(false);
          const log = await hideLog(page);
          expect(log.length, 'the sheet closed').toBeGreaterThan(0);
          expect(log[0], 'where focus is at the end of the close task').toBe(
            'button.ss-index__button',
          );
          await expect(button).toBeFocused();
        },
      );

      test(
        "Shift+Tab off the Index sheet's first link goes to its button and leaves the sheet open (guard)",
        { annotation },
        async ({ page }) => {
          const button = await openFromKeyboard(page);
          await expect(page.locator(`${SHEET} a[href]`).first()).toBeFocused();
          await page.keyboard.press('Shift+Tab');
          await expect(button).toBeFocused();
          expect(await isOpen(page), 'the sheet stays open').toBe(true);
          expect(await hideLog(page), 'nothing closed it').toEqual([]);
        },
      );

      test(
        'a pointer click outside the open Index sheet closes it and leaves focus where the click put it (guard)',
        { annotation },
        async ({ page }) => {
          const button = await openFromKeyboard(page);
          await page.locator(`${SHEET} :is(a, button):visible`).last().focus();
          // A point on the masthead, which the sheet never covers, on nothing that takes focus or a
          // click of its own, at every width (its location cell is hidden at 390).
          const point = await page.evaluate((sheet) => {
            const bar = document.querySelector('.ss-masthead')!.getBoundingClientRect();
            for (let y = bar.top + 2; y < bar.bottom - 1; y += 4)
              for (let x = bar.left + 2; x < bar.right - 1; x += 4) {
                const hit = document.elementFromPoint(x, y);
                if (
                  hit &&
                  !hit.closest(`${sheet}, a, button, input, select, textarea, summary, [tabindex]`)
                )
                  return { x, y };
              }
            return null;
          }, SHEET);
          expect(point, 'a plain point on the masthead').not.toBeNull();
          await page.mouse.click(point!.x, point!.y);
          await expect.poll(() => isOpen(page)).toBe(false);
          // Past any later task the close might have queued: no return to the button comes.
          await page.waitForTimeout(300);
          await expect(button).not.toBeFocused();
          const at = await page.evaluate(() => document.activeElement?.localName ?? 'none');
          expect(at, 'focus is where the click put it, the page itself').toBe('body');
        },
      );
    });
}
