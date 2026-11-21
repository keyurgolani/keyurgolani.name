import { expect, test, type Page } from '@playwright/test';
import { CONTRACT_FIXTURES } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { fixtureApp } from '../variants/target';

// Chapters' running head on a phone, at 320 and 390, with the root text at 200% (WCAG 2.2 1.4.4 and
// 1.4.10): on every contract fixture, the book's name in the head breaks only between its words,
// and the head, sticky at the window's top, takes at most a quarter of the window. Below 60rem the
// head kept the name's column beside Contents and Write, both in rem, so at 200% the name had a
// sliver of the head and set a letter or two a line, the head growing far down the window. A word
// may still break after its own hyphen. The text is set as the quality cells set it: the root's
// font-size, inline, once the page and its fonts are in.
//
// long-text's name is pinned to its word breaks alone: its surname is 54 letters and hyphens in
// five parts, which at 200% sets four or five lines even across the head's whole width, so with
// Contents and Write under it the head takes more than a quarter of a phone's window. Every other
// fixture's head is held to the quarter.
const WORDS_ONLY = new Set(['long-text']);

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
] as const;

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** Home at 200% root text: the head's name, its words that run to more than one line, and the head's height. */
async function readHead(page: Page) {
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
    const head = document.querySelector<HTMLElement>('.ch-runhead');
    const name = head?.querySelector<HTMLElement>('.ch-runhead__name') ?? null;
    const broken: string[] = [];
    const nodes: Text[] = [];
    if (name) {
      const walker = document.createTreeWalker(name, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
    }
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
      name: nodes
        .map((n) => n.data)
        .join('')
        .trim(),
      shown: name ? name.getClientRects().length > 0 : false,
      width: name ? Math.round(name.getBoundingClientRect().width) : 0,
      broken,
      head: head ? Math.round(head.getBoundingClientRect().height) : 0,
      window: window.innerHeight,
    };
  });
}

for (const fixture of CONTRACT_FIXTURES) {
  test.describe(`Chapters' running head on ${fixture.name}`, () => {
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
      test(`on ${fixture.name}, at ${viewport.width} with the root text at 200%, the running head's name breaks only between its words${WORDS_ONLY.has(fixture.name) ? '' : ' and the head takes at most a quarter of the window'}`, async ({
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
          const head = await readHead(await context.newPage());
          console.log(
            `chapters runhead ${fixture.name} ${viewport.width}: ${JSON.stringify(head)}`,
          );
          expect(head.shown, 'the home page shows the book name in its running head').toBe(true);
          expect(head.broken, `"${head.name}" (${head.width} px wide)`).toEqual([]);
          if (!WORDS_ONLY.has(fixture.name))
            expect(
              head.head,
              'the running head, at most a quarter of the window',
            ).toBeLessThanOrEqual(head.window / 4);
        } finally {
          await context.close();
        }
      });
  });
}
