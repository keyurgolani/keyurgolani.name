import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Schematic's detail sheet with a real title's words (the P2 mockup's ruling,
// changes 1, 2, 5 and 6): the complete fixture's case-study work titled
// "Postmortem Template Kit", with no organization, in a copy of its own.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const TITLE = 'Postmortem Template Kit';
const COPY = path.join(mkdtempSync(path.join(tmpdir(), 'sx-case-')), 'portfolio.yml');
writeFileSync(
  COPY,
  readFileSync(FIXTURE.files.portfolio, 'utf8')
    .replace('title: Project name', `title: ${TITLE}`)
    // No "for", as the demo's work has none: the medium stands alone in its row (change 6).
    .replace('    organization: Project organization\n', ''),
);
const annotation = [
  { type: 'route', description: '/work/[slug]' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  viewport: { width: 390, height: 844 },
  appOptions: {
    portfolio: COPY,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'schematic'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

async function openCase(page: Page) {
  await page.goto('/work/project-name', { waitUntil: 'networkidle' });
  await expect(page.locator('h1')).toHaveText(TITLE);
}

test(
  'at 390 and 320 the detail sheet’s title never breaks inside a word (change 1)',
  { annotation },
  async ({ page }) => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await openCase(page);
      const broken = await page.locator('h1').evaluate((h1) => {
        const text = h1.firstChild as Text;
        const out: string[] = [];
        let at = 0;
        for (const word of (text.textContent ?? '').split(' ')) {
          const range = document.createRange();
          range.setStart(text, at);
          range.setEnd(text, at + word.length);
          const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
          if (lines.size > 1) out.push(word);
          at += word.length + 1;
        }
        return out;
      });
      expect(broken, `${width}`).toEqual([]);
    }
  },
);

test(
  'at 390 the phone bar names the detail sheet by its number alone, and the owner’s name stays whole (change 2)',
  { annotation },
  async ({ page }) => {
    await openCase(page);
    const sheet = page.locator('.sx-phone a[data-sx-open]');
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(300);
    const text = (await sheet.innerText()).replace(/\s+/g, ' ').trim();
    expect(text).toMatch(/W-01$/);
    expect(text).not.toContain(TITLE);
    const name = await page
      .locator('.sx-phone__name')
      .evaluate((el) => ({ cut: el.scrollWidth > el.clientWidth + 1, text: el.textContent }));
    expect(name.cut, `${name.text}`).toBe(false);
  },
);

test(
  'past 30rem the phone bar keeps the detail sheet’s title beside its number (change 2)',
  { annotation },
  async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 });
    await openCase(page);
    const sheet = page.locator('.sx-phone a[data-sx-open]');
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(300);
    const title = sheet.locator('.sx-here__title');
    await expect(title).toBeVisible();
    await expect(title).toHaveText(TITLE);
  },
);

test(
  'the detail sheet’s Fig. 1 keeps the interface, what it measured and its parts, never In, Out or references (change 5)',
  { annotation },
  async ({ page }) => {
    await openCase(page);
    const fig = page.locator('.sx-dview--elevation .sx-fig');
    await expect(fig).toHaveCount(1);
    await expect(fig.locator('.sx-ports')).toBeVisible();
    await expect(fig.locator('.sx-io')).toHaveCount(0);
    await expect(fig.locator('[data-col="refs"]')).toHaveCount(0);
    expect(await fig.locator('.sx-depth__group').count()).toBeGreaterThan(0);
  },
);

test(
  'the detail sheet’s facts are a title block under the lede, role to recognition, at 1440 and 390 (change 6)',
  { annotation },
  async ({ page }, testInfo) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await openCase(page);
      const facts = page.locator('.sx-dhead .sx-tb[data-at="facts"]');
      await expect(facts).toBeVisible();
      const names = (await facts.locator('.sx-field-name').allInnerTexts()).map((n) =>
        n.trim().toLowerCase(),
      );
      for (const name of ['role', 'period', 'medium', 'made with', 'recognition'])
        expect(names, `${viewport.width}`).toContain(name);
      // Under the lede, never beside the title: the head doesn't split into two columns.
      const geometry = await page.evaluate(() => {
        const lede = document.querySelector('.sx-dhead__id')!.getBoundingClientRect();
        const block = document
          .querySelector('.sx-dhead .sx-tb[data-at="facts"]')!
          .getBoundingClientRect();
        // Each row of cells reaches the block's far edge, as a drawing's title block draws them.
        const rows = new Map<number, number>();
        for (const cell of document.querySelectorAll('.sx-dhead .sx-dfacts > .sx-tb__cell')) {
          const box = cell.getBoundingClientRect();
          const top = Math.round(box.top);
          rows.set(top, Math.max(rows.get(top) ?? 0, box.right));
        }
        const inner =
          block.right -
          Number.parseFloat(
            getComputedStyle(document.querySelector('.sx-dhead .sx-dfacts')!).borderRightWidth,
          );
        return {
          ledeBottom: lede.bottom,
          blockTop: block.top,
          short: [...rows.values()].filter((right) => right < inner - 1).length,
        };
      });
      expect(geometry.short, `${viewport.width}: rows short of the block's edge`).toBe(0);
      expect(geometry.blockTop, `${viewport.width}`).toBeGreaterThanOrEqual(
        geometry.ledeBottom - 1,
      );
      await page
        .locator('.sx-dhead')
        .screenshot({ path: testInfo.outputPath(`case-head-${viewport.width}.png`) });
    }
  },
);
