// Look shots for one CI proof (laid in by the proof kit, never in a head's tree): Raw Grid's home
// on the complete contract fixture at 1024 by 768, once hydrated, in the high-contrast display mode
// and under forced colors: the ticker across the top, clipped to its box plus 16 px, and beside it
// its state, whether its Pause motion shows, and its box.
// Out: $PROOF_LOOK_OUT/<row>-ticker.png and <row>-ticker.json, row = high-contrast | forced.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'raw-grid'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1024, height: 768 },
  contextOptions: { reducedMotion: 'no-preference' },
});

const ROWS = {
  'high-contrast': {
    mode: 'high-contrast',
    media: { contrast: 'no-preference', forcedColors: 'none' },
  },
  forced: {
    mode: 'light',
    media: { contrast: 'no-preference', forcedColors: 'active' },
  },
} as const;

for (const [row, { mode, media }] of Object.entries(ROWS)) {
  test(`look 1024 ${row}: the ticker and its Pause motion`, async ({ page, app }) => {
    const out = process.env.PROOF_LOOK_OUT ?? '';
    expect(out, 'PROOF_LOOK_OUT').not.toBe('');
    mkdirSync(out, { recursive: true });
    await page.context().addCookies([
      {
        name: 'portfolio_appearance',
        value: new URLSearchParams({
          scheme: 'warm-parchment',
          mode,
        }).toString(),
        url: app.origin,
      },
    ]);
    await page.emulateMedia(media);
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    // Hydrated: the client has taken the Index over as it starts the ticker; two frames on.
    await expect(page.locator('[data-rg-index][aria-expanded]').first()).toBeAttached();
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const ticker = page.locator('.rg-ticker');
    const read = await ticker.evaluate((el) => {
      const pause = el.querySelector<HTMLElement>('.rg-ticker__toggle');
      const box = el.getBoundingClientRect();
      return {
        state: el.getAttribute('data-ticker'),
        pause: pause
          ? getComputedStyle(pause).display !== 'none' && pause.offsetParent !== null
          : false,
        box: `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`,
      };
    });
    writeFileSync(path.join(out, `${row}-ticker.json`), `${JSON.stringify(read, null, 2)}\n`);
    const b = (await ticker.boundingBox())!;
    const x = Math.max(0, b.x - 16);
    const y = Math.max(0, b.y - 16);
    await page.screenshot({
      path: path.join(out, `${row}-ticker.png`),
      clip: {
        x,
        y,
        width: Math.min(1024 - x, b.width + 32),
        height: Math.min(768 - y, b.height + 32),
      },
      animations: 'disabled',
      caret: 'hide',
    });
  });
}
