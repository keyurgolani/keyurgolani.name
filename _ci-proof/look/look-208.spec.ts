// Look shots for the skip link's CI proof (laid in by the proof kit at the base and the head): the
// host's skip link focused by the page's first Tab, in each of the seven first-party compositions
// whose own link colour took its text, at 1440 in light and at 390 on phone emulation in dark, on the
// complete contract fixture's home in each composition's default packs, the mode by the appearance
// cookie. Self-contained: it imports only the harness and the contract fixtures.
// Out: $PROOF_LOOK_OUT/<composition>-<width>-<mode>.png, the link and 24 px round it.
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type BrowserContext } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const COMPOSITIONS = [
  'flux',
  'mission-control',
  'obsidian-atelier',
  'raw-grid',
  'schematic',
  'swiss-signal',
  'terra-field',
];

type App = Awaited<ReturnType<typeof startApp>>;

for (const composition of COMPOSITIONS) {
  test.describe(composition, () => {
    test.describe.configure({ mode: 'default' });
    let app: App;
    test.beforeAll(async () => {
      test.setTimeout(120_000);
      app = await startApp({
        portfolio: FIXTURE.files.portfolio,
        siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), composition),
        sourceFiles: Object.fromEntries(
          FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
        ),
        logFile: test.info().outputPath('server.log'),
      });
    });
    test.afterAll(async () => {
      await app?.stop();
    });
    const guard = (context: BrowserContext) =>
      context.route('**/*', (route) =>
        new URL(route.request().url()).origin === app.origin
          ? route.continue()
          : route.abort('blockedbyclient'),
      );
    test(`look ${composition}`, async ({ browser }) => {
      const out = process.env.PROOF_LOOK_OUT ?? '';
      expect(out, 'PROOF_LOOK_OUT').not.toBe('');
      mkdirSync(out, { recursive: true });
      for (const [width, height, mode, phone] of [
        [1440, 900, 'light', false],
        [390, 844, 'dark', true],
      ] as const) {
        const context = await browser.newContext({
          viewport: { width, height },
          ...(phone ? { isMobile: true, hasTouch: true } : {}),
        });
        await guard(context);
        await context.addCookies([
          {
            name: 'portfolio_appearance',
            value: new URLSearchParams({ mode }).toString(),
            url: app.origin,
          },
        ]);
        const page = await context.newPage();
        await page.goto(`${app.origin}/`, { waitUntil: 'networkidle' });
        await expect(page.locator('[data-display-mode]').first()).toHaveAttribute(
          'data-display-mode',
          mode,
        );
        await page.evaluate(() => document.fonts.ready);
        const skip = page.locator('[data-ui-slot="skip-link"]').first();
        await page.keyboard.press('Tab');
        await expect(skip).toBeFocused();
        await page.evaluate(
          () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
        );
        const box = (await skip.boundingBox())!;
        const x = Math.max(0, box.x - 24);
        const y = Math.max(0, box.y - 24);
        await page.screenshot({
          path: path.join(out, `${composition}-${width}-${mode}.png`),
          clip: {
            x,
            y,
            width: Math.min(width - x, box.width + 48),
            height: Math.min(height - y, box.height + 48),
          },
          animations: 'disabled',
          caret: 'hide',
        });
        await context.close();
      }
    });
  });
}
