import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  mediaBlobs,
  parseMediaDocument,
  parsePortfolio,
  parseSite,
  parseSource,
  resolvePortfolioView,
  type MediaDocument,
} from '@portfolio/schema';
import { readManifest } from '../../store/revisions';
import { runRetention } from '../../store/retention';
import { verifyStore } from '../../store/verify';
import { nodeFs } from '../../store/fs-port';
import type { Store } from '../../store/store';
import { newStore, owned, pairInput, tempDir, testChecks } from '../../store/test-support/fixtures';
import type { Sha256 } from '../../store/layout';
import type { UnitInput } from '../unit';
import type { SharpLoad } from './derive';
import { mediaIngestion, type IngestInput, type MediaIngestionOptions } from './ingest';
import { localMediaRoot } from './local';
import { remoteImageFetcher, type RemoteTransport } from './remote';
import { cameraJpeg, carries, jpeg, png } from '../../store/test-support/images';

// Ingestion at draft save (#10, items 5 and 6, and VR2's identity half):
// an asset keeps its id and its place across a rename, a replacement, a
// metadata change, a missing source, and a restored one; a replacement
// takes over only once it derives; and a published revision never changes
// when its source does.

const PAIR = pairInput('photography');
const IDS = ['portrait', 'ferry-at-dawn', 'nets-on-the-quay'];

/** The photography pair's portfolio model, with `edit` applied to its text first. */
function portfolio(edit: (text: string) => string = (text) => text): unknown {
  const parsed = parseSource(edit(PAIR.portfolio.sourceText), 'yaml');
  assert.ok(parsed.ok);
  return parsed.data;
}

interface Setup {
  readonly store: Store;
  readonly root: string;
  readonly put: (relative: string, bytes: Uint8Array) => void;
  readonly clock: { now: number };
  readonly ingest: (
    input: Partial<IngestInput>,
  ) => ReturnType<ReturnType<typeof mediaIngestion>['ingest']>;
}

async function setup(
  t: { after(fn: () => void): void },
  options: Partial<MediaIngestionOptions> = {},
): Promise<Setup> {
  const store = await newStore(t, { checks: testChecks({ referencedBlobs: mediaBlobs }) });
  const root = path.join(tempDir(t, 'media-root-'), 'media');
  mkdirSync(path.join(root, 'images'), { recursive: true });
  const clock = { now: Date.parse('2026-10-23T08:00:00Z') };
  const ingestion = mediaIngestion({
    assets: store.assets,
    root: localMediaRoot(root),
    now: () => clock.now,
    ...options,
  });
  const put = (relative: string, bytes: Uint8Array) => {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), bytes);
  };
  return {
    store,
    root,
    put,
    clock,
    ingest: (input) =>
      ingestion.ingest({ portfolio: portfolio(), previous: null, fetchRemote: false, ...input }),
  };
}

async function sources(s: Setup) {
  s.put('images/mateo.jpg', await jpeg({ width: 600, height: 800, color: '#884422' }));
  s.put('images/harbor-1.jpg', await jpeg({ width: 1200, height: 800, color: '#224488' }));
  s.put('images/harbor-2.jpg', await png({ width: 500, height: 500, color: '#448822' }));
}

const record = (document: MediaDocument, id: string) => {
  const found = document.assets.find(({ assetId }) => assetId === id);
  assert.ok(found, id);
  return found;
};

