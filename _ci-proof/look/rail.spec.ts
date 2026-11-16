import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '../harness/fixtures';
import { fixtureIn } from './forced-backplate';

// The rail labels proof's look spec (copied in by the CI proof kit, never committed): Singular's rail stops at rest and focused from the keyboard,
// at 1024, on L1_LOOK_ROUTE, in the L1_LOOK_PALETTE palette, with forced colours on or off
// (L1_LOOK_ROW forced-colors or default). Each stop in L1_LOOK_STOPS is shot in one fixed clip: its
// own box, 240 px to its left (where its label shows) and 24 px round, the same at rest and focused
// and on either side. Shots go to PROOF_LOOK_OUT (or L1_LOOK_OUT/<side>)/<route>-<palette>-<row>-stop<i>-{rest,focused}.png
// with the stop's and its label's boxes printed; with no env it lists.

const OUT = process.env.PROOF_LOOK_OUT ?? process.env.L1_LOOK_OUT ?? '';
const SIDE = process.env.L1_LOOK_SIDE ?? '';
const ROUTE = process.env.L1_LOOK_ROUTE ?? '/';
const PALETTE = process.env.L1_LOOK_PALETTE === 'dark' ? 'dark' : 'light';
const ROW = process.env.L1_LOOK_ROW === 'default' ? 'default' : 'forced-colors';
const STOPS = (process.env.L1_LOOK_STOPS ?? '0').split(',').map(Number);

test.use({ appOptions: fixtureIn('singular') });

test(`look: Singular's rail stops at rest and focused, ${ROUTE}, ${PALETTE}, ${ROW}`, async ({
  page,
}) => {
  test.setTimeout(240_000);
  expect(OUT, 'PROOF_LOOK_OUT').not.toBe('');
  const dir = path.join(OUT, SIDE);
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.emulateMedia({
    colorScheme: PALETTE,
    forcedColors: ROW === 'forced-colors' ? 'active' : 'none',
    reducedMotion: 'reduce',
  });
  await page.goto(ROUTE, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  const stops = page.locator('.sg-rail__stop');
  const slug = ROUTE === '/' ? 'home' : ROUTE.replaceAll('/', '-').replace(/^-/, '');
  for (const i of STOPS) {
    const stop = stops.nth(i);
    await expect(stop).toBeVisible();
    const box = (await stop.boundingBox())!;
    const x = Math.max(0, Math.floor(box.x - 240));
    const y = Math.max(0, Math.floor(box.y - 24));
    const clip = {
      x,
      y,
      width: Math.min(1024, Math.ceil(box.x + box.width + 24)) - x,
      height: Math.min(768, Math.ceil(box.y + box.height + 24)) - y,
    };
    const name = `${slug}-${PALETTE}-${ROW}-stop${i}`;
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(0, 0);
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    writeFileSync(
      path.join(dir, `${name}-rest.png`),
      await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }),
    );
    await stop.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    expect(await stop.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    writeFileSync(
      path.join(dir, `${name}-focused.png`),
      await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }),
    );
    const label = await stop.locator('.sg-rail__label').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        box: [r.x, r.y, r.width, r.height].map((v) => +v.toFixed(2)),
        words: (el.textContent ?? '').trim(),
        style: `color ${s.color}, background ${s.backgroundColor}, border ${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}, opacity ${s.opacity}`,
      };
    });
    console.log(
      `l1 look ${SIDE} ${name}: stop ${JSON.stringify(box)}, clip ${JSON.stringify(clip)}, label ${JSON.stringify(label)}`,
    );
  }
});
