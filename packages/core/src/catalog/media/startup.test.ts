import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mediaBlobs, parseMediaDocument } from '@portfolio/schema';
import { sharpFromDirectory } from './derive';
import { localMediaRoot } from './local';
import { deriveStartupMedia, directoryBlobStore, MediaCacheError } from './startup';
import { jpeg, png } from '../../store/test-support/images';

// Startup derivation for read-only and demo (#10, Risk 3): the media
// document derives once, into a cache of the server user's own, and the log
// lists each asset revision's hash. demo passes no fetcher, so it fetches
// nothing.

function dirs(t: { after(fn: () => void): void }) {
  const base = mkdtempSync(path.join(tmpdir(), 'kgn-startup-media-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'media');
  mkdirSync(path.join(root, 'work'), { recursive: true });
  return { base, root, cache: path.join(base, 'cache') };
}

const portfolio = (...media: { id: string; source: string }[]) => ({
  media: media.map((entry) => ({ ...entry, kind: 'image' })),
});

test('it derives every image into the cache and logs each asset revision with its hash', async (t) => {
  const { root, cache } = dirs(t);
  const cover = await jpeg({ width: 800, height: 400 });
  writeFileSync(path.join(root, 'work', 'cover.jpg'), cover);
  writeFileSync(path.join(root, 'work', 'plate.png'), await png({ width: 300, height: 300 }));
  const lines: Record<string, unknown>[] = [];
  const derived = await deriveStartupMedia({
    portfolio: portfolio(
      { id: 'cover', source: 'work/cover.jpg' },
      { id: 'plate', source: 'work/plate.png' },
    ),
    root: localMediaRoot(root),
    cacheDir: cache,
    log: (entry) => lines.push({ ...entry }),
  });
  assert.ok(parseMediaDocument(derived.document).ok);
  assert.deepEqual(
    derived.document.assets.map(({ assetId }) => assetId),
    ['cover', 'plate'],
  );
  const hash = createHash('sha256').update(cover).digest('hex');
  assert.equal(derived.document.assets[0]!.sha256, hash);
  // Risk 3: the log lists each asset's hash.
  assert.deepEqual(
    lines.filter(({ event }) => event === 'media.startup.asset'),
    derived.document.assets.map(({ assetId, sha256 }) => ({
      level: 'info',
      event: 'media.startup.asset',
      assetId,
      sha256,
    })),
  );
  // Every blob is in the cache, the cache only this user's.
  for (const blob of mediaBlobs(derived.document)) {
    const file = await derived.blobs.file(blob);
    assert.ok(file, blob);
    assert.equal(statSync(file).mode & 0o077, 0, `${blob} is closed to others`);
  }
  assert.equal(statSync(cache).mode & 0o077, 0);
  assert.ok(readFileSync((await derived.blobs.file(`sha256:${hash}`))!).equals(Buffer.from(cover)));
});

test('with no fetcher, as under demo, a remote source is never fetched', async (t) => {
  const { root, cache } = dirs(t);
  writeFileSync(path.join(root, 'work', 'cover.jpg'), await jpeg({ width: 100, height: 100 }));
  const derived = await deriveStartupMedia({
    portfolio: portfolio(
      { id: 'cover', source: 'work/cover.jpg' },
      { id: 'remote', source: 'https://images.example.net/a.jpg' },
    ),
    root: localMediaRoot(root),
    cacheDir: cache,
  });
  assert.deepEqual(
    derived.document.assets.map(({ assetId }) => assetId),
    ['cover'],
  );
  assert.deepEqual(
    derived.findings.map(({ assetId, code }) => [assetId, code]),
    [['remote', 'fetch_denied']],
  );
});

test("a cache someone else could reach is refused: another's mode, or a link", async (t) => {
  const { base, root } = dirs(t);
  const open = path.join(base, 'open');
  mkdirSync(open, { mode: 0o755 });
  chmodSync(open, 0o777);
  await assert.rejects(
    deriveStartupMedia({ portfolio: portfolio(), root: localMediaRoot(root), cacheDir: open }),
    MediaCacheError,
  );
  const target = path.join(base, 'target');
  mkdirSync(target, { mode: 0o700 });
  const linked = path.join(base, 'linked');
  symlinkSync(target, linked);
  await assert.rejects(
    deriveStartupMedia({ portfolio: portfolio(), root: localMediaRoot(root), cacheDir: linked }),
    MediaCacheError,
  );
});

test('the cache stores blobs by hash, and a link at a blob name is no blob', async (t) => {
  const { base, cache } = dirs(t);
  mkdirSync(cache, { mode: 0o700 });
  const blobs = directoryBlobStore(cache);
  const bytes = new TextEncoder().encode('a rendition');
  const hex = createHash('sha256').update(bytes).digest('hex');
  assert.deepEqual(await blobs.put(bytes, 'image/webp'), { sha256: `sha256:${hex}` });
  assert.equal(await blobs.has(`sha256:${hex}`), true);
  // Stored once: a second put finds it.
  assert.deepEqual(await blobs.put(bytes, 'image/webp'), { sha256: `sha256:${hex}` });
  const other = 'b'.repeat(64);
  mkdirSync(path.join(cache, 'sha256', 'bb'), { recursive: true });
  writeFileSync(path.join(base, 'elsewhere'), 'not a blob');
  symlinkSync(path.join(base, 'elsewhere'), path.join(cache, 'sha256', 'bb', other));
  assert.equal(await blobs.has(`sha256:${other}`), false);
  assert.throws(() => directoryBlobStore('relative/cache'), TypeError);
  await assert.rejects(blobs.has('sha256:nothex' as `sha256:${string}`), TypeError);
});

test("sharp loads from a build's external link, as the bundled CLI finds it", (t) => {
  const { base } = dirs(t);
  const externals = path.join(base, '.next', 'node_modules');
  mkdirSync(externals, { recursive: true });
  const real = path.resolve(
    fileURLToPath(new URL('.', import.meta.url)),
    '../../../node_modules/sharp',
  );
  symlinkSync(real, path.join(externals, 'sharp-0123abcd'));
  const sharp = sharpFromDirectory(externals) as { versions: { sharp: string } };
  assert.equal(sharp.versions.sharp, '0.34.5');
  assert.throws(() => sharpFromDirectory(base));
});
