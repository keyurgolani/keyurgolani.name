import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { REFERENCE_CANARIES as SCANNED } from '../../../tests/harness/canaries.mjs';
import {
  buildReferenceFixture,
  FIXTURE_DIR,
  generatedFiles,
  png,
  readSource,
  REFERENCE_ASSETS,
  REFERENCE_CANARIES,
} from './reference-fixture';

// The CI reference fixture (#9) is what `pnpm fixture:reference` writes from
// its pair under this build: rebuilt in memory, every file matches the
// committed one byte for byte, and there's no other.

const FIX = 'Run `pnpm fixture:reference` and commit what it writes.';

test('the committed reference fixture is what pnpm fixture:reference writes', () => {
  const built = buildReferenceFixture(readSource());
  assert.deepEqual(generatedFiles().sort(), [...built.keys()].sort(), FIX);
  for (const [file, bytes] of built) {
    assert.ok(readFileSync(path.join(FIXTURE_DIR, file)).equals(bytes), `${file}: ${FIX}`);
  }
});

test('the fixture holds each canary where the demo must drop it', () => {
  const portfolio = readSource()['portfolio.yml'];
  for (const canary of [
    REFERENCE_CANARIES.privateRecord,
    REFERENCE_CANARIES.hiddenSection,
    REFERENCE_CANARIES.privateSlug,
    REFERENCE_CANARIES.privateAsset,
  ]) {
    assert.ok(portfolio.includes(canary), canary);
  }
  const built = buildReferenceFixture(readSource());
  const blobs = [...built].filter(([file]) => file.startsWith('media/blobs/'));
  assert.equal(blobs.length, 3);
  assert.equal(
    blobs.filter(([, bytes]) => bytes.includes(REFERENCE_CANARIES.privateMedia)).length,
    1,
    'the private image carries its canary in its bytes',
  );
});

test('bundle.json has the fields export-revision writes, and no event field it never exports', () => {
  const bundle = JSON.parse(
    buildReferenceFixture(readSource()).get('bundle.json')!.toString('utf8'),
  );
  assert.deepEqual(Object.keys(bundle), [
    'bundleFormat',
    'revisionId',
    'parentRevisionId',
    'createdAt',
    'createdBy',
    'source',
    'appVersion',
    'unitHash',
    'documents',
    'snapshots',
    'blobs',
    'rendering',
    'events',
  ]);
  assert.deepEqual(bundle.source, { kind: 'draft' });
  assert.deepEqual(Object.keys(bundle.documents), ['portfolio', 'site', 'media']);
  for (const document of Object.values(bundle.documents)) {
    assert.deepEqual(Object.keys(document as object), [
      'file',
      'format',
      'schemaVersion',
      'sourceHash',
      'contentHash',
    ]);
  }
  assert.deepEqual(Object.keys(bundle.rendering), ['variant', 'packs', 'contracts']);
  for (const blob of bundle.blobs) assert.deepEqual(Object.keys(blob), ['file', 'sha256', 'size']);
  // reason and idempotencyKey stay in the store's log: export-revision never writes them.
  for (const event of bundle.events) {
    assert.deepEqual(Object.keys(event), [
      'seq',
      'type',
      'revisionId',
      'previousRevisionId',
      'actor',
      'at',
    ]);
  }
});

test('png() makes the same bytes every time, a PNG signature first', () => {
  const a = png(4, [1, 2, 3], 'note');
  assert.ok(a.equals(png(4, [1, 2, 3], 'note')));
  assert.deepEqual([...a.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(!a.equals(png(4, [1, 2, 3])));
});

test('the leak scans look for every canary the fixture holds, and for the mount’s own name', () => {
  for (const canary of [
    REFERENCE_CANARIES.privateRecord,
    REFERENCE_CANARIES.hiddenSection,
    REFERENCE_CANARIES.privateMedia,
    REFERENCE_CANARIES.privateSlug,
    REFERENCE_CANARIES.privateAsset,
  ]) {
    assert.ok(SCANNED.includes(canary), canary);
  }
  // The private image's source path, which only the media document and the
  // portfolio name.
  const privateSource = REFERENCE_ASSETS.find(
    ({ assetId }) => assetId === REFERENCE_CANARIES.privateAsset,
  )!.source;
  assert.ok(readSource()['portfolio.yml'].includes(privateSource));
  assert.ok(SCANNED.includes(privateSource), privateSource);
  assert.ok(SCANNED.includes(path.basename(FIXTURE_DIR)));
});
