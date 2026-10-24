import { expect, test } from '../harness/fixtures';
import { DEMO_APP, profileMatrix } from '../harness/profile-matrix';
import { FALLBACK_ID, VARIANTS } from '../harness/registry';
import { withoutNonces } from '../harness/route-headers.mjs';
import { withRscHash } from '../harness/rsc';

// The demo profile (#1, slice 3; #9): the bundled sample at / and /sample,
// with nothing for crawlers to index, no cookie, no structured data, and the
// same body for the same URL, and the route-level matrix (AC4) for demo. The
// sample site selects Editorial Evidence, the platform default, which this
// build registers (#13), so both render it.
// /sample?variant= renders a variant this build registers, and anything else
// it names falls back to the sample's own at the canonical URL (#9). The
// sample's case study renders at /sample/work/<slug>, from the sample's own
// slugs, and the root's works list links it there (#10b).
const DEMO = { type: 'profile', description: 'demo' };
// identity.name in portfolio.example.yml.
const SAMPLE_NAME = 'Anamika Devi';

// The sample's images are its own, bundled beside it, and have no rendition
// until #10's second slice derives them, so the page asks no host for one.
test.use({ appOptions: DEMO_APP });

profileMatrix('demo');

for (const route of ['/', '/sample']) {
  test(
    `${route} renders the bundled sample in its own selection, Editorial Evidence (#13)`,
    { annotation: [{ type: 'route', description: route }, DEMO] },
    async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      const root = page.locator('[data-variant]');
      await expect(root).toHaveAttribute('data-variant', 'editorial-evidence');
      await expect(root).not.toHaveAttribute('data-requested-variant', /./);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(SAMPLE_NAME);
    },
  );
}

test(
  "/sample?variant= naming the fallback, an unregistered id, nothing, or two ids falls back to the sample's own selection at the canonical URL, and the page names none of it (#9)",
  { annotation: [{ type: 'route', description: '/sample' }, DEMO] },
  async ({ page, app }) => {
    for (const query of [
      'variant=fallback',
      'variant=canary-variant',
      'variant=',
      'variant=fallback&variant=fallback',
      'variant=canary-variant&canary-key=canary-value',
    ]) {
      const response = await page.goto(`/sample?${query}`);
      expect(response?.status(), query).toBe(200);
      // One 307, to /sample on the deployment's origin.
      const sent = response?.request().redirectedFrom();
      expect(sent?.url(), query).toBe(`${app.origin}/sample?${query}`);
      expect((await sent?.response())?.status(), query).toBe(307);
      expect(page.url(), query).toBe(`${app.origin}/sample`);
      // The sample's own selection, Editorial Evidence, which renders itself (#13).
      await expect(page.locator('[data-variant]'), query).toHaveAttribute(
        'data-variant',
        'editorial-evidence',
      );
      await expect(page.locator('[data-variant]'), query).not.toHaveAttribute(
        'data-requested-variant',
        /./,
      );
      await expect(page.getByRole('heading', { level: 1 }), query).toHaveText(SAMPLE_NAME);
      // Nothing the request sent that the registry refused is in the page, its payload included.
      expect(await page.content(), query).not.toMatch(/canary/i);
    }
  },
);

/**
 * Query values no axis accepts, each built so its marker sits between two
 * characters that change in every escaping: a percent-encoded URL leaves a
 * hex digit before it and `%` after it, and anything else, raw text, HTML
 * entities, or a JSON string's escapes, leaves something else there.
 */
const HOSTILE = [
  '"><script>zqhostileA</script>',
  '</script><img src=x onerror=zqhostileB>',
  '\\zqhostileC"\'`${1}',
  '\u202ezqhostileD\u2028\u00e4\u{1F600}',
  '&zqhostileE&amp;&lt;',
] as const;

/** Where a marker sits in `body` other than inside a percent-encoded URL string. */
function unencoded(body: string): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(/zqhostile[A-E]/g)) {
    const before = body[match.index - 1] ?? '';
    const after = body[match.index + match[0].length] ?? '';
    if (!/^[0-9A-Fa-f]$/.test(before) || after !== '%') {
      found.push(body.slice(Math.max(0, match.index - 24), match.index + 24));
    }
  }
  return found;
}

/** The document boundary's opening tag, which carries every axis the page renders. */
const boundaryOf = (html: string) =>
  /<div[^>]*data-appearance-boundary="document"[^>]*>/.exec(html)?.[0] ?? null;

