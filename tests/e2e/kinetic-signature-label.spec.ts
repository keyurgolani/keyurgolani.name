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
