import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import type * as Registry from '../../apps/web/src/lib/generated/registry.meta';
import { CONTRACT_FIXTURE_NAMES } from '../../packages/variant-contract/src/contract-fixtures';
import { startApp } from '../harness/app-server.mjs';
import { inventory, nonceOf, recordViolations, violations } from '../harness/preview-document';
import { PREVIEW_HEADERS } from '../harness/route-headers.mjs';

// The preview's dev fixture route under `next dev` (#7, Slice 1, item 8):
// every #5 contract fixture, in every variant this checkout registers, in a
// real preview document. The production build answers the route as a path
// no route matches, which the profile matrix checks.

// apps/web has no "type": "module", so its modules are CommonJS to Node and
// load through require().
const require = createRequire(import.meta.url);
const { VARIANTS } =
  require('../../apps/web/src/lib/generated/registry.meta.ts') as typeof Registry;

const PREVIEW = { type: 'route', description: '/preview/dev/[variant]/[fixture]' };

// One dev server for the file: next dev keeps its output in apps/web/.next/dev.
test.describe.configure({ mode: 'serial', timeout: 300_000 });

let app: Awaited<ReturnType<typeof startApp>>;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  app = await startApp({ dev: true });
});
test.afterAll(async () => {
  await app?.stop();
});

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * The preview's policy under next dev, which adds eval, the inline styles
 * Next's dev tools and hot reloading add, and same-origin connections,
 * framed by `origin` alone.
 */
const devPolicy = (origin: string) =>
  new RegExp(
    `^default-src 'none'; script-src 'nonce-([A-Za-z0-9+/]{22}==)' 'strict-dynamic' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${escaped(origin)}$`,
  );

/** Selectors from host chrome or Studio's own stylesheet. */
const HOST_SELECTOR = /\.(?:host-chrome|studio)\b/;

/** Loads `path` on the dev server and returns its response, once the page is idle. */
async function open(page: Page, path: string) {
  const response = await page.goto(`${app.origin}${path}`);
  await page.waitForLoadState('networkidle');
  return response;
}

test(
  'every #5 fixture renders on the dev route with the preview headers, no CSP violation, and no host CSS',
  { annotation: [PREVIEW] },
  async ({ page }) => {
    await recordViolations(page);
    expect(VARIANTS.length).toBeGreaterThan(0);
    expect(CONTRACT_FIXTURE_NAMES.length).toBeGreaterThan(10);
    for (const { manifest } of VARIANTS) {
      for (const fixture of CONTRACT_FIXTURE_NAMES) {
        const path = `/preview/dev/${manifest.id}/${fixture}`;
        const response = await open(page, path);
        expect(response?.status(), path).toBe(200);
        const policies = (await response!.headersArray()).filter(
          ({ name }) => name.toLowerCase() === 'content-security-policy',
        );
        expect(policies.length, `${path}: CSP headers`).toBe(1);
        const csp = policies[0]!.value;
        expect(csp, path).toMatch(devPolicy(app.origin));
        const headers = response!.headers();
        for (const [name, value] of Object.entries(PREVIEW_HEADERS)) {
          // next dev sends its own Cache-Control on every page after the
          // app's, no-store since 16.4, so a dev page never stays in a cache;
          // a production build sends private, no-store, which the profile
          // matrix checks.
          const expected = name === 'cache-control' ? 'no-store' : value;
          expect(headers[name], `${path}: ${name}`).toBe(expected);
        }
        // The composition the route names, in the preview document.
        await expect(page.locator('[data-variant]'), path).toHaveAttribute(
          'data-variant',
          manifest.id,
        );
        const found = await inventory(page, nonceOf(csp));
        expect(found.sentinel, `${path}: the sentinel`).toBe('');
        expect(
          found.selectors.filter((selector) => HOST_SELECTOR.test(selector)),
          `${path}: host CSS`,
        ).toEqual([]);
        expect(
          found.selectors.some((selector) => selector.includes('[data-ui-slot="skip-link"]')),
          "the skip link's focus ring",
        ).toBe(true);
        expect(found.forms + found.passwordFields, `${path}: Studio's forms`).toBe(0);
        // No theme script: a preview document has none.
        expect(
          await page.evaluate(() => document.documentElement.dataset.theme ?? null),
          `${path}: the theme script`,
        ).toBeNull();
        expect(await page.locator('meta[name="robots"]').getAttribute('content'), path).toBe(
          'noindex, nofollow',
        );
        expect(await violations(page), `${path}: CSP violations`).toEqual([]);
      }
    }
    // next dev asks npm for its latest version once hot reloading connects
    // (hot-reloader-shared-utils.js), which the egress trap refuses. Nothing
    // the app does may try to go out.
    expect(
      app.egress().filter((target) => target !== 'registry.npmjs.org:443'),
      'requests the dev server tried to send out',
    ).toEqual([]);
  },
);

test(
  'the dev route sets the environment its query asks for on the presentation boundary, and a variant, fixture, or value that names nothing gets the 404 an unknown path gets',
  { annotation: [PREVIEW] },
  async ({ page }) => {
    await recordViolations(page);
    const path = '/preview/dev/fallback/complete';
    const response = await open(
      page,
      `${path}?displayMode=dark&contrast=more&motion=reduce&enhancement=off`,
    );
    expect(response?.status()).toBe(200);
    const boundary = page.locator('[data-variant]');
    await expect(boundary).toHaveAttribute('data-display-mode', 'dark');
    await expect(boundary).toHaveAttribute('data-contrast', 'more');
    await expect(boundary).toHaveAttribute('data-motion', 'reduced');
    await expect(boundary).toHaveAttribute('data-enhancement', 'off');
    // motion=system is full motion as far as the frame goes, so the reader's
    // own setting decides, through the variant's prefers-reduced-motion.
    await open(page, `${path}?motion=system`);
    await expect(page.locator('[data-variant]')).toHaveAttribute('data-motion', 'full');
    expect(await violations(page)).toEqual([]);
    // next dev answers a path no route matches with the app's 404 page, as a
    // production build does, now that no visitor page has a catch-all route
    // of its own for it to fall through to (#6, Slice 2). Each is held to
    // what /no-such-page gets here.
    const notFound = /<h1>Page not found<\/h1>/;
    const unknown = await page.request.get(`${app.origin}/no-such-page`, { maxRedirects: 0 });
    expect(unknown.status()).toBe(404);
    expect(await unknown.text()).toMatch(notFound);
    for (const target of [
      '/preview/dev/no-such-variant/complete',
      '/preview/dev/fallback/no-such-fixture',
      `${path}?motion=fast`,
      `${path}?displayMode=dark&displayMode=light`,
    ]) {
      const missing = await page.request.get(`${app.origin}${target}`, { maxRedirects: 0 });
      expect(missing.status(), target).toBe(404);
      expect(await missing.text(), target).toMatch(notFound);
      expect(missing.headers()['x-robots-tag'], target).toBe('noindex, nofollow');
    }
  },
);