async function blobBytes(store: Store, hash: string): Promise<Buffer> {
  const stream = await store.assets.open(`sha256:${hash}` as Sha256);
  assert.ok(stream, `blob ${hash} is stored`);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

test('each image derives one revision, in authored order, with every blob stored', async (t) => {
  const s = await setup(t);
  await sources(s);
  const { document, findings, derived } = await s.ingest({});
  assert.deepEqual(findings, []);
  assert.deepEqual(derived, IDS);
  // The portfolio's order, never the file names'.
  assert.deepEqual(
    document.assets.map(({ assetId }) => assetId),
    IDS,
  );
  assert.ok(parseMediaDocument(document).ok, 'the document checks');
  const ferry = record(document, 'ferry-at-dawn');
  assert.equal(ferry.mime, 'image/jpeg');
  assert.deepEqual([ferry.width, ferry.height, ferry.aspectRatio], [1200, 800, 1.5]);
  assert.match(ferry.dominantColor!, /^#[0-9a-f]{6}$/);
  assert.deepEqual(ferry.source, { kind: 'local', path: 'images/harbor-1.jpg' });
  assert.deepEqual(ferry.availability, { state: 'available' });
  assert.equal(ferry.derivedAt, '2026-10-23T08:00:00.000Z');
  assert.deepEqual(
    ferry.renditions.map(({ name }) => name),
    ['w480-a1', 'w480-a1-jpg', 'w960-a1', 'w960-a1-jpg'],
  );
  // The source is the asset revision, stored as is; each rendition under its own hash.
  const source = readFileSync(path.join(s.root, 'images/harbor-1.jpg'));
  assert.ok((await blobBytes(s.store, ferry.sha256)).equals(source));
  for (const rendition of ferry.renditions) {
    const bytes = await blobBytes(s.store, rendition.sha256);
    assert.equal(bytes.length, rendition.bytes);
  }
  for (const blob of mediaBlobs(document)) assert.ok(await s.store.assets.has(blob), blob);
});

test('a rename keeps the revision: same hash, same renditions, nothing derived again', async (t) => {
  const s = await setup(t);
  await sources(s);
  const first = (await s.ingest({})).document;
  renameSync(path.join(s.root, 'images/harbor-1.jpg'), path.join(s.root, 'images/ferry.jpg'));
  s.clock.now += 60_000;
  const renamed = portfolio((text) => text.replace('images/harbor-1.jpg', 'images/ferry.jpg'));
  const second = await s.ingest({ portfolio: renamed, previous: first });
  assert.deepEqual(second.derived, []);
  assert.deepEqual(second.findings, []);
  const before = record(first, 'ferry-at-dawn');
  const after = record(second.document, 'ferry-at-dawn');
  assert.deepEqual(after, { ...before, source: { kind: 'local', path: 'images/ferry.jpg' } });
  assert.deepEqual(
    second.document.assets.map(({ assetId }) => assetId),
    IDS,
  );
});

test('a revision whose blobs are gone is never reused: the same bytes derive again', async (t) => {
  const s = await setup(t);
  await sources(s);
  const first = (await s.ingest({})).document;
  const lost = record(first, 'ferry-at-dawn').renditions[0]!.sha256;
  rmSync(s.store.paths.blob(`sha256:${lost}` as Sha256));
  assert.equal(await s.store.assets.has(`sha256:${lost}` as Sha256), false);
  const second = await s.ingest({ previous: first });
  assert.deepEqual(second.derived, ['ferry-at-dawn']);
  assert.equal(
    record(second.document, 'ferry-at-dawn').sha256,
    record(first, 'ferry-at-dawn').sha256,
  );
  for (const blob of mediaBlobs(second.document)) {
    assert.ok(await s.store.assets.has(blob), blob);
  }
});

test('a replacement becomes the revision once it derives; a broken one leaves the last in place', async (t) => {
  const s = await setup(t);
  await sources(s);
  const first = (await s.ingest({})).document;
  const before = record(first, 'nets-on-the-quay');

  s.clock.now += 60_000;
  s.put(
    'images/harbor-2.jpg',
    await png({ width: 800, height: 400, color: '#aa2222', alpha: true }),
  );
  const replaced = await s.ingest({ previous: first });
  assert.deepEqual(replaced.derived, ['nets-on-the-quay']);
  const after = record(replaced.document, 'nets-on-the-quay');
  assert.notEqual(after.sha256, before.sha256);
  assert.deepEqual([after.width, after.height], [800, 400]);
  assert.deepEqual(
    after.renditions.map(({ name }) => name),
    ['w480-a1', 'w480-a1-png'],
  );
  // The old revision's blobs stay: a published revision may use them.
  for (const blob of mediaBlobs({ assets: [before] })) assert.ok(await s.store.assets.has(blob));
  // The others are untouched.
  assert.deepEqual(record(replaced.document, 'portrait'), record(first, 'portrait'));

  s.clock.now += 60_000;
  const since = new Date(s.clock.now).toISOString();
  for (const [bytes, reason] of [
    [new TextEncoder().encode('GIF89a not really'), 'refused'],
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), 'invalid'],
  ] as const) {
    s.put('images/harbor-2.jpg', bytes);
    const broken = await s.ingest({ previous: replaced.document });
    assert.deepEqual(broken.derived, []);
    assert.deepEqual(record(broken.document, 'nets-on-the-quay'), {
      ...after,
      availability: { state: 'unavailable', reason, since },
    });
    assert.equal(broken.findings[0]!.kept, true);
  }
});

