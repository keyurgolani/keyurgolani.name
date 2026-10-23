import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { APIResponse, Frame, Page } from '@playwright/test';
import { DEFAULT_SITE } from '../harness/app-server.mjs';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import {
  inventory,
  nonceOf,
  recordViolations,
  violations,
  type DocumentInventory,
} from '../harness/preview-document';
import {
  command,
  ENVIRONMENT,
  mint,
  mintDraft,
  mountFrame,
  publish,
  seedDraft,
  signIn,
} from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';
import { PREVIEW_CSP } from '../harness/route-headers.mjs';

// The preview under owner (#7), against the built server: a grant's frame
// (Slice 2), mounted on a Studio page as Studio will mount it, the one
// status document every other preview request gets, their headers, the
// stylesheets public pages load now that host chrome is Studio's alone, and
// what crawlers are told. Under owner, so a Studio page shows the sentinel
// and Studio's own scripts and stylesheets are there to compare against.

const secret = ownerSecret();
test.use({ appOptions: ownerApp(secret.hash) });

const PREVIEW = { type: 'route', description: '/preview' };
const GRANT = { type: 'route', description: '/preview/[grant]/[[...route]]' };
const ASSETS = { type: 'route', description: '/preview-assets/[grant]/[...path]' };
const UNAVAILABLE = 'This preview is not available. Open it from Studio.';

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

/** The theme the site's theme script painted, or null where none ran. */
const paintedTheme = (page: Page | Frame) =>
  page.evaluate(() => document.documentElement.dataset.theme ?? null);

/** What a frame load of a grant path looks like to the server: an iframe document. */
const asFrame = { 'sec-fetch-dest': 'iframe' };

/** Expects the status document: 404, the preview's headers, and its words alone. */
async function expectStatusDocument(response: APIResponse, what: string) {
  expect(response.status(), what).toBe(404);
  expect(response.headers()['content-type'], what).toBe('text/html; charset=utf-8');
  expect(response.headers()['content-security-policy'], what).toMatch(PREVIEW_CSP);
  expect(response.headers()['cache-control'], what).toBe('private, no-store');
  expect(response.headers()['x-robots-tag'], what).toBe('noindex, nofollow');
  expect(response.headers()['set-cookie'], what).toBeUndefined();
  const body = await response.text();
  expect(body, what).toContain(`<p>${UNAVAILABLE}</p>`);
  expect(body, what).not.toMatch(/<script|<link|<style|<a\b|class=|id=/);
}

test(
  "a preview path's page loads no Studio stylesheet, script, or markup, and no theme script, carries the nonce on every script, and raises no CSP violation",
  { annotation: [PREVIEW, GRANT] },
  async ({ page, app }) => {
    await recordViolations(page);
    // Studio's sign-in page, for what only Studio loads: the sentinel, its
    // selectors, and the stylesheets and scripts no public page gets. What a
    // public page loads too, such as Next's own shared chunks, isn't Studio's.
    const studio = await load(page, '/studio/sign-in', 200);
    expect(studio.found.sentinel, 'the sentinel shows on a Studio page').toBe('present');
    expect(studioSelectors(studio.found).length).toBeGreaterThan(0);
    const notFound = await load(page, '/no-such-page', 404);
    // The site's 404 runs the site's theme script, as its pages do.
    expect(await paintedTheme(page), 'the theme on the site 404').not.toBeNull();
    const site = [notFound, await load(page, '/', 200)];
    const publicScripts = new Set(site.flatMap(({ found: each }) => each.scripts));
    const studioOnly = studio.found.scripts.filter((src) => !publicScripts.has(src));
    expect(studioOnly.length, "scripts only Studio's pages load").toBeGreaterThan(0);
    const publicSheets = new Set(site.flatMap(({ found: each }) => each.stylesheets));
    const studioSheets = studio.found.stylesheets.filter((href) => !publicSheets.has(href));
    expect(studioSheets.length, "stylesheets only Studio's pages load").toBeGreaterThan(0);

    // A grant's frame, on a Studio page, with Studio's sandbox: the portfolio
    // a visitor gets, and nothing of Studio's.
    const csrf = await signIn(page, app, secret.password);
    const grant = await mintDraft(page, csrf, await seedDraft(app, 'Inventory Person'));
    const { frame, response } = await mountFrame(page, `/preview/${grant}`);
    expect(response.status()).toBe(200);
    const csp = response.headers()['content-security-policy'];
    expect(csp).toMatch(PREVIEW_CSP);
    await frame.waitForLoadState('networkidle');
    const found = await inventory(frame, nonceOf(csp));
    expect(await frame.textContent('body')).toContain('Inventory Person');
    expect(await paintedTheme(frame), "the frame's theme script").toBeNull();
    expect(found.classes, "the experience's skip link").toContain('host-skip-link');
    expect(found.stylesheets.length, "the experience's stylesheets").toBeGreaterThan(0);
    expect(found.sentinel, 'the sentinel').toBe('');
    expect(studioSelectors(found), "Studio's selectors").toEqual([]);
    expect(found.stylesheets.filter((href) => studioSheets.includes(href))).toEqual([]);
    expect(
      found.scripts.filter((src) => studioOnly.includes(src)),
      "Studio's scripts",
    ).toEqual([]);
    expect(found.unnoncedInline, 'inline scripts without the nonce').toBe(0);
    expect(found.forms + found.passwordFields, "Studio's forms").toBe(0);
    expect(found.classes.filter((name) => name.startsWith('studio'))).toEqual([]);
    expect(await violations(frame), "the frame's CSP violations").toEqual([]);

    // Every other preview path, the same grant loaded top level included:
    // the status document, which loads nothing at all.
    for (const path of [
      `/preview/${grant}`,
      '/preview/editorial',
      '/preview-assets/g_7Hk-2/asset',
      '/PREVIEW/x',
    ]) {
      const { csp: policy, found: status } = await load(page, path, 404);
      expect(policy, path).toMatch(PREVIEW_CSP);
      expect(await paintedTheme(page), `${path}: the theme script`).toBeNull();
      expect(status.sentinel, `${path}: the sentinel`).toBe('');
      expect(status.stylesheets, `${path}: stylesheets`).toEqual([]);
      expect(status.scripts, `${path}: scripts`).toEqual([]);
      expect(status.classes, `${path}: markup`).toEqual([]);
      expect(status.forms + status.passwordFields, `${path}: forms`).toBe(0);
      expect(await page.textContent('body'), path).toContain(UNAVAILABLE);
      expect(await violations(page), `${path}: CSP violations`).toEqual([]);
    }
  },
);

