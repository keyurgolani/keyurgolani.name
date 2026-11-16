import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { test } from '../harness/fixtures';
import { optionalFaces, pinFaces } from '../harness/optional-faces';

// A look, run from tests/e2e at the base and at the head: Kinetic Cosmos on the complete fixture in
// one design language, scheme, type pack and mode (PROOF_LOOK_LANG, _SCHEME, _PACK, _MODE), its
// optional faces in their designed state, and one set of shots (PROOF_LOOK_KIND):
//   planets: every planet set at 390 and 1024, with each body's box and its magnitude's size as JSON
//   lines: the four rings' openers, their orbit lines, at 1024, 1280 and 1440
//   focus: the first plate focused at 1024 (default, more contrast, forced colours), the dock and
//     its first stop focused at 1024 (default, forced colours), a work's title and the dock's Index
//     focused at 390 (forced colours, more contrast)
// Each PNG goes to PROOF_LOOK_OUT. One pack a file run, since a file takes one appOptions.

const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';
const env = (name: string, fallback: string) => process.env[`PROOF_LOOK_${name}`] ?? fallback;
const LANG = env('LANG', 'platform-neutral');
const SCHEME = env('SCHEME', 'warm-parchment');
const PACK = env('PACK', 'console-mono');
const MODE = env('MODE', 'dark');
const KIND = env('KIND', 'planets');
const NAME = `${KIND}-${PACK}-${MODE}`;
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'kinetic-cosmos')
      .replace(/designLanguage: .*/, `designLanguage: ${LANG}`)
      .replace(/colorScheme: .*/, `colorScheme: ${SCHEME}`)
      .replace(/typography: .*/, `typography: ${PACK}`)
      .replace(/displayMode: .*/, `displayMode: ${MODE}`),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

type Row = 'default' | 'contrast-more' | 'forced-colors';

const settle = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

async function open(page: Page, width: number, height: number, row: Row) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({
    reducedMotion: 'reduce',
    forcedColors: row === 'forced-colors' ? 'active' : 'none',
    contrast: row === 'contrast-more' ? 'more' : 'no-preference',
  });
  await pinFaces(page, await optionalFaces(page), 'designed');
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await settle(page);
}

async function shot(page: Page, locator: Locator, name: string, pad: number) {
  mkdirSync(OUT, { recursive: true });
  await locator.scrollIntoViewIfNeeded();
  await settle(page);
  const b = (await locator.boundingBox())!;
  const vp = page.viewportSize()!;
  const x = Math.max(0, b.x - pad);
  const y = Math.max(0, b.y - pad);
  await page.screenshot({
    path: path.join(OUT, `${name}.png`),
    clip: {
      x,
      y,
      width: Math.min(vp.width - x, b.width + 2 * pad),
      height: Math.min(vp.height - y, b.height + 2 * pad),
    },
    animations: 'disabled',
    caret: 'hide',
  });
}

async function keyFocus(page: Page, stop: Locator) {
  await stop.scrollIntoViewIfNeeded();
  await stop.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
}

/** Each planet body's box and the size its magnitude gives it (its token times --layout-size). */
const bodies = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.kc-planet')].map((planet, index) => {
      const body = planet.querySelector<HTMLElement>('.kc-planet__body')!;
      const size = parseFloat(getComputedStyle(planet).getPropertyValue('--layout-size'));
      const set = planet.closest('.kc-planets')!;
      const small = matchMedia('(max-width: 47.99rem)').matches && !set.matches('.kc-planets--row');
      const ruler = document.createElement('div');
      ruler.style.cssText = `position: absolute; visibility: hidden; inline-size: var(${small ? '--space-2xl' : '--space-3xl'});`;
      planet.append(ruler);
      const token = ruler.getBoundingClientRect().width;
      ruler.remove();
      const box = body.getBoundingClientRect();
      return {
        planet: planet.id || `planet ${index + 1}`,
        size,
        width: box.width,
        height: box.height,
        expected: token * size,
      };
    }),
  );

test(`kc look ${NAME}`, async ({ page }) => {
  if (KIND === 'planets') {
    for (const [width, height] of [
      [390, 844],
      [1024, 768],
    ] as const) {
      await open(page, width, height, 'default');
      mkdirSync(OUT, { recursive: true });
      writeFileSync(
        path.join(OUT, `${NAME}-${width}.json`),
        JSON.stringify(await bodies(page), null, 1),
      );
      const sets = page.locator('.kc-planets');
      for (let i = 0; i < (await sets.count()); i += 1)
        await shot(page, sets.nth(i), `${NAME}-${width}-set${i + 1}`, 16);
    }
  } else if (KIND === 'lines') {
    for (const [width, height] of [
      [1024, 768],
      [1280, 800],
      [1440, 900],
    ] as const) {
      await open(page, width, height, 'default');
      for (const ring of ['work', 'writing', 'record', 'personal'])
        await shot(
          page,
          page.locator(`#kc--ring-${ring} .kc-ring__opener`),
          `${NAME}-${width}-${ring}`,
          8,
        );
    }
  } else {
    for (const row of ['default', 'contrast-more', 'forced-colors'] as const) {
      await open(page, 1024, 768, row);
      const plate = page.locator('.kc-plates .kc-plate__link').first();
      await keyFocus(page, plate);
      await shot(page, plate, `${NAME}-1024-${row}-plate`, 16);
      if (row === 'contrast-more') continue;
      await page.locator('#kc--ring-record').scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await shot(page, page.locator('.kc-dock'), `${NAME}-1024-${row}-dock`, 4);
      await keyFocus(page, page.locator('.kc-dock .kc-dock__stop').first());
      await shot(page, page.locator('.kc-dock'), `${NAME}-1024-${row}-dock-first-stop`, 4);
    }
    for (const row of ['forced-colors', 'contrast-more'] as const) {
      await open(page, 390, 844, row);
      const title = page.locator('#project-name h4 a').first();
      await keyFocus(page, title);
      await shot(page, title, `${NAME}-390-${row}-work-title`, 16);
      await page.locator('#kc--ring-record').scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await keyFocus(page, page.locator('.kc-dock .kc-index-trigger--dock'));
      await shot(page, page.locator('.kc-dock'), `${NAME}-390-${row}-dock-index`, 4);
    }
  }
});
