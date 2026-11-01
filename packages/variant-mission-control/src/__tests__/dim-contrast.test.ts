import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './harness.test';

// MC-M4: while a record lights, the rest dims, and dimmed text keeps 4.5:1
// or more. The dim is the muted text role on the grounds a record sits on:
// the panel (surface-default), the chrome and a hovered module
// (surface-subtle), and the canvas. This holds it in every set of every
// shipping scheme, and of the generated ones over a spread of inputs, so a
// scheme that slips fails here, not on the page. The appearance package's
// colour math is loaded from its source at run time: the package declares
// no dependency on @portfolio/appearance, and this test adds none.

type ColorTokens = Readonly<Record<string, string>>;
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
  schemeSets: (
    base: unknown,
    highContrast: unknown,
    derivation: unknown,
    anchors: unknown,
  ) => Record<string, ColorTokens>;
};
const { contrast, deriveBaseSet, schemeSets } = appearance;

const GROUNDS = ['surface-default', 'surface-subtle', 'canvas'] as const;
const DIM = 'text-muted';
const SCHEMES = path.join(REPO_ROOT, 'packages', 'appearance-schemes', 'packs');
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;

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

const failures = (label: string, tokens: ColorTokens) =>
  GROUNDS.flatMap((ground) => {
    if (!tokens[DIM] || !tokens[ground]) return [`${label}: no ${tokens[DIM] ? ground : DIM}`];
    const ratio = contrast(tokens[DIM]!, tokens[ground]!);
    return ratio < 4.5 ? [`${label} ${DIM} on ${ground}: ${ratio.toFixed(2)}:1`] : [];
  });

test('dimmed text reads at 4.5:1 or more on every ground, in every shipping scheme (MC-M4)', () => {
  const every = sets();
  assert.ok(every.length > 60, `${every.length} sets`);
  assert.ok(
    every.some(({ id }) => id === 'control-room'),
    "the recipe's scheme ships",
  );
  assert.deepEqual(
    every.flatMap(({ id, name, tokens }) => failures(`${id} ${name}`, tokens)),
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
  for (let i = 0; i < 32 * 32; i++) data.set([...(i % 32 < 20 ? a : b), 255], i * 4);
  return { width: 32, height: 32, data };
}

test('dimmed text reads in every generated scheme too, over a spread of seeds and images', () => {
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
      failing.push(...failures(`${label} ${set}`, tokens));
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