test(
  'a rejected query value never decides an axis, and never appears in a 200 page, a payload, or a redirect except percent-encoded in a URL (#9)',
  { annotation: [{ type: 'route', description: '/sample' }, DEMO] },
  async ({ request }) => {
    // What the canonical selection renders, which the hostile requests must match.
    const canonical = new Map<string, string | null>();
    for (const path of ['/sample?mode=dark', '/?mode=dark']) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(200);
      canonical.set(path, boundaryOf(await response.text()));
      expect(canonical.get(path), path).toContain('data-display-mode="dark"');
    }
    for (const value of HOSTILE) {
      const sent = encodeURIComponent(value);
      const checks: Array<{ path: string; status: number; same?: string; rsc?: true }> = [
        // A document load the page sends to the canonical URL.
        { path: `/sample?mode=${sent}`, status: 307 },
        { path: `/sample?mode=dark&x=${sent}`, status: 307 },
        { path: `/?scheme=${sent}`, status: 307 },
        // Next strips _rsc before the page reads the query, so these render.
        { path: `/sample?_rsc=${sent}&mode=dark`, status: 200, same: '/sample?mode=dark' },
        { path: `/?_rsc=${sent}&mode=dark`, status: 200, same: '/?mode=dark' },
        // A client navigation: the RSC answer that carries the page's redirect.
        { path: `/sample?x=${sent}&mode=dark`, status: 200, rsc: true },
      ];
      for (const { path, status, same, rsc } of checks) {
        const headers: Record<string, string> = rsc ? { rsc: '1' } : {};
        const target = rsc ? await withRscHash(path, headers) : path;
        const response = await request.get(target, { maxRedirects: 0, headers });
        const what = `${JSON.stringify(value)} ${path}`;
        const body = await response.text();
        expect(unencoded(body), what).toEqual([]);
        // Every header too, the location included.
        for (const [name, header] of Object.entries(response.headers())) {
          expect(unencoded(header), `${what} ${name}`).toEqual([]);
        }
        expect(response.status(), what).toBe(status);
        if (rsc) expect(response.headers()['content-type'], what).toMatch(/^text\/x-component/);
        // The page renders the canonical selection's axes, every one of them.
        if (same) expect(boundaryOf(body), what).toBe(canonical.get(same));
      }
    }
  },
);

test(
  'identical URLs return identical bodies apart from the nonce, and no response sets a cookie (#9, A7)',
  { annotation: [{ type: 'route', description: '/sample' }, DEMO] },
  async ({ playwright, app }) => {
    // Two visitors with nothing in common, one sending cookies and headers of its own.
    const first = await playwright.request.newContext({ baseURL: app.origin });
    const second = await playwright.request.newContext({
      baseURL: app.origin,
      extraHTTPHeaders: {
        cookie: 'portfolio_appearance=mode%3Ddark; studio_session=canary-session',
        'accept-language': 'fr-FR',
        'user-agent': 'canary-agent',
      },
    });
    try {
      const paths = [
        '/',
        '/sample',
        '/sample?mode=dark',
        `/sample?variant=${VARIANTS.find(({ manifest }) => manifest.id !== FALLBACK_ID)?.manifest.id ?? FALLBACK_ID}&mode=light&motion=reduce`,
        '/sample/no-such-view',
        '/robots.txt',
        // Demo Studio, which keeps every choice in the visitor's browser (#9).
        '/studio',
        '/studio?mode=dark',
      ];
      for (const path of paths) {
        const bodies: string[] = [];
        for (const context of [first, second, first]) {
          const response = await context.get(path, { maxRedirects: 0 });
          expect(response.headers()['set-cookie'], path).toBeUndefined();
          bodies.push(withoutNonces(await response.text()));
        }
        expect(new Set(bodies).size, path).toBe(1);
        expect(bodies[0], path).not.toMatch(/canary/i);
      }
    } finally {
      await first.dispose();
      await second.dispose();
    }
  },
);

test(
  'robots.txt lets crawlers fetch every page, so they see its noindex, names no sitemap, and the sitemap is empty (#22)',
  { annotation: [{ type: 'route', description: '/robots.txt' }, DEMO] },
  async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toMatch(/^Allow: \/\s*$/m);
    expect(robots).not.toMatch(/Disallow/i);
    expect(robots).not.toMatch(/Sitemap:/i);
    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).not.toContain('<url>');
  },
);

