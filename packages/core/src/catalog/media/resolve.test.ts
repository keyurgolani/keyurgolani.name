import test from 'node:test';
import assert from 'node:assert/strict';
import type { MediaRecord } from '@portfolio/schema';
import { resolveRendition } from './resolve';

// Which blob a rendition URL names (#10): only a visible asset's current
// revision and a rendition it lists, never its original, and nothing for
// anything else.

const hex = (digit: string) => digit.repeat(64);

const RECORD: MediaRecord = {
  assetId: 'atlas-cover',
  sha256: hex('a'),
  mime: 'image/jpeg',
  bytes: 2048,
  width: 960,
  height: 480,
  renditions: [
    { name: 'w480-a1', ext: 'webp', mime: 'image/webp', bytes: 512, width: 480, sha256: hex('b') },
    {
      name: 'w480-a1-jpg',
      ext: 'jpg',
      mime: 'image/jpeg',
      bytes: 700,
      width: 480,
      sha256: hex('c'),
    },
  ],
  derivedAt: '2026-10-23T08:00:00Z',
  algorithmVersion: 1,
  source: { kind: 'local', path: 'atlas/cover.jpg' },
  availability: { state: 'available' },
};
const PRIVATE: MediaRecord = { ...RECORD, assetId: 'private-scan', sha256: hex('d') };
const MEDIA = { assets: [RECORD, PRIVATE] };
const VISIBLE = new Set(['atlas-cover']);

test('a visible asset at its current revision resolves each rendition it lists, with the record type', () => {
  assert.deepEqual(resolveRendition(MEDIA, VISIBLE, ['atlas-cover', hex('a'), 'w480-a1.webp']), {
    blob: `sha256:${hex('b')}`,
    mime: 'image/webp',
    bytes: 512,
    assetId: 'atlas-cover',
  });
  assert.equal(
    resolveRendition(MEDIA, VISIBLE, ['atlas-cover', hex('a'), 'w480-a1-jpg.jpg'])?.blob,
    `sha256:${hex('c')}`,
  );
});

test('a private, unknown, or superseded asset, an original, or any other path resolves nothing', () => {
  for (const segments of [
    ['private-scan', hex('d'), 'w480-a1.webp'],
    ['nothing', hex('a'), 'w480-a1.webp'],
    ['atlas-cover', hex('e'), 'w480-a1.webp'],
    ['atlas-cover', hex('a'), 'w480-a1.jpg'],
    ['atlas-cover', hex('a'), 'w480-a1-jpg.webp'],
    ['atlas-cover', hex('a'), 'w960-a1.webp'],
    ['atlas-cover', hex('a'), 'source-a1.jpg'],
    ['atlas-cover', hex('a'), `${hex('a')}.jpg`],
    ['atlas-cover', hex('a').toUpperCase(), 'w480-a1.webp'],
    ['atlas-cover', hex('a'), 'w480-a1.webp', 'extra'],
    ['atlas-cover', hex('a')],
    ['..', hex('a'), 'w480-a1.webp'],
    ['atlas-cover', hex('a'), '../w480-a1.webp'],
    ['Atlas-Cover', hex('a'), 'w480-a1.webp'],
  ]) {
    assert.equal(resolveRendition(MEDIA, VISIBLE, segments), null, segments.join('/'));
  }
  assert.equal(
    resolveRendition(MEDIA, new Set(['private-scan']), ['private-scan', hex('d'), 'w480-a1.webp'])
      ?.blob,
    `sha256:${hex('b')}`,
    'what the view keeps is the caller’s to say',
  );
  // A media document that doesn't check names nothing.
  assert.equal(
    resolveRendition({ assets: [{ ...RECORD, renditions: 'x' }] }, VISIBLE, [
      'atlas-cover',
      hex('a'),
      'w480-a1.webp',
    ]),
    null,
  );
  assert.equal(
    resolveRendition(undefined, VISIBLE, ['atlas-cover', hex('a'), 'w480-a1.webp']),
    null,
  );
  // A rendition whose blob is the original's own bytes is the original: never served.
  const original = {
    assets: [{ ...RECORD, renditions: [{ ...RECORD.renditions[0]!, sha256: hex('a') }] }],
  };
  assert.equal(
    resolveRendition(original, VISIBLE, ['atlas-cover', hex('a'), 'w480-a1.webp']),
    null,
  );
});
