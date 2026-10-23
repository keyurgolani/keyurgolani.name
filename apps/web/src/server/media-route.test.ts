import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parsePortfolio, parseSite, type MediaRecord } from '@portfolio/schema';
import { GET } from '../app/(site)/media/[...path]/route';
import type { PublicationUnit } from './catalog-port';
import { readDeploymentConfig } from './config';
import { setDeploymentState } from './config-store';

// GET /media (#10, slice 2 item 5): a rendition of the live revision's
// media, for an asset its public view keeps, at the revision it holds, with
// the record's Content-Type and a year's immutable cache. Anything else is
// the same uncached 404, and a rendition whose blob is gone logs it once.

const PAIRS = fileURLToPath(
  new URL('../../../../packages/schema/src/__fixtures__/pairs/photography/yaml/', import.meta.url),
);
const PORTFOLIO = readFileSync(`${PAIRS}portfolio.yml`, 'utf8');
const SITE = readFileSync(`${PAIRS}site.yml`, 'utf8');

const hex = (digit: string) => digit.repeat(64);
const BYTES = Buffer.from('a webp rendition, in bytes');

const record = (assetId: string, digit: string): MediaRecord => ({
  assetId,
  sha256: hex(digit),
  mime: 'image/jpeg',
  bytes: 4096,
  width: 960,
  height: 640,
  renditions: [
    {
      name: 'w480-a1',
      ext: 'webp',
      mime: 'image/webp',
      bytes: BYTES.length,
      width: 480,
      sha256: hex('f'),
    },
  ],
  derivedAt: '2026-10-23T08:00:00Z',
  algorithmVersion: 1,
  source: { kind: 'local', path: `images/${assetId}.jpg` },
  availability: { state: 'available' },
});

/** A read-only deployment serving the photography pair, `nets-on-the-quay` private. */
function deploy(
  t: TestContext,
  blobs: Map<string, Buffer> = new Map([[`sha256:${hex('f')}`, BYTES]]),
) {
  const portfolio = parsePortfolio(
    PORTFOLIO.replace(
      '    alt: Nets drying on a quay\n',
      '    alt: Nets drying on a quay\n    visibility: private\n',
    ),
    'yaml',
  );
  const site = parseSite(SITE, 'yaml');
  assert.ok(portfolio.ok && site.ok);
  const unit: PublicationUnit = {
    portfolio: portfolio.value,
    site: site.value,
    media: { assets: [record('ferry-at-dawn', 'a'), record('nets-on-the-quay', 'b')] },
    snapshots: {},
  };
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: 'read-only',
      PORTFOLIO_ORIGIN: 'https://rowan.test',
      PORTFOLIO_SOURCE_DIR: '/srv/portfolio',
    },
    { cwd: '/' },
  );
  assert.ok(read.ok);
  const opened: string[] = [];
  setDeploymentState({
    config: read.config,
    catalog: {
      getLive: async () => ({ state: 'live', revisionId: 'source', unitHash: 'sha256:x', unit }),
    } as never,
    dispatch: () => assert.fail('no dispatch here'),
    degraded: [],
    mediaBlobs: async (hash) => {
      opened.push(hash);
      const bytes = blobs.get(hash);
      return bytes ? Readable.from([bytes]) : null;
    },
  });
  t.after(() => setDeploymentState(undefined));
  return { opened };
}

const get = (path: string, init: RequestInit = {}) =>
  GET(new Request(`https://rowan.test/media/${path}`, init), {
    params: Promise.resolve({ path: path.split('/') }),
  } as never);

test("a kept asset's rendition serves its bytes with the record's type, cached for a year, and no Range", async (t) => {
  deploy(t);
  const response = await get(`ferry-at-dawn/${hex('a')}/w480-a1.webp`, {
    headers: { range: 'bytes=0-3' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.equal(response.headers.get('content-length'), String(BYTES.length));
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('accept-ranges'), 'none');
  assert.equal(response.headers.get('content-range'), null);
  assert.ok(Buffer.from(await response.arrayBuffer()).equals(BYTES));

  const head = await get(`ferry-at-dawn/${hex('a')}/w480-a1.webp`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(BYTES.length));
  assert.equal(head.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(head.body, null);
});

test('a private, unknown, or superseded asset, an original, or any other path is the same uncached 404', async (t) => {
  const { opened } = deploy(t);
  for (const path of [
    `nets-on-the-quay/${hex('b')}/w480-a1.webp`,
    `nobody/${hex('a')}/w480-a1.webp`,
    `ferry-at-dawn/${hex('c')}/w480-a1.webp`,
    `ferry-at-dawn/${hex('a')}/w960-a1.webp`,
    `ferry-at-dawn/${hex('a')}/w480-a1.jpg`,
    `ferry-at-dawn/${hex('a')}/${hex('a')}.jpg`,
    `ferry-at-dawn/${hex('a')}`,
    'probe',
  ]) {
    const response = await get(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get('cache-control'), 'no-store', path);
    assert.equal(await response.text(), 'Not found.', path);
  }
  assert.deepEqual(opened, [], 'no blob was opened for any of them');
});

test('a rendition whose blob is gone is a 404 with no-store, logged once per asset', async (t) => {
  deploy(t, new Map());
  const logged = t.mock.method(console, 'log', () => {});
  for (let i = 0; i < 3; i++) {
    const response = await get(`ferry-at-dawn/${hex('a')}/w480-a1.webp`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const lines = logged.mock.calls
    .map((call) => JSON.parse(String(call.arguments[0])) as Record<string, unknown>)
    .filter((line) => line.event === 'media.blob.missing');
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.assetId, 'ferry-at-dawn');
});

test('before startup, /media is the 503 every route answers', async () => {
  setDeploymentState(undefined);
  const response = await get(`ferry-at-dawn/${hex('a')}/w480-a1.webp`);
  assert.equal(response.status, 503);
});
