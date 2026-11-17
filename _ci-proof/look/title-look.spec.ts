import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { test } from '../harness/fixtures';

// A look, run from tests/e2e at the base and at the head: Kinetic Cosmos's project page on one
// fixture (PROOF_LOOK_FIXTURE, its page PROOF_LOOK_ROUTE), the case stage shot at 1024 and 1440,
// with the root text at 100% and at 200%, to PROOF_LOOK_OUT.

const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';
const NAME = process.env.PROOF_LOOK_FIXTURE ?? 'complete';
const ROUTE = process.env.PROOF_LOOK_ROUTE ?? '/work/project-name';
const FIXTURE = contractFixture(NAME);
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'kinetic-cosmos'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

test(`title look ${NAME}`, async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(OUT, { recursive: true });
  for (const width of [1024, 1440]) {
    for (const text of [100, 200]) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(ROUTE, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready.then(() => true));
      await page.evaluate(
        (size) => document.documentElement.style.setProperty('font-size', `${size}%`, 'important'),
        text,
      );
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      const stage = page.locator('.kc-case-stage').first();
      await page.screenshot({
        path: path.join(OUT, `${NAME}-${width}-${text}.png`),
        clip: (await stage.boundingBox()) ?? { x: 0, y: 0, width, height: 900 },
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
      });
    }
  }
});