test('a metadata change: a touched file keeps its revision, edited EXIF makes a new one, alt text changes nothing', async (t) => {
  const s = await setup(t);
  await sources(s);
  s.put('images/mateo.jpg', await cameraJpeg({ width: 600, height: 800 }, { canary: 'first' }));
  const first = (await s.ingest({})).document;

  // A new mtime is no new revision.
  const file = path.join(s.root, 'images/mateo.jpg');
  utimesSync(file, new Date('2030-01-01T00:00:00Z'), new Date('2030-01-01T00:00:00Z'));
  const touched = await s.ingest({ previous: first });
  assert.deepEqual(touched.derived, []);
  assert.deepEqual(touched.document, first);

  // Authored metadata is the portfolio's: the media document doesn't move.
  const realt = portfolio((text) =>
    text.replace('Mateo with a medium-format camera', 'Mateo, 2024'),
  );
  const authored = await s.ingest({ portfolio: realt, previous: first });
  assert.deepEqual(authored.document, first);

  // The same pixels with other EXIF are other bytes: a new revision of the same asset, in its place.
  s.clock.now += 60_000;
  s.put('images/mateo.jpg', await cameraJpeg({ width: 600, height: 800 }, { canary: 'second' }));
  const edited = await s.ingest({ previous: first });
  assert.deepEqual(edited.derived, ['portrait']);
  assert.notEqual(record(edited.document, 'portrait').sha256, record(first, 'portrait').sha256);
  assert.deepEqual(
    edited.document.assets.map(({ assetId }) => assetId),
    IDS,
  );
});

test('a missing source keeps the last revision, unavailable since it went; a restored one is back as it was', async (t) => {
  const s = await setup(t);
  await sources(s);
  const first = (await s.ingest({})).document;
  const before = record(first, 'ferry-at-dawn');
  const bytes = readFileSync(path.join(s.root, 'images/harbor-1.jpg'));

  rmSync(path.join(s.root, 'images/harbor-1.jpg'));
  s.clock.now += 60_000;
  const wentAt = new Date(s.clock.now).toISOString();
  const missing = await s.ingest({ previous: first });
  assert.deepEqual(missing.findings, [
    { assetId: 'ferry-at-dawn', reason: 'missing', code: 'not_found', kept: true },
  ]);
  assert.deepEqual(record(missing.document, 'ferry-at-dawn'), {
    ...before,
    availability: { state: 'unavailable', reason: 'missing', since: wentAt },
  });
  assert.deepEqual(
    missing.document.assets.map(({ assetId }) => assetId),
    IDS,
  );

  // Saving again with nothing changed changes nothing: `since` stays.
  s.clock.now += 60_000;
  const again = await s.ingest({ previous: missing.document });
  assert.deepEqual(again.document, missing.document);

  writeFileSync(path.join(s.root, 'images/harbor-1.jpg'), bytes);
  s.clock.now += 60_000;
  const restored = await s.ingest({ previous: again.document });
  assert.deepEqual(restored.derived, []);
  assert.deepEqual(restored.findings, []);
  assert.deepEqual(restored.document, first);

  // An asset that never derived and has no source has no record, and says so.
  const fresh = await s.ingest({
    portfolio: portfolio((text) => text.replace('images/mateo.jpg', 'images/nobody.jpg')),
  });
  assert.deepEqual(
    fresh.document.assets.map(({ assetId }) => assetId),
    ['ferry-at-dawn', 'nets-on-the-quay'],
  );
  assert.deepEqual(fresh.findings, [
    { assetId: 'portrait', reason: 'missing', code: 'not_found', kept: false },
  ]);
});

