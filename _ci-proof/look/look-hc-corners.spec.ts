// Look shots for one CI proof (laid in by the proof kit, never in a head's tree): Horizontal
// Cinema's home on the complete contract fixture in Bauhaus Geometric and Humanist UI, loaded and
// settled as the quality cells load it. The window with the first bar's Next link focused, at 1440
// in Low Stimulus Warm's dark, and at 1024 in Warm Parchment on the system's light under more
// contrast. Beside them, each scene's corner radius as drawn.
// Out: $PROOF_LOOK_OUT/1440-lsw-dark.png and 1024-wp-more.png, each with its .json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { loadForPass } from '../quality/lib/run-cell';
import { sweepSiteText } from '../quality/lib/server';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: sweepSiteText(
      fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    ),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  colorScheme: 'light',
});

async function look(page: Page, origin: string, name: string, scheme: string, mode: string) {
  const out = process.env.PROOF_LOOK_OUT ?? '';
  expect(out, 'PROOF_LOOK_OUT').not.toBe('');
  mkdirSync(out, { recursive: true });
  await page.context().addCookies([
    {
      name: 'portfolio_appearance',
      value: new URLSearchParams({
        language: 'bauhaus-geometric',
        scheme,
        type: 'humanist-ui',
        mode,
      }).toString(),
      url: origin,
    },
  ]);
  const loaded = await loadForPass(page, '/');
  expect({ settled: loaded.settled, enhanced: loaded.enhanced }).toEqual({
    settled: true,
    enhanced: true,
  });
  await page.evaluate(() => document.fonts.ready);
  // Tab to the first bar's Next link, as the walk reaches it.
  const next = page.locator('.hc-bar__next').first();
  for (let presses = 0; presses < 80; presses += 1) {
    if (await next.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  const read = await page.evaluate(() => ({
    focused: document.activeElement?.className ?? null,
    scenes: [...document.querySelectorAll('.hc-scene')].slice(0, 4).map((scene) => ({
      id: scene.id,
      radius: getComputedStyle(scene).borderTopLeftRadius,
    })),
  }));
  await page.screenshot({
    path: path.join(out, `${name}.png`),
    animations: 'disabled',
    caret: 'hide',
  });
  writeFileSync(path.join(out, `${name}.json`), `${JSON.stringify(read, null, 2)}\n`);
}

test.describe('1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('look 1440 Bauhaus Geometric, Low Stimulus Warm dark, first Next link focused', async ({
    page,
    app,
  }) => {
    test.setTimeout(120_000);
    await look(page, app.origin, '1440-lsw-dark', 'low-stimulus-warm', 'dark');
  });
});

test.describe('1024 more contrast', () => {
  test.use({ viewport: { width: 1024, height: 768 }, contextOptions: { contrast: 'more' } });
  test('look 1024 Bauhaus Geometric, Warm Parchment system, more contrast, first Next link focused', async ({
    page,
    app,
  }) => {
    test.setTimeout(120_000);
    await look(page, app.origin, '1024-wp-more', 'warm-parchment', 'system');
  });
});
