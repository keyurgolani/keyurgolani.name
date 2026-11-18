import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Flux at 320 with the root text at 200%, where its Index is taller than the window and
// scrolls: scrolled to its end, a further turn of the wheel over it stays in it, and the page
// behind doesn't move. On the complete contract fixture, in its own tuple.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  viewport: { width: 320, height: 568 },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'flux'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

test(`at 320 with the root text at 200%, the open Index scrolled to its end keeps a wheel turn from scrolling the page behind`, async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() =>
    document.documentElement.style.setProperty('font-size', '200%', 'important'),
  );
  const opener = page.locator(`[data-fx-open-index]`).first();
  // The enhancement has taken the opener over once it says whether it's open.
  await expect(opener).toHaveAttribute('aria-expanded', 'false');
  await opener.evaluate((el) => (el as HTMLElement).click());
  const scroller = page.locator(`.fx-index`);
  await expect(scroller).toBeVisible();
  const box = await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    const r = el.getBoundingClientRect();
    return {
      scrolls: el.scrollHeight > el.clientHeight,
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
    };
  });
  expect(box.scrolls, 'the open Index scrolls').toBe(true);
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.move(box.x, box.y);
  await page.mouse.wheel(0, 600);
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => window.scrollY);
  console.log(`Flux Index at its end, wheel 600: page y ${before} -> ${after}`);
  expect(after, 'the page behind stays where it was').toBe(before);
});
