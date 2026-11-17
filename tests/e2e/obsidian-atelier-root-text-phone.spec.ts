import { expect, test, type Page } from '@playwright/test';
import { readPair } from '../../packages/schema/src/node';
import { resolvePortfolioView, routedSlugs } from '../../packages/schema/src/index';
import { CONTRACT_FIXTURES } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { fixtureApp } from '../variants/target';

// Obsidian Atelier on a phone, at 320 and 390, with the root text at 200% (WCAG 2.2 1.4.4 and
// 1.4.10): on every contract fixture, its home and its first work page don't scroll sideways. The
// quality cells read 200% root text at 1024 only. A box sized to its content held its longest word
// or its padding whole and ran past the window: a citation plate's mat, padded 3.375rem a side, a
// source's address, the next room's title and a vitrine room's title, each in a grid track or a
// flex item that wouldn't shrink below them. The text is set as the quality cells set it: the
// root's font-size, inline, once the page and its fonts are in.

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
] as const;

/** The fixture's first routed work page, or null when it routes none. */
function firstWork(fixture: (typeof CONTRACT_FIXTURES)[number]): string | null {
  const read = readPair(fixture.files);
  if (!read.ok) return null;
  const routed = [
    ...routedSlugs(resolvePortfolioView(read.pair, {}, { mediaBase: '/media' })),
  ].sort();
  return routed.length ? `/work/${routed[0]}` : null;
}

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** `route` at 200% root text: how far the page scrolls sideways, and what runs past the window first. */
async function readSideways(page: Page, route: string) {
  await page.goto(route, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() =>
    document.documentElement.style.setProperty('font-size', '200%', 'important'),
  );
  await frames(page);
  await page.evaluate(() => document.fonts.ready);
  await frames(page);
  return page.evaluate(() => {
    const html = document.documentElement;
    const edge = html.clientWidth;
    const past = [...document.querySelectorAll('[data-variant] *')].find((element) => {
      if (element.closest('svg') && element.tagName.toLowerCase() !== 'svg') return false;
      for (let at: Element | null = element; at; at = at.parentElement) {
        if (getComputedStyle(at).position === 'fixed') return false;
      }
      return element.getBoundingClientRect().right > edge + 0.5;
    });
    return {
      scroll: html.scrollWidth,
      client: edge,
      first: past
        ? `${past.tagName.toLowerCase()}.${[...past.classList].join('.')} "${(past.textContent ?? '').trim().slice(0, 40)}"`
        : '',
    };
  });
}

const atelier = { manifest: { id: 'obsidian-atelier' } };

for (const fixture of CONTRACT_FIXTURES) {
  test(`${fixture.name}: Obsidian Atelier's home and first work page at 320 and 390 with the root text at 200% don't scroll sideways`, async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(3 * 60_000);
    const work = firstWork(fixture);
    const routes = ['/', ...(work ? [work] : [])];
    const app = await startApp({
      ...fixtureApp(fixture, atelier),
      logFile: testInfo.outputPath('server.log'),
    });
    const sideways: string[] = [];
    try {
      for (const viewport of VIEWPORTS) {
        const context = await browser.newContext({
          viewport,
          isMobile: true,
          hasTouch: true,
          baseURL: app.origin,
        });
        try {
          const page = await context.newPage();
          for (const route of routes) {
            const read = await readSideways(page, route);
            if (read.scroll > read.client) {
              sideways.push(
                `${route} at ${viewport.width}: ${read.scroll} > ${read.client}, ${read.first}`,
              );
            }
          }
        } finally {
          await context.close();
        }
      }
    } finally {
      await app.stop();
    }
    expect(sideways).toEqual([]);
  });
}
