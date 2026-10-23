import { expect, test } from '../harness/fixtures';
import { send } from '../harness/http-client.mjs';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { ownerApp } from '../harness/profile-matrix';
import {
  environmentIn,
  frameElement,
  openPreview,
  PREVIEW_PAGE,
  stage,
} from '../harness/studio-preview';

// The owner's preview on a preview origin of its own (#7, Slice 4):
// PORTFOLIO_PREVIEW_ORIGIN on preview.localhost, which the browser resolves
// to loopback while the server still binds 127.0.0.1. Owner frames load
// from it with allow-same-origin, Studio's frame-src names it, and Studio's
// half of the channel holds the handshake to it. That origin serves the
// preview's paths alone: everything else there is the 404 an unknown path
// gets, read off the request's Host and nothing else.

const secret = ownerSecret();
test.use({ appOptions: { ...ownerApp(secret.hash), previewHost: 'preview.localhost' } });

const PAGE = { type: 'route', description: '/studio/preview' };

test(
  "owner frames load from the preview origin with allow-same-origin, under a frame-src that names it, and Studio's channel works with them there (#7, Slice 4)",
  { annotation: [PAGE] },
  async ({ page, app }) => {
    const previewOrigin = app.previewOrigin!;
    expect(new URL(previewOrigin).hostname).toBe('preview.localhost');
    const studioPage = page.waitForResponse(
      (response) => new URL(response.url()).pathname === PREVIEW_PAGE,
    );
    const { frame } = await openPreview(page, app, secret.password, 'Origin Person');
    const csp = (await studioPage).headers()['content-security-policy'] ?? '';
    expect(csp).toContain(`frame-src 'self' ${previewOrigin};`);
    await expect(frameElement(page)).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
    expect(new URL(frame.url()).origin).toBe(previewOrigin);
    expect(await frame.evaluate(() => self.origin)).toBe(previewOrigin);
    expect(await frame.textContent('body')).toContain('Origin Person');
    // The handshake held to the frame's origin, and Studio's messages reach it.
    await page.getByRole('combobox', { name: 'Display mode' }).selectOption('dark');
    await expect.poll(() => environmentIn(frame)).toMatchObject({ displayMode: 'dark' });
    await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
  },
);

test(
  "on the preview origin, where a frame's document has an origin and so the Navigation API, the guard's backstop cancels what no click showed it, a link in a closed shadow root, a script's location.assign(), and a pushState() or replaceState() outside the grant, shows each to the owner as a link, and lets a reload, the grant's own paths, and Studio's own loads go on (#7, Slices 3 and 4)",
  { annotation: [PAGE] },
  async ({ page, app, blockedRequests }) => {
    const { frame } = await openPreview(page, app, secret.password, 'Backstop Origin Person');
    const frameUrl = frame.url();
    const grantPath = new URL(frameUrl).pathname;
    const target = page.locator('.preview-surface__href');
    // A link in a closed shadow root, which a click doesn't show the guard.
    await frame.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'closed-host';
      const root = host.attachShadow({ mode: 'closed' });
      const link = document.createElement('a');
      link.href = 'https://example.test/shadow';
      link.textContent = 'A link in a closed shadow root';
      // The whole host, so a click on it is on the link.
      link.style.display = 'block';
      root.append(link);
      document.body.prepend(host);
    });
    await frame.locator('#closed-host').click();
    await expect(page.getByText('The preview tried to open another site:')).toBeVisible();
    await expect(target).toHaveText('https://example.test/shadow');
    // A script's own navigation.
    await frame.evaluate(() => location.assign('https://example.test/assign'));
    await expect(target).toHaveText('https://example.test/assign');
    // A history change outside the grant, which a reload would load next:
    // the frame's URL stays the grant's, and the owner sees where it went,
    // as the site's own page.
    for (const [change, path] of [
      ['pushState', '/studio'],
      ['replaceState', '/studio/drafts'],
    ] as const) {
      const after = await frame.evaluate(
        ([how, to]) => {
          try {
            history[how](null, '', to);
          } catch {
            // A cancelled change may throw. Either way the URL stays.
          }
          return location.pathname;
        },
        [change, path] as const,
      );
      expect(after, change).toBe(grantPath);
      await expect(page.getByText('The preview tried to open a page of this site:')).toBeVisible();
      await expect(target).toHaveText(`${app.origin}${path}`);
    }
    expect(blockedRequests.filter((url) => url.startsWith('https://example.test/'))).toEqual([]);
    expect(frame.url()).toBe(frameUrl);
    await expect(stage(page)).toHaveAttribute('data-phase', 'ready');

    // A reload, and the grant's own path, load as before, each a new document.
    const marked = () =>
      frame.evaluate(() => {
        (window as unknown as { kept?: boolean }).kept = true;
      });
    const reloaded = () =>
      expect
        .poll(() =>
          frame
            .evaluate(() => (window as unknown as { kept?: boolean }).kept ?? false)
            .catch(() => true),
        )
        .toBe(false);
    await marked();
    await frame.evaluate(() => {
      setTimeout(() => location.reload(), 0);
    });
    await reloaded();
    await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
    await marked();
    await frame.evaluate((href) => {
      setTimeout(() => location.assign(href), 0);
    }, grantPath);
    await reloaded();
    await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
    expect(new URL(frame.url()).pathname).toBe(grantPath);

    // Studio's own load of a new grant, from another origin than the
    // frame's, isn't the frame's to cancel.
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect.poll(() => new URL(frame.url()).pathname).not.toBe(grantPath);
    await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
    expect(new URL(frame.url()).origin).toBe(app.previewOrigin);
  },
);

