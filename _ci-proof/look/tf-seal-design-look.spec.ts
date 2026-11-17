// The look: Terra Field's home on the design contract fixture at 320, with the root text at 200% and
// at its own size: a shot of the seal and the arc around it, and the seal's box, its label's box and
// the page's width. Shots and readings go to PROOF_LOOK_OUT. One appOptions a file.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { test } from '../harness/fixtures';

const FIXTURE = contractFixture('design');
const DIR = path.dirname(FIXTURE.files.portfolio);
const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';

test.use({
  viewport: { width: 320, height: 568 },
  isMobile: true,
  hasTouch: true,
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'terra-field'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

for (const size of ['100%', '200%']) {
  test(`terra field design home at 320, text ${size}: the seal`, async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
      (to) => document.documentElement.style.setProperty('font-size', to, 'important'),
      size,
    );
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const seal = page.locator('.tf-seal').first();
    await seal.scrollIntoViewIfNeeded();
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const read = await page.evaluate(() => {
      const box = (el: Element | null) => {
        const r = el?.getBoundingClientRect();
        return r ? [r.left, r.right, r.top, r.bottom].map((v) => Math.round(v * 10) / 10) : null;
      };
      const s = document.querySelector('.tf-seal');
      return {
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
        seal: box(s),
        label: box(s?.querySelector('.tf-seal__label') ?? null),
        value: box(s?.querySelector('.tf-seal__value') ?? null),
        text: (s?.textContent ?? '').trim(),
      };
    });
    const tag = size.replace('%', '');
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, `seal-design-${tag}.json`), JSON.stringify(read, null, 1));
    console.log(`seal design ${size}: ${JSON.stringify(read)}`);
    const b = (await seal.boundingBox())!;
    const pad = 24;
    await page.screenshot({
      path: path.join(OUT, `seal-design-${tag}.png`),
      animations: 'disabled',
      clip: {
        x: 0,
        y: Math.max(0, b.y - pad),
        width: 320,
        height: Math.min(568, b.height + 2 * pad),
      },
    });
  });
}