test('a source that escapes the media root is refused and never read', async (t) => {
  const s = await setup(t);
  await sources(s);
  const first = (await s.ingest({})).document;
  const outside = path.join(path.dirname(s.root), 'outside.jpg');
  writeFileSync(outside, await jpeg({ width: 100, height: 100 }));
  rmSync(path.join(s.root, 'images/harbor-1.jpg'));
  symlinkSync(outside, path.join(s.root, 'images/harbor-1.jpg'));
  const escaped = await s.ingest({ previous: first });
  assert.deepEqual(escaped.findings, [
    { assetId: 'ferry-at-dawn', reason: 'refused', code: 'path_escape', kept: true },
  ]);
  assert.equal(
    record(escaped.document, 'ferry-at-dawn').sha256,
    record(first, 'ferry-at-dawn').sha256,
  );
  // Absolute and `..` sources never validate, and ingestion skips them.
  for (const source of [outside, '../outside.jpg']) {
    const result = await s.ingest({
      portfolio: portfolio((text) => text.replace('images/mateo.jpg', source)),
    });
    assert.ok(!result.document.assets.some(({ assetId }) => assetId === 'portrait'), source);
  }
});

test("when sharp won't load, nothing new derives and every revision stays", async (t) => {
  let ok = true;
  const real = await import('./derive').then((module) => module.loadSharp());
  const s = await setup(t, {
    sharp: async (): Promise<SharpLoad> => (ok ? real : { ok: false, code: 'ERR_DLOPEN_FAILED' }),
  });
  await sources(s);
  const first = (await s.ingest({})).document;
  ok = false;
  s.put('images/harbor-2.jpg', await png({ width: 64, height: 64, color: '#000000' }));
  const result = await s.ingest({ previous: first });
  assert.deepEqual(result.document, first);
  assert.deepEqual(result.findings, [
    {
      assetId: 'nets-on-the-quay',
      reason: 'renditions_unavailable',
      code: 'ERR_DLOPEN_FAILED',
      kept: true,
    },
  ]);
  for (const blob of mediaBlobs(first)) assert.ok(await s.store.assets.has(blob));
});

test('remote sources: fetched only when allowed, through the address checks, and not again while unchanged', async (t) => {
  const image = await jpeg({ width: 640, height: 480 });
  let fetches = 0;
  const transport: RemoteTransport = async ({ url }) => {
    fetches++;
    if (url.hostname === 'images.example.net') {
      return {
        status: url.pathname === '/moved.jpg' ? 302 : 200,
        headers:
          url.pathname === '/moved.jpg' ? { location: 'https://internal.example.net/a.jpg' } : {},
        body: (async function* () {
          yield image;
        })(),
        cancel() {},
      };
    }
    throw new Error(`connected to ${url.hostname}`);
  };
  const resolve = async (hostname: string) => [
    { address: hostname === 'internal.example.net' ? '10.0.0.8' : '93.184.216.34', family: 4 },
  ];
  const s = await setup(t, { fetchRemote: remoteImageFetcher({ resolve, transport }) });
  await sources(s);
  const remote = (url: string) => portfolio((text) => text.replace('images/harbor-1.jpg', url));

  const denied = await s.ingest({ portfolio: remote('https://images.example.net/a.jpg') });
  assert.equal(fetches, 0);
  assert.deepEqual(
    denied.findings.map(({ assetId, code }) => [assetId, code]),
    [['ferry-at-dawn', 'fetch_denied']],
  );

  const fetched = await s.ingest({
    portfolio: remote('https://images.example.net/a.jpg'),
    fetchRemote: true,
  });
  assert.equal(fetches, 1);
  const ferry = record(fetched.document, 'ferry-at-dawn');
  assert.deepEqual(ferry.source, { kind: 'remote', url: 'https://images.example.net/a.jpg' });
  assert.deepEqual([ferry.width, ferry.height], [640, 480]);

  // Saved again with the same URL: no fetch.
  await s.ingest({
    portfolio: remote('https://images.example.net/a.jpg'),
    previous: fetched.document,
    fetchRemote: true,
  });
  assert.equal(fetches, 1);

  // A changed URL that redirects to a private address is refused; the last revision stays.
  const moved = await s.ingest({
    portfolio: remote('https://images.example.net/moved.jpg'),
    previous: fetched.document,
    fetchRemote: true,
  });
  assert.equal(fetches, 2, 'the private address was never connected to');
  assert.deepEqual(
    moved.findings.map(({ code, kept }) => [code, kept]),
    [['address_blocked', true]],
  );
  assert.equal(record(moved.document, 'ferry-at-dawn').sha256, ferry.sha256);
  for (const url of ['https://127.0.0.1/a.jpg', 'https://169.254.169.254/latest/meta-data/']) {
    const blocked = await s.ingest({ portfolio: remote(url), fetchRemote: true });
    assert.deepEqual(
      blocked.findings.map(({ code }) => code),
      ['address_blocked'],
      url,
    );
  }
  assert.equal(fetches, 2);
});

