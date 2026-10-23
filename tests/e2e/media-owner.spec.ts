import { readFileSync } from 'node:fs';
import { DEFAULT_PORTFOLIO, DEFAULT_SITE } from '../harness/app-server.mjs';
import { expect, test } from '../harness/fixtures';
import { draftWithCover, expectNotFound } from '../harness/media';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { mintDraft, publish, seedDraftWith, signIn } from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';
import { expectFrameImage } from '../harness/studio-preview';

// #10's draft media under owner, against the built server: a draft's
// renditions serve only under its preview grant, private and no-store, and
// from /media only once it's published, when the grant ends; and Studio's
// preview frame renders them, under the preview CSP. The draft is the
// harness fixture with its work cover a local file, its rendition seeded
// into the store as ingestion would put it. The images are made here, from
// nothing. media-preview-origin.spec.ts renders the frame on a preview
// origin of its own.

const MEDIA = { type: 'route', description: '/media/[...path]' };
const ASSETS = { type: 'route', description: '/preview-assets/[grant]/[...path]' };
const OWNER = { type: 'profile', description: 'owner' };

const secret = ownerSecret();
test.use({ appOptions: ownerApp(secret.hash) });

const draft = () =>
  draftWithCover(readFileSync(DEFAULT_PORTFOLIO, 'utf8'), readFileSync(DEFAULT_SITE, 'utf8'));

test(
  "a draft's media serves under its grant alone, private and no-store, and from /media once published",
  { annotation: [ASSETS, MEDIA, OWNER] },
  async ({ page, app, request }) => {
    const csrf = await signIn(page, app, secret.password);
    const { documents, blobs, rendition, original, file } = draft();
    const seeded = await seedDraftWith(app, documents, blobs);
    const grant = await mintDraft(page, csrf, seeded);
    const asImage = { 'sec-fetch-dest': 'image' };

    const served = await request.get(`/preview-assets/${grant}/${file}`, { headers: asImage });
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toBe('image/png');
    expect(served.headers()['cache-control']).toBe('private, no-store');
    expect(served.headers()['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(await served.body()).equals(rendition)).toBe(true);
    // Not live yet: /media and the live page know nothing of it.
    await expectNotFound(await request.get(`/media/${file}`), 'a draft on /media');
    expect(await (await request.get('/')).text()).not.toContain(original);
    // Another grant's name, or another destination, gets the status document.
    for (const [url, headers] of [
      [`/preview-assets/${'x'.repeat(22)}/${file}`, asImage],
      [`/preview-assets/${grant}/${file}`, { 'sec-fetch-dest': 'document' }],
    ] as const) {
      const refused = await request.get(url, { headers });
      expect(refused.status(), url).toBe(404);
      expect(refused.headers()['cache-control'], url).toContain('no-store');
      expect(refused.headers()['content-type'], url).toMatch(/^text\/html/);
    }

    // Published: /media serves it, for a year, the page names it, and the draft's grant ends.
    await publish(app, seeded);
    const live = await request.get(`/media/${file}`);
    expect(live.status()).toBe(200);
    expect(live.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(Buffer.from(await live.body()).equals(rendition)).toBe(true);
    expect(await (await request.get('/')).text()).toContain(`/media/${file}`);
    const ended = await request.get(`/preview-assets/${grant}/${file}`, { headers: asImage });
    expect(ended.status()).toBe(404);
    expect(ended.headers()['content-type']).toMatch(/^text\/html/);
  },
);

test(
  "Studio's preview frame renders the draft's image from its grant's /preview-assets, under the preview CSP",
  { annotation: [ASSETS, OWNER] },
  async ({ page, app }) => {
    const { documents, blobs, file } = draft();
    await seedDraftWith(app, documents, blobs);
    await expectFrameImage(page, app, secret.password, file, app.origin);
  },
);
