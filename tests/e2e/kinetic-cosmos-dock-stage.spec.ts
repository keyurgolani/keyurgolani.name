import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Kinetic Cosmos's dock steps aside while the opening stage is in view and comes back once it has
// gone by, whatever the order its observer's entries arrive in. A browser hands an observer every
// entry queued since its last delivery, oldest first, so a page that goes back to the stage and
// away again before the observer's task runs (a busy main thread; the keyboard's Shift+Tab into
// the stage and Tab out of it) delivers both in one call. The dock read the first of them and
// stayed hidden past the stage, as the reading specs at 390 saw on CI. Here every observer's
// deliveries are coalesced over half a second, so that order is the one the page gets.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
const COALESCE_MS = 500;

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'kinetic-cosmos'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

declare global {
  interface Window {
    /** Each coalesced delivery's entries, as [target id, intersecting]. */
    __deliveries?: [string, boolean][][];
  }
}

for (const { width, height } of [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
])
  test(
    `at ${width}, with the observers' entries delivered together, the dock shows once the stage has gone by, after a visit back to it`,
    { annotation },
    async ({ page }) => {
      await page.addInitScript((wait) => {
        const Native = window.IntersectionObserver;
        window.IntersectionObserver = class extends Native {
          constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
            let held: IntersectionObserverEntry[] = [];
            let timer = 0;
            super((entries, observer) => {
              held.push(...entries);
              window.clearTimeout(timer);
              timer = window.setTimeout(() => {
                const batch = held;
                held = [];
                (window.__deliveries ??= []).push(
                  batch.map((entry) => [entry.target.id, entry.isIntersecting]),
                );
                callback(batch, observer);
              }, wait);
            }, options);
          }
        };
      }, COALESCE_MS);
      await page.setViewportSize({ width, height });
      await page.goto('/', { waitUntil: 'networkidle' });
      const dock = page.locator('.kc-dock');
      // While the stage is in view, the dock is out of view and out of the tab order.
      await expect(dock).toBeHidden();
      // Past the stage, it shows.
      await page
        .locator('#kc--ring-record')
        .evaluate((ring) => ring.scrollIntoView({ block: 'start' }));
      await expect(dock).toBeVisible();
      // Back to the stage and past it again, a frame apart, inside one delivery.
      const before = await page.evaluate(() => window.__deliveries?.length ?? 0);
      await page.evaluate(async () => {
        const frames = () =>
          new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        document.getElementById('kc--stage')!.scrollIntoView({ block: 'start' });
        await frames();
        document.getElementById('kc--ring-record')!.scrollIntoView({ block: 'start' });
        await frames();
      });
      // The delivery holds the stage in view and then out of it: the dock reads the latest.
      await expect
        .poll(() =>
          page.evaluate(
            (from) =>
              (window.__deliveries ?? []).slice(from).some((batch) => {
                const stage = batch.filter(([id]) => id === 'kc--stage').map(([, at]) => at);
                return stage.length > 1 && stage[0] === true && stage.at(-1) === false;
              }),
            before,
          ),
        )
        .toBe(true);
      // Two frames for the island to render what the delivery set.
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      await expect(dock).toBeVisible();
    },
  );
