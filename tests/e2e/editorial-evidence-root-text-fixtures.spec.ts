import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';

// Editorial Evidence with the root text at 200% on a phone: the home page doesn't scroll sideways on
// the contract fixtures whose shapes push it there, each on its own appearance. A skills list's
// long term (long-text, at 320 and 390), a review's pull quote (music), the byline's facts
// (photography) and a work row's address (writing), each at 320. The root text is set as the
// quality cells' root-text condition sets it (conditions.ts: the root's font-size at 200%,
// important). Each failure names the widest boxes past the window's right edge that neither a
// fixed layer nor a scroller holds.

const PAGES = [
  ['long-text', [320, 390]],
  ['music', [320]],
  ['photography', [320]],
  ['writing', [320]],
] as const;

function appOptionsFor(name: string) {
  const fixture = contractFixture(name);
  const dir = path.dirname(fixture.files.portfolio);
  return {
    portfolio: fixture.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(fixture.files.site, 'utf8'), 'editorial-evidence'),
    sourceFiles: Object.fromEntries(
      fixture.unitFiles.map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]),
    ),
  };
}

// Each fixture its own server, started for its tests: a worker's app takes one set of options,
// and each fixture has its own. Its tests run in order, each on its own, so one that fails doesn't
// skip the next; a new worker starts the server again.
for (const [name, widths] of PAGES) {
  test.describe(name, () => {
    test.describe.configure({ mode: 'default' });
    let app: { origin: string; stop: () => Promise<void> } | undefined;
    test.beforeAll(async () => {
      app = await startApp(appOptionsFor(name));
    });
    test.afterAll(async () => {
      await app?.stop();
    });

    for (const width of widths) {
      test.describe(`at ${width}`, () => {
        test.use({
          viewport: { width, height: width === 320 ? 568 : 844 },
          isMobile: true,
          hasTouch: true,
        });

        test(
          `with the root text at 200% on ${name} at ${width}, the home page doesn't scroll sideways`,
          { annotation: [{ type: 'route', description: '/' }] },
          async ({ page }) => {
            await page.goto(`${app!.origin}/`, { waitUntil: 'networkidle' });
            await page.evaluate(() => document.fonts.ready);
            await page.evaluate(() =>
              document.documentElement.style.setProperty('font-size', '200%', 'important'),
            );
            await page.evaluate(
              () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
            );
            const read = await page.evaluate(() => {
              const html = document.documentElement;
              const room = html.clientWidth + 0.5;
              const name = (el: Element) =>
                `${el.localName}${[...el.classList].map((c) => `.${c}`).join('')}`;
              // Held: under a fixed layer, or clipped or scrolled by an ancestor, or in a shut fold.
              const held = (el: Element) => {
                if (el.closest('details:not([open])') && !el.closest('summary')) return true;
                for (let up: Element | null = el; up && up !== html; up = up.parentElement) {
                  const style = getComputedStyle(up);
                  if (style.position === 'fixed') return true;
                  if (up !== el && style.overflowX !== 'visible') return true;
                }
                return false;
              };
              const past = [...document.body.querySelectorAll('*')]
                .filter((el) => el.getClientRects().length > 0)
                .map((el) => ({ el, r: el.getBoundingClientRect() }))
                .filter(({ el, r }) => r.right > room && r.width > 0 && !held(el))
                .sort((a, b) => b.r.right - a.r.right)
                .slice(0, 6)
                .map(({ el, r }) => `${name(el)} ${r.left.toFixed(1)}..${r.right.toFixed(1)}`);
              return { scroll: html.scrollWidth, client: html.clientWidth, past };
            });
            expect(
              read.scroll,
              `the page is no wider than the screen; past its edge: ${read.past.join('; ')}`,
            ).toBeLessThanOrEqual(read.client);
          },
        );
      });
    }
  });
}
