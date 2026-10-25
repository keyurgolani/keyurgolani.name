import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  expectedFonts,
  fontDifference,
  FONTS_FILE,
  FONTS_HEADER,
  inPinnedImage,
  normalizeFonts,
  observedFontsProblems,
  observedFontsText,
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

test('fonts.observed.txt is fonts.txt as a visual run writes it, so the first scheduled run bootstraps the list byte for byte', () => {
  // The committed list is a visual run's own output, written byte for byte: the header, then
  // the image's fonts, sorted, each once. No font is made up; every one came from the image.
  const committed = readFileSync(FONTS_FILE, 'utf8');
  assert.ok(committed.startsWith(`${FONTS_HEADER}\n`));
  assert.deepEqual(observedFontsProblems(committed), []);
  assert.ok(expectedFonts(FONTS_FILE).length > 0);
  const fonts = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf: DejaVu Sans:style=Book',
    '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf: Liberation Mono:style=Bold',
  ];
  const observed = observedFontsText(fonts);
  assert.deepEqual(observedFontsProblems(observed), []);
  // Committed as it is, it reads back as the same list, with nothing left to differ.
  assert.deepEqual(fontDifference(normalizeFonts(observed), fonts), { missing: [], extra: [] });
  assert.deepEqual(observedFontsProblems(observedFontsText([])), ['It lists no font.']);
  assert.match(
    observedFontsProblems(fonts.join('\n'))[0]!,
    /doesn't start with fonts\.txt's header/,
  );
  assert.match(
    observedFontsProblems(observedFontsText([...fonts].reverse()))[0]!,
    /isn't sorted with each font once/,
  );
  assert.match(
    observedFontsProblems(observedFontsText([fonts[0]!, fonts[0]!]))[0]!,
    /isn't sorted with each font once/,
  );
  assert.match(
    observedFontsProblems(observedFontsText(['relative.ttf: X:style=Bold']))[0]!,
    /Line 1 of the list isn't an fc-list font line/,
  );
  assert.deepEqual(observedFontsProblems(observed.slice(0, -1)), ["It doesn't end in a newline."]);
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
