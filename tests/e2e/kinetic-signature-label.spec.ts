import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { decodePng, deltaEOk, pixel, type Rgb } from '../quality/lib/pixels';

// Kinetic Cosmos's signature label (12b, 3 Nov 2026): the pill on the map keeps its own ground and
// border, and the halo of the stage's ground knocked out round it sits behind the pill, never over
// it. d4d3f7569 painted the halo over the pill's border (a negative z-index child of the pill's own
// stacking context paints above that box's border and background), so the pill read as bare words
// on the stage while every quality cell passed. Pointer hit-testing can't tell (the halo takes no
// pointer events), so both checks read pixels.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const SITE = fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'kinetic-cosmos');
const SOURCE_FILES = Object.fromEntries(
  FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
);
const MAGENTA: Rgb = [255, 0, 255];

test.use({
  appOptions: { portfolio: FIXTURE.files.portfolio, siteText: SITE, sourceFiles: SOURCE_FILES },
});

test(
  'the signature label keeps its own border and ground over the halo, at 1440 and 1024',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    // The map held still, so nothing that moves behind the label changes between two shots.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.mouse.move(0, 0);
      const label = page.locator('.kc-signature-label');
      await expect(label, `${viewport.width}: the label`).toBeVisible();
      const box = (await label.boundingBox())!;
      const clip = { x: box.x, y: box.y, width: box.width, height: box.height };

      // The border: the label's box shot, then shot again with every border in it see-through.
      // The pill's edge must change between the two, so its border is what's painted there.
      const shown = decodePng(await page.screenshot({ clip, animations: 'disabled' }));
      const bare = await page.addStyleTag({
        content:
          '.kc-signature-label, .kc-signature-label * { border-color: transparent !important; }',
      });
      const hidden = decodePng(await page.screenshot({ clip, animations: 'disabled' }));
      await bare.evaluate((el) => (el as Element).remove());
      let edge = 0;
      let changed = 0;
      for (let i = 0; i < shown.width * shown.height; i++) {
        const [x, y] = [i % shown.width, Math.floor(i / shown.width)];
        if (x > 0 && y > 0 && x < shown.width - 1 && y < shown.height - 1) continue;
        edge++;
        if (deltaEOk(pixel(shown, i), pixel(hidden, i)) > 0.02) changed++;
      }
      expect(
        changed / edge,
        `${viewport.width}: the pill's border painted on its edge`,
      ).toBeGreaterThan(0.5);

      // The ground: the halo painted magenta. Inside the pill's padding, beside its words, the
      // pill's own ground must still show, so the halo sits behind it.
      const loud = await page.addStyleTag({
        content: '.kc-signature-label__ground { background-color: rgb(255, 0, 255) !important; }',
      });
      const inside = decodePng(
        await page.screenshot({
          clip: { x: box.x + 3, y: box.y + box.height / 2 - 1, width: 2, height: 2 },
          animations: 'disabled',
        }),
      );
      await loud.evaluate((el) => (el as Element).remove());
      for (let i = 0; i < inside.width * inside.height; i++) {
        expect(
          deltaEOk(pixel(inside, i), MAGENTA),
          `${viewport.width}: the pill's own ground over the halo`,
        ).toBeGreaterThan(0.2);
      }
    }
  },
);

test(
  "the signature label's knocked-out ground leaves the map's bodies whole, at 320, 390, 1024 and 1440",
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    // 509a47777 hung the label below and left of its anchor on a phone, across the other rings'
    // anchors: at 390 the pill and its ground covered ring 1's body whole and ring 2's but for a
    // sliver. A body is the map's solid mark; its lines and coronae may stop short of the ground.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const viewport of [
      { width: 320, height: 844 },
      { width: 390, height: 844 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'networkidle' });
      const ground = (await page.locator('.kc-signature-label__ground').boundingBox())!;
      const marks = [
        ...(await page.locator('.kc-orrery__body').all()),
        ...(await page.locator('.kc-core').all()),
      ];
      expect(marks.length, `${viewport.width}: the map's bodies`).toBeGreaterThan(1);
      for (const [index, mark] of marks.entries()) {
        const box = (await mark.boundingBox())!;
        const clear =
          box.x + box.width <= ground.x ||
          ground.x + ground.width <= box.x ||
          box.y + box.height <= ground.y ||
          ground.y + ground.height <= box.y;
        expect(
          clear,
          `${viewport.width}: body ${index} (${box.x.toFixed(1)},${box.y.toFixed(1)} ${box.width.toFixed(1)}x${box.height.toFixed(1)}) clear of the ground (${ground.x.toFixed(1)},${ground.y.toFixed(1)} ${ground.width.toFixed(1)}x${ground.height.toFixed(1)})`,
        ).toBe(true);
      }
    }
  },
);

test(
  'on a phone the signature label and its focus ring stay in the viewport, at 100% and 200% root text',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    // Hung to its anchor's right, the label moves back toward the map's start only where its words
    // need the room: enlarged text (the quality root-text condition's 200%) must not push it, or its
    // ring, past the screen's edge, nor make the page scroll sideways.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [320, 390]) {
      for (const scale of [1, 2]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto('/', { waitUntil: 'networkidle' });
        await page.evaluate(
          (at) =>
            document.documentElement.style.setProperty('font-size', `${at * 100}%`, 'important'),
          scale,
        );
        const label = page.locator('.kc-signature-label');
        await label.evaluate((e) =>
          (e as HTMLElement).focus({ focusVisible: true } as FocusOptions),
        );
        const fit = await label.evaluate((e) => {
          const box = e.getBoundingClientRect();
          const s = getComputedStyle(e);
          const reach = (parseFloat(s.outlineOffset) || 0) + (parseFloat(s.outlineWidth) || 0);
          const doc = document.documentElement;
          return {
            start: box.left - reach,
            end: box.right + reach,
            width: doc.clientWidth,
            scroll: document.scrollingElement!.scrollWidth,
          };
        });
        const at = `${width} at ${scale * 100}% text`;
        expect(fit.start, `${at}: the ring's start in view`).toBeGreaterThanOrEqual(0);
        expect(fit.end, `${at}: the ring's end in view`).toBeLessThanOrEqual(fit.width);
        expect(fit.scroll, `${at}: no sideways scroll`).toBeLessThanOrEqual(fit.width);
      }
    }
  },
);