test('a GPS-tagged source and a private canary reach no rendition and no visitor view', async (t) => {
  const s = await setup(t);
  await sources(s);
  const CANARY = 'private-canary-3b9e';
  s.put(
    'images/harbor-2.jpg',
    await cameraJpeg({ width: 900, height: 600 }, { orientation: 6, canary: CANARY }),
  );
  const privateText = PAIR.portfolio.sourceText.replace(
    '    alt: Nets drying on a quay\n',
    `    alt: Nets drying on a quay\n    visibility: private\n`,
  );
  assert.notEqual(privateText, PAIR.portfolio.sourceText);
  const model = parseSource(privateText, 'yaml');
  assert.ok(model.ok);
  const { document } = await s.ingest({ portfolio: model.data });
  const nets = record(document, 'nets-on-the-quay');
  // Upright: the EXIF quarter turn applied.
  assert.deepEqual([nets.width, nets.height], [600, 900]);
  const original = readFileSync(path.join(s.root, 'images/harbor-2.jpg'));
  assert.ok(carries(original, CANARY));
  for (const rendition of nets.renditions) {
    const bytes = await blobBytes(s.store, rendition.sha256);
    assert.ok(!carries(bytes, CANARY), rendition.name);
    assert.ok(!carries(bytes, 'Exif\0\0'), rendition.name);
  }
  // The visitor view leaves the private asset out, record and all.
  const portfolioModel = parsePortfolio(privateText, 'yaml');
  const site = parseSite(PAIR.site.sourceText, 'yaml');
  assert.ok(portfolioModel.ok && site.ok);
  const view = resolvePortfolioView(
    { portfolio: portfolioModel.value, site: site.value },
    { media: document, snapshots: {} },
    { mediaBase: '/media' },
  );
  const text = JSON.stringify(view);
  assert.ok(!('nets-on-the-quay' in view.media));
  assert.ok(!text.includes(nets.sha256));
  assert.ok(!text.includes(CANARY));
  assert.ok(!text.includes('images/harbor-2.jpg'));
});

test('one ingestion runs at a time', async (t) => {
  let running = 0;
  let overlapped = false;
  const s = await setup(t);
  await sources(s);
  const reads = localMediaRoot(s.root);
  const ingestion = mediaIngestion({
    assets: s.store.assets,
    root: {
      async read(source) {
        running++;
        if (running > 1) overlapped = true;
        await new Promise((resolve) => setTimeout(resolve, 5));
        try {
          return await reads.read(source);
        } finally {
          running--;
        }
      },
    },
  });
  const input = { portfolio: portfolio(), previous: null, fetchRemote: false };
  await Promise.all([ingestion.ingest(input), ingestion.ingest(input), ingestion.ingest(input)]);
  assert.equal(overlapped, false);
  // A failure doesn't stop the next one.
  const failing = mediaIngestion({
    assets: s.store.assets,
    root: {
      read: async () => {
        throw new Error('disk on fire');
      },
    },
  });
  await assert.rejects(failing.ingest(input), /disk on fire/);
  await assert.rejects(failing.ingest(input), /disk on fire/);
});

