import { expect, test, type Page } from '@playwright/test';
import { CONTRACT_FIXTURES } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { fixtureApp } from '../variants/target';

// Chapters' title page on a phone, at 320 and 390, with the root text at 200% (WCAG 2.2 1.4.4 and
// 1.4.10): on every contract fixture, the title breaks only between its words, so no word is cut
// and no full stop sets a line of its own. The title kept its display step at 200%, so its longer
// words were wider than the page and broke inside them ("Practi / ce / thesis / ."). A word may
// still break after its own hyphen. The text is set as the quality cells set it: the root's
// font-size, inline, once the page and its fonts are in.

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
] as const;

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** Home at 200% root text: the title's words that run to more than one line. */
async function readTitle(page: Page) {
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
    const title = document.querySelector<HTMLElement>('.tp-title');
    const nodes: Text[] = [];
    if (title) {
      const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
    }
    const broken: string[] = [];
    for (const node of nodes) {
      for (const match of node.data.matchAll(/[^\s-]+-*|-+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const tops = new Set(
          [...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)),
        );
        if (tops.size > 1) broken.push(`"${match[0]}" on ${tops.size} lines`);
      }
    }
    return {
      text: nodes
        .map((n) => n.data)
        .join('')
        .trim(),
      size: title ? getComputedStyle(title).fontSize : null,
      width: title ? Math.round(title.getBoundingClientRect().width) : 0,
      broken,
    };
  });
}

for (const fixture of CONTRACT_FIXTURES) {
  test.describe(`Chapters' title page on ${fixture.name}`, () => {
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
      test(`on ${fixture.name}, at ${viewport.width} with the root text at 200%, the title breaks only between its words`, async ({
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
          const title = await readTitle(await context.newPage());
          console.log(`chapters title ${fixture.name} ${viewport.width}: ${JSON.stringify(title)}`);
          expect(title.text, 'the home page has a title').not.toBe('');
          expect(title.broken, `"${title.text}" (${title.size}, ${title.width} px wide)`).toEqual(
            [],
          );
        } finally {
          await context.close();
        }
      });
  });
}
