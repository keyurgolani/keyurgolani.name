// Look shots for one CI proof (laid in by the proof kit, never in a head's tree): Horizontal Cinema on
// the academic contract fixture as a phone at 320 by 568. A work page's scene map with the root text
// at 200% and at 100%, and the home's credits head at 200%. Each shot is clipped to the window's
// width around its element, with the page's scroll width, the element's box and everything past the
// window (with its parent's layout) beside it.
// Out: $PROOF_LOOK_OUT/<row>.png and <row>.json, row = map-200 | map-100 | credits-200.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

const FIXTURE = contractFixture('academic');
const DIR = path.dirname(FIXTURE.files.portfolio);
const WORK = '/work/canopy-drought-memory';

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

const ROWS = [
  { row: 'map-200', route: WORK, size: '200%', selector: '.hc-board__map' },
  { row: 'map-100', route: WORK, size: '100%', selector: '.hc-board__map' },
  { row: 'credits-200', route: '/', size: '200%', selector: '.hc-credits__head' },
] as const;

for (const { row, route, size, selector } of ROWS) {
  test(`look 320 ${row}`, async ({ page }) => {
    const out = process.env.PROOF_LOOK_OUT ?? '';
    expect(out, 'PROOF_LOOK_OUT').not.toBe('');
    mkdirSync(out, { recursive: true });
    await page.goto(route, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
      (value) => document.documentElement.style.setProperty('font-size', value, 'important'),
      size,
    );
    await frames(page);
    await page.waitForTimeout(250);
    await frames(page);
    const target = page.locator(selector).first();
    await target.scrollIntoViewIfNeeded();
    await frames(page);
    const read = await target.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return {
        scroll: document.documentElement.scrollWidth,
        window: document.documentElement.clientWidth,
        box: [box.left, box.right, box.top, box.height].map((n) => Math.round(n)),
        text: (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(0, 120),
        // Everything in the page past the window, with its parent's layout, widest first.
        past: [...document.body.querySelectorAll('*')]
          .map((each) => ({ each, right: each.getBoundingClientRect().right }))
          .filter(({ right }) => right > document.documentElement.clientWidth + 1)
          .sort((a, b) => b.right - a.right)
          .slice(0, 30)
          .map(({ each, right }) => {
            const up = each.parentElement!;
            const css = getComputedStyle(up);
            const name = (n: Element) =>
              `${n.localName}${n.id ? `#${n.id}` : ''}${[...n.classList]
                .slice(0, 2)
                .map((c) => `.${c}`)
                .join('')}`;
            return {
              at: name(each),
              right: Math.round(right),
              width: Math.round(each.getBoundingClientRect().width),
              parent: `${name(up)} ${css.display} w ${Math.round(up.getBoundingClientRect().width)} gtc ${css.gridTemplateColumns}`,
            };
          }),
      };
    });
    writeFileSync(path.join(out, `${row}.json`), `${JSON.stringify(read, null, 2)}\n`);
    const b = (await target.boundingBox())!;
    const y = Math.max(0, b.y - 12);
    await page.screenshot({
      path: path.join(out, `${row}.png`),
      clip: { x: 0, y, width: 320, height: Math.min(568 - y, b.height + 24) },
      animations: 'disabled',
      caret: 'hide',
    });
  });
}
