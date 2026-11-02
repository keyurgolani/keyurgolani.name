import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Singular P2's home outline in a browser (the plan's §2, the lead's rulings on the mockup): every
// record row past the panels is closed at rest, its summary a count, the owner's first sentence or
// the plus alone, and its name ending with the row's title; a fragment opens the row that holds it,
// on load, on a hash change and from Contents' links, with script; with none, :target shows its body
// and the plus goes; print opens every row and drops the summaries. On the complete fixture, under
// read-only.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

const SITE_TEXT = fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'singular');
const APP = {
  portfolio: FIXTURE.files.portfolio,
  siteText: SITE_TEXT,
  sourceFiles: Object.fromEntries(
    FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
  ),
};

test.use({ viewport: { width: 1440, height: 900 }, appOptions: APP });

const ROW = '#experience';

test(
  'every row past the panels is closed at rest, and says what it holds',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('.sg[data-sg-live]')).toHaveCount(1);
    const folds = page.locator('.sg-rec > details.sg-fold');
    expect(await folds.count()).toBeGreaterThan(10);
    expect(await page.locator('.sg-rec > details.sg-fold[open]').count()).toBe(0);
    const rows = await folds.evaluateAll((all) =>
      all.map((fold) => {
        const row = fold.closest('.sg-rec')!;
        const summary = fold.querySelector('summary')!;
        const body = fold.querySelector('.sg-rec__body')!;
        return {
          id: row.id,
          title: row.querySelector('.sg-rec__title')?.textContent?.trim() ?? '',
          name: summary.textContent?.replace(/\s+/g, ' ').trim() ?? '',
          line: fold.querySelector('.sg-fold__line')?.textContent ?? null,
          // A closed disclosure skips its content (content-visibility), which checkVisibility reads.
          body: body.checkVisibility(),
          // The heading stays a heading outside the fold.
          headingOutside: !!row.querySelector(':scope > header h3, :scope > header h2'),
        };
      }),
    );
    for (const row of rows) {
      expect(row.body, row.id).toBe(false);
      expect(row.headingOutside, row.id).toBe(true);
      expect(row.name.endsWith(row.title), `${row.id}: ${row.name}`).toBe(true);
      expect(row.line, row.id).not.toBe('Read it');
    }
    // Each summary's name is its own.
    expect(new Set(rows.map((row) => row.name)).size).toBe(rows.length);
    // The counts are the content's: the experience row counts its entries.
    expect(rows.find((row) => row.id === 'experience')?.line).toMatch(/^\d+ (roles?|entries)/);
  },
);

// The ledger's measure (the lead's ruling, item 3): a closed row is its heading and one line, 68 px
// at 1440 and 76 at 390, give or take the type pack's line; a row whose heading takes more lines is
// taller by those lines only. A closed body takes no space: the record is its head and its rows.
for (const [width, height, target] of [
  [1440, 900, 68],
  [390, 844, 76],
] as const) {
  test(
    `closed rows are ${target} px at ${width}, and a closed body takes no space`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/', { waitUntil: 'networkidle' });
      const measured = await page.evaluate(() => {
        const record = document.querySelector('[data-sg-record]')!;
        const head = record.querySelector('.sg-record__head')!;
        const rows = [...record.querySelectorAll<HTMLElement>('.sg-record__rows > .sg-rec')];
        const style = getComputedStyle(record);
        const lineOf = (el: Element) => parseFloat(getComputedStyle(el).lineHeight) || 24;
        return {
          record: record.getBoundingClientRect().height,
          head: head.getBoundingClientRect().height,
          padding: parseFloat(style.paddingBlockStart) + parseFloat(style.paddingBlockEnd),
          rows: rows.map((row) => {
            const head = row.querySelector('.sg-rec__head')!.getBoundingClientRect().height;
            const title = row.querySelector('.sg-rec__title')!.getBoundingClientRect().height;
            return {
              id: row.id,
              closed: !!row.querySelector(':scope > details.sg-fold:not([open])'),
              height: row.getBoundingClientRect().height,
              // What the heading's track holds past one title line: a subtitle, a date, a wrap.
              extra: Math.max(0, head - title),
              oneLine: title <= lineOf(row.querySelector('.sg-rec__title')!) * 1.5,
            };
          }),
        };
      });
      console.log(
        `rows at ${width}: ${measured.rows.map((r) => `${r.id} ${Math.round(r.height)}`).join(', ')}`,
      );
      // Every closed row whose title is one line is the ledger's measure, plus what its heading's
      // track holds under the title (one line each for a subtitle or a date, at the fold line's size).
      const closed = measured.rows.filter((row) => row.closed && row.oneLine);
      expect(closed.length).toBeGreaterThan(10);
      for (const row of closed) {
        // No taller than the measure plus what its heading holds, and never under the measure.
        const most = target + row.extra + 8;
        expect(row.height, `${row.id} ${row.height} over ${most}`).toBeLessThanOrEqual(most);
        expect(row.height, `${row.id} ${row.height} under ${target - 8}`).toBeGreaterThanOrEqual(
          target - 8,
        );
      }
      // The rows are all the record holds under its head: no closed body adds a pixel.
      const sum = measured.rows.reduce((total, row) => total + row.height, 0);
      expect(
        Math.abs(measured.record - measured.padding - measured.head - sum),
      ).toBeLessThanOrEqual(2);
    },
  );
}

