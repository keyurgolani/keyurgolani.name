import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { optionalFaces, pinFaces } from '../harness/optional-faces';

// Editorial Evidence at 390 on one tuple, PROOF_LOOK_TUPLE (language/scheme/typography/mode): the
// works list whose rows end in a plate link, at rest, with each row's box, and the chapter bar
// with its last link, Contact, focused from the keyboard, with the ring's box against the bar's.
// Optional faces are pinned to the designed ones. Each shot and reading goes to PROOF_LOOK_OUT.
// One appOptions a file run.

const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const TUPLE = process.env.PROOF_LOOK_TUPLE ?? 'retro-web/sunset-ember/technical-sans-mono/dark';
const [LANGUAGE, SCHEME, TYPOGRAPHY, MODE] = TUPLE.split('/') as [string, string, string, string];
const LABEL = TUPLE.replaceAll('/', '-');

test.use({
  viewport: { width: 390, height: 844 },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'editorial-evidence')
      .replace(/designLanguage: .*/, `designLanguage: ${LANGUAGE}`)
      .replace(/colorScheme: .*/, `colorScheme: ${SCHEME}`)
      .replace(/typography: .*/, `typography: ${TYPOGRAPHY}`)
      .replace(/displayMode: .*/, `displayMode: ${MODE}`),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

const round = (v: number) => Math.round(v * 10) / 10;

async function open(page: Page) {
  await pinFaces(page, await optionalFaces(page), 'designed');
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await frames(page);
}

test(`the works list's rows with their plate links at 390 on ${TUPLE}`, async ({ page }) => {
  await open(page);
  const plate = page.locator('.ee-row__end > a').first();
  await expect(plate).toHaveCount(1);
  const rows = plate.locator('xpath=ancestor::*[contains(@class, "ee-rows")][1]');
  await rows.scrollIntoViewIfNeeded();
  await frames(page);
  mkdirSync(OUT, { recursive: true });
  await rows.screenshot({
    path: path.join(OUT, `rows-${LABEL}.png`),
    animations: 'disabled',
    caret: 'hide',
  });
  const read = await rows.evaluate((list) =>
    [...list.querySelectorAll(':scope > .ee-row')].map((row) => {
      const box = row.getBoundingClientRect();
      const end = row.querySelector('.ee-row__end > a')?.getBoundingClientRect();
      return {
        height: box.height,
        end: end ? [end.width, end.height] : null,
      };
    }),
  );
  writeFileSync(
    path.join(OUT, `rows-${LABEL}.json`),
    `${JSON.stringify(read.map(({ height, end }) => ({ height: round(height), end: end?.map(round) ?? null })))}\n`,
  );
});

test(`the chapter bar at 390 on ${TUPLE}, its last link focused`, async ({ page }) => {
  await open(page);
  const bar = page.locator('.ee-rail');
  const last = page.locator('.ee-rail__link').last();
  await page.keyboard.press('Shift');
  await last.focus();
  await frames(page);
  mkdirSync(OUT, { recursive: true });
  await bar.screenshot({
    path: path.join(OUT, `bar-${LABEL}.png`),
    animations: 'disabled',
    caret: 'hide',
  });
  const read = await last.evaluate((link) => {
    const style = getComputedStyle(link);
    const reach =
      Number.parseFloat(style.outlineWidth) + Math.max(0, Number.parseFloat(style.outlineOffset));
    const box = link.getBoundingClientRect();
    const list = link.closest('.ee-rail__list')!.getBoundingClientRect();
    return {
      text: (link.textContent ?? '').trim(),
      ringRight: box.right + reach,
      listRight: list.right,
      clear: list.right - (box.right + reach),
    };
  });
  writeFileSync(
    path.join(OUT, `bar-${LABEL}.json`),
    `${JSON.stringify({ ...read, ringRight: round(read.ringRight), listRight: round(read.listRight), clear: round(read.clear) })}\n`,
  );
});
