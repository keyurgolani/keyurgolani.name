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
