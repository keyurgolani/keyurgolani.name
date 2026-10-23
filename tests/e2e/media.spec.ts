import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_PORTFOLIO, DEFAULT_SITE } from '../harness/app-server.mjs';
import { expect, test } from '../harness/fixtures';
import { expectNotFound, renditionsOf, sha256, solidPng } from '../harness/media';
import { visitorOutput } from '../harness/visitor-output';

// #10's media over HTTP, against the built server, under read-only: it
// derives the mounted pair's images at startup from PORTFOLIO_MEDIA_ROOT,
// and a visitor gets the public one's renditions from /media, in the page
// and in the browser. A private record's image never reaches the HTML, the
// RSC payload, the feed, the JSON-LD, or /media, even at the address its
// renditions would have. media-owner.spec.ts serves a draft's under its
// grant. The images are made here, from nothing.

const MEDIA = { type: 'route', description: '/media/[...path]' };
const READ_ONLY = { type: 'profile', description: 'read-only' };
const CANARY = 'canary-media-private';

// The media root and the pair, under a directory of this worker's own.
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

/** Writes the media root and the pair. */
function writeSources() {
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
}

// A worker writes them as it loads this file: its server starts as the
// first test's fixtures are set up, before any hook runs. The runner's own
// process only lists the tests, and writes nothing.
if (process.env.TEST_WORKER_INDEX !== undefined) writeSources();
test.afterAll(() => rmSync(base, { recursive: true, force: true }));

/** The page's HTML once startup derivation has finished, which happens in the background. */
async function derivedHome(request: Parameters<typeof visitorOutput>[0]) {
  await expect
    .poll(async () => renditionsOf(await (await request.get('/')).text(), 'fixture-garden-cover'), {
      timeout: 30_000,
    })
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
      // The record's type, which the rendition's extension matches.
      const ext = url.split('.').at(-1)!;
      expect(response.headers()['content-type'], url).toBe(
        { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' }[ext],
      );
      expect(response.headers()['cache-control'], url).toBe('public, max-age=31536000, immutable');
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
    // Nothing mounts into public/: /assets is the site's own 404, as any path no route has.
    const assets = await request.get('/assets/fixture-garden.png');
    expect(assets.status()).toBe(404);
    expect(assets.headers()['content-type']).toMatch(/^text\/html/);
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
