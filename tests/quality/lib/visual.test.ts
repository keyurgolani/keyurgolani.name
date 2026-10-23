import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  expectedFonts,
  fontDifference,
  FONTS_FILE,
  inPinnedImage,
  normalizeFonts,
  RANDOM_SEED,
  seedRandomScript,
  VISUAL_IMAGE,
} from './visual';

const CI = fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url));

interface Job {
  readonly container?: { readonly image?: string };
  readonly env?: Record<string, string>;
}

test("the visual cells' image is the variants job's, by digest, and the quality jobs run in it and name it", () => {
  const { jobs } = parse(readFileSync(CI, 'utf8')) as { jobs: Record<string, Job> };
  assert.equal(jobs.variants?.container?.image, VISUAL_IMAGE);
  assert.match(
    VISUAL_IMAGE,
    /^mcr\.microsoft\.com\/playwright:v1\.58\.2-noble@sha256:[0-9a-f]{64}$/,
  );
  assert.equal(jobs['quality-pr']?.container?.image, VISUAL_IMAGE);
  assert.equal(jobs['quality-pr']?.env?.QUALITY_CONTAINER, VISUAL_IMAGE);
  assert.equal(jobs['quality-meta']?.container?.image, VISUAL_IMAGE);
});

test('only the pinned image, named exactly, counts as it', () => {
  assert.ok(inPinnedImage({ QUALITY_CONTAINER: VISUAL_IMAGE }));
  assert.ok(!inPinnedImage({}));
  assert.ok(!inPinnedImage({ QUALITY_CONTAINER: 'mcr.microsoft.com/playwright:v1.58.2-noble' }));
  assert.ok(!inPinnedImage({ QUALITY_CONTAINER: VISUAL_IMAGE.replace(/.$/, '0') }));
});

test("a font list is fc-list's lines, sorted and once each, without comments", () => {
  assert.deepEqual(
    normalizeFonts(
      '# fonts\n\n/b.ttf: B:style=Bold\n/a.ttf: A:style=Regular\n/b.ttf: B:style=Bold\n',
    ),
    ['/a.ttf: A:style=Regular', '/b.ttf: B:style=Bold'],
  );
  assert.deepEqual(fontDifference(['a', 'b'], ['b', 'c']), { missing: ['a'], extra: ['c'] });
  assert.deepEqual(fontDifference(['a'], ['a']), { missing: [], extra: [] });
});

test('fonts.txt reads as a font list, and an empty one fails against any image, so no visual cell passes before the list is written', () => {
  const listed = expectedFonts(FONTS_FILE);
  assert.ok(listed.every((font) => !font.startsWith('#')));
  assert.deepEqual(fontDifference([], ['/usr/share/fonts/x.ttf: X:style=Regular']), {
    missing: [],
    extra: ['/usr/share/fonts/x.ttf: X:style=Regular'],
  });
});

test('the seeded Math.random gives the same sequence each load, in [0, 1)', () => {
  const draw = () => {
    const real = Math.random;
    try {
      seedRandomScript(RANDOM_SEED);
      return Array.from({ length: 5 }, () => Math.random());
    } finally {
      Math.random = real;
    }
  };
  const first = draw();
  assert.deepEqual(draw(), first);
  for (const value of first) assert.ok(value >= 0 && value < 1, String(value));
  assert.equal(new Set(first).size, first.length);
});
