import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { load } from './horizontal-cinema-model';

// Horizontal Cinema's full record (the home outline): after the film, each
// section of the record behind a closed native disclosure, in its own frame
// with its own id. A link to one opens it and lands on it; with no script
// its summary opens it; on paper every one reads open.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];
const tag = '@interaction';

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1440, height: 900 },
});

/** The first section of the full record: its disclosure, and the id its frame keeps. */
async function firstRecord(page: import('@playwright/test').Page) {
  const item = page.locator('details[data-record]').first();
  const id = await item.evaluate((one) => one.querySelector('section[id]')!.id);
  return { item, id };
}

test(
  'the record is closed after the film, and a link to a section of it opens it and lands on it',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    expect(await page.locator('details[data-record]').count()).toBeGreaterThan(0);
    const { item, id } = await firstRecord(page);
    await expect(item).not.toHaveAttribute('open', '');
    // The section is outside the strip: every scene of the strip is before it.
    expect(await page.locator(`.hc-track [id="${id}"]`).count()).toBe(0);
    await load(page, `/#${id}`);
    const opened = page.locator(`details[data-record]:has([id="${id}"])`);
    await expect(opened).toHaveAttribute('open', '');
    await expect(page.locator(`[id="${id}"]`)).toBeInViewport();
  },
);

test('on paper every section of the record reads open', { annotation, tag }, async ({ page }) => {
  await load(page);
  const ids = await page
    .locator('details[data-record]')
    .evaluateAll((items) => items.map((one) => one.querySelector('section[id]')!.id));
  expect(ids.length).toBeGreaterThan(0);
  await page.emulateMedia({ media: 'print' });
  for (const id of ids) {
    const height = await page
      .locator(`[id="${id}"]`)
      .evaluate((one) => one.getBoundingClientRect().height);
    expect(height, `${id} reads on paper`).toBeGreaterThan(0);
    await expect(page.locator(`[id="${id}"] :is(h2, h3, h4)`).first()).toBeVisible();
  }
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test(
    "a section of the record opens from its own summary, the browser's own disclosure",
    { annotation, tag },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'load' });
      const item = page.locator('details[data-record]').first();
      await expect(item).not.toHaveAttribute('open', '');
      await item.locator('summary').click();
      await expect(item).toHaveAttribute('open', '');
      const id = await item.evaluate((one) => one.querySelector('section[id]')!.id);
      await expect(page.locator(`[id="${id}"] :is(h2, h3, h4)`).first()).toBeVisible();
    },
  );

  test(
    "a fresh load of a link to a section of the record opens it with no script, the browser's own fragment search",
    { annotation, tag },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'load' });
      const id = await page
        .locator('details[data-record]')
        .first()
        .evaluate((one) => one.querySelector('section[id]')!.id);
      // A fresh document, as a case study's "Back to the full record" opens it: not a same-page jump.
      const url = new URL(`/#${id}`, page.url()).href;
      await page.goto('about:blank');
      await page.goto(url, { waitUntil: 'load' });
      await expect(page.locator(`details[data-record]:has([id="${id}"])`)).toHaveAttribute(
        'open',
        '',
      );
      await expect(page.locator(`[id="${id}"] :is(h2, h3, h4)`).first()).toBeVisible();
    },
  );
});
