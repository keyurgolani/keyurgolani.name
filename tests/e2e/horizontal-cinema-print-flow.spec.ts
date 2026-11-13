import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { frames, load } from './horizontal-cinema-model';

// Horizontal Cinema on paper at a page wide and tall enough for the strip's room: the strip's media
// blocks asked for the room (64rem by 44rem and up) and a fine pointer that hovers, and nothing more,
// so a printed page that matches it, A4 landscape and the quality cells' print rows at 1440 by 900
// and 1024 by 768, took the strip. The stage stayed a sideways scroller, the scenes past the page's
// side were cut off, and the contrast check found the later chapters' timeline entries and
// intertitle numbers with no box on the page to sample. On paper the scenes run top to bottom
// instead: the stage doesn't scroll sideways, and every scene and everything in it lies inside the
// page's width. On the complete contract fixture, with the script, as the print rows run.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const) {
  test(
    `on paper at ${viewport.width} by ${viewport.height}, the scenes run top to bottom and every one lies inside the page's width`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize(viewport);
      await load(page);
      await page.emulateMedia({ media: 'print' });
      await frames(page);
      await frames(page);
      const read = await page.evaluate(() => {
        const stage = document.querySelector<HTMLElement>('.hc-stage')!;
        const width = document.documentElement.clientWidth;
        const path = (e: Element) =>
          `${e.localName}${e.id ? `#${e.id}` : ''}${e.classList.length ? `.${[...e.classList].join('.')}` : ''}`;
        // Each scene, and each text-bearing element in it with a box, that runs past either side of the page.
        const cut = [...document.querySelectorAll<HTMLElement>('.hc-track .hc-scene')].flatMap(
          (scene) =>
            [scene, ...scene.querySelectorAll<HTMLElement>('*')]
              .filter(
                (e) => e.getClientRects().length > 0 && (e === scene || e.textContent?.trim()),
              )
              .map((e) => ({ e, r: e.getBoundingClientRect() }))
              .filter(({ r }) => r.width > 0 && (r.left < -0.5 || r.right > width + 0.5))
              .map(({ e, r }) => `${path(e)} ${Math.round(r.left)}..${Math.round(r.right)}`),
        );
        return {
          sideways: ['auto', 'scroll'].includes(getComputedStyle(stage).overflowX),
          scenes: document.querySelectorAll('.hc-track .hc-scene').length,
          cut: cut.slice(0, 12),
          cutCount: cut.length,
        };
      });
      expect(read.scenes, 'the complete fixture has scenes').toBeGreaterThan(0);
      expect(
        { sideways: read.sideways, cutCount: read.cutCount },
        `the strip on paper ${JSON.stringify(read)}`,
      ).toEqual({ sideways: false, cutCount: 0 });
    },
  );
}
