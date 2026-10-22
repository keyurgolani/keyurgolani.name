import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import {
  inventory,
  nonceOf,
  recordViolations,
  violations,
  type DocumentInventory,
} from '../harness/preview-document';
import { ownerApp } from '../harness/profile-matrix';
import { PREVIEW_CSP } from '../harness/route-headers.mjs';

// The preview's document and headers under owner (#7, Slice 1), against the
// built server: what a preview path answers before any preview route serves
// it, the stylesheets public pages load now that host chrome is Studio's
// alone, and what crawlers are told. Under owner, so a Studio page shows the
// sentinel and Studio's own scripts are there to compare against.

const secret = ownerSecret();
test.use({ appOptions: ownerApp(secret.hash) });

const PREVIEW = { type: 'route', description: '/preview' };

/**
 * Loads `path` and returns its inventory with the response's CSP, once the
 * page is idle, so a prefetch it starts has run. The test calls
 * recordViolations first.
 */
async function load(page: Page, path: string, status: number) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(status);
  const csp = response?.headers()['content-security-policy'];
  await page.waitForLoadState('networkidle');
  return { csp, found: await inventory(page, nonceOf(csp)) };
}

/** Selectors from host chrome or Studio's own stylesheet. */
const studioSelectors = (found: DocumentInventory) =>
  found.selectors.filter((selector) => /\.(?:host-chrome|studio)\b/.test(selector));

test(
  "a preview path's page loads no Studio stylesheet, script, or markup, carries the nonce on every script, and raises no CSP violation",
  { annotation: [PREVIEW] },
  async ({ page }) => {
    await recordViolations(page);
    // Studio's sign-in page, for what only Studio loads: the sentinel, its
    // selectors, and the scripts a page outside Studio doesn't get.
    const studio = await load(page, '/studio/sign-in', 200);
    expect(studio.found.sentinel, 'the sentinel shows on a Studio page').toBe('present');
    expect(studioSelectors(studio.found).length).toBeGreaterThan(0);
    const site = await load(page, '/no-such-page', 404);
    const studioOnly = studio.found.scripts.filter((src) => !site.found.scripts.includes(src));
    expect(studioOnly.length, "scripts only Studio's pages load").toBeGreaterThan(0);

    for (const path of ['/preview/editorial', '/preview-assets/g_7Hk-2/asset', '/PREVIEW/x']) {
      const { csp, found } = await load(page, path, 404);
      expect(csp, path).toMatch(PREVIEW_CSP);
      expect(found.sentinel, `${path}: the sentinel`).toBe('');
      expect(studioSelectors(found), `${path}: Studio's selectors`).toEqual([]);
      // The experience's own stylesheets did load.
      expect(found.selectors.some((selector) => selector.includes('host-skip-link'))).toBe(true);
      expect(
        found.scripts.filter((src) => studioOnly.includes(src)),
        `${path}: Studio's scripts`,
      ).toEqual([]);
      expect(found.unnoncedInline, `${path}: inline scripts without the nonce`).toBe(0);
      expect(found.forms + found.passwordFields, `${path}: Studio's forms`).toBe(0);
      expect(
        found.classes.filter((name) => name.startsWith('studio')),
        `${path}: Studio's markup`,
      ).toEqual([]);
      expect(await violations(page), `${path}: CSP violations`).toEqual([]);
    }
  },
);

test(
  'every preview response carries one CSP, a nonce of its own, and the nonce on every script and stylesheet Next renders',
  { annotation: [PREVIEW] },
  async ({ request }) => {
    const nonces = new Set<string>();
    for (const path of ['/preview/editorial', '/preview/editorial', '/preview-assets/a/b']) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(404);
      const policies = response
        .headersArray()
        .filter(({ name }) => name.toLowerCase() === 'content-security-policy');
      expect(policies.length, `${path}: CSP headers`).toBe(1);
      const nonce = nonceOf(policies[0]?.value);
      expect(nonce, path).not.toBe('');
      nonces.add(nonce);
      const html = await response.text();
      const tags = [
        ...html.matchAll(/<script\b[^>]*>/g),
        ...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g),
        ...html.matchAll(/<style\b[^>]*>/g),
      ].map(([tag]) => tag);
      expect(tags.length, path).toBeGreaterThan(1);
      for (const tag of tags) expect(tag, `${path}: no nonce`).toContain(`nonce="${nonce}"`);
    }
    expect(nonces.size, 'a nonce came twice').toBe(3);
  },
);

test(
  "public pages and their 404 load the experience's stylesheets and no host chrome or Studio stylesheet",
  { annotation: [{ type: 'route', description: '/' }] },
  async ({ page }) => {
    await recordViolations(page);
    for (const [path, status] of [
      ['/', 200],
      ['/no-such-page', 404],
    ] as const) {
      const { found } = await load(page, path, status);
      expect(found.sentinel, `${path}: the sentinel`).toBe('');
      expect(studioSelectors(found), `${path}: Studio's selectors`).toEqual([]);
      expect(found.selectors.some((selector) => selector.includes('host-skip-link'))).toBe(true);
    }
  },
);

test(
  'robots.txt disallows no preview path, so crawlers fetch one and see its noindex, and the sitemap lists none',
  { annotation: [PREVIEW, { type: 'route', description: '/robots.txt' }] },
  async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toMatch(/Disallow: \/studio/);
    expect(robots).not.toMatch(/preview/i);
    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).toContain('<loc>');
    expect(sitemap).not.toMatch(/preview/i);
    const preview = await request.get('/preview/editorial', { maxRedirects: 0 });
    expect(preview.headers()['x-robots-tag']).toBe('noindex, nofollow');
  },
);
