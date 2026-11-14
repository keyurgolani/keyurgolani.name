import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';

// The host's skip link, focused, on every first-party composition at 390 on phone emulation, on home
// and on a work's page: it shows at the page's top-left, over whatever chrome the composition puts
// there, so it's the element at its own center. The skip link's focus style is the platform's own,
// shared by every composition that sets none of its own, so one composition's chrome at a higher
// stacking level would hide it on every page that composition renders. On the complete contract
// fixture, each composition's default packs.
//
// Each composition needs its own site document, so each group starts its own server rather than the
// harness's one per file. The browser reaches nothing outside it, and the server nothing outside the
// machine.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const PACKAGES = fileURLToPath(new URL('../../packages/', import.meta.url));
const COMPOSITIONS = readdirSync(PACKAGES)
  .filter((name) => name.startsWith('variant-') && name !== 'variant-contract')
  .map((name) => name.slice('variant-'.length))
  .sort();

type App = Awaited<ReturnType<typeof startApp>>;

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

for (const composition of COMPOSITIONS) {
  test.describe(composition, () => {
    // One server for the group's tests, in order.
    test.describe.configure({ mode: 'default' });
    let app: App;

    test.beforeAll(async () => {
      // As long as the harness gives a server to start.
      test.setTimeout(120_000);
      app = await startApp({
        portfolio: FIXTURE.files.portfolio,
        siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), composition),
        sourceFiles: Object.fromEntries(
          FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
        ),
        logFile: test.info().outputPath('server.log'),
      });
    });
    test.afterAll(async () => {
      await app?.stop();
    });
    /** The browser reaches the server alone. */
    const guard = (context: BrowserContext) =>
      context.route('**/*', (route) =>
        new URL(route.request().url()).origin === app.origin
          ? route.continue()
          : route.abort('blockedbyclient'),
      );
    test.beforeEach(async ({ context }) => {
      await guard(context);
    });
    test.afterEach(() => {
      expect(app.egress(), 'hosts the server tried to reach').toEqual([]);
    });

    for (const route of ['/', '/work/project-name']) {
      test(
        `${composition} on ${route} at 390: the focused skip link is the element at its own center`,
        { annotation: [{ type: 'route', description: route === '/' ? '/' : '/work/[slug]' }] },
        async ({ page }) => {
          await page.goto(`${app.origin}${route}`, { waitUntil: 'networkidle' });
          await expect(page.locator('[data-variant]').first()).toHaveAttribute(
            'data-variant',
            composition,
          );
          const skip = page.locator('[data-ui-slot="skip-link"]').first();
          await expect(skip).toHaveCount(1);
          await page.keyboard.press('Shift');
          await skip.focus();
          await expect(skip).toBeFocused();
          const hit = await skip.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            const own = top !== null && (top === el || el.contains(top));
            const name = top
              ? `${top.localName}${[...top.classList].map((each) => `.${each}`).join('')}`
              : 'nothing';
            return own ? 'itself' : name;
          });
          expect(hit, `what's at the focused skip link's center on ${composition} ${route}`).toBe(
            'itself',
          );
        },
      );
    }
  });
}
