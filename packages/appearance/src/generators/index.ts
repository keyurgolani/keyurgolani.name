// @portfolio/appearance/generators (#19, Slice 2, item 5): scheme generators,
// keyed by a color scheme manifest's `generator.id`. Each is a pure function
// of its input, browser-safe like the root entry, so #10's draft save and
// #9's Demo Studio in the browser generate the same bytes, and each result
// carries its contrast report. #19 ships the deterministic fixture-seed.
//
// #20 PR 3 adds the four first-party generators (schemes.ts): brand-seed and
// hct-tonal from a seed color, and profile-image and portfolio-artwork from
// an image's decoded pixels, which the caller hands over beside the stored
// input. Each result is the record #10's draft save stores: the input, the
// algorithm and its version, what it extracted and chose, every adjustment,
// all four sets, and the contrast report at the strictest shipping reading.
// An image-derived result is `review: pending` until the owner accepts it,
// and generatedSets() never renders a pending one.

import type { BaseMode } from '../axes';
import { BLACK, contrast, lightness, mix, WHITE, withLightness } from '../color';
import { anchorV1 } from '../derive';
import {
  contrastReport,
  GROUND_ROLES,
  NEUTRAL_LANGUAGE,
  type ContrastReport,
  type GateLanguage,
  type GateTypography,
} from '../gate';
import type { GeneratedScheme } from '../resolve-tokens';
import { schemeSets } from '../sets';
import type { ColorTokens } from '../roles';
import { compose, type Composed, type Composition, type ExtractedColor } from './compose';
import type { Raster } from './palette';
import { brandSeed, fromImage, hctTonal } from './schemes';

export type { Raster } from './palette';
export type { AnchorMoves, Composition, ExtractedColor, ModeAnchors } from './compose';
export { APPROVED_ANCHORS, hctPalettes, SECONDARY_HUE_APART } from './schemes';
export { fromHct, hctOf, toneOf } from './hct';
export { imagePalette } from './palette';

/** What a generator reads: a site's appearanceInputs entry for its scheme. */
export type GeneratorInput = { readonly seedColor: string } | { readonly sourceAsset: string };

export interface SchemeGenerator {
  readonly id: string;
  /** A scheme names the version it was built for; another one refuses to run for it. */
  readonly version: number;
  readonly input: 'seed-color' | 'asset';
  /**
   * Both base modes, as concrete hex, and for #20's generators both
   * high-contrast sets. Pure: one input, one output, everywhere. An asset
   * generator reads the image's decoded pixels, `raster`, and throws
   * without them.
   */
  readonly generate: (input: GeneratorInput, raster?: Raster) => GeneratedScheme;
  /** For #20's generators: what it chose from the input, which its record keeps. */
  readonly compose?: (input: GeneratorInput, raster?: Raster) => Composition;
}

/** The stored input: a seed color, or an asset with the hash of the pixels it was decoded to. */
export type RecordedInput =
  | { readonly seedColor: string }
  | { readonly sourceAsset: string; readonly pixelsSha256?: string };

export interface GeneratorResult {
  readonly generator: { readonly id: string; readonly version: number };
  /** The input as the generator read it, a seed color lowercased. */
  readonly input: RecordedInput;
  /** What #10's draft save stores in the draft's derived.schemes. */
  readonly tokens: GeneratedScheme;
  /** Every set the scheme renders, its high-contrast ones included, gated on their own. */
  readonly contrastReport: ContrastReport;
  /** For #20's generators: the algorithm, what it chose, and every move it and anchor-v2 made. */
  readonly algorithm?: string;
  readonly extracted?: readonly ExtractedColor[];
  readonly anchors?: { readonly picked: Composition['anchors']; readonly used: Composed['anchors'] };
  readonly adjustments?: Composed['adjustments'];
  readonly notes?: readonly string[];
  /** What the report read: the language and typography it gated with. */
  readonly reading?: string;
}

/**
 * The strictest reading a shipping pack gives a scheme, which #20's
 * generators report at. A shipping language is either textured and opaque
 * (every target on canvas and the surfaces times 1.1) or untextured, and
 * glassmorphism's 97% floor is the lowest surface opacity any of them has,
 * read over canvas, black, and white. Both readings take strong control
 * borders and a 2px ring, and every shipping profile sets the signature
 * fill as WCAG large text, anchor-v2's premise. A node test holds these to
 * the shipping packs.
 */
export const STRICTEST_READINGS: readonly {
  readonly name: string;
  readonly language: GateLanguage;
}[] = Object.freeze([
  {
    name: 'textured and opaque',
    language: Object.freeze({ ...NEUTRAL_LANGUAGE, textured: true }),
  },
  {
    name: 'at 97% surface opacity over canvas, black, and white',
    language: Object.freeze({ ...NEUTRAL_LANGUAGE, surfaceOpacity: 0.97 }),
  },
]);
export const SHIPPING_TYPOGRAPHY: GateTypography = Object.freeze({ largeSignature: true });

