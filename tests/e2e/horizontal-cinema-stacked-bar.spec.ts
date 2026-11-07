import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { load, stepAcrossStacked } from './horizontal-cinema-model';

// Horizontal Cinema stacked top to bottom by a touch screen in the strip's own room (64rem by 44rem
// and up): the strip's bar shows, in flow at the end of the scenes, with Scenes by chapter, Previous
// and Next, the credits link and the status, and Strip | List stays in the top line.
// The status names the scene the reader is on as the page scrolls, as the strip's does: one polite
// update for each scene the page settles on, and nothing at load.

const COMPLETE = contractFixture('complete');
const COMPLETE_DIR = path.dirname(COMPLETE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];
const tag = '@interaction';
const SCENES = 21;
const at = (n: number) => new RegExp(`(?<!\\d)${n} of ${SCENES}$`);

test.use({
  appOptions: {
    portfolio: COMPLETE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(COMPLETE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      COMPLETE.unitFiles.map((file) => [file, readFileSync(path.join(COMPLETE_DIR, file), 'utf8')]),
    ),
  },
  hasTouch: true,
});

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
] as const) {
  test(
    `stacked by touch at ${width} by ${height}, the strip's bar shows in flow after the scenes, and its status follows the scroll a scene at a time`,
    { annotation, tag },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      // Every text the status shows, in order, from its first: what a screen reader would hear.
      await page.addInitScript(() => {
        const seen: string[] = [];
        (window as unknown as { kgnStatus: string[] }).kgnStatus = seen;
        new MutationObserver(() => {
          const text = document.querySelector('.hc-scrub__status')?.textContent ?? null;
          if (text !== null && seen.at(-1) !== text) seen.push(text);
        }).observe(document, { subtree: true, childList: true, characterData: true });
      });
      await load(page);
      expect(
        await page.evaluate(
          () => matchMedia('(hover: none)').matches || matchMedia('(pointer: coarse)').matches,
        ),
      ).toBe(true);
      await expect(page.locator('.hc-shell')).not.toHaveAttribute('data-pin');
      await expect(page.locator('.hc-chrome__views')).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Scenes by chapter' })).toHaveCount(1);
      const status = page.locator('.hc-scrub__status');
      await expect(status).toHaveAttribute('role', 'status');
      await expect(status).toHaveText(at(1));
      await page.waitForTimeout(1000);
      // Nothing at load: the first scene's words, once.
      const heard = () =>
        page.evaluate(() => (window as unknown as { kgnStatus: string[] }).kgnStatus.slice());
      expect(await heard()).toHaveLength(1);
      await page
        .locator('#scene-10')
        .evaluate((scene) => scene.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await expect(status).toHaveText(at(10));
      // In flow after the scenes: not stuck to the window, below the last scene, out of view here.
      const flow = await page.locator('.hc-frame > .hc-scrub').evaluate((bar) => {
        const scenes = [...document.querySelectorAll('.hc-track .hc-scene')];
        return {
          position: getComputedStyle(bar).position,
          top: bar.getBoundingClientRect().top,
          last: scenes.at(-1)!.getBoundingClientRect().bottom,
        };
      });
      expect(flow.position).toBe('static');
      expect(flow.top).toBeGreaterThanOrEqual(flow.last - 1);
      expect(flow.top).toBeGreaterThan(height);
      await expect(page.locator('.hc-frame > .hc-scrub')).toBeVisible();
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await expect(status).toHaveText(at(1));
      // One update for each scene the page settled on, none for the scenes it passed.
      const words = await heard();
      expect(words.map((text) => text.match(/(\d+) of \d+$/)?.[1])).toEqual(['1', '10', '1']);
    },
  );

  test(
    `stacked by touch at ${width} by ${height}, a fresh load at the last scene's link names it in the status, before any press`,
    { annotation, tag },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await load(page);
      const id = await page.locator('.hc-track .hc-scene').last().getAttribute('id');
      expect(id).toBeTruthy();
      // A fresh document at the link, as a shared link opens: the status says where the page is.
      await page.goto('about:blank');
      await load(page, `/#${id}`);
      await expect(page.locator('.hc-scrub__status')).toHaveText(at(SCENES));
    },
  );

  // Guards, green on the parent too: a fragment no scene holds moves nothing, so the status names the
  // first scene, where the page is, never a scene read from the fragment; and a fragment change after load
  // still reaches the status through the settle, which the mount's write leaves alone.
  test(
    `stacked by touch at ${width} by ${height}, a fresh load at a fragment no scene holds stays at the top and its status names the first scene`,
    { annotation, tag },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('about:blank');
      await load(page, '/#scene-99');
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await expect(page.locator('.hc-scrub__status')).toHaveText(at(1));
    },
  );

  test(
    `stacked by touch at ${width} by ${height}, a fragment change after load moves the status with the page`,
    { annotation, tag },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await load(page);
      const status = page.locator('.hc-scrub__status');
      await expect(status).toHaveText(at(1));
      const ids = await page
        .locator('.hc-track .hc-scene')
        .evaluateAll((scenes) => scenes.map((scene) => scene.id));
      await page.evaluate(
        (id) => {
          window.location.hash = id;
        },
        ids[SCENES - 1]!,
      );
      await expect(status).toHaveText(at(SCENES));
      await page.evaluate((id) => {
        window.location.hash = id;
      }, ids[9]!);
      await expect(status).toHaveText(at(10));
    },
  );

  test(
    `stacked by touch at ${width} by ${height}, the bar's Next steps from the first scene to the last and Previous back`,
    { annotation, tag },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await load(page);
      await expect(page.locator('.hc-shell')).not.toHaveAttribute('data-pin');
      expect(await stepAcrossStacked(page)).toBe(2 * (SCENES - 1));
    },
  );
}
