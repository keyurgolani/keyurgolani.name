import { expect, test } from '@playwright/test';
import { readStructure } from '../variants/distinct';
import { captureComposition } from '../variants/distinct-capture';

// The distinct guards' capture of Singular's home reads the page as it stays once its
// enhancements have settled. Singular's pager mounts its anchor when its lazy module lands, after
// the page has loaded and two frames have drawn, so a capture that waits for no more reads the page
// before it, and on a slower machine sometimes after. After each capture the page is left until no
// settle signal is on it and read again: the two agree, at desktop and at mobile.

test("the distinct capture of Singular's home reads it as it stays once its enhancements settle", async ({
  browser,
}, testInfo) => {
  testInfo.setTimeout(5 * 60_000);
  const read: string[] = [];
  await captureComposition({
    browser,
    variant: 'singular',
    testInfo,
    onPage: async (page, capture) => {
      await page.waitForFunction(
        () => !document.querySelector('[data-enhancement-pending]'),
        null,
        {
          timeout: 10_000,
        },
      );
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      expect(await readStructure(page), `${capture.viewport}: the boundary once settled`).toEqual(
        capture.boundary,
      );
      read.push(capture.viewport);
    },
  });
  expect(read.sort()).toEqual(['desktop', 'mobile']);
});