test(
  'every preview response carries one CSP, a nonce of its own, and the nonce on every script and stylesheet Next renders',
  { annotation: [PREVIEW, GRANT] },
  async ({ page, app, request }) => {
    const csrf = await signIn(page, app, secret.password);
    const grant = await mintDraft(page, csrf, await seedDraft(app, 'Header Person'));
    const nonces = new Set<string>();
    const policiesOf = (response: APIResponse) =>
      response
        .headersArray()
        .filter(({ name }) => name.toLowerCase() === 'content-security-policy');
    // The frame's document, which Next renders.
    for (const path of [`/preview/${grant}`, `/preview/${grant}`]) {
      const response = await request.get(path, { maxRedirects: 0, headers: asFrame });
      expect(response.status(), path).toBe(200);
      const policies = policiesOf(response);
      expect(policies.length, `${path}: CSP headers`).toBe(1);
      const nonce = nonceOf(policies[0]?.value);
      expect(nonce, path).not.toBe('');
      nonces.add(nonce);
      const html = await response.text();
      const tags = [
        ...html.matchAll(/<script\b[^>]*>/g),
        ...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g),
        ...html.matchAll(/<style\b[^>]*>/g),
      ]
        .map(([tag]) => tag)
        .filter((tag) => !tag.includes('application/ld+json'));
      expect(tags.length, path).toBeGreaterThan(1);
      for (const tag of tags) expect(tag, `${path}: no nonce`).toContain(`nonce="${nonce}"`);
    }
    // The status document, which renders nothing that could carry one.
    for (const path of ['/preview/editorial', '/preview/editorial', '/preview-assets/a/b']) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(404);
      const policies = policiesOf(response);
      expect(policies.length, `${path}: CSP headers`).toBe(1);
      const nonce = nonceOf(policies[0]?.value);
      expect(nonce, path).not.toBe('');
      nonces.add(nonce);
      expect(await response.text(), path).not.toMatch(/<script|<link|<style/);
    }
    expect(nonces.size, 'a nonce came twice').toBe(5);
  },
);

