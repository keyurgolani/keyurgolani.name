import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Shell sets its figures (a key's value, a record's numbers, a fold's count, the proof line's
// figure, a star) in --layout-fig, a mix of the scheme's emphasis and its primary text. Emphasis
// is a fill role: the scheme gate holds text on it (on-emphasis), never it as text on the page.
// So the mix is what keeps a figure readable, and this holds it to text contrast on the grounds
// Shell paints (the canvas, the subtle surface, the palette's overlay): 4.5:1, and 7:1 in a
// high-contrast set, in every set of every shipping scheme and of the generated ones over a
// spread of inputs. Print renders the light set, so the light sets cover it. The mix is read from
// the stylesheet and worked out as the browser does color-mix(in oklab, ...).

type ColorTokens = Readonly<Record<string, string>>;
interface ColorSchemeManifest {
  readonly generator?: unknown;
  readonly anchors?: Record<'light' | 'dark', unknown>;
  readonly derivation?: string;
  readonly light?: ColorTokens;
  readonly dark?: ColorTokens;
  readonly highContrast?: unknown;
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CSS = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const appearance = (await import(
  pathToFileURL(path.join(REPO_ROOT, 'packages', 'appearance', 'src', 'index.ts')).href
)) as {
  contrast: (a: string, b: string) => number;
  deriveBaseSet: (derivation: string, anchors: unknown, mode: 'light' | 'dark') => ColorTokens;
  schemeSets: (
    base: unknown,
    highContrast: unknown,
    derivation: unknown,
    anchors: unknown,
  ) => Record<string, ColorTokens>;
};
const { contrast, deriveBaseSet, schemeSets } = appearance;

const GROUNDS = ['canvas', 'surface-subtle', 'surface-overlay'] as const;
const SCHEMES = path.join(REPO_ROOT, 'packages', 'appearance-schemes', 'packs');
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;

const FIG =
  /--layout-fig:\s*color-mix\(\s*in oklab,\s*var\(--color-([a-z0-9-]+)\)\s+(\d+(?:\.\d+)?)%,\s*var\(--color-([a-z0-9-]+)\)\s*\)\s*;/.exec(
    CSS,
  );

const linear = (channel: number) => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const gamma = (value: number) =>
  value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;

function toOklab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((at) => linear(parseInt(hex.slice(at, at + 2), 16))) as [
    number,
    number,
    number,
  ];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: readonly number[]): string {
  const l = (L! + 0.3963377774 * a! + 0.2158037573 * b!) ** 3;
  const m = (L! - 0.1055613458 * a! - 0.0638541728 * b!) ** 3;
  const s = (L! - 0.0894841775 * a! - 1.291485548 * b!) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${rgb
    .map((value) =>
      Math.round(Math.min(1, Math.max(0, gamma(value))) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** color-mix(in oklab, first share%, second). */
function mixOklab(first: string, second: string, share: number): string {
  const x = toOklab(first);
  const y = toOklab(second);
  return fromOklab(x.map((value, i) => value * share + y[i]! * (1 - share)));
}

function figure(tokens: ColorTokens): string {
  const [, first, share, second] = FIG!;
  return mixOklab(tokens[first!]!, tokens[second!]!, Number(share) / 100);
}

const failures = (label: string, tokens: ColorTokens, highContrast: boolean) => {
  const need = highContrast ? 7 : 4.5;
  const fig = figure(tokens);
  return GROUNDS.flatMap((ground) => {
    const ratio = contrast(fig, tokens[ground]!);
    return ratio < need
      ? [`${label}: ${fig} on ${ground} ${ratio.toFixed(2)}:1, under ${need}`]
      : [];
  });
};

function sets(): { id: string; name: string; tokens: ColorTokens }[] {
  return fs
    .readdirSync(SCHEMES)
    .filter((id) => fs.existsSync(path.join(SCHEMES, id, 'manifest.json')))
    .sort()
    .flatMap((id) => {
      const manifest = read<ColorSchemeManifest>(path.join(SCHEMES, id, 'manifest.json'));
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
      return Object.entries(all).map(([name, tokens]) => ({ id, name, tokens }));
    });
}

test('the figure colour is a mix of two colour roles the stylesheet names', () => {
  assert.ok(FIG, '--layout-fig is color-mix(in oklab, var(--color-a) n%, var(--color-b))');
});

test('figures read at text contrast on every ground Shell paints, in every shipping scheme', () => {
  const every = sets();
  assert.ok(every.length > 60, `${every.length} sets`);
  assert.ok(
    every.some(({ id, name }) => id === 'aurora-meadow' && name === 'light'),
    'Aurora Meadow ships a light set',
  );
  assert.deepEqual(
    every.flatMap(({ id, name, tokens }) =>
      failures(`${id} ${name}`, tokens, name.startsWith('high-contrast')),
    ),
    [],
  );
});

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
  for (let i = 0; i < 32 * 32; i++) data.set([...(i % 32 < 20 ? a! : b!), 255], i * 4);
  return { width: 32, height: 32, data };
}

test('figures read at text contrast in every generated scheme too, over a spread of seeds and images', () => {
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
    const named: [string, ColorTokens, boolean][] = [
      ['light', scheme.light, false],
      ['dark', scheme.dark, false],
      ...(scheme.highContrast
        ? ([
            ['hc light', scheme.highContrast.light, true],
            ['hc dark', scheme.highContrast.dark, true],
          ] as [string, ColorTokens, boolean][])
        : []),
    ];
    for (const [set, tokens, high] of named) {
      checked++;
      failing.push(...failures(`${label} ${set}`, tokens, high));
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
