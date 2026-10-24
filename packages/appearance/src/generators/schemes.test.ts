import test from 'node:test';
import assert from 'node:assert/strict';
import { BLACK, contrast, deltaE, lightness, WHITE } from '../color';
import { DISTINCT_PAIRS } from '../derive';
import { generatedSets } from '../resolve-tokens';
import { COLOR_SET_NAMES } from '../sets';
import { COLOR_ROLES } from '../tokens';
import { randomHex, seeded } from '../test-support/packs';
import { ACCENT_LIGHTNESS, generatorAccent, ON_ACCENT_TARGET } from './compose';
import { CLIP_TONE, fromHct, hctOf, toneOf } from './hct';
import {
  APPROVED_ANCHORS,
  GENERATORS,
  hctPalettes,
  runGenerator,
  SECONDARY_HUE_APART,
  STRICTEST_READINGS,
  type Raster,
} from './index';
import { imagePalette, MIN_CHROMA } from './palette';

// #20 PR 3's generators: hct@1's HCT against published values, the four
// schemes' anchors against the reviewed catalog, image-palette@1 on small
// rasters, and every generated scheme passing its own report at the
// strictest shipping reading, deterministically.

/** The reviewed catalog's schemes, from the seed file #20 PR 2a copied byte for byte. */
const SEED = new URL('../../../../scripts/catalog/seed/appearance-catalog.js', import.meta.url)
  .href;
const { COLOR_SCHEMES } = (await import(SEED)) as {
  COLOR_SCHEMES: readonly { id: string; modes: Record<string, Record<string, string>> }[];
};

const declared = (id: string) => {
  const generator = GENERATORS[id]!;
  return { id, version: generator.version, input: generator.input };
};

