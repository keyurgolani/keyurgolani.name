import { expect, test, type Page } from '@playwright/test';
import { CONTRACT_FIXTURES } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { fixtureApp } from '../variants/target';

// Chapters' top bar on a phone, at 320 and 390, with the root text at 200% (WCAG 2.2 1.4.4 and
// 1.4.10): on every contract fixture, the bar sits under the running head, on its foot. The bar
// was fixed at the head's least height, so where the head grew past it, as long-text's name does
// at 200%, it ran through the head's lines. The text is set as the quality cells set it: the
// root's font-size, inline, once the page and its fonts are in.

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
] as const;

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** Home at 200% root text: the running head's box and the top bar's. */
async function readBar(page: Page) {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() =>
    document.documentElement.style.setProperty('font-size', '200%', 'important'),
  );
  await frames(page);
  await page.evaluate(() => document.fonts.ready);
  await frames(page);
  return page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element || element.getClientRects().length === 0) return null;
      const r = element.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        left: Math.round(r.left),
        width: Math.round(r.width),
      };
    };
    return { head: box('.ch-runhead'), bar: box('.ch-progress') };
  });
}

for (const fixture of CONTRACT_FIXTURES) {
  test.describe(`Chapters' top bar on ${fixture.name}`, () => {
    // One server for the fixture's tests, in order.
    test.describe.configure({ mode: 'default' });
    let app: Awaited<ReturnType<typeof startApp>>;
    test.beforeAll(async () => {
      test.setTimeout(120_000);
      app = await startApp({
        ...fixtureApp(fixture, { manifest: { id: 'chapters' } }),
        logFile: test.info().outputPath('server.log'),
      });
    });
    test.afterAll(async () => {
      await app?.stop();
    });
    for (const viewport of VIEWPORTS)
      test(`on ${fixture.name}, at ${viewport.width} with the root text at 200%, the top bar sits on the running head's foot`, async ({
        browser,
      }) => {
        const context = await browser.newContext({
          viewport,
          isMobile: true,
          hasTouch: true,
          baseURL: app.origin,
        });
        // The browser reaches the server alone.
        await context.route('**/*', (route) =>
          new URL(route.request().url()).origin === app.origin
            ? route.continue()
            : route.abort('blockedbyclient'),
        );
        try {
          const { head, bar } = await readBar(await context.newPage());
          console.log(
            `chapters top bar ${fixture.name} ${viewport.width}: ${JSON.stringify({ head, bar })}`,
          );
          expect(head, 'the running head').not.toBeNull();
          expect(bar, 'the top bar').not.toBeNull();
          expect(
            Math.abs(bar!.top - head!.bottom),
            'the bar on the head foot, in px',
          ).toBeLessThanOrEqual(1);
          expect(
            Math.abs(bar!.left - head!.left),
            'the bar from the head start, in px',
          ).toBeLessThanOrEqual(1);
          expect(
            Math.abs(bar!.width - head!.width),
            'the bar as wide as the head, in px',
          ).toBeLessThanOrEqual(1);
        } finally {
          await context.close();
        }
      });
  });
}
