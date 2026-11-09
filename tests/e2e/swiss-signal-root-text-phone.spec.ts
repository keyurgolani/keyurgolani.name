import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Row 19, Swiss Signal: with the root text at 200% on a phone (390 and 320), the page scrolls sideways to
// 432 px (E's kgn-e-rt390 read on main; D's probe on 396766013). Under 48rem Swiss's twelve-track grids keep
// eleven rem gutters, which at 200% fill a phone's width: every track comes to 0 px, and what sits on them
// runs past the right edge, the masthead's Index button on every page, the lede and press on home, the
// cited links on a case. Set as the quality cells' root-text condition sets it (conditions.ts: the root's
// font-size at 200%, important). At 200% on a phone nothing runs past the page's right edge, on home or on
// a case. One language a file: each is a server of its own.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
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

for (const [width, height] of [
  [390, 844],
  [320, 568],
] as const)
  test.describe(`at ${width}`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true });
    for (const [name, route] of [
      ['the home page', '/'],
      ['a case', '/work/project-name'],
    ] as const)
      test(
        `with the root text at 200% at ${width}, ${name} doesn't scroll sideways and the Index button stays on it`,
        { annotation: [{ type: 'route', description: route }] },
        async ({ page }) => {
          await page.goto(route, { waitUntil: 'networkidle' });
          await expect(page.locator('.ss')).toHaveAttribute('data-ss-live', '');
          await page.evaluate(() =>
            document.documentElement.style.setProperty('font-size', '200%', 'important'),
          );
          await page.evaluate(
            () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
          );
          const read = await page.evaluate(() => {
            const html = document.documentElement;
            const button = document.querySelector('.ss-index__button')!.getBoundingClientRect();
            return { scroll: html.scrollWidth, client: html.clientWidth, right: button.right };
          });
          expect(read.right, 'the Index button ends inside the page').toBeLessThanOrEqual(
            read.client + 0.5,
          );
          expect(read.scroll, 'the page is no wider than the screen').toBeLessThanOrEqual(
            read.client,
          );
        },
      );
  });
