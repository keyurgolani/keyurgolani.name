import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Horizontal Cinema at 1440, where the strip is pinned: a reader inside the strip changes the text
// size, a step larger, and then moves the strip with a sideways wheel over the stage. The refit
// takes the strip's scroll as it left it for its own, and the reader's wheel after it is still
// theirs: the page follows the strip, the two in step. On the complete contract fixture.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  viewport: { width: 1440, height: 900 },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 400))),
      ),
  );

const where = (page: Page) =>
  page.evaluate(() => ({
    page: window.scrollY,
    strip: Math.abs(document.querySelector('.hc-stage')!.scrollLeft),
  }));

test(
  'after a text size, a sideways wheel over the pinned strip still moves the page with it',
  { annotation: [{ type: 'route', description: '/' }] },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await settle(page);
    await page.evaluate(() => {
      const shell = document.querySelector('.hc-shell')!;
      window.scrollTo(0, scrollY + shell.getBoundingClientRect().top + 2000);
    });
    await settle(page);
    await settle(page);
    await page.evaluate(() =>
      document.documentElement.style.setProperty('font-size', '112.5%', 'important'),
    );
    await settle(page);
    await settle(page);
    const before = await where(page);
    expect(before.strip, 'inside the strip, past its start').toBeGreaterThan(0);
    const stage = (await page.locator('.hc-stage').boundingBox())!;
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await page.mouse.wheel(600, 0);
    await settle(page);
    await settle(page);
    const after = await where(page);
    console.log(`wheel after a text size: ${JSON.stringify({ before, after })}`);
    expect(Math.abs(after.strip - before.strip), 'the wheel moved the strip').toBeGreaterThan(50);
    expect(
      Math.abs(after.page - after.strip - (before.page - before.strip)),
      'the page followed the strip, the two in step',
    ).toBeLessThanOrEqual(2);
  },
);
