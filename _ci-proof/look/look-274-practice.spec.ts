// Look shots for one CI proof (laid in by the proof kit, never in a head's tree): Horizontal Cinema's
// home on the engineering contract fixture as a phone at 320 by 568, every record section open, with
// the root text at 200% and at 100%: the practice, its rows of skills under each name,
// clipped to the window around it, with the window's width and the furthest right edge inside it.
// Out: $PROOF_LOOK_OUT/<row>.png and <row>.json, row = 200 | 100.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

const FIXTURE = contractFixture('engineering');
const DIR = path.dirname(FIXTURE.files.portfolio);
const TARGET = '.hc-record .hc-section[data-family=practice]';

test.use({
  viewport: { width: 320, height: 568 },
  isMobile: true,
  hasTouch: true,
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

for (const size of ['200', '100'] as const) {
  test(`look 320 practice at ${size}%`, async ({ page }) => {
    const out = process.env.PROOF_LOOK_OUT ?? '';
    expect(out, 'PROOF_LOOK_OUT').not.toBe('');
    mkdirSync(out, { recursive: true });
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
      (value) => document.documentElement.style.setProperty('font-size', value, 'important'),
      `${size}%`,
    );
    await page.evaluate(() => {
      for (const details of document.querySelectorAll<HTMLDetailsElement>('details[data-record]'))
        details.open = true;
    });
    await frames(page);
    await page.waitForTimeout(250);
    await frames(page);
    const target = page.locator(TARGET).first();
    await target.scrollIntoViewIfNeeded();
    await frames(page);
    const read = await target.evaluate((el) => {
      const box = el.getBoundingClientRect();
      let right = 0;
      for (const each of el.querySelectorAll('*')) {
        const r = each.getBoundingClientRect();
        if (r.width > 0) right = Math.max(right, r.right);
      }
      return {
        window: document.documentElement.clientWidth,
        box: [box.left, box.right, box.top, box.height].map((n) => Math.round(n)),
        furthest: Math.round(right),
      };
    });
    writeFileSync(path.join(out, `${size}.json`), `${JSON.stringify(read, null, 2)}\n`);
    const b = (await target.boundingBox())!;
    const y = Math.max(0, b.y - 12);
    await page.screenshot({
      path: path.join(out, `${size}.png`),
      clip: { x: 0, y, width: 320, height: Math.min(568 - y, b.height + 24) },
      animations: 'disabled',
      caret: 'hide',
    });
  });
}
