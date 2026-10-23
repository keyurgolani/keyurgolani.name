import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import type { CatalogReader, RemoteFetcher } from '@portfolio/core';
import { startStartupMedia, startupMedia } from './startup-media';

// read-only's and demo's startup media (#10, Risk 3): derived once, in the
// background, into the media cache, with each asset's hash in the log.
// demo reads the bundled sample's media and fetches nothing; read-only reads
// PORTFOLIO_MEDIA_ROOT and fetches https sources; owner derives nothing here.

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

function solidPng(width: number, height: number): Buffer {
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
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array(width).fill([10, 20, 30]).flat()),
  ]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(height).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A reader serving a pair whose portfolio has these media entries. */
function reader(media: { id: string; source: string }[]): CatalogReader {
  return {
    getLive: async () => ({
      state: 'live',
      revisionId: 'source',
      unitHash: 'sha256:x',
      unit: {
        portfolio: { media: media.map((entry) => ({ ...entry, kind: 'image' })) },
        site: {},
        snapshots: {},
      },
    }),
  } as unknown as CatalogReader;
}

function setup(t: TestContext) {
  const base = mkdtempSync(path.join(tmpdir(), 'startup-media-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'media');
  mkdirSync(root);
  writeFileSync(path.join(root, 'cover.png'), solidPng(500, 250));
  const lines: Record<string, unknown>[] = [];
  t.mock.method(console, 'log', (text: string) => {
    try {
      lines.push(JSON.parse(text) as Record<string, unknown>);
    } catch {
      // Not a log line.
    }
  });
  return { base, root, cache: path.join(base, 'cache'), lines };
}

test("read-only derives from PORTFOLIO_MEDIA_ROOT and logs each asset's hash", async (t) => {
  const { root, cache, lines } = setup(t);
  const derived = await startStartupMedia({
    profile: 'read-only',
    reader: reader([{ id: 'cover', source: 'cover.png' }]),
    mediaRoot: root,
    options: { cacheDir: cache },
  });
  assert.ok(derived);
  assert.equal(await startupMedia(), derived, 'the route half reads what started');
  const [record] = derived.document.assets;
  assert.equal(record?.assetId, 'cover');
  assert.ok(
    lines.some(
      (line) =>
        line.event === 'media.startup.asset' &&
        line.assetId === 'cover' &&
        line.sha256 === record?.sha256,
    ),
  );
  assert.ok(lines.some((line) => line.event === 'media.startup.derived' && line.count === 1));
  // No path or URL reaches the log.
  assert.ok(!JSON.stringify(lines).includes(root));
});

test('read-only fetches https sources through its fetcher; demo never fetches, whatever it names', async (t) => {
  const { root, cache } = setup(t);
  const png = solidPng(64, 64);
  let fetches = 0;
  const fetchRemote: RemoteFetcher = async () => {
    fetches++;
    return new Uint8Array(png);
  };
  const media = [{ id: 'remote', source: 'https://images.example.net/a.png' }];
  const readOnly = await startStartupMedia({
    profile: 'read-only',
    reader: reader(media),
    options: { cacheDir: cache, fetchRemote },
  });
  assert.equal(fetches, 1);
  assert.equal(readOnly?.document.assets[0]?.assetId, 'remote');

  const demo = await startStartupMedia({
    profile: 'demo',
    reader: reader([...media, { id: 'cover', source: 'cover.png' }]),
    sampleMedia: root,
    options: { cacheDir: path.join(cache, 'demo'), fetchRemote },
  });
  assert.equal(fetches, 1, 'demo fetched nothing');
  assert.deepEqual(
    demo?.document.assets.map(({ assetId }) => assetId),
    ['cover'],
  );
  assert.deepEqual(
    demo?.findings.map(({ assetId, code }) => [assetId, code]),
    [['remote', 'fetch_denied']],
  );
});

test('with nothing to derive from, read-only skips; owner never derives here; a failure never throws', async (t) => {
  const { cache, lines } = setup(t);
  const skipped = await startStartupMedia({
    profile: 'read-only',
    reader: reader([{ id: 'cover', source: 'cover.png' }]),
    options: { cacheDir: cache },
  });
  assert.equal(skipped, null);
  assert.ok(lines.some((line) => line.event === 'media.startup.skipped'));
  const owner = await startStartupMedia({
    profile: 'owner',
    reader: reader([{ id: 'cover', source: 'cover.png' }]),
    mediaRoot: cache,
  });
  assert.equal(owner, null);
  const broken = await startStartupMedia({
    profile: 'demo',
    reader: {
      getLive: async () => Promise.reject(new Error('unreadable')),
    } as unknown as CatalogReader,
    sampleMedia: cache,
  });
  assert.equal(broken, null);
  assert.ok(lines.some((line) => line.event === 'media.startup.failed'));
});

test("demo's bundled sample derives from example-media, every image of it", async (t) => {
  const { cache, lines } = setup(t);
  const sample = [
    { id: 'portrait', source: 'anamika/portrait.png' },
    { id: 'small-traces', source: 'work/small-traces.png' },
  ];
  const derived = await startStartupMedia({
    profile: 'demo',
    reader: reader(sample),
    sampleMedia: path.join(REPO, 'example-media'),
    options: { cacheDir: cache },
  });
  assert.deepEqual(
    derived?.document.assets.map(({ assetId }) => assetId),
    ['portrait', 'small-traces'],
  );
  assert.deepEqual(derived?.findings, []);
  assert.equal(lines.filter((line) => line.event === 'media.startup.asset').length, 2);
});
