// The proof look: Mission Control's home at 320
// at 100% and 200% root text, the Latest panel's title bar and the readouts, each as shown. Shots and
// readings go to PROOF_LOOK_OUT. One appOptions a file.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { test } from '../harness/fixtures';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';
test.use({
  viewport: { width: 320, height: 568 },
  isMobile: true,
  hasTouch: true,
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'mission-control')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((f) => [f, readFileSync(path.join(DIR, f), 'utf8')]),
    ),
  },
});
for (const size of ['100%', '200%']) {
  test(`mission control home 320 text ${size}: latest bar and readouts`, async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
      (s) => document.documentElement.style.setProperty('font-size', s, 'important'),
      size,
    );
    await page.evaluate(
      () => new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(d))),
    );
    const tag = size.replace('%', '');
    await page
      .locator('.mc-latest > .mc-bar')
      .screenshot({ path: `${OUT}/latest-bar-${tag}.png`, animations: 'disabled' });
    await page
      .locator('.mc-readouts')
      .first()
      .screenshot({ path: `${OUT}/readouts-${tag}.png`, animations: 'disabled' });
    const box = await page.evaluate(() => {
      const r = (s: string) => {
        const b = document.querySelector(s)?.getBoundingClientRect();
        return b
          ? [
              Math.round(b.left * 10) / 10,
              Math.round(b.right * 10) / 10,
              Math.round(b.height * 10) / 10,
            ]
          : null;
      };
      return {
        scroll: document.documentElement.scrollWidth,
        bar: r('.mc-latest > .mc-bar'),
        count: r('.mc-latest .mc-count'),
        readouts: r('.mc-readouts'),
        num: r('.mc-readout__figure .mc-num'),
      };
    });
    console.log(`look ${tag}: ${JSON.stringify(box)}`);
  });
}
