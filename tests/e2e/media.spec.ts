import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import type { APIResponse } from '@playwright/test';
import { DEFAULT_PORTFOLIO, DEFAULT_SITE } from '../harness/app-server.mjs';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { mintDraft, publish, seedDraftWith, signIn } from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';
import { visitorOutput } from '../harness/visitor-output';

// #10's media over HTTP, against the built server. read-only derives the
// mounted pair's images at startup from PORTFOLIO_MEDIA_ROOT, and a visitor
// gets the public one's renditions from /media, in the page and in the
// browser. A private record's image never reaches the HTML, the RSC
// payload, the feed, the JSON-LD, or /media, even at the address its
// renditions would have. Under owner, a draft's media serves only under its
// grant, private and no-store, and from /media only once it's published.
// The images are made here, from nothing.

const MEDIA = { type: 'route', description: '/media/[...path]' };
const ASSETS = { type: 'route', description: '/preview-assets/[grant]/[...path]' };
const READ_ONLY = { type: 'profile', description: 'read-only' };
const OWNER = { type: 'profile', description: 'owner' };
const CANARY = 'canary-media-private';

/** A solid `width` by `height` PNG of `rgb`, encoded by hand. */
function solidPng(width: number, height: number, rgb: readonly [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgb).flat())]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(height).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The renditions a page's HTML names for `assetId`, as /media paths. */
const renditionsOf = (html: string, assetId: string) => [
  ...new Set(html.match(new RegExp(`/media/${assetId}/[0-9a-f]{64}/[a-z0-9-]+\\.[a-z0-9]+`, 'g'))),
];

async function expectNotFound(response: APIResponse, label: string) {
  expect(response.status(), label).toBe(404);
  expect(response.headers()['cache-control'], label).toBe('no-store');
  expect(await response.text(), label).toBe('Not found.');
}

test.describe('read-only', () => {
  // The worker writes the media root and the pair before its server starts.
  const base = path.join(tmpdir(), `portfolio-media-spec-${randomUUID()}`);
  const root = path.join(base, 'media');
  const portfolio = path.join(base, 'portfolio.yml');
  const PUBLIC = solidPng(640, 400, [40, 90, 140]);
  const PRIVATE = solidPng(640, 400, [140, 40, 90]);

  test.use({
    appOptions: {
      portfolio,
      site: DEFAULT_SITE,
      // The media cache goes under the run's own directory too.
      env: { PORTFOLIO_MEDIA_ROOT: root, TMPDIR: base },
    },
  });

  test.beforeAll(() => {
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, 'fixture-garden.png'), PUBLIC);
    writeFileSync(path.join(root, `${CANARY}.png`), PRIVATE);
    // The harness fixture, its cover a local file, and a private work with
    // a private image beside it in the visible works section.
    const text = readFileSync(DEFAULT_PORTFOLIO, 'utf8')
      .replace('https://media.rowan.test/fixture-garden.png', 'fixture-garden.png')
      .replace(
        'media:\n',
        [
          `  - id: ${CANARY}-work`,
          `    title: ${CANARY}-title`,
          '    medium: software',
          '    visibility: private',
          `    summary: ${CANARY}-summary`,
          '    cover:',
          `      asset: ${CANARY}-cover`,
          'media:',
          '',
        ].join('\n'),
      )
      .replace(
        'contact:\n',
        [
          `  - id: ${CANARY}-cover`,
          '    kind: image',
          `    source: ${CANARY}.png`,
          '    visibility: private',
          `    alt: ${CANARY}-alt`,
          'contact:',
          '',
        ].join('\n'),
      )
      .replace('      - fixture-garden\n', `      - fixture-garden\n      - ${CANARY}-work\n`);
    writeFileSync(portfolio, text);
  });
  test.afterAll(() => rmSync(base, { recursive: true, force: true }));

  /** The page's HTML once startup derivation has finished, which happens in the background. */
  async function derivedHome(request: Parameters<typeof visitorOutput>[0]) {
    await expect
      .poll(
        async () => renditionsOf(await (await request.get('/')).text(), 'fixture-garden-cover'),
        {
          timeout: 30_000,
        },
      )
      .not.toEqual([]);
    return (await request.get('/')).text();
  }

  test(
    "a private record's image reaches no HTML, RSC payload, feed, JSON-LD, or /media, where the public one serves",
    { annotation: [MEDIA, READ_ONLY] },
    async ({ request }) => {
      const html = await derivedHome(request);
      const renditions = renditionsOf(html, 'fixture-garden-cover');
      expect(renditions[0]).toContain(`/${sha256(PUBLIC)}/`);
      for (const url of renditions) {
        const response = await request.get(url);
        expect(response.status(), url).toBe(200);
        expect(response.headers()['content-type'], url).toMatch(/^image\/(?:webp|png)$/);
        expect(response.headers()['cache-control'], url).toBe(
          'public, max-age=31536000, immutable',
        );
        expect(response.headers()['x-content-type-options'], url).toBe('nosniff');
      }

      const output = await visitorOutput(request);
      const hash = sha256(PRIVATE);
      for (const [name, text] of Object.entries({
        html: output.html,
        payload: output.payload,
        feed: output.feed,
        jsonLd: JSON.stringify(output.jsonLd),
      })) {
        expect(text, name).not.toContain(CANARY);
        expect(text, name).not.toContain(hash);
      }
      // At each address a rendition of it would have, and under the public
      // asset's name: the same uncached 404 as a path that names nothing.
      for (const url of renditions) {
        const file = url.split('/').at(-1)!;
        await expectNotFound(await request.get(`/media/${CANARY}-cover/${hash}/${file}`), file);
        await expectNotFound(
          await request.get(`/media/fixture-garden-cover/${hash}/${file}`),
          `public name, private hash: ${file}`,
        );
      }
      await expectNotFound(
        await request.get(`/media/fixture-garden-cover/${sha256(PUBLIC)}/${sha256(PUBLIC)}.png`),
        'the original',
      );
      await expectNotFound(await request.get('/assets/fixture-garden.png'), '/assets');
    },
  );

  test(
    'a published image renders in the browser, from /media, under the CSP',
    { annotation: [MEDIA, READ_ONLY] },
    async ({ page, request }) => {
      await derivedHome(request);
      const blocked: string[] = [];
      page.on('console', (message) => {
        if (/Content Security Policy/i.test(message.text())) blocked.push(message.text());
      });
      const loads: string[] = [];
      page.on('response', (response) => {
        const { pathname } = new URL(response.url());
        if (pathname.startsWith('/media/') && response.status() === 200) loads.push(pathname);
      });
      await page.goto('/');
      const image = page.locator('img[alt="Rows of identical seedlings"]');
      await expect(image).toBeVisible();
      await expect
        .poll(() =>
          image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth),
        )
        .toBeGreaterThan(0);
      expect(await image.evaluate((element: HTMLImageElement) => element.currentSrc)).toMatch(
        /\/media\/fixture-garden-cover\/[0-9a-f]{64}\//,
      );
      expect(loads.length).toBeGreaterThan(0);
      expect(blocked).toEqual([]);
      await expect(page.getByText('Image unavailable')).toHaveCount(0);
    },
  );
});

