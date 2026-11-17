import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, type Page } from '@playwright/test';
import { readPair } from '../../packages/schema/src/node';
import { resolvePortfolioView, routedSlugs } from '../../packages/schema/src/index';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { fixtureApp } from '../variants/target';

// Look shots: Obsidian Atelier at 320 on a phone, each box that ran past the window with the root
// text at 200%, at 200% and at 100% root text, the full width the page scrolls to, so what runs
// past the window shows: the academic case's citation plate and next room, the engineering case's
// sources, the long-text home's vitrine room side, the writing case's next room.

const OUT = process.env.PROOF_LOOK_OUT ?? path.join('reports', 'look-277');
const SHOTS = [
  {
    fixture: 'academic',
    route: '/work/',
    selector: 'figure.oa-caseplate--citation',
    name: 'citation',
  },
  { fixture: 'academic', route: '/work/', selector: 'nav.oa-nextroom', name: 'next-room' },
  { fixture: 'engineering', route: '/work/', selector: '.oa-backmatter__sources', name: 'sources' },
  { fixture: 'long-text', route: '/', selector: '.oa-room--vitrine .oa-side', name: 'room-side' },
  { fixture: 'writing', route: '/work/', selector: 'nav.oa-nextroom', name: 'next-room' },
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

for (const fixtureName of ['academic', 'engineering', 'long-text', 'writing'] as const) {
  test(`look: Obsidian Atelier at 320 on ${fixtureName}, what ran past the window, at 200% and 100% root text`, async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(3 * 60_000);
    const fixture = contractFixture(fixtureName);
    const app = await startApp({
      ...fixtureApp(fixture, { manifest: { id: 'obsidian-atelier' } }),
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
