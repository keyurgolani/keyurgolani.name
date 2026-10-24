import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildReferenceFixture,
  FIXTURE_DIR,
  generatedFiles,
  png,
  readSource,
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
  assert.ok(built.get('bundle.json')!.includes(REFERENCE_CANARIES.event));
});

test('png() makes the same bytes every time, a PNG signature first', () => {
  const a = png(4, [1, 2, 3], 'note');
  assert.ok(a.equals(png(4, [1, 2, 3], 'note')));
  assert.deepEqual([...a.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(!a.equals(png(4, [1, 2, 3])));
});
