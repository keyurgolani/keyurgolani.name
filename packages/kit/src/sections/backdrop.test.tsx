import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ViewMediaAsset, ViewRendition } from '@portfolio/schema';
import { BACKDROP_WIDTH, MediaBackdrop, backdropOf } from './media';

// The kit compiles JSX classically, so a render reads React from the global scope.
Object.assign(globalThis, { React });

// A backdrop (K-8): a media ref's image behind the page, through the media
// pipeline's WebP renditions up to its 1600w step, as decoration, and null,
// so the composition renders its roles-only field, for anything else.

const rendition = (width: number, mime = 'image/webp'): ViewRendition => ({
  url: `/media/sky/${'a'.repeat(64)}/w${width}-a1${mime === 'image/webp' ? '' : '-jpg'}.${mime === 'image/webp' ? 'webp' : 'jpg'}`,
  name: `w${width}-a1`,
  mime,
  bytes: width * 40,
  width,
  height: Math.round((width * 2) / 3),
});

const asset = (
  renditions: readonly ViewRendition[],
  extra: Partial<ViewMediaAsset> = {},
): ViewMediaAsset => ({
  id: 'sky',
  kind: 'image',
  alt: 'A green aurora over a lake.',
  focalPoint: { x: 0.3, y: 0.6 },
  derived: {
    state: 'ready',
    derivedAt: '2026-10-26T00:00:00.000Z',
    value: {
      sha256: 'a'.repeat(64),
      mime: 'image/jpeg',
      bytes: 900_000,
      width: 3000,
      height: 2000,
      aspectRatio: 1.5,
      dominantColor: '#123a2f',
      renditions,
    },
  },
  ...extra,
});

const FULL = [480, 960, 1600, 2400].flatMap((width) => [
  rendition(width),
  rendition(width, 'image/jpeg'),
]);

test('a backdrop takes the WebP renditions up to the pipeline’s 1600w step, no wider and no JPEG', () => {
  assert.equal(BACKDROP_WIDTH, 1600);
  const backdrop = backdropOf({ media: { sky: asset(FULL) } }, 'sky');
  assert.ok(backdrop);
  assert.equal(backdrop.src, rendition(1600).url);
  assert.equal(
    backdrop.srcSet,
    [480, 960, 1600].map((width) => `${rendition(width).url} ${width}w`).join(', '),
  );
  assert.deepEqual(
    [backdrop.width, backdrop.height, backdrop.dominantColor, backdrop.focalPoint],
    [1600, 1067, '#123a2f', { x: 0.3, y: 0.6 }],
  );
  // A source narrower than 1600 has no 1600w step: its widest WebP serves.
  const narrow = backdropOf(
    { media: { sky: asset(FULL.filter(({ width }) => width! < 1600)) } },
    'sky',
  );
  assert.equal(narrow?.src, rendition(960).url);
  assert.equal(narrow?.width, 960);
});

test('a backdrop renders as decoration: alt="", aria-hidden, eager, at the focal point, whatever the asset says', () => {
  const html = renderToStaticMarkup(
    <MediaBackdrop
      backdrop={backdropOf({ media: { sky: asset(FULL) } }, 'sky')!}
      className="ag-sky"
    />,
  );
  // React preloads an image that loads at once, as a backdrop in the first view does.
  assert.match(
    html,
    /^<link rel="preload" as="image" imageSrcSet="[^"]+w1600-a1\.webp 1600w" imageSizes="100vw"\/><img class="pf-backdrop ag-sky" /,
  );
  assert.match(html, / alt="" aria-hidden="true" /);
  assert.match(html, / sizes="100vw" width="1600" height="1067" /);
  assert.match(html, /style="--focal-x:0.3;--focal-y:0.6"/);
  assert.match(html, /data-backdrop-asset="sky"/);
  // The owner's alt text is for the photograph where it's placed, not for the backdrop.
  assert.doesNotMatch(html, /aurora over a lake/);
  assert.doesNotMatch(html, /loading=/);
  assert.doesNotMatch(html, /\.jpg/);
});

test('no backdrop, so the roles-only field, for no value, an asset the view lacks, a non-image, one not derived, or one with no WebP', () => {
  const media = {
    sky: asset(FULL),
    clip: asset(FULL, { id: 'clip', kind: 'video' }),
    pending: asset([], {
      id: 'pending',
      derived: { state: 'unavailable', reason: 'processing', since: null },
    }),
    jpeg: asset(
      FULL.filter(({ mime }) => mime === 'image/jpeg'),
      { id: 'jpeg' },
    ),
    wide: asset([rendition(2400)], { id: 'wide' }),
  };
  for (const id of [
    null,
    undefined,
    7,
    'nowhere',
    'constructor',
    'clip',
    'pending',
    'jpeg',
    'wide',
  ]) {
    assert.equal(backdropOf({ media }, id), null, String(id));
  }
});
