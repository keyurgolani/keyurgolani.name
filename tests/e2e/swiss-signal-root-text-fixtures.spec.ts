import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { startApp } from '../harness/app-server.mjs';
import { CONTRACT_FIXTURES } from '../../packages/variant-contract/src/node/fixtures';
import { fixtureApp } from '../variants/target';

// Swiss Signal's home with the root text at 200% on a phone (320 and 390), on every contract
// fixture, read as the quality reflow read reads it (loaded, fonts in, the root's font-size at 200%,
// important): the page is no wider than the window. A ruled table, a citation, the quote poster, a
// figure, a ruled group and a work row each held the page past it on some fixture. Each fixture's
// site document is its own, so each starts its own server; the browser reaches nothing outside it.

const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];
const SWISS = { manifest: { id: 'swiss-signal' } };
const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
] as const;

type App = Awaited<ReturnType<typeof startApp>>;

/** The page's width against the window, and what runs past its right edge, deepest first. */
const sideways = (page: Page) =>
  page.evaluate(() => {
    const html = document.documentElement;
    const client = html.clientWidth;
    const past = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > client + 0.5 && el.checkVisibility();
      })
      .filter((el, _, all) => !all.some((other) => other !== el && el.contains(other)))
      .slice(0, 8)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const classes = typeof el.className === 'string' ? el.className.trim().split(/\s+/) : [];
        const name = [el.localName, ...classes.filter(Boolean)].join('.');
        return `${name} ${Math.round(r.left)}..${Math.round(r.right)}`;
      });
    return { scroll: html.scrollWidth, client, past };
  });

for (const fixture of CONTRACT_FIXTURES)
  test.describe(`Swiss Signal on ${fixture.name}`, () => {
    // One server for the fixture's tests, in order.
    test.describe.configure({ mode: 'default' });
    let app: App;

    test.beforeAll(async () => {
      test.setTimeout(120_000);
      app = await startApp({
        ...fixtureApp(fixture, SWISS),
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

    for (const { width, height } of VIEWPORTS)
      test(
        `on ${fixture.name}, with the root text at 200% at ${width}, the home page doesn't scroll sideways`,
        { annotation },
        async ({ browser }) => {
          const context = await browser.newContext({
            viewport: { width, height },
            isMobile: true,
            hasTouch: true,
            baseURL: app.origin,
          });
          try {
            await guard(context);
            const page = await context.newPage();
            await page.goto('/', { waitUntil: 'load' });
            await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
            await expect(page.locator('[data-variant]').first()).toHaveAttribute(
              'data-variant',
              'swiss-signal',
            );
            await page.evaluate(() => document.fonts.ready);
            await page.evaluate(() =>
              document.documentElement.style.setProperty('font-size', '200%', 'important'),
            );
            const frames = () =>
              page.evaluate(
                () =>
                  new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
              );
            await frames();
            await page.waitForTimeout(250);
            await frames();
            const read = await sideways(page);
            expect(
              read.scroll,
              `the page is no wider than the screen; past it: ${read.past.join('; ')}`,
            ).toBeLessThanOrEqual(read.client);
          } finally {
            await context.close();
          }
          expect(app.egress(), 'hosts the server tried to reach').toEqual([]);
        },
      );
  });
