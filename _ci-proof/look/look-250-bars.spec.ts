// Look shots for one CI proof (laid in by the proof kit, never in a head's tree): Horizontal
// Cinema on the mixed contract fixture (Arabic, right to left): at 1440 by 900 with the strip live,
// the scrubber's position; at 390 by 844, the first bar Next link that names a scene. Each clipped to
// its box plus 12 px, with its text and, for the link, the left edges of "Next:" and of the name.
// Out: $PROOF_LOOK_OUT/status.png, status.json, next.png and next.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

const FIXTURE = contractFixture('mixed');
const DIR = path.dirname(FIXTURE.files.portfolio);

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

async function shoot(page: Page, locator: Locator, file: string, w: number, h: number) {
  const b = (await locator.boundingBox())!;
  const x = Math.max(0, b.x - 12);
  const y = Math.max(0, b.y - 12);
  await page.screenshot({
    path: file,
    clip: {
      x,
      y,
      width: Math.min(w - x, b.width + 24),
      height: Math.min(h - y, b.height + 24),
    },
    animations: 'disabled',
    caret: 'hide',
  });
}

/** The first bar link that says "Next:" on its own before a scene's name, marked for its shot. */
const markNext = (page: Page) =>
  page.evaluate(() => {
    for (const link of document.querySelectorAll('.hc-bar__next')) {
      const lead = [...link.querySelectorAll('span')].find(
        (s) => s.textContent?.trim() === 'Next:',
      );
      if (!lead) continue;
      link.setAttribute('data-look', 'next');
      link.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const range = document.createRange();
      range.setStartAfter(lead);
      range.setEnd(lead.parentNode!, lead.parentNode!.childNodes.length);
      return {
        next: link.textContent?.trim() ?? null,
        dir: getComputedStyle(link).direction,
        leadLeft: Math.round(lead.getBoundingClientRect().left),
        nameLeft: Math.round(range.getBoundingClientRect().left),
      };
    }
    return null;
  });

test.describe('1440', () => {
  test('look 1440 mixed: the position', async ({ page }) => {
    const out = process.env.PROOF_LOOK_OUT ?? '';
    expect(out, 'PROOF_LOOK_OUT').not.toBe('');
    mkdirSync(out, { recursive: true });
    await page.goto('/', { waitUntil: 'load' });
    await expect(page.locator('.hc-scrub[data-live]')).toHaveCount(1);
    await page.evaluate(() => document.fonts.ready);
    const status = page.locator('.hc-scrub__status');
    const text = await status.evaluate((el) => el.textContent?.trim() ?? null);
    writeFileSync(path.join(out, 'status.json'), `${JSON.stringify({ status: text }, null, 2)}\n`);
    await shoot(page, status, path.join(out, 'status.png'), 1440, 900);
  });
});

test.describe('390', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('look 390 mixed: a bar Next before a scene name', async ({ page }) => {
    const out = process.env.PROOF_LOOK_OUT ?? '';
    expect(out, 'PROOF_LOOK_OUT').not.toBe('');
    mkdirSync(out, { recursive: true });
    await page.goto('/', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const read = await markNext(page);
    expect(read, 'a bar Next before a scene name').not.toBeNull();
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    writeFileSync(path.join(out, 'next.json'), `${JSON.stringify(read, null, 2)}\n`);
    await shoot(page, page.locator('[data-look="next"]'), path.join(out, 'next.png'), 390, 844);
  });
});
