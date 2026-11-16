import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { optionalFaces, pinFaces } from '../harness/optional-faces';

// Mission Control's Overview readouts at 1024 with 100% and 200% root text in one type pack, PROOF_LOOK_PACK, on its
// language, scheme and mode (PROOF_LOOK_LANGUAGE, PROOF_LOOK_SCHEME, PROOF_LOOK_MODE): the readouts panel and its
// first square, its optional faces pinned to the designed ones. The root text is set as the quality
// runner sets it, once the fonts are in.
// Each shot goes to PROOF_LOOK_OUT. One appOptions a file run.

const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const LANGUAGE = process.env.PROOF_LOOK_LANGUAGE ?? 'art-deco';
const TYPOGRAPHY = process.env.PROOF_LOOK_PACK ?? 'swiss-grotesque';
const MODE = process.env.PROOF_LOOK_MODE ?? 'dark';
const SCHEME = process.env.PROOF_LOOK_SCHEME ?? 'graphite';

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'mission-control')
      .replace(/designLanguage: .*/, `designLanguage: ${LANGUAGE}`)
      .replace(/typography: .*/, `typography: ${TYPOGRAPHY}`)
      .replace(/displayMode: .*/, `displayMode: ${MODE}`),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const settle = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

async function visit(page: Page, origin: string, scheme: string, mode: string) {
  await page.context().addCookies([
    {
      name: 'portfolio_appearance',
      value: new URLSearchParams({ scheme, mode }).toString(),
      url: origin,
    },
  ]);
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[data-display-mode]').first()).toHaveAttribute(
    'data-display-mode',
    mode,
  );
  await settle(page);
}

async function shoot(target: Locator, name: string) {
  mkdirSync(OUT, { recursive: true });
  await target.screenshot({
    path: path.join(OUT, `${name}.png`),
    animations: 'disabled',
    caret: 'hide',
  });
}

test.use({ viewport: { width: 1024, height: 768 } });
for (const scale of [1, 2]) {
  test(`Mission Control's readouts in ${TYPOGRAPHY} at 1024 with ${scale * 100}% root text`, async ({
    page,
    app,
  }) => {
    // A pack's optional faces in their designed state, as the quality cells pin them.
    await pinFaces(page, await optionalFaces(page), 'designed');
    await visit(page, app.origin, SCHEME, MODE);
    await page.evaluate(
      (scale) =>
        document.documentElement.style.setProperty('font-size', `${scale * 100}%`, 'important'),
      scale,
    );
    await settle(page);
    await shoot(page.locator('.mc-readouts'), `readouts-${TYPOGRAPHY}-1024-${scale * 100}-panel`);
    await shoot(
      page.locator('.mc-readout').first(),
      `readouts-${TYPOGRAPHY}-1024-${scale * 100}-first`,
    );
  });
}