test(
  'the preview origin serves /preview, /preview-assets, /_next/static, and /_portfolio alone, by its Host, and everything else there is the 404 an unknown path gets (#7, Slice 4)',
  { annotation: [PAGE] },
  async ({ app }) => {
    const previewHost = new URL(app.previewOrigin!).host;
    const canonicalHost = new URL(app.origin).host;
    const get = (path: string, host: string, accept = 'text/html') =>
      send({ protocol: 'http:', port: app.port, path, headers: { host, accept } });
    // A build asset, from the page that names it.
    const studio = await get('/studio/sign-in', canonicalHost);
    const asset = /\/_next\/static\/[^"']+\.js/.exec(studio.body)?.[0];
    expect(asset, 'a build asset on the sign-in page').toBeTruthy();
    expect((await get(asset!, previewHost, '*/*')).status).toBe(200);
    // A grant path gets its own rules there: the preview's status document.
    const grantPath = `/preview/${'G'.repeat(22)}`;
    const refused = await get(grantPath, previewHost);
    expect(refused.status).toBe(404);
    expect(refused.headers['content-security-policy']).toMatch(/^default-src 'none'/);
    expect(refused.body).toContain('This preview is not available. Open it from Studio.');
    // Everything else on the preview origin is the unknown path's 404, the
    // same as on the canonical origin, where the same paths answer as usual.
    const unknown = await get('/no-such-page', canonicalHost);
    expect(unknown.status).toBe(404);
    for (const path of [
      '/',
      '/studio',
      '/studio/sign-in',
      PREVIEW_PAGE,
      '/sample',
      '/feed.xml',
      '/robots.txt',
      '/sitemap.xml',
      '/api/health',
      '/api/ready',
      '/api/studio/auth.session',
      '/previews',
      '/_next/image?url=%2Fx.png&w=64&q=75',
      '/_portfolio',
    ]) {
      const there = await get(path, previewHost);
      expect(there.status, `${path} on the preview origin`).toBe(404);
      expect(there.headers['set-cookie'], path).toBeUndefined();
    }
    expect((await get('/api/health', canonicalHost, 'application/json')).status).toBe(200);
    expect((await get('/robots.txt', canonicalHost, 'text/plain')).status).toBe(200);
  },
);
