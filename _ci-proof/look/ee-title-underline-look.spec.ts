import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { optionalFaces, pinFaces } from '../harness/optional-faces';
import { decodePng } from '../quality/lib/pixels';

// Editorial Evidence's next work's title link on a work's page at 1440, in one typography,
// PROOF_LOOK_TYPO, on Platform Neutral and Warm Parchment, by default, under more contrast and
// under forced colours: the link at rest and focused from the keyboard, and where its underline
// runs against the link's own box (the rows that change when the underline is taken away), so a
// look can see the underline inside the box and clear of the ring. Optional faces are pinned to
// the designed ones. Each shot and reading goes to PROOF_LOOK_OUT. One appOptions a file run.

const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const TYPO = process.env.PROOF_LOOK_TYPO ?? 'accessible-reading';
const ROUTE = '/work/project-name';
const LINK = '.ee-case__next-title a';
const ROWS = {
  default: { forcedColors: 'none', contrast: 'no-preference' },
  'contrast-more': { forcedColors: 'none', contrast: 'more' },
  'forced-colors': { forcedColors: 'active', contrast: 'no-preference' },
} as const;

test.use({
  viewport: { width: 1440, height: 900 },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'editorial-evidence')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, `typography: ${TYPO}`)
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

for (const [row, media] of Object.entries(ROWS)) {
  test(`the next work's title link in ${TYPO} at 1440, ${row}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light', ...media });
    await pinFaces(page, await optionalFaces(page, ROUTE), 'designed');
    await page.goto(ROUTE, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const link = page.locator(LINK);
    await expect(link).toHaveCount(1);
    await link.scrollIntoViewIfNeeded();
    await frames(page);
    const read = await link.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        box: [box.left, box.top, box.right, box.bottom].map((v) => Math.round(v * 10) / 10),
        offset: style.textUnderlineOffset,
        ring: `${style.outlineWidth} ${style.outlineOffset}`,
      };
    });
    const [left, top, right, bottom] = read.box as [number, number, number, number];
    const clip = {
      x: Math.floor(left) - 12,
      y: Math.floor(top) - 12,
      width: Math.ceil(right - left) + 24,
      height: Math.ceil(bottom - top) + 24,
    };
    mkdirSync(OUT, { recursive: true });
    const name = `title-${TYPO}-${row}`;
    const rest = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
    writeFileSync(path.join(OUT, `${name}-rest.png`), rest);
    // The underline's rows: what changes when it's taken away, at rest.
    await page.addStyleTag({
      content: `[data-variant] ${LINK} { text-decoration-line: none !important; }`,
    });
    await frames(page);
    const bare = decodePng(await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }));
    const shot = decodePng(rest);
    const rows: number[] = [];
    for (let y = 0; y < shot.height; y++) {
      let changed = 0;
      for (let x = 0; x < shot.width; x++) {
        const i = (y * shot.width + x) * 4;
        const d =
          Math.abs(shot.data[i]! - bare.data[i]!) +
          Math.abs(shot.data[i + 1]! - bare.data[i + 1]!) +
          Math.abs(shot.data[i + 2]! - bare.data[i + 2]!);
        if (d > 30) changed++;
      }
      if (changed > (right - left) / 4) rows.push(clip.y + y);
    }
    await page.evaluate(() =>
      document.querySelectorAll('style').forEach((tag) => {
        if (tag.textContent?.includes('text-decoration-line: none !important')) tag.remove();
      }),
    );
    await frames(page);
    await page.keyboard.press('Shift');
    await link.focus();
    await frames(page);
    await page.screenshot({
      clip,
      path: path.join(OUT, `${name}-focused.png`),
      animations: 'disabled',
      caret: 'hide',
    });
    const underline = rows.length > 0 ? [Math.min(...rows), Math.max(...rows) + 1] : null;
    writeFileSync(
      path.join(OUT, `${name}.json`),
      `${JSON.stringify({
        ...read,
        underline,
        belowBox: underline ? Math.round((underline[1]! - bottom) * 10) / 10 : null,
      })}\n`,
    );
  });
}