/** A raster of `width` by `height` filled by `paint(x, y)`, as RGBA. */
function raster(width: number, height: number, paint: (x: number, y: number) => number[]): Raster {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(paint(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}

const rgba = (hex: string, alpha = 255) => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
  alpha,
];

test("HCT reads sRGB's primaries as Material's published HCT does, to three places", () => {
  const near = (actual: number, expected: number, what: string) =>
    assert.ok(Math.abs(actual - expected) < 0.001, `${what}: ${actual} against ${expected}`);
  for (const [hex, hue, chroma, tone] of [
    ['#ff0000', 27.408, 113.358, 53.233],
    ['#00ff00', 142.14, 108.41, 87.737],
    ['#0000ff', 282.788, 87.231, 32.303],
  ] as const) {
    const read = hctOf(hex);
    near(read.hue, hue, `${hex} hue`);
    near(read.chroma, chroma, `${hex} chroma`);
    near(read.tone, tone, `${hex} tone`);
  }
  assert.equal(fromHct(0, 0, 100), WHITE);
  assert.equal(fromHct(0, 50, 0), BLACK);
});

test('a tone comes back at the tone asked, within CLIP_TONE where sRGB clips it, and well within it where it holds it', () => {
  let worst = 0;
  for (let hue = 0; hue < 360; hue += 11) {
    for (const chroma of [0, 4, 16, 24, 48, 90]) {
      for (const tone of [1, 5, 10, 20, 40, 60, 80, 90, 95, 99]) {
        worst = Math.max(worst, Math.abs(toneOf(fromHct(hue, chroma, tone)) - tone));
      }
    }
  }
  assert.ok(worst <= CLIP_TONE, `worst tone error ${worst}`);
  // A color sRGB holds reads back at its own tone, to rounding.
  for (const tone of [10, 40, 80]) {
    assert.ok(Math.abs(toneOf(fromHct(280, 20, tone)) - tone) < 0.2, String(tone));
  }
});

test("hct-tonal's anchors from #6750a4 are within one 8-bit step of M3's published baseline in every channel", () => {
  // M3's baseline from #6750a4: neutral 99 and 10, primary 40, tertiary 40;
  // neutral 10 and 90, primary 80, tertiary 80. Material's own solver
  // differs from the exact-tone one here by a step at most.
  const baseline = {
    light: { canvas: '#fffbfe', text: '#1c1b1f', accent: '#6750a4', secondary: '#7d5260' },
    dark: { canvas: '#1c1b1f', text: '#e6e1e5', accent: '#d0bcff', secondary: '#efb8c8' },
  };
  const run = runGenerator(declared('hct-tonal'), { seedColor: '#6750a4' });
  assert.ok(run.ok);
  for (const mode of ['light', 'dark'] as const) {
    for (const [role, expected] of Object.entries(baseline[mode])) {
      const picked = run.result.anchors!.picked[mode] as unknown as Readonly<
        Record<string, string>
      >;
      const actual = picked[role]!;
      for (const at of [1, 3, 5]) {
        const step = Math.abs(
          Number.parseInt(actual.slice(at, at + 2), 16) -
            Number.parseInt(expected.slice(at, at + 2), 16),
        );
        assert.ok(step <= 1, `${mode} ${role}: ${actual} against ${expected}`);
      }
    }
  }
  // Pinned, so a change to the math is a change to version 1.
  assert.deepEqual(run.result.anchors!.picked, {
    light: { canvas: '#fffbff', text: '#1c1b1e', accent: '#6750a4', secondary: '#7e5260' },
    dark: { canvas: '#1c1b1e', text: '#e6e1e6', accent: '#cfbcff', secondary: '#efb8c8' },
  });
  const palettes = hctPalettes('#6750a4');
  assert.equal(palettes.primary.chroma, Math.max(48, hctOf('#6750a4').chroma));
  assert.equal(palettes.tertiary.chroma, 24);
  assert.equal(palettes.neutral.chroma, 4);
  assert.ok(Math.abs(palettes.tertiary.hue - ((palettes.primary.hue + 60) % 360)) < 1e-9);
});

test("the approved anchors are the reviewed catalog's, and brand-seed takes the seed as the accent alone", () => {
  for (const id of ['brand-seed', 'profile-image', 'portfolio-artwork']) {
    const seed = COLOR_SCHEMES.find((scheme) => scheme.id === id)!;
    for (const mode of ['light', 'dark'] as const) {
      assert.deepEqual(
        APPROVED_ANCHORS[id]![mode],
        {
          canvas: seed.modes[mode]!.canvas,
          text: seed.modes[mode]!['text-primary'],
          accent: seed.modes[mode]!.accent,
          secondary: seed.modes[mode]!.information,
        },
        `${id} ${mode}`,
      );
    }
  }
  const run = runGenerator(declared('brand-seed'), { seedColor: '#3366FF' });
  assert.ok(run.ok);
  assert.deepEqual(run.result.input, { seedColor: '#3366ff' });
  for (const mode of ['light', 'dark'] as const) {
    assert.deepEqual(run.result.anchors!.picked[mode], {
      ...APPROVED_ANCHORS['brand-seed']![mode],
      accent: '#3366ff',
    });
  }
});

test('black or white reads at 4.5:1 on every color, so no accent needs an on-accent step, and the accent holds its lightness bounds', () => {
  const best = (color: string) => Math.max(contrast(BLACK, color), contrast(WHITE, color));
  let floor = Infinity;
  const hex = (value: number) => value.toString(16).padStart(2, '0');
  for (let gray = 0; gray < 256; gray += 1)
    floor = Math.min(floor, best(`#${hex(gray).repeat(3)}`));
  for (let r = 0; r < 256; r += 15)
    for (let g = 0; g < 256; g += 15)
      for (let b = 0; b < 256; b += 15)
        floor = Math.min(floor, best(`#${hex(r)}${hex(g)}${hex(b)}`));
  assert.ok(floor >= ON_ACCENT_TARGET, `the floor is ${floor}`);
  assert.ok(floor < 4.6, 'and only just');
  assert.equal(generatorAccent('#1d4ed8'), '#1d4ed8');
  assert.ok(Math.abs(lightness(generatorAccent('#000000')) - ACCENT_LIGHTNESS.least) < 0.01);
  assert.ok(Math.abs(lightness(generatorAccent('#ffffff')) - ACCENT_LIGHTNESS.most) < 0.01);
});

test('property: every seed gives both seed generators a scheme that passes its report at the strictest shipping readings, the same bytes each time', () => {
  const random = seeded(2031);
  const seeds = [
    '#000000',
    '#ffffff',
    '#808080',
    '#ffff00',
    '#00ffff',
    '#0000ff',
    '#ff0000',
    '#777777',
  ];
  for (let index = 0; index < 250; index += 1) seeds.push(randomHex(random));
  let stepped = 0;
  for (const id of ['brand-seed', 'hct-tonal']) {
    for (const seedColor of seeds) {
      const run = runGenerator(declared(id), { seedColor });
      const again = runGenerator(declared(id), { seedColor });
      assert.ok(run.ok && again.ok, `${id} ${seedColor}`);
      assert.deepEqual(run.result, again.result);
      const failing = run.result.contrastReport.pairs.filter(({ passes }) => !passes);
      assert.deepEqual(failing, [], `${id} ${seedColor}`);
      // Both readings, every set, and the translucent one over black and white.
      const { pairs } = run.result.contrastReport;
      assert.deepEqual(
        [...new Set(pairs.map(({ set }) => set))].sort(),
        [...COLOR_SET_NAMES].sort(),
      );
      assert.ok(
        pairs.some(({ backdrop }) => backdrop === BLACK) &&
          pairs.some(({ backdrop }) => backdrop === WHITE),
      );
      const { tokens } = run.result;
      for (const set of [
        tokens.light,
        tokens.dark,
        tokens.highContrast!.light,
        tokens.highContrast!.dark,
      ]) {
        assert.deepEqual(Object.keys(set), [...COLOR_ROLES]);
      }
      for (const mode of ['light', 'dark'] as const) {
        for (const [first, second, least] of DISTINCT_PAIRS) {
          assert.ok(
            deltaE(tokens[mode][first], tokens[mode][second]) >= least,
            `${id} ${seedColor} ${mode} ${first}`,
          );
        }
        const moved: readonly [string, string] | undefined =
          run.result.adjustments!.generator[mode]?.accent;
        if (moved) {
          stepped += 1;
          assert.equal(moved[1], run.result.anchors!.used[mode].accent);
          assert.equal(moved[1], generatorAccent(moved[0]));
        }
      }
      assert.ok(generatedSets({ [id]: tokens }, id));
    }
  }
  assert.ok(stepped > 0, 'black and white seeds have their accent held within its bounds');
});

test('the strictest readings are a textured opaque language and a 97% translucent one, with large signature text', () => {
  assert.deepEqual(
    STRICTEST_READINGS.map(({ language }) => [language.textured, language.surfaceOpacity]),
    [
      [true, 1],
      [false, 0.97],
    ],
  );
});

test('image-palette@1 scores chromatic clusters by share times chroma, skips transparency, and never scores a neutral', () => {
  // Left half #c0392b, a quarter #2471a3, a quarter grey.
  const three = raster(64, 64, (x) => rgba(x < 32 ? '#c0392b' : x < 48 ? '#2471a3' : '#808080'));
  const palette = imagePalette(three);
  assert.deepEqual(
    palette.map(({ hex, share }) => [hex, share]),
    [
      ['#c0392b', 0.5],
      ['#2471a3', 0.25],
      ['#808080', 0.25],
    ],
  );
  assert.equal(palette[2]!.score, 0);
  assert.ok(palette[0]!.score > palette[1]!.score && palette[1]!.score > 0);
  assert.deepEqual(imagePalette(raster(8, 8, () => rgba('#c0392b', 0))), []);
  assert.deepEqual(imagePalette(three), palette, 'deterministic');
  assert.throws(() => imagePalette({ width: 2, height: 2, data: new Uint8Array(3) }), TypeError);
  assert.ok(MIN_CHROMA > 0);
});

test('an image gives its two best colors at least 30 degrees of hue apart, else the approved ones, and says so', () => {
  const run = (image: Raster) => {
    const result = runGenerator(
      declared('portfolio-artwork'),
      { sourceAsset: 'art' },
      { raster: image, pixelsSha256: 'a'.repeat(64) },
    );
    assert.ok(result.ok);
    return result.result;
  };
  const two = run(raster(64, 64, (x) => rgba(x < 40 ? '#c0392b' : '#2471a3')));
  assert.equal(two.anchors!.picked.light.accent, '#c0392b');
  assert.equal(two.anchors!.picked.light.secondary, '#2471a3');
  assert.deepEqual(two.notes, []);
  assert.deepEqual(two.input, { sourceAsset: 'art', pixelsSha256: 'a'.repeat(64) });
  assert.equal(two.algorithm, 'image-palette@1, anchor-v2');
  // Two reds closer than 30 degrees of hue: the approved secondary.
  const reds = run(raster(64, 64, (x) => rgba(x < 40 ? '#c0392b' : '#7a1a12')));
  assert.equal(
    reds.anchors!.picked.dark.secondary,
    APPROVED_ANCHORS['portfolio-artwork']!.dark.secondary,
  );
  assert.match(reds.notes![0]!, new RegExp(`${SECONDARY_HUE_APART} degrees`));
  // Greys alone: the approved accent and secondary.
  // Near-neutrals, under MIN_CHROMA, never score.
  const grey = run(raster(16, 16, (x) => rgba(x < 8 ? '#3a3d42' : '#c8cacd')));
  assert.deepEqual(grey.anchors!.picked, APPROVED_ANCHORS['portfolio-artwork']);
  assert.match(grey.notes![0]!, /No color scored/);
  for (const result of [two, reds, grey]) {
    assert.equal(result.contrastReport.passes, true);
    assert.ok(generatedSets({ 'portfolio-artwork': result.tokens }, 'portfolio-artwork'));
  }
});

test("an image generator without the image's pixels is a problem, never a throw", () => {
  for (const id of ['profile-image', 'portfolio-artwork']) {
    const run = runGenerator(declared(id), { sourceAsset: 'portrait' });
    assert.equal(run.ok, false);
    assert.match(run.ok ? '' : run.problem, /decoded pixels/);
    assert.throws(() => GENERATORS[id]!.generate({ sourceAsset: 'portrait' }), TypeError);
    const bad = runGenerator(
      declared(id),
      { sourceAsset: 'portrait' },
      {
        raster: { width: 3, height: 3, data: new Uint8Array(4) },
      },
    );
    assert.equal(bad.ok, false);
    assert.match(bad.ok ? '' : bad.problem, /can't read its input/);
  }
  for (const id of ['brand-seed', 'hct-tonal']) {
    assert.throws(() => GENERATORS[id]!.generate({ sourceAsset: 'portrait' }), TypeError);
  }
});