test(
  "a grant's frame renders the draft version it pinned, with no cookie read, and every other way to ask for it gets the one status document (#7)",
  { annotation: [GRANT, ASSETS] },
  async ({ page, app, request }) => {
    const csrf = await signIn(page, app, secret.password);
    const draft = await seedDraft(app, 'Pinned Person');
    const grant = await mintDraft(page, csrf, draft);
    // The draft moves on, and nothing mints its new version.
    await seedDraft(app, 'Moved Person');
    const { frame, response } = await mountFrame(page, `/preview/${grant}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('private, no-store');
    expect(response.headers()['set-cookie']).toBeUndefined();
    const text = (await frame.textContent('body')) ?? '';
    expect(text).toContain('Pinned Person');
    expect(text).not.toContain('Moved Person');
    // Every link to a path stays under the grant.
    const links = await frame.evaluate(() =>
      Array.from(document.querySelectorAll('a[href^="/"]'), (link) => link.getAttribute('href')),
    );
    for (const href of links) expect(href, 'a link out of the grant').toMatch(`/preview/${grant}`);
    // A query changes nothing: not the version, the variant, or the environment.
    const variantOf = (html: string) => /data-variant="([^"]+)"/.exec(html)?.[1];
    const plainText = await (await request.get(`/preview/${grant}`, { headers: asFrame })).text();
    const queried = await request.get(`/preview/${grant}?displayMode=dark&variant=other`, {
      headers: asFrame,
    });
    expect(queried.status()).toBe(200);
    const queriedText = await queried.text();
    expect(queriedText).toContain('Pinned Person');
    expect(variantOf(plainText)).toBeDefined();
    expect(variantOf(queriedText)).toBe(variantOf(plainText));
    // The environment is the grant's own (#7, Slice 4), whatever the query says.
    expect(plainText).toContain('data-display-mode="system"');
    expect(queriedText).toContain('data-display-mode="system"');
    expect(queriedText).not.toContain('data-display-mode="dark"');

    // Top level, no Fetch Metadata, a wrong destination, or a method but GET
    // and HEAD: the status document.
    const frameUrl = `/preview/${grant}`;
    await expectStatusDocument(
      await request.get(frameUrl, { headers: { 'sec-fetch-dest': 'document' } }),
      'top level',
    );
    await expectStatusDocument(await request.get(frameUrl), 'no Fetch Metadata');
    for (const destination of ['image', 'script', 'empty', 'object', 'embed']) {
      await expectStatusDocument(
        await request.get(frameUrl, { headers: { 'sec-fetch-dest': destination } }),
        destination,
      );
    }
    await expectStatusDocument(await request.post(frameUrl, { headers: asFrame }), 'POST');
    // An asset the grant's media doesn't hold, under any destination, is the
    // status document too. media.spec.ts serves one it does (#10).
    const asset = `/preview-assets/${grant}/a1/${'0'.repeat(64)}/large.webp`;
    for (const destination of ['image', 'font', 'iframe']) {
      await expectStatusDocument(
        await request.get(asset, { headers: { 'sec-fetch-dest': destination } }),
        `asset as ${destination}`,
      );
    }

    // Revoked, as Studio rotates or unmounts a frame: the next load renders nothing.
    const revoked = await command(page, csrf, 'preview.grant.revoke', { grant });
    expect(revoked.body.data).toEqual({ revoked: true });
    await expectStatusDocument(await request.get(frameUrl, { headers: asFrame }), 'revoked');
    const remounted = await mountFrame(page, frameUrl);
    expect(remounted.response.status()).toBe(404);
    expect(await remounted.frame.textContent('body')).toContain(UNAVAILABLE);
    const status = await command(page, csrf, 'preview.grant.status', { grant });
    expect(status.body.data).toEqual({ status: 'superseded' });
  },
);

test(
  'publishing a draft ends its grant at the next request while a revision grant renders on, and logout ends every grant (#7)',
  { annotation: [GRANT] },
  async ({ page, app, request }) => {
    const csrf = await signIn(page, app, secret.password);
    const revisionId = await publish(app, await seedDraft(app, 'Live Person'));
    const revisionGrant = await mint(page, csrf, { revision: revisionId });
    const next = await seedDraft(app, 'Next Person');
    const draftGrant = await mintDraft(page, csrf, next);
    const frameLoad = (grant: string) =>
      request.get(`/preview/${grant}`, { headers: asFrame, maxRedirects: 0 });
    expect((await frameLoad(draftGrant)).status()).toBe(200);

    // Published from another process, as the CLI does: the server hears no
    // event, and its check finds the draft gone.
    await publish(app, next);
    await expectStatusDocument(await frameLoad(draftGrant), 'a published draft');
    const status = await command(page, csrf, 'preview.grant.status', { grant: draftGrant });
    expect(status.body.data).toEqual({ status: 'superseded' });
    const revision = await frameLoad(revisionGrant);
    expect(revision.status()).toBe(200);
    expect(await revision.text()).toContain('Live Person');

    const out = await page.evaluate(
      async (token) =>
        (
          await fetch('/api/studio/auth.logout', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-csrf-token': token },
            body: '{}',
          })
        ).status,
      csrf,
    );
    expect(out).toBe(200);
    await expectStatusDocument(await frameLoad(revisionGrant), 'after logout');
  },
);

test(
  'a draft version with blocks-preview findings gets no grant, only how many there are (#7)',
  { annotation: [GRANT] },
  async ({ page, app }) => {
    const csrf = await signIn(page, app, secret.password);
    const site = readFileSync(DEFAULT_SITE, 'utf8');
    const broken = site.replace(
      'motionPolicy: respect-os',
      'motionPolicy: respect-os\nnoSuchKey: 1',
    );
    expect(broken).not.toBe(site);
    const draft = await seedDraft(app, 'Blocked Person', broken);
    const minted = await command(page, csrf, 'preview.grant.mint', {
      subject: { draft: draft.draftId, version: draft.version },
      environment: ENVIRONMENT,
    });
    expect(minted.status).toBe(200);
    expect(minted.body.data?.status).toBe('preview_blocked');
    expect(minted.body.data?.diagnostics).toBeGreaterThan(0);
    expect(Object.keys(minted.body.data ?? {}).sort()).toEqual(['diagnostics', 'status']);
  },
);

test(
  'an active grant whose content no longer reads gets a neutral 500 with a reference the log carries, never another portfolio, and the log names the grant by its ref alone (#7)',
  { annotation: [GRANT] },
  async ({ page, app }) => {
    const csrf = await signIn(page, app, secret.password);
    const damaged = await publish(app, await seedDraft(app, 'Damaged Person'));
    // Another revision goes live, so the damaged one is only history.
    await publish(app, await seedDraft(app, 'Current Person'));
    const grant = await mint(page, csrf, { revision: damaged });
    // Damaged on disk after the mint, as a bad restore would leave it, and
    // put back after the load, for the tests that share this server.
    const manifest = path.join(
      app.env.PORTFOLIO_DATA_DIR ?? '',
      'revisions',
      damaged,
      'manifest.json',
    );
    const intact = readFileSync(manifest);
    writeFileSync(manifest, '{');
    let mounted: Awaited<ReturnType<typeof mountFrame>>;
    try {
      mounted = await mountFrame(page, `/preview/${grant}`);
    } finally {
      writeFileSync(manifest, intact);
    }
    const { frame, response } = mounted;
    expect(response.status()).toBe(500);
    expect(response.headers()['content-security-policy']).toMatch(PREVIEW_CSP);
    expect(response.headers()['cache-control']).toBe('private, no-store');
    expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow');
    await expect(frame.locator('main')).toContainText("This preview couldn't be shown.");
    const text = (await frame.textContent('body')) ?? '';
    const reference = /Reference: (\S+)/.exec(text)?.[1];
    expect(reference, 'the reference').toBeDefined();
    for (const name of ['Damaged Person', 'Current Person', 'Rowan Fixture', 'Anamika Devi']) {
      expect(text, name).not.toContain(name);
    }
    // The server log: the failure by the grant's ref, the request's error by
    // the same reference, and never the token.
    const lines = async () => {
      const log = readFileSync(app.log, 'utf8');
      expect(log, 'the token in the log').not.toContain(grant);
      return log
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    };
    await expect
      .poll(async () => (await lines()).some((line) => line.event === 'preview.render_failed'))
      .toBe(true);
    const failed = (await lines()).filter((line) => line.event === 'preview.render_failed');
    for (const line of failed) {
      expect(Object.keys(line).sort()).toEqual(['event', 'grantRef', 'level', 'ts']);
      expect(line.grantRef).toMatch(/^[0-9a-f]{8}$/);
    }
    await expect
      .poll(async () =>
        (await lines()).some((line) => line.event === 'request.error' && line.digest === reference),
      )
      .toBe(true);
  },
);

test(
  "a trailing slash on a grant path is a 308 that is private and no-store and never checks the grant, and a repeated slash is Next's own bare 308 to the grant path, which does (#7)",
  { annotation: [GRANT] },
  async ({ page, app, request }) => {
    const csrf = await signIn(page, app, secret.password);
    const grant = await mintDraft(page, csrf, await seedDraft(app, 'Slash Person'));
    for (const target of [grant, 'A'.repeat(22)]) {
      const slash = await request.get(`/preview/${target}/`, { maxRedirects: 0, headers: asFrame });
      expect(slash.status(), target).toBe(308);
      expect(slash.headers()['location'], target).toBe(`/preview/${target}`);
      expect(slash.headers()['cache-control'], target).toBe('private, no-store');
      expect(slash.headers()['x-robots-tag'], target).toBe('noindex, nofollow');
      expect(slash.headers()['referrer-policy'], target).toBe('no-referrer');
      expect(slash.headers()['content-security-policy'], target).toMatch(PREVIEW_CSP);
    }
    // Next answers a repeated slash before the app runs, with none of the
    // preview's headers (docs/deployment.md). The path it names is the grant
    // path, which checks the grant on its own request.
    const repeated = await request.get(`${app.origin}//preview/${grant}`, { maxRedirects: 0 });
    expect(repeated.status()).toBe(308);
    expect(repeated.headers()['location']).toBe(`/preview/${grant}`);
    expect(repeated.headers()['cache-control']).toBeUndefined();
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
