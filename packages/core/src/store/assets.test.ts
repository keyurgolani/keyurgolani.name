import assert from 'node:assert/strict';
import { readFileSync, statSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { text } from 'node:stream/consumers';
import { test } from 'node:test';
import { sha256 } from '../catalog/unit';
import { newStore } from './test-support/fixtures';

test('put stores bytes under their hash at 0600, once, and has, stat, and open find them', async (t) => {
  const store = await newStore(t);
  const bytes = Buffer.from('a picture of a lighthouse');
  const stored = await store.assets.put(bytes, 'image/png');
  assert.deepEqual(stored, { sha256: sha256(bytes), size: bytes.byteLength });
  const file = store.paths.blob(stored.sha256);
  assert.equal(
    path.relative(store.paths.assets, file),
    `${stored.sha256.slice(7, 9)}/${stored.sha256.slice(7)}`,
  );
  assert.deepEqual(readFileSync(file), bytes);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.equal(await store.assets.has(stored.sha256), true);
  assert.deepEqual(await store.assets.stat(stored.sha256), stored);
  const stream = await store.assets.open(stored.sha256);
  assert.ok(stream);
  assert.equal(await text(stream), 'a picture of a lighthouse');
  // The same bytes again write nothing, and only bring the blob's mtime to
  // now, as an upload's: retention's grace counts from it.
  const day = 24 * 60 * 60;
  const old = Date.now() / 1000 - 2 * day;
  utimesSync(file, old, old);
  assert.deepEqual(await store.assets.put(Buffer.from(bytes), 'image/png'), stored);
  assert.ok(statSync(file).mtimeMs > (old + day) * 1000, 'the mtime is now');
  assert.deepEqual(readFileSync(file), bytes);
  assert.deepEqual((await import('node:fs')).readdirSync(path.dirname(file)), [
    stored.sha256.slice(7),
  ]);
});

test("a blob that isn't stored, or isn't a digest, is absent", async (t) => {
  const store = await newStore(t);
  const absent = sha256('nothing');
  assert.equal(await store.assets.has(absent), false);
  assert.equal(await store.assets.stat(absent), null);
  assert.equal(await store.assets.open(absent), null);
  assert.equal(await store.assets.has('sha256:../../etc/passwd' as never), false);
  await assert.rejects(store.assets.put(Buffer.from('x'), 'not a media type'), TypeError);
  await assert.rejects(store.assets.put('text' as never, 'text/plain'), TypeError);
});