test(
  'a fragment opens its row: on load, on a hash change, and from Contents',
  { annotation },
  async ({ page }) => {
    await page.goto(`/${ROW}`, { waitUntil: 'networkidle' });
    await expect(page.locator('.sg[data-sg-live]')).toHaveCount(1);
    await expect(page.locator(`${ROW} > details.sg-fold`)).toHaveAttribute('open', '');
    await expect(page.locator(`${ROW} .sg-rec__body`)).toBeVisible();
    // A hash change opens the next one.
    await page.evaluate(() => {
      window.location.hash = 'education';
    });
    await expect(page.locator('#education > details.sg-fold')).toHaveAttribute('open', '');
    // Contents' link to a closed row opens it before the browser lands.
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('.sg[data-sg-live]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Contents' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('a[href$="#publications"]').first().click();
    await expect(page.locator('#publications > details.sg-fold')).toHaveAttribute('open', '');
    await expect(page.locator('#publications .sg-rec__body')).toBeInViewport();
  },
);

test(
  'a row a fragment opened closes, and its body goes (code review P1-1)',
  { annotation },
  async ({ page }) => {
    await page.goto(`/${ROW}`, { waitUntil: 'networkidle' });
    await expect(page.locator('.sg[data-sg-live]')).toHaveCount(1);
    const fold = page.locator(`${ROW} > details.sg-fold`);
    await expect(fold).toHaveAttribute('open', '');
    await fold.locator('summary').click();
    await expect(fold).not.toHaveAttribute('open', '');
    // The row is still the target, and the body still goes.
    expect(await page.evaluate(() => window.location.hash)).toBe(ROW);
    expect(await page.locator(`${ROW} .sg-rec__body`).evaluate((el) => el.checkVisibility())).toBe(
      false,
    );
    expect(
      await page.locator(`${ROW} .sg-fold__mark`).evaluate((el) => getComputedStyle(el).visibility),
    ).toBe('visible');
  },
);

test(
  'a summary opens and closes its row, by pointer and by keyboard',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const fold = page.locator(`${ROW} > details.sg-fold`);
    await fold.locator('summary').scrollIntoViewIfNeeded();
    await fold.locator('summary').click();
    await expect(fold).toHaveAttribute('open', '');
    await fold.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(fold).not.toHaveAttribute('open', '');
  },
);

test('print opens every row and drops the summaries', { annotation }, async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print' });
  const shown = await page.locator('.sg-rec > details.sg-fold').evaluateAll((all) =>
    all.map((fold) => ({
      body: fold.querySelector('.sg-rec__body')!.checkVisibility(),
      summary: fold.querySelector('summary')!.getBoundingClientRect().height,
    })),
  );
  expect(shown.length).toBeGreaterThan(10);
  for (const row of shown) {
    expect(row.body).toBe(true);
    expect(row.summary).toBe(0);
  }
});

test.describe('with no script', () => {
  test.use({ javaScriptEnabled: false });
  test(
    ':target shows the row a fragment names, and its plus goes',
    { annotation },
    async ({ page }) => {
      await page.goto(`/${ROW}`, { waitUntil: 'networkidle' });
      await expect(page.locator('.sg[data-sg-live]')).toHaveCount(0);
      // The native disclosure is still closed: the body shows through ::details-content.
      await expect(page.locator(`${ROW} > details.sg-fold`)).not.toHaveAttribute('open', '');
      expect(
        await page.locator(`${ROW} .sg-rec__body`).evaluate((el) => el.checkVisibility()),
      ).toBe(true);
      expect(
        await page
          .locator(`${ROW} .sg-fold__mark`)
          .evaluate((el) => getComputedStyle(el).visibility),
      ).toBe('hidden');
      // Another row stays closed, with its plus.
      expect(
        await page.locator('#education .sg-rec__body').evaluate((el) => el.checkVisibility()),
      ).toBe(false);
      expect(
        await page
          .locator('#education .sg-fold__mark')
          .evaluate((el) => getComputedStyle(el).visibility),
      ).toBe('visible');
      // Last, since it leaves the page: a link in the shown body is its own, as the summary's reach
      // stops at its line (code review P1-1), so the first click follows the link.
      const link = page.locator(`${ROW} .sg-rec__body a[href^="https://"]`).first();
      const href = await link.getAttribute('href');
      expect(href).toBeTruthy();
      const target = new URL(href!);
      await link.scrollIntoViewIfNeeded();
      expect(
        await link.evaluate((a) => {
          const box = a.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return hit !== null && a.contains(hit);
        }),
      ).toBe(true);
      // The owner's address is fulfilled here, so the click lands without leaving loopback.
      await page.route(
        (url) => url.origin === target.origin,
        (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'landed' }),
      );
      await link.click();
      await expect(page).toHaveURL(target.href);
    },
  );
});