/** A scheme's sets gated at both strictest readings, as one report. */
export function strictestReport(sets: Parameters<typeof contrastReport>[0]): ContrastReport {
  const pairs = STRICTEST_READINGS.flatMap(
    ({ language }) => contrastReport(sets, language, SHIPPING_TYPOGRAPHY).pairs,
  );
  return { passes: pairs.every((pair) => pair.passes), pairs };
}

/** What a #20 generator's report says it read. */
export const STRICTEST_READING = `${STRICTEST_READINGS.map(({ name }) => name).join(', and ')}, with the signature fill as large text`;

const SEED = /^#[0-9a-fA-F]{6}$/;

/**
 * `color`, or the first 0.02 step of it in OKLCH lightness, darker on a
 * light page and lighter on a dark one, that reads at 4.6:1 on every ground.
 */
function legible(color: string, grounds: readonly string[], mode: BaseMode): string {
  const reads = (candidate: string) =>
    grounds.every((ground) => contrast(candidate, ground) >= 4.6);
  if (reads(color)) return color;
  const from = lightness(color);
  for (let step = 1; step <= 50; step += 1) {
    const candidate = withLightness(
      color,
      mode === 'light' ? from - 0.02 * step : from + 0.02 * step,
    );
    if (reads(candidate)) return candidate;
  }
  return mode === 'light' ? BLACK : WHITE;
}

/**
 * One mode from a canvas, text, and two seed colors: anchor-v1, with the
 * accent and secondary anchors made legible first, since anchors never move
 * and they're the signature fill's colors. The accent keeps an OKLCH
 * lightness from 0.3 to 0.8, so its hover and active states have room to
 * move away from on-accent, whichever of black and white that is.
 */
function seededMode(
  canvas: string,
  text: string,
  accent: string,
  secondary: string,
  mode: BaseMode,
): ColorTokens {
  const draft = anchorV1({ canvas, text, accent, secondary }, mode);
  const grounds = GROUND_ROLES.map((role) => draft[role]);
  const toned = withLightness(accent, Math.min(0.8, Math.max(0.3, lightness(accent))));
  return anchorV1(
    {
      canvas,
      text,
      accent: legible(toned, grounds, mode),
      secondary: legible(secondary, grounds, mode),
    },
    mode,
  );
}

/**
 * fixture-seed, version 1: the seed tints a near-white canvas and near-black
 * text for light, and a near-black canvas and near-white text for dark, so
 * text always passes. The seed, and a lighter seed for dark, is the accent,
 * and a deeper or paler seed the secondary, each moved until it reads.
 * anchor-v1 solves the rest, so every seed passes the gate.
 */
export const FIXTURE_SEED: SchemeGenerator = Object.freeze({
  id: 'fixture-seed',
  version: 1,
  input: 'seed-color',
  generate(input: GeneratorInput): GeneratedScheme {
    if (!('seedColor' in input) || !SEED.test(input.seedColor)) {
      throw new TypeError('fixture-seed takes a six-digit hex seed color.');
    }
    const seed = input.seedColor.toLowerCase();
    return {
      light: seededMode(
        mix(WHITE, seed, 6),
        mix(BLACK, seed, 18),
        seed,
        mix(seed, BLACK, 40),
        'light',
      ),
      dark: seededMode(
        mix(BLACK, seed, 12),
        mix(WHITE, seed, 10),
        mix(seed, WHITE, 30),
        mix(seed, WHITE, 60),
        'dark',
      ),
    };
  },
});

/** A seed color the generator can read, lowercased, or a TypeError naming it. */
function seedOf(id: string, input: GeneratorInput): string {
  if (!('seedColor' in input) || !SEED.test(input.seedColor)) {
    throw new TypeError(`${id} takes a six-digit hex seed color.`);
  }
  return input.seedColor.toLowerCase();
}

/** The pixels an asset generator reads, or a TypeError naming it. */
function rasterOf(id: string, input: GeneratorInput, raster: Raster | undefined): Raster {
  if (!('sourceAsset' in input) || !raster) {
    throw new TypeError(`${id} takes { sourceAsset } with the asset's decoded pixels.`);
  }
  return raster;
}

/** A #20 generator from its composition: compose() solves it, and an image's output waits for review. */
function composed(
  id: string,
  input: 'seed-color' | 'asset',
  choose: (input: GeneratorInput, raster?: Raster) => Composition,
): SchemeGenerator {
  return Object.freeze({
    id,
    version: 1,
    input,
    compose: choose,
    generate(read: GeneratorInput, raster?: Raster): GeneratedScheme {
      const { tokens } = compose(choose(read, raster));
      return input === 'asset' ? { ...tokens, review: 'pending' } : tokens;
    },
  });
}

/** brand-seed, version 1: the approved canvas, text, and secondary, and the seed as the accent. */
export const BRAND_SEED = composed('brand-seed', 'seed-color', (input) =>
  brandSeed(seedOf('brand-seed', input)),
);

/** hct-tonal, version 1: every anchor a tone of the seed's HCT palettes (hct@1). */
export const HCT_TONAL = composed('hct-tonal', 'seed-color', (input) =>
  hctTonal(seedOf('hct-tonal', input)),
);