/** Creates a draft with `documents` and publishes it, returning the revision ID. */
async function publish(store: Store, documents: UnitInput) {
  const working = await store.drafts.getWorking();
  const created = await store.drafts.create(
    { documents, ...(working ? { expectedVersion: working.version } : {}) },
    'owner',
  );
  assert.equal(created.kind, 'saved', JSON.stringify(created));
  if (created.kind !== 'saved') throw new Error('unsaved');
  const live = await store.publication.status();
  const outcome = await owned(store).publish(
    {
      draftId: created.draft.draftId,
      draftVersion: created.draft.version,
      expectedLiveRevisionId: live.liveRevisionId,
    },
    'owner',
  );
  assert.equal(outcome.kind, 'committed', JSON.stringify(outcome));
  if (outcome.kind !== 'committed') throw new Error('unpublished');
  return outcome.revisionId;
}

const asDocument = (document: MediaDocument) => ({
  format: 'json' as const,
  sourceText: `${JSON.stringify(document, null, 2)}\n`,
});

test('a published revision keeps its media, bytes and all, through a replacement and a loss', async (t) => {
  const s = await setup(t);
  await sources(s);
  const first = (await s.ingest({})).document;
  const revisionId = await publish(s.store, { ...PAIR, media: asDocument(first) });
  const manifest = await readManifest(nodeFs, s.store.paths, revisionId);
  assert.deepEqual(manifest?.blobs, mediaBlobs(first));
  const frozen = readFileSync(
    path.join(s.store.paths.revision(revisionId), 'documents', 'media.json'),
    'utf8',
  );
  const bytesBefore = await Promise.all(
    mediaBlobs(first).map((blob) => blobBytes(s.store, blob.slice(7))),
  );

  // The owner replaces one file and deletes another, then saves a draft.
  s.put('images/harbor-2.jpg', await png({ width: 300, height: 300, color: '#ffffff' }));
  rmSync(path.join(s.root, 'images/harbor-1.jpg'));
  s.clock.now += 60_000;
  const next = await s.ingest({ previous: first });
  const created = await s.store.drafts.create(
    {
      documents: { ...PAIR, media: asDocument(next.document) },
      expectedVersion: (await s.store.drafts.getWorking())?.version,
    },
    'owner',
  );
  assert.equal(created.kind, 'saved', JSON.stringify(created));

  // The live revision is as it was: the same media document, the same blobs, byte for byte.
  assert.equal((await s.store.publication.status()).liveRevisionId, revisionId);
  assert.equal(
    readFileSync(path.join(s.store.paths.revision(revisionId), 'documents', 'media.json'), 'utf8'),
    frozen,
  );
  const bytesAfter = await Promise.all(
    mediaBlobs(first).map((blob) => blobBytes(s.store, blob.slice(7))),
  );
  assert.deepEqual(bytesAfter, bytesBefore);

  // The draft took the replacement, kept the lost one's last revision, and can publish.
  assert.notEqual(
    record(next.document, 'nets-on-the-quay').sha256,
    record(first, 'nets-on-the-quay').sha256,
  );
  assert.equal(
    record(next.document, 'ferry-at-dawn').sha256,
    record(first, 'ferry-at-dawn').sha256,
  );
  if (created.kind !== 'saved') return;
  const second = await owned(s.store).publish(
    {
      draftId: created.draft.draftId,
      draftVersion: created.draft.version,
      expectedLiveRevisionId: revisionId,
    },
    'owner',
  );
  assert.equal(second.kind, 'committed', JSON.stringify(second));
  // And the first revision is still whole, a rollback target with every blob.
  const firstManifest = await readManifest(nodeFs, s.store.paths, revisionId);
  for (const blob of firstManifest?.blobs ?? []) assert.ok(await s.store.assets.has(blob));
});

