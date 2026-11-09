import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Row 127, Swiss Signal: with the root text at 200% at 320 the masthead wraps, the Index under the name, and
// the name sat against the masthead's top and the Index against its rule (D's look packet on fec718095): the
// row had a height to centre one row in, and no padding. The coordinator's ruling: wrapped, the space above
// the name is the space below the Index, and both are the one-row masthead's (its row's space above and
// below the Index button, read at 390 at the same root size). One language a file: each is a server of its
// own.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  viewport: { width: 320, height: 568 },
  isMobile: true,
  hasTouch: true,
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'swiss-signal')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const read = () => {
  const mast = document.querySelector('.ss-masthead')!;
  const box = mast.getBoundingClientRect();
  const rule = box.bottom - parseFloat(getComputedStyle(mast).borderBottomWidth);
  const name = document.querySelector('.ss-masthead__name')!.getBoundingClientRect();
  const button = document.querySelector('.ss-index__button')!.getBoundingClientRect();
  return {
    wrapped: button.top >= name.bottom - 0.5,
    aboveName: name.top - box.top,
    belowIndex: rule - button.bottom,
    aboveButton: button.top - box.top,
  };
};

const settle = (page: import('@playwright/test').Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

test(
  "with the root text at 200% at 320, the wrapped masthead keeps the one-row masthead's space above the name and below the Index",
  { annotation: [{ type: 'route', description: '/' }] },
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('.ss')).toHaveAttribute('data-ss-live', '');
    await page.evaluate(() =>
      document.documentElement.style.setProperty('font-size', '200%', 'important'),
    );
    await settle(page);
    const one = await page.evaluate(read);
    expect(one.wrapped, 'at 390 the masthead is one row').toBe(false);
    await page.setViewportSize({ width: 320, height: 568 });
    await settle(page);
    const two = await page.evaluate(read);
    expect(two.wrapped, 'at 320 the Index wraps under the name').toBe(true);
    expect(
      Math.abs(two.aboveName - two.belowIndex),
      `the space above the name (${two.aboveName}) is the space below the Index (${two.belowIndex})`,
    ).toBeLessThanOrEqual(0.5);
    expect(
      Math.abs(two.aboveName - one.aboveButton),
      `the space above the name (${two.aboveName}) is the one-row masthead's (${one.aboveButton})`,
    ).toBeLessThanOrEqual(0.5);
  },
);
