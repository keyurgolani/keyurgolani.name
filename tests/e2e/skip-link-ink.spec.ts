import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';

// The host's skip link, focused by the page's first Tab, on every first-party composition: its text
// reads at 4.5:1 or more on its own fill. The platform's focus style gives it the accent's fill and
// the ink derived for it, but a composition's own link color (`a { color: inherit }` in its sheet's
// later layer) could take the text back to the page's ink on the accent: Obsidian Atelier's read
// 1.77:1 in dark and 3.49:1 in light. At 390 on phone emulation and at 1440, in light and dark, each
// in default contrast and under more contrast, on the complete contract fixture's home in each
// composition's default packs, the visitor's mode set by the appearance cookie and guarded.
//
// Each composition needs its own site document, so each group starts its own server rather than the
// harness's one per file. The browser reaches nothing outside it, and the server nothing outside the
// machine.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const PACKAGES = fileURLToPath(new URL('../../packages/', import.meta.url));
const COMPOSITIONS = readdirSync(PACKAGES)
  .filter((name) => name.startsWith('variant-') && name !== 'variant-contract')
  .map((name) => name.slice('variant-'.length))
  .sort();

const SETTINGS = [390, 1440].flatMap((width) =>
  (['light', 'dark'] as const).flatMap((mode) =>
    (['no-preference', 'more'] as const).map((contrast) => ({ width, mode, contrast })),
  ),
);

type App = Awaited<ReturnType<typeof startApp>>;

for (const composition of COMPOSITIONS) {
  test.describe(composition, () => {
    // One server for the group's tests, in order.
    test.describe.configure({ mode: 'default' });
    let app: App;

    test.beforeAll(async () => {
      // As long as the harness gives a server to start.
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
    /** The browser reaches the server alone. */
    const guard = (context: BrowserContext) =>
      context.route('**/*', (route) =>
        new URL(route.request().url()).origin === app.origin
          ? route.continue()
          : route.abort('blockedbyclient'),
      );
    test.beforeEach(async ({ context }) => {
      await guard(context);
    });
    test.afterEach(() => {
      expect(app.egress(), 'hosts the server tried to reach').toEqual([]);
    });

    for (const { width, mode, contrast } of SETTINGS) {
      const more = contrast === 'more' ? ' under more contrast' : '';
      test(
        `${composition} at ${width} in ${mode}${more}: the focused skip link's text reads at 4.5:1 on its own fill`,
        { annotation: [{ type: 'route', description: '/' }] },
        async ({ page }) => {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
          await page.context().addCookies([
            {
              name: 'portfolio_appearance',
              value: new URLSearchParams({ mode }).toString(),
              url: app.origin,
            },
          ]);
          await page.emulateMedia({ contrast });
          await page.goto(`${app.origin}/`, { waitUntil: 'networkidle' });
          await expect(page.locator('[data-variant]').first()).toHaveAttribute(
            'data-variant',
            composition,
          );
          // The mode asked is the one shown: the boundary carries it, and dark its own color-scheme.
          const boundary = page.locator('[data-display-mode]').first();
          await expect(boundary).toHaveAttribute('data-display-mode', mode);
          if (mode === 'dark')
            expect(await boundary.evaluate((el) => getComputedStyle(el).colorScheme)).toBe('dark');
          await page.evaluate(() => document.fonts.ready);
          const skip = page.locator('[data-ui-slot="skip-link"]').first();
          await expect(skip).toHaveCount(1);
          await page.keyboard.press('Tab');
          await expect(skip).toBeFocused();
          await page.evaluate(
            () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
          );
          // Its text's color and its fill (the nearest opaque box, itself first), as sRGB through a
          // canvas, so any color syntax the cascade computes reads the same, and their contrast.
          const read = await skip.evaluate((el) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
            const rgba = (c: string) => {
              ctx.clearRect(0, 0, 1, 1);
              ctx.fillStyle = '#000';
              ctx.fillStyle = c;
              ctx.fillRect(0, 0, 1, 1);
              const d = ctx.getImageData(0, 0, 1, 1).data;
              return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
            };
            const lin = (v: number) => {
              const s = v / 255;
              return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            };
            const lum = (c: number[]) =>
              0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
            let fill = rgba('#fff');
            let on = 'nothing';
            for (let at: Element | null = el; at; at = at.parentElement) {
              const bg = rgba(getComputedStyle(at).backgroundColor);
              if (bg[3]! >= 0.999) {
                fill = bg;
                on = at === el ? 'itself' : at.localName;
                break;
              }
            }
            const ink = rgba(getComputedStyle(el).color);
            const [hi, lo] = [lum(ink), lum(fill)].sort((a, b) => b - a);
            const hex = (c: number[]) =>
              `#${c
                .slice(0, 3)
                .map((v) => v.toString(16).padStart(2, '0'))
                .join('')}`;
            return {
              ratio: Math.round(((hi! + 0.05) / (lo! + 0.05)) * 100) / 100,
              ink: hex(ink),
              fill: hex(fill),
              on,
            };
          });
          expect(
            read.ratio,
            `the focused skip link's text on its fill on ${composition} at ${width} in ${mode}${more}: ${JSON.stringify(read)}`,
          ).toBeGreaterThanOrEqual(4.5);
        },
      );
    }
  });
}
