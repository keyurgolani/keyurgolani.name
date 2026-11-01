import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './harness.test';

// The appearance package's colour math, loaded from its source at run time: the
// package declares no dependency on @portfolio/appearance, and this test adds none.
type ColorTokens = Readonly<Record<string, string>> & {
  readonly accent: string;
  readonly 'on-accent': string;
  readonly 'text-primary': string;
  readonly 'surface-prominent': string;
};
type ColorSetName = string;
interface ColorSchemeManifest {
  readonly generator?: unknown;
  readonly anchors?: Record<'light' | 'dark', unknown>;
  readonly derivation?: string;
  readonly light?: ColorTokens;
  readonly dark?: ColorTokens;
  readonly highContrast?: unknown;
}
const appearance = (await import(
  pathToFileURL(path.join(REPO_ROOT, 'packages', 'appearance', 'src', 'index.ts')).href
)) as {
  contrast: (a: string, b: string) => number;
  deriveBaseSet: (derivation: string, anchors: unknown, mode: 'light' | 'dark') => ColorTokens;
  isHighContrastSet: (name: string) => boolean;
  schemeSets: (
    base: unknown,
    highContrast: unknown,
    derivation: unknown,
    anchors: unknown,
  ) => Record<string, ColorTokens>;
};
const { contrast, deriveBaseSet, isHighContrastSet, schemeSets } = appearance;

// TF-M7 (the lead's ruling, 2026-10-27): the field is the accent by
// default, its text and its links on-accent, so on-accent on accent must
// read at 4.5:1 or more in every set of every shipping scheme. K-2 derives
// on-accent as black or white, whichever contrasts more, and pins the pair;
// this holds Terra's default to it, so a scheme that slips fails here, not
// on the page. Quiet, the field is the prominent surface under the primary
// text, which the derivation holds already.

const SCHEMES = path.join(REPO_ROOT, 'packages', 'appearance-schemes', 'packs');
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;

/** Every set of every shipping scheme that renders from its manifest: generated ones have none. */
function sets(): { id: string; name: ColorSetName; tokens: ColorTokens }[] {
  return fs
    .readdirSync(SCHEMES)
    .filter((id) => fs.existsSync(path.join(SCHEMES, id, 'manifest.json')))
    .sort()
    .flatMap((id) => {
      const manifest = read<ColorSchemeManifest & Record<string, unknown>>(
        path.join(SCHEMES, id, 'manifest.json'),
      );
      if (manifest.generator) return [];
      const base = manifest.anchors
        ? Object.fromEntries(
            (['light', 'dark'] as const)
              .filter((mode) => manifest.anchors![mode])
              .map((mode) => [
                mode,
                deriveBaseSet(manifest.derivation ?? 'anchor-v1', manifest.anchors![mode]!, mode),
              ]),
          )
        : { light: manifest.light, dark: manifest.dark };
      const all = schemeSets(base, manifest.highContrast, manifest.derivation, manifest.anchors);
      return (Object.entries(all) as [ColorSetName, ColorTokens][]).map(([name, tokens]) => ({
        id,
        name,
        tokens,
      }));
    });
}

test('the field reads in every shipping scheme: on-accent on accent at 4.5:1 or more (TF-M7)', () => {
  const every = sets();
  assert.ok(every.length > 60, `${every.length} sets`);
  assert.ok(
    every.some(({ id }) => id === 'botanical-sage'),
    "the recipe's scheme ships",
  );
  const failing = every
    .map(({ id, name, tokens }) => ({
      id,
      name,
      ratio: contrast(tokens['on-accent'], tokens.accent),
    }))
    .filter(({ ratio }) => ratio < 4.5)
    .map(({ id, name, ratio }) => `${id} ${name}: ${ratio.toFixed(2)}:1`);
  assert.deepEqual(failing, []);
});

test('quiet, the field reads too: the primary text on the prominent surface, in every set', () => {
  for (const { id, name, tokens } of sets()) {
    const target = isHighContrastSet(name) ? 7 : 4.5;
    const ratio = contrast(tokens['text-primary'], tokens['surface-prominent']);
    assert.ok(ratio >= target, `${id} ${name}: ${ratio.toFixed(2)}:1`);
  }
});

// The generated schemes the manifests leave to an owner's input (code review low 13):
// brand-seed and hct-tonal from a seed colour, portfolio-artwork from an image's pixels.
// Each runs on a spread of inputs, and every set it gives holds the field's pair.
const generators = (await import(
  pathToFileURL(path.join(REPO_ROOT, 'packages', 'appearance', 'src', 'generators', 'index.ts'))
    .href
)) as {
  GENERATORS: Record<
    string,
    {
      generate: (
        input: { seedColor: string } | { sourceAsset: string },
        raster?: { width: number; height: number; data: Uint8ClampedArray },
      ) => {
        light: ColorTokens;
        dark: ColorTokens;
        highContrast?: { light: ColorTokens; dark: ColorTokens };
      };
    }
  >;
};

/** A colour of the wheel as hex: hue in degrees, at a mid saturation and lightness. */
function hue(degrees: number, s = 0.65, l = 0.5): string {
  const k = (n: number) => (n + degrees / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return `#${[f(0), f(8), f(4)]
    .map((x) =>
      Math.round(x * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** A 32 by 32 raster in two colours' stripes, as an image generator decodes one. */
function stripes(one: string, two: string) {
  const rgb = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const [a, b] = [rgb(one), rgb(two)];
  const data = new Uint8ClampedArray(32 * 32 * 4);
  for (let i = 0; i < 32 * 32; i++) data.set([...(i % 32 < 20 ? a : b), 255], i * 4);
  return { width: 32, height: 32, data };
}

test('the field reads in every generated scheme too, over a spread of seeds and images (low 13)', () => {
  const seeds = [
    ...Array.from({ length: 18 }, (_, i) => hue(i * 20)),
    '#777777',
    hue(140, 0.3, 0.3),
  ];
  const failing: string[] = [];
  let checked = 0;
  const check = (
    label: string,
    scheme: ReturnType<(typeof generators.GENERATORS)[string]['generate']>,
  ) => {
    const named: [string, ColorTokens][] = [
      ['light', scheme.light],
      ['dark', scheme.dark],
      ...(scheme.highContrast
        ? ([
            ['hc light', scheme.highContrast.light],
            ['hc dark', scheme.highContrast.dark],
          ] as [string, ColorTokens][])
        : []),
    ];
    for (const [set, tokens] of named) {
      checked++;
      const ratio = contrast(tokens['on-accent'], tokens.accent);
      if (ratio < 4.5) failing.push(`${label} ${set}: ${ratio.toFixed(2)}:1`);
    }
  };
  for (const id of ['brand-seed', 'hct-tonal']) {
    const generator = generators.GENERATORS[id]!;
    for (const seed of seeds) check(`${id} ${seed}`, generator.generate({ seedColor: seed }));
  }
  const artwork = generators.GENERATORS['portfolio-artwork']!;
  for (let i = 0; i < seeds.length - 1; i++)
    check(
      `portfolio-artwork ${seeds[i]}+${seeds[i + 1]}`,
      artwork.generate({ sourceAsset: 'stripes' }, stripes(seeds[i]!, seeds[i + 1]!)),
    );
  assert.ok(checked > 100, `${checked} sets`);
  assert.deepEqual(failing, []);
});
