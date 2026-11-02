import type { Response } from '@playwright/test';
import { encodings, REFERENCE_CANARIES } from '../harness/canaries.mjs';
import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';

// The demo's read-only reference (#9, A1's privacy half) in a browser, on
// this checkout's build with the CI fixture mounted: every page under
// /reference the reference's links reach, loaded with JavaScript on, and
// every response that page and its scripts, payloads, styles, and images
// get, carries none of the fixture's canaries, in a body or a header. Its
// images load from /reference/media alone, and nothing loads from another
// host. The profile matrix probes each route one by one; this follows what
// a visitor's browser actually fetches.

test.use({ appOptions: DEMO_APP });

const DEMO = { type: 'profile', description: 'demo' };
const LEAKS = REFERENCE_CANARIES.flatMap(encodings);
/** The most pages the sweep follows. */
const MOST = 40;

test(
  "no response a visitor's browser gets across the reference's pages carries a canary, and every image is the reference's own",
  {
    annotation: [{ type: 'route', description: '/reference/[[...path]]' }, DEMO],
  },
  async ({ page, app, blockedRequests }) => {
    test.setTimeout(180_000);
    const responses: Response[] = [];
    page.on('response', (response) => responses.push(response));
    const queue = ['/reference'];
    const seen = new Set<string>();
    while (queue.length > 0 && seen.size < MOST) {
      const at = queue.shift()!;
      if (seen.has(at)) continue;
      seen.add(at);
      const response = await page.goto(at);
      expect(response?.status(), at).toBe(200);
      await page.waitForLoadState('networkidle');
      for (const href of await page
        .locator('a[href]')
        .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href))) {
        const url = new URL(href);
        if (url.origin !== app.origin || !/^\/reference(?:\/|$)/.test(url.pathname)) continue;
        if (url.pathname.startsWith('/reference/media/')) continue;
        queue.push(`${url.pathname}${url.search}`);
      }
      const images = await page
        .locator('img')
        .evaluateAll((found) => found.map((image) => (image as HTMLImageElement).currentSrc));
      for (const src of images.filter(Boolean)) {
        const url = new URL(src);
        if (url.protocol === 'data:') continue;
        expect(url.origin, src).toBe(app.origin);
        expect(url.pathname, src).toMatch(/^\/reference\/media\//);
      }
    }
    expect(seen.has('/reference'), 'the sweep loaded the reference').toBe(true);
    const leaked: string[] = [];
    for (const response of responses) {
      const body = await response.body().catch(() => Buffer.alloc(0));
      const text = `${JSON.stringify(await response.allHeaders())}\n${body.toString('latin1')}`;
      for (const canary of LEAKS) {
        if (text.includes(canary)) leaked.push(`${response.url()}: ${canary}`);
      }
    }
    expect(leaked).toEqual([]);
    expect(blockedRequests).toEqual([]);
  },
);
