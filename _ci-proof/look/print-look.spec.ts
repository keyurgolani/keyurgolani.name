import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { test } from '../harness/fixtures';

// A look under print, run from tests/e2e at the base and at the head: one composition
// (PROOF_LOOK_COMP) on the complete fixture at 1024, printed as a browser prints it (print media,
// a beforeprint, every disclosure open), its page's top and its foot shot to PROOF_LOOK_OUT, where
// the visitor's Appearance control sits in a header or a footer.

const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';
const COMP = process.env.PROOF_LOOK_COMP ?? 'kinetic-cosmos';
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), COMP),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

test(`print look ${COMP}`, async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' });
  const height = await page.evaluate(() => {
    window.dispatchEvent(new Event('beforeprint'));
    for (const details of document.querySelectorAll('details')) details.open = true;
    return document.documentElement.scrollHeight;
  });
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  const take = Math.min(700, height);
  for (const [name, y] of [
    ['top', 0],
    ['foot', Math.max(0, height - take)],
  ] as const) {
    await page.screenshot({
      path: path.join(OUT, `${COMP}-print-${name}.png`),
      clip: { x: 0, y, width: 1024, height: take },
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
  }
});
