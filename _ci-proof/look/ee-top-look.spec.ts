import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { optionalFaces, pinFaces } from '../harness/optional-faces';

// Editorial Evidence's home page at 1440 on Art Deco, Blue Orange Color Safe, Drafting Grotesk,
// high contrast, by default and under more contrast: the window at the top on arrival, and again
// after a jump to the fourth chapter and straight back, with what the running head and the
// chapter index say each time. Optional faces are pinned to the designed ones. Each shot and
// reading goes to PROOF_LOOK_OUT. One appOptions a file run.

const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  viewport: { width: 1440, height: 900 },
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

const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 300))),
      ),
  );

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

for (const contrast of ['no-preference', 'more'] as const) {
  const row = contrast === 'more' ? 'contrast-more' : 'default';
  test(`the top of the home page at 1440, ${row}, on arrival and back from the fourth chapter`, async ({
    page,
  }) => {
    await page.emulateMedia({ contrast });
    await pinFaces(page, await optionalFaces(page), 'designed');
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await settle(page);
    mkdirSync(OUT, { recursive: true });
    const arrival = await reading(page);
    await page.screenshot({
      path: path.join(OUT, `top-${row}-arrival.png`),
      animations: 'disabled',
      caret: 'hide',
    });
    const chapter = page.locator('[data-ee-chapter="4"] .ee-chapter__open');
    await expect(chapter).toHaveCount(1);
    await chapter.evaluate((opener) => {
      const spy = document.querySelector<HTMLElement>('.ee-spy');
      const line = Math.ceil(Number.parseFloat(getComputedStyle(spy!).paddingBlockStart) || 0);
      window.scrollTo(0, scrollY + opener.getBoundingClientRect().top - line + 8);
    });
    await settle(page);
    const deep = await reading(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page);
    const back = await reading(page);
    await page.screenshot({
      path: path.join(OUT, `top-${row}-back.png`),
      animations: 'disabled',
      caret: 'hide',
    });
    writeFileSync(
      path.join(OUT, `top-${row}.json`),
      `${JSON.stringify({ arrival, deep, back })}\n`,
    );
  });
}