test(
  'no demo page carries JSON-LD, so the sample never passes for a real person (#22)',
  { annotation: [{ type: 'route', description: '/sample' }, DEMO] },
  async ({ request }) => {
    const selectable = VARIANTS.map(({ manifest }) => manifest.id).filter(
      (id) => id !== FALLBACK_ID,
    );
    for (const url of ['/', '/sample', ...selectable.map((id) => `/sample?variant=${id}`)]) {
      const response = await request.get(url);
      expect(response.status(), url).toBe(200);
      expect(response.headers()['x-robots-tag'], url).toBe('noindex');
      const html = await response.text();
      expect(html, url).toContain(SAMPLE_NAME);
      expect(html, url).not.toContain('application/ld+json');
      expect(html, url).not.toContain('"@type":"Person"');
    }
  },
);

test(
  'a visit sets no cookie, and every response it loads is noindex',
  { annotation: [{ type: 'route', description: '/sample' }, DEMO] },
  async ({ page, context, app }) => {
    const responses: Array<{ url: string; robots: string | undefined }> = [];
    page.on('response', (response) => {
      if (new URL(response.url()).origin !== app.origin) return;
      responses.push({ url: response.url(), robots: response.headers()['x-robots-tag'] });
    });
    await page.goto('/sample', { waitUntil: 'networkidle' });
    await page.goto('/', { waitUntil: 'networkidle' });
    // Build assets included.
    expect(responses.some(({ url }) => new URL(url).pathname.startsWith('/_next/static/'))).toBe(
      true,
    );
    for (const { url, robots } of responses) expect(robots, url).toBe('noindex');
    expect(await context.cookies()).toEqual([]);
  },
);

test(
  'rendering the sample in every variant reaches no host outside the app',
  { annotation: [{ type: 'route', description: '/sample' }, DEMO] },
  async ({ page, app }) => {
    // Editorial Evidence at / and /sample, then each variant this build registers.
    const selectable = VARIANTS.map(({ manifest }) => manifest.id).filter(
      (id) => id !== FALLBACK_ID,
    );
    for (const url of ['/', '/sample', ...selectable.map((id) => `/sample?variant=${id}`)]) {
      const response = await page.goto(url, { waitUntil: 'networkidle' });
      expect(response?.status(), url).toBe(200);
    }
    expect(app.egress()).toEqual([]);
  },
);

test(
  "the sample's github section renders the snapshot bundled beside it, with its date (#10)",
  { annotation: [{ type: 'route', description: '/' }, DEMO] },
  async ({ page, app }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const github = page.locator('#on-github');
    await expect(github.getByRole('heading', { name: 'On GitHub' })).toBeVisible();
    // Its figures, its pinned repositories, and the day it was taken.
    for (const label of ['Repositories', 'Stars received', 'Contributions in the last year']) {
      await expect(github.locator('dt', { hasText: label })).toHaveCount(1);
    }
    await expect(github.getByRole('link', { name: 'postmortem-template-kit' })).toBeVisible();
    await expect(github.locator('time[datetime="2026-10-17"]')).toHaveText('October 17, 2026');
    await expect(github.getByRole('link', { name: 'anamika', exact: true })).toHaveAttribute(
      'href',
      'https://github.com/anamika',
    );
    // From the snapshot alone: the server reached no host for it.
    expect(app.egress()).toEqual([]);
  },
);

test(
  "the sample's case study renders at /sample/work/<slug>, linked from / and /sample, and any other slug is the 404 page (#10b)",
  { annotation: [{ type: 'route', description: '/sample/[[...path]]' }, DEMO] },
  async ({ page, request, app }) => {
    // The sample's signature work, portfolio.example.yml's one case study.
    const path = '/sample/work/postmortem-template-kit';
    for (const from of ['/', '/sample']) {
      await page.goto(from);
      await page.locator(`a[href="${path}"]`).first().click();
      await expect(page, from).toHaveURL(`${app.origin}${path}`);
      await expect(page.getByRole('heading', { level: 1 }), from).toHaveText(
        'Postmortem Template Kit',
      );
    }
    const headers = { RSC: '1' };
    const flight = await request.get(await withRscHash(path, headers), {
      headers,
      maxRedirects: 0,
    });
    expect(flight.status()).toBe(200);
    expect(flight.headers()['content-type']).toMatch(/^text\/x-component/);
    // A public work with no case study, and a slug the sample doesn't name.
    for (const other of ['/sample/work/small-traces', '/sample/work/no-such-work']) {
      const response = await page.goto(other);
      expect(response?.status(), other).toBe(404);
      await expect(page.getByRole('heading', { level: 1 }), other).toHaveText('Page not found');
    }
  },
);
