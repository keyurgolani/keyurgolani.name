import { expect, test } from '../harness/fixtures';
import { kineticOptions, openHome } from './kinetic-cosmos-reading';

// Kinetic Cosmos's dock on first load at desktop widths: the rings begin inside the first window,
// so a dock that renders showing sits at the window's foot, over the page, until the observer that
// hides it at the opening stage first reports. It's held here by an observer that never reports:
// the page as it stands before that report, which a busy main thread can keep a while. The dock
// isn't painted inside the window then.

test.use({
  appOptions: kineticOptions({
    language: 'skeuomorphic',
    scheme: 'warm-parchment',
    typography: 'humanist-ui',
    mode: 'system',
  }),
});

const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

for (const { width, height } of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
])
  test(
    `at ${width} by ${height}, at load before the stage's observer reports, the dock isn't painted in the window`,
    { annotation },
    async ({ page }) => {
      await page.addInitScript(() => {
        window.IntersectionObserver = class {
          readonly root = null;
          readonly rootMargin = '';
          readonly thresholds = [];
          observe() {}
          unobserve() {}
          disconnect() {}
          takeRecords() {
            return [];
          }
        } as unknown as typeof IntersectionObserver;
      });
      await openHome(page, { width, height, row: 'default' });
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      const dock = await page.locator('.kc-dock').evaluate((element) => {
        const box = element.getBoundingClientRect();
        const painted = box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight;
        return painted
          ? `painted at ${Math.round(box.top)}..${Math.round(box.bottom)} of ${innerHeight}`
          : 'not painted';
      });
      expect(dock, 'the dock before the first report').toBe('not painted');
    },
  );