/** profile-image, version 1: image-palette@1 over the approved canvas and text. */
export const PROFILE_IMAGE = composed('profile-image', 'asset', (input, raster) =>
  fromImage('profile-image', rasterOf('profile-image', input, raster)),
);

/** portfolio-artwork, version 1: image-palette@1 over its approved canvas and text. */
export const PORTFOLIO_ARTWORK = composed('portfolio-artwork', 'asset', (input, raster) =>
  fromImage('portfolio-artwork', rasterOf('portfolio-artwork', input, raster)),
);

/** Every generator this build has, by id. */
export const GENERATORS: Readonly<Record<string, SchemeGenerator>> = Object.freeze({
  [FIXTURE_SEED.id]: FIXTURE_SEED,
  [BRAND_SEED.id]: BRAND_SEED,
  [HCT_TONAL.id]: HCT_TONAL,
  [PROFILE_IMAGE.id]: PROFILE_IMAGE,
  [PORTFOLIO_ARTWORK.id]: PORTFOLIO_ARTWORK,
});

export type GeneratorRun =
  | { readonly ok: true; readonly result: GeneratorResult }
  | { readonly ok: false; readonly problem: string };

/** What an asset generator reads beside its input: the decoded pixels, and their hash for the record. */
export interface AssetPixels {
  readonly raster: Raster;
  /** The pixels' SHA-256, as pixelsSha256() in @portfolio/appearance/node gives it. */
  readonly pixelsSha256?: string;
}

/**
 * Runs the generator a scheme's manifest names on a site's input for it.
 * It never throws: an unknown generator, another version, an input of the
 * wrong kind, or an asset input without its pixels is a problem the caller
 * reports.
 */
export function runGenerator(
  declared: {
    readonly id: string;
    readonly version: number;
    readonly input: 'seed-color' | 'asset';
  },
  input: unknown,
  asset?: AssetPixels,
): GeneratorRun {
  const generator = Object.hasOwn(GENERATORS, declared.id) ? GENERATORS[declared.id] : undefined;
  if (!generator) return { ok: false, problem: `This build has no generator ${declared.id}.` };
  if (generator.version !== declared.version) {
    return {
      ok: false,
      problem: `The scheme was built for ${declared.id} version ${declared.version}, and this build has version ${generator.version}.`,
    };
  }
  if (generator.input !== declared.input) {
    return {
      ok: false,
      problem: `${declared.id} takes a ${generator.input} input, not ${declared.input}.`,
    };
  }
  const read = readInput(generator.input, input);
  if (!read) {
    return {
      ok: false,
      problem:
        generator.input === 'seed-color'
          ? `${declared.id} takes { seedColor }, a six-digit hex color such as #3366ff.`
          : `${declared.id} takes { sourceAsset }, a media asset id.`,
    };
  }
  if (generator.input === 'asset' && generator.compose && !asset) {
    return { ok: false, problem: `${declared.id} reads the asset's decoded pixels, and none came with it.` };
  }
  const id = { id: generator.id, version: generator.version };
  if (!generator.compose) {
    const tokens = generator.generate(read);
    return {
      ok: true,
      result: { generator: id, input: read, tokens, contrastReport: contrastReport(schemeSets(tokens)) },
    };
  }
  let composition: Composition;
  try {
    composition = generator.compose(read, asset?.raster);
  } catch (error) {
    return { ok: false, problem: `${declared.id} can't read its input: ${(error as Error).message}` };
  }
  const solved = compose(composition);
  const tokens: GeneratedScheme =
    generator.input === 'asset' ? { ...solved.tokens, review: 'pending' } : solved.tokens;
  const recorded: RecordedInput =
    'sourceAsset' in read && asset?.pixelsSha256 !== undefined
      ? { sourceAsset: read.sourceAsset, pixelsSha256: asset.pixelsSha256 }
      : read;
  return {
    ok: true,
    result: {
      generator: id,
      input: recorded,
      algorithm: `${composition.algorithm}, anchor-v2`,
      ...(composition.extracted ? { extracted: composition.extracted } : {}),
      anchors: { picked: composition.anchors, used: solved.anchors },
      adjustments: solved.adjustments,
      notes: composition.notes,
      tokens,
      reading: STRICTEST_READING,
      contrastReport: strictestReport(schemeSets(solved.tokens, solved.tokens.highContrast)),
    },
  };
}

/** The input's own field for `kind`, never one it inherits. */
function readInput(kind: 'seed-color' | 'asset', input: unknown): GeneratorInput | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const own = (key: string) =>
    Object.hasOwn(input, key) ? (input as Record<string, unknown>)[key] : undefined;
  if (kind === 'seed-color') {
    const seed = own('seedColor');
    return typeof seed === 'string' && SEED.test(seed) ? { seedColor: seed.toLowerCase() } : null;
  }
  const asset = own('sourceAsset');
  return typeof asset === 'string' && asset !== '' ? { sourceAsset: asset } : null;
}
