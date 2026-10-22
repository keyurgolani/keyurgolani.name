// @portfolio/appearance/generators (#19, Slice 2, item 5): scheme generators,
// keyed by a color scheme manifest's `generator.id`. Each is a pure function
// of its input, browser-safe like the root entry, so #10's draft save and
// #9's Demo Studio in the browser generate the same bytes, and each result
// carries its contrast report. This issue ships the deterministic
// fixture-seed; #20 (Slice 8) adds the first-party generators.

import { mix } from '../color';
import { anchorV1 } from '../derive';
import { contrastReport, type ContrastReport } from '../gate';
import type { GeneratedScheme } from '../resolve-tokens';
import { schemeSets } from '../sets';

/** What a generator reads: a site's appearanceInputs entry for its scheme. */
export type GeneratorInput = { readonly seedColor: string } | { readonly sourceAsset: string };

export interface SchemeGenerator {
  readonly id: string;
  /** A scheme names the version it was built for; another one refuses to run for it. */
  readonly version: number;
  readonly input: 'seed-color' | 'asset';
  /** Both base modes, as concrete hex. Pure: one input, one output, everywhere. */
  readonly generate: (input: GeneratorInput) => GeneratedScheme;
}

export interface GeneratorResult {
  readonly generator: { readonly id: string; readonly version: number };
  /** The input as the generator read it, a seed color lowercased. */
  readonly input: GeneratorInput;
  /** What #10's draft save stores in the draft's derived.schemes. */
  readonly tokens: GeneratedScheme;
  /** Every set the scheme renders, its high-contrast ones included, gated on their own. */
  readonly contrastReport: ContrastReport;
}

const SEED = /^#[0-9a-fA-F]{6}$/;

/**
 * fixture-seed, version 1: the seed tints a near-white canvas and near-black
 * text for light, and a near-black canvas and near-white text for dark, so
 * text always passes; the seed is the light accent and a lighter seed the
 * dark one; anchor-v1 solves the rest.
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
      light: anchorV1(
        {
          canvas: mix('#ffffff', seed, 6),
          text: mix('#000000', seed, 18),
          accent: seed,
          secondary: mix(seed, '#000000', 40),
        },
        'light',
      ),
      dark: anchorV1(
        {
          canvas: mix('#000000', seed, 12),
          text: mix('#ffffff', seed, 10),
          accent: mix(seed, '#ffffff', 30),
          secondary: mix(seed, '#ffffff', 60),
        },
        'dark',
      ),
    };
  },
});

/** Every generator this build has, by id. */
export const GENERATORS: Readonly<Record<string, SchemeGenerator>> = Object.freeze({
  [FIXTURE_SEED.id]: FIXTURE_SEED,
});

export type GeneratorRun =
  | { readonly ok: true; readonly result: GeneratorResult }
  | { readonly ok: false; readonly problem: string };

/**
 * Runs the generator a scheme's manifest names on a site's input for it.
 * It never throws: an unknown generator, another version, or an input of
 * the wrong kind is a problem the caller reports.
 */
export function runGenerator(
  declared: {
    readonly id: string;
    readonly version: number;
    readonly input: 'seed-color' | 'asset';
  },
  input: unknown,
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
  const tokens = generator.generate(read);
  return {
    ok: true,
    result: {
      generator: { id: generator.id, version: generator.version },
      input: read,
      tokens,
      contrastReport: contrastReport(schemeSets(tokens)),
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
