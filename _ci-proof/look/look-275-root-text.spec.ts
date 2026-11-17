import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, type Page } from '@playwright/test';
import { readPair } from '../../packages/schema/src/node';
import { resolvePortfolioView, routedSlugs } from '../../packages/schema/src/index';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { fixtureApp } from '../variants/target';

// Look shots: Chapters at 320 on a phone, on the consulting and photography fixtures, the first
// work page's fact sheet and the home's contents, each at 200% and at 100% root text, the full
// width the page scrolls to, so what runs past the window shows.

const OUT = process.env.PROOF_LOOK_OUT ?? path.join('reports', 'look-275');
const SHOTS = [
  { fixture: 'consulting', route: '/work/', selector: 'dl.ch-facts', name: 'work-facts' },
  { fixture: 'consulting', route: '/', selector: 'ol.toc', name: 'home-contents' },
  { fixture: 'photography', route: '/work/', selector: 'dl.ch-facts', name: 'work-facts' },
  { fixture: 'photography', route: '/', selector: 'ol.toc', name: 'home-contents' },
] as const;

/** The fixture's first routed work page, as the sweep and the red pick it. */
function firstWork(fixture: ReturnType<typeof contractFixture>): string {
  const read = readPair(fixture.files);
  if (!read.ok) throw new Error(`${fixture.name} doesn't read`);
  const routed = [
    ...routedSlugs(resolvePortfolioView(read.pair, {}, { mediaBase: '/media' })),
  ].sort();
  return `/work/${routed[0]}`;
}

async function shoot(page: Page, selector: string, text: number) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    (scale) =>
      document.documentElement.style.setProperty('font-size', `${scale * 100}%`, 'important'),
    text,
  );
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  const scrollY = await page.evaluate(() => window.scrollY);
  return page.screenshot({
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
    clip: { x: 0, y: Math.max(0, box.y + scrollY - 16), width, height: box.height + 32 },
  });
}

for (const fixtureName of ['consulting', 'photography'] as const) {
  test(`look: Chapters at 320 on ${fixtureName}, the fact sheet and the contents at 200% and 100% root text`, async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(3 * 60_000);
    const fixture = contractFixture(fixtureName);
    const app = await startApp({
      ...fixtureApp(fixture, { manifest: { id: 'chapters' } }),
      logFile: testInfo.outputPath('server.log'),
    });
    mkdirSync(OUT, { recursive: true });
    try {
      for (const shot of SHOTS.filter((each) => each.fixture === fixtureName)) {
        for (const text of [2, 1]) {
          const context = await browser.newContext({
            viewport: { width: 320, height: 568 },
            isMobile: true,
            hasTouch: true,
            baseURL: app.origin,
          });
          try {
            const page = await context.newPage();
            await page.goto(shot.route === '/work/' ? firstWork(fixture) : '/', {
              waitUntil: 'load',
            });
            await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
            const png = await shoot(page, shot.selector, text);
            writeFileSync(path.join(OUT, `${fixtureName}-${shot.name}-${text * 100}.png`), png);
          } finally {
            await context.close();
          }
        }
      }
    } finally {
      await app.stop();
    }
  });
}