test('retention 25 hours on keeps every source and rendition a revision or a draft references, and nothing else', async (t) => {
  const s = await setup(t);
  await sources(s);
  const first = (await s.ingest({})).document;
  await publish(s.store, { ...PAIR, media: asDocument(first) });
  // A draft takes a replacement the live revision doesn't have.
  s.put('images/harbor-2.jpg', await png({ width: 320, height: 320, color: '#123456' }));
  const next = (await s.ingest({ previous: first })).document;
  const created = await s.store.drafts.create(
    {
      documents: { ...PAIR, media: asDocument(next) },
      expectedVersion: (await s.store.drafts.getWorking())?.version,
    },
    'owner',
  );
  assert.equal(created.kind, 'saved', JSON.stringify(created));
  // And a blob nothing references, as a derivation a crash left.
  const orphan = await s.store.assets.put(new TextEncoder().encode('nobody'), 'image/webp');

  const report = await runRetention(
    {
      fs: nodeFs,
      paths: s.store.paths,
      lock: s.store.lock,
      checks: testChecks({ referencedBlobs: mediaBlobs }),
      actor: 'operator',
      now: () => Date.now() + 25 * 60 * 60_000,
    },
    {},
  );
  assert.equal(report.kind, 'done');
  if (report.kind !== 'done') return;
  assert.deepEqual(report.report.removedBlobs, [orphan.sha256]);
  const kept = new Set([...mediaBlobs(first), ...mediaBlobs(next)]);
  assert.ok(kept.size > mediaBlobs(first).length, 'the draft names blobs the revision does not');
  for (const blob of kept) assert.ok(await s.store.assets.has(blob), blob);
  assert.equal(await s.store.assets.has(orphan.sha256), false);
});

for (const [damage, change] of [
  [
    'a media document this build no longer accepts',
    (raw: string) => {
      // One field a newer schema may write: the document stops checking here.
      const draft = JSON.parse(raw) as {
        documents: { media: { model: { assets: { algorithmVersion: number }[] } } };
      };
      draft.documents.media.model.assets[0]!.algorithmVersion = 0;
      return JSON.stringify(draft);
    },
  ],
  ['a draft file cut short', (raw: string) => raw.slice(0, raw.length - 10)],
] as const) {
  test(`retention 25 hours on keeps every blob of ${damage}`, async (t) => {
    const s = await setup(t);
    await sources(s);
    const document = (await s.ingest({})).document;
    const created = await s.store.drafts.create(
      { documents: { ...PAIR, media: asDocument(document) } },
      'owner',
    );
    assert.equal(created.kind, 'saved', JSON.stringify(created));
    if (created.kind !== 'saved') return;
    const file = s.store.paths.draft(created.draft.draftId);
    writeFileSync(file, change(readFileSync(file, 'utf8')));
    const orphan = await s.store.assets.put(new TextEncoder().encode('nobody'), 'image/webp');

    const report = await runRetention(
      {
        fs: nodeFs,
        paths: s.store.paths,
        lock: s.store.lock,
        checks: testChecks({ referencedBlobs: mediaBlobs }),
        actor: 'operator',
        now: () => Date.now() + 25 * 60 * 60_000,
      },
      {},
    );
    assert.equal(report.kind, 'done');
    if (report.kind !== 'done') return;
    const blobs = mediaBlobs(document);
    assert.ok(blobs.length > 0);
    for (const blob of blobs) assert.ok(await s.store.assets.has(blob), blob);
    if (damage === 'a draft file cut short') {
      // Nothing can be said about what it keeps, so nothing goes.
      assert.equal(report.report.blobsKept, 'draft_unreadable');
      assert.deepEqual(report.report.removedBlobs, []);
    } else {
      // Read by shape, it still names its blobs, and only the orphan goes.
      assert.deepEqual(report.report.removedBlobs, [orphan.sha256]);
      // verify reads it the same way: one of its blobs gone is a problem.
      rmSync(s.store.paths.blob(blobs[0]!));
      const verified = await verifyStore({
        fs: nodeFs,
        paths: s.store.paths,
        checks: testChecks({ referencedBlobs: mediaBlobs }),
      });
      assert.ok(
        verified.problems.some(({ code }) => code === 'blob_missing'),
        JSON.stringify(verified.problems),
      );
    }
  });
}
