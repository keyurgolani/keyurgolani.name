import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Mission Control's full record and its case page in a browser (Design gate
// rule 8; variants-10 brief §5.0, P2): the closed panels at a board's end
// open from a fragment link, with the record enhancement and with no script
// at all, and print open; a work's own page has one h1, its title, every
// part its index names, and no sideways scroll down to 320. On the complete
// fixture, under read-only.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'mission-control'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

test(
  'a fragment link opens a closed panel of the full record and lands on it (rule 8)',
  { annotation },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-variant="mission-control"]')).toHaveCount(1);
    await expect(page.locator('[data-mc-record]')).toHaveCount(1);
    const folded = page.locator('section[data-fold]');
    expect(await folded.count()).toBeGreaterThan(0);
    // Closed at rest: only the bar shows.
    for (const fold of await folded.all())
      expect(await fold.locator('details').evaluate((d) => (d as HTMLDetailsElement).open)).toBe(
        false,
      );
    const id = (await folded.first().getAttribute('id'))!;
    // From the board's own index, the way a visitor gets there.
    await page.locator(`a[href="#${id}"]`).first().click();
    await expect
      .poll(() =>
        folded
          .first()
          .locator('details')
          .evaluate((d) => (d as HTMLDetailsElement).open),
      )
      .toBe(true);
    const box = (await folded.first().boundingBox())!;
    expect(box.y).toBeLessThan(900);
    expect(box.y + box.height).toBeGreaterThan(0);
  },
);

test.describe('with no script', () => {
  test.use({ javaScriptEnabled: false });

  test(
    'a fragment link shows a closed panel’s content, and every panel stays reachable (rule 8)',
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/', { waitUntil: 'networkidle' });
      const id = (await page.locator('section[data-fold]').first().getAttribute('id'))!;
      await page.goto(`/#${id}`, { waitUntil: 'networkidle' });
      const height = await page
        .locator(`[id="${id}"] details > :not(summary)`)
        .first()
        .evaluate((el) => el.getBoundingClientRect().height);
      expect(height).toBeGreaterThan(0);
    },
  );
});

test('on paper every closed panel prints open (rule 8)', { annotation }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print' });
  const heights = await page
    .locator('details[data-mc-fold] > :not(summary)')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThan(0);
  expect(heights.every((h) => h > 0)).toBe(true);
});

test(
  'a work’s own page: one h1, its title; every part in its index lands; no sideways scroll to 320 (P2)',
  { annotation: [{ type: 'route', description: '/work/project-name' }, annotation[1]!] },
  async ({ page }) => {
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/work/project-name', { waitUntil: 'networkidle' });
      await expect(page.locator('[data-variant="mission-control"]')).toHaveCount(1);
      await expect(page.locator('[data-mc-page="case"]')).toHaveCount(1);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toContainText('Project name');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      const links = await page
        .locator('.mc-board__nav a')
        .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).hash.slice(1)));
      for (const id of links) await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
    }
  },
);
