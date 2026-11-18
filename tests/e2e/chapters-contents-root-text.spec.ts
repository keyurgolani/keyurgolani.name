import { expect, test, type Page } from '@playwright/test';
import { CONTRACT_FIXTURES } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { fixtureApp } from '../variants/target';

// Chapters' contents on a phone, at 320 and 390, with the root text at 200% (WCAG 2.2 1.4.4 and
// 1.4.10): on every contract fixture, each title in the contents (a chapter's, the preface's, the
// back matter's) breaks only between its words. A contents line kept its numeral's column and its
// page number's beside the title, both in rem, so at 200% the title had about 55 px of a 240 px
// list at 320 and broke every two or three letters ("Fi / el / d / n / ot / e"). A word may still
// break after its own hyphen. The text is set as the quality cells set it: the root's font-size,
// inline, once the page and its fonts are in.

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
] as const;

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** Home at 200% root text: each contents title's words that run to more than one line. */
async function readTitles(page: Page) {
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
    const titles = [...document.querySelectorAll('.toc :is(.toc__t, .toc__fm > a)')];
    return titles.map((title) => {
      // The words as they show: a screen reader's "Chapter 1: " is not on the line.
      const nodes: Text[] = [];
      const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.parentElement?.closest('.ch-sr')) nodes.push(n as Text);
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
        size: getComputedStyle(title).fontSize,
        width: Math.round(title.getBoundingClientRect().width),
        broken,
      };
    });
  });
}

for (const fixture of CONTRACT_FIXTURES) {
  test.describe(`Chapters' contents on ${fixture.name}`, () => {
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
      test(`on ${fixture.name}, at ${viewport.width} with the root text at 200%, each contents title breaks only between its words`, async ({
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
          const titles = await readTitles(await context.newPage());
          expect(titles.length, 'the home page has a contents').toBeGreaterThan(0);
          const broken = titles
            .filter((title) => title.broken.length > 0)
            .map(
              (title) =>
                `"${title.text}" (${title.size}, ${title.width} px wide): ${title.broken.join(', ')}`,
            );
          expect(broken).toEqual([]);
        } finally {
          await context.close();
        }
      });
  });
}
