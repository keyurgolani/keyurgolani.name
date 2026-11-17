import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Editorial Evidence with the root text at 200% on a phone (390 and 320): the page doesn't scroll
// sideways, on home or on a case. Set as the quality cells' root-text condition sets it
// (conditions.ts: the root's font-size at 200%, important), on the release tuple, Platform Neutral
// on Warm Parchment in Humanist UI. Each failure names the boxes that run past the window's right
// edge, the outermost of each run.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'editorial-evidence')
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
        `with the root text at 200% at ${width}, ${name} doesn't scroll sideways`,
        { annotation: [{ type: 'route', description: route }] },
        async ({ page }) => {
          await page.goto(route, { waitUntil: 'networkidle' });
          await page.evaluate(() =>
            document.documentElement.style.setProperty('font-size', '200%', 'important'),
          );
          await page.evaluate(
            () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
          );
          const read = await page.evaluate(() => {
            const html = document.documentElement;
            const room = html.clientWidth + 0.5;
            const name = (el: Element) =>
              `${el.localName}${[...el.classList].map((c) => `.${c}`).join('')}`;
            // Each box past the right edge whose parent isn't: where a run past the edge starts.
            const past = [...document.body.querySelectorAll('*')]
              .filter((el) => el.getClientRects().length > 0)
              .map((el) => ({ el, r: el.getBoundingClientRect() }))
              .filter(({ el, r }) => {
                if (r.right <= room || r.width === 0) return false;
                const up = el.parentElement;
                return !up || up === document.body || up.getBoundingClientRect().right <= room;
              })
              .slice(0, 8)
              .map(({ el, r }) => `${name(el)} ${r.left.toFixed(1)}..${r.right.toFixed(1)}`);
            return { scroll: html.scrollWidth, client: html.clientWidth, past };
          });
          expect(
            read.scroll,
            `the page is no wider than the screen; past its edge: ${read.past.join('; ')}`,
          ).toBeLessThanOrEqual(read.client);
        },
      );
  });