test.describe('owner', () => {
  const secret = ownerSecret();
  test.use({ appOptions: ownerApp(secret.hash) });

  test(
    "a draft's media serves under its grant alone, private and no-store, and from /media once published",
    { annotation: [ASSETS, MEDIA, OWNER] },
    async ({ page, app, request }) => {
      const csrf = await signIn(page, app, secret.password);
      const rendition = solidPng(480, 300, [60, 120, 60]);
      const blob = sha256(rendition);
      const original = sha256(solidPng(960, 600, [60, 120, 60]));
      const documents = {
        portfolio: {
          format: 'yaml' as const,
          sourceText: [
            'schemaVersion: 3',
            'locale: en',
            'direction: ltr',
            'identity:',
            '  name: Draft Photographer',
            '  avatar:',
            '    asset: portrait',
            'media:',
            '  - id: portrait',
            '    kind: image',
            '    source: portrait.png',
            '    alt: The photographer',
            'sections:',
            '  - kind: lede',
            '    id: about',
            '    body: Hi.',
            '',
          ].join('\n'),
        },
        site: { format: 'yaml' as const, sourceText: readFileSync(DEFAULT_SITE, 'utf8') },
        media: {
          format: 'json' as const,
          sourceText: JSON.stringify({
            assets: [
              {
                assetId: 'portrait',
                sha256: original,
                mime: 'image/png',
                bytes: 4096,
                width: 960,
                height: 600,
                renditions: [
                  {
                    name: 'w480-a1',
                    ext: 'png',
                    mime: 'image/png',
                    bytes: rendition.length,
                    width: 480,
                    sha256: blob,
                  },
                ],
                derivedAt: '2026-10-23T08:00:00Z',
                algorithmVersion: 1,
                source: { kind: 'local', path: 'portrait.png' },
                availability: { state: 'available' },
              },
            ],
          }),
        },
      };
      const draft = await seedDraftWith(app, documents, [
        { bytes: rendition, mediaType: 'image/png' },
      ]);
      const grant = await mintDraft(page, csrf, draft);
      const file = `portrait/${original}/w480-a1.png`;
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

      // Published: /media serves it, for a year, and the draft's grant ends.
      await publish(app, draft);
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
});
