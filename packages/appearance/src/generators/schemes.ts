// #20's four generated schemes (PR 3), first-party on #19's color math:
// each picks a mode's anchors from its input, and compose() solves them
// with anchor-v2. The approved anchors are the reviewed catalog's
// (scripts/catalog/seed/appearance-catalog.js), which schemes.test.ts holds
// them to.
//
// - brand-seed: the approved canvas, text, and secondary, with the seed as
//   the accent in both modes.
// - hct-tonal: the seed's HCT hue and chroma (hct.ts) as tonal palettes:
//   primary at the seed's hue and at least 48 chroma, tertiary 60 degrees
//   on at 24, neutral at 4. Light is neutral 99 and 10, primary 40, and
//   tertiary 40; dark is neutral 10 and 90, primary 80, and tertiary 80.
// - profile-image and portfolio-artwork: image-palette@1 (palette.ts) over
//   the approved canvas and text, the top-scoring color the accent and the
//   next one 30 degrees of hue away the secondary.

import { hue } from '../color';
import type { Anchors } from '../derive';
import type { Composition, ModeAnchors } from './compose';
import { hctOf, tone } from './hct';
import { imagePalette, type Raster } from './palette';

const anchors = (value: string): Anchors => {
  const [canvas, text, accent, secondary] = value.split('/').map((hex) => `#${hex}`) as [
    string,
    string,
    string,
    string,
  ];
  return { canvas, text, accent, secondary };
};

/** The reviewed catalog's anchors for each generated scheme, light then dark. */
export const APPROVED_ANCHORS: Readonly<Record<string, ModeAnchors>> = Object.freeze({
  'brand-seed': {
    light: anchors('f7f7fb/202235/5b5bd6/0f9f88'),
    dark: anchors('11121a/f0f1fb/8d8df0/4bc7b3'),
  },
  'profile-image': {
    light: anchors('f7f4f1/242a32/315c8c/b66a4d'),
    dark: anchors('15181d/f4eee9/6f9dce/dd967b'),
  },
  'portfolio-artwork': {
    light: anchors('fbf4f8/312335/7a3f92/d56b3f'),
    dark: anchors('1c121e/f8edf5/b97ad0/ef9a78'),
  },
});

const approved = (id: string): ModeAnchors => APPROVED_ANCHORS[id]!;

/** brand-seed@1: the approved anchors with the seed as the accent. */
export function brandSeed(seed: string): Composition {
  const base = approved('brand-seed');
  return {
    algorithm: 'brand-seed@1',
    anchors: {
      light: { ...base.light, accent: seed },
      dark: { ...base.dark, accent: seed },
    },
    notes: [],
  };
}

/** The core palettes hct@1 takes from a seed's hue and chroma. */
export function hctPalettes(seed: string) {
  const { hue: seedHue, chroma: seedChroma } = hctOf(seed);
  return {
    primary: { hue: seedHue, chroma: Math.max(48, seedChroma) },
    tertiary: { hue: (seedHue + 60) % 360, chroma: 24 },
    neutral: { hue: seedHue, chroma: 4 },
  };
}

/** hct@1: every anchor a tone of one of the seed's palettes. */
export function hctTonal(seed: string): Composition {
  const { primary, tertiary, neutral } = hctPalettes(seed);
  return {
    algorithm: 'hct@1',
    anchors: {
      light: {
        canvas: tone(neutral, 99),
        text: tone(neutral, 10),
        accent: tone(primary, 40),
        secondary: tone(tertiary, 40),
      },
      dark: {
        canvas: tone(neutral, 10),
        text: tone(neutral, 90),
        accent: tone(primary, 80),
        secondary: tone(tertiary, 80),
      },
    },
    notes: [],
  };
}

/** The least hue between the accent and the secondary an image gives, in OKLCH degrees. */
export const SECONDARY_HUE_APART = 30;

const hueApart = (first: string, second: string) => {
  const difference = Math.abs(hue(first) - hue(second)) % 360;
  return Math.min(difference, 360 - difference);
};

/** image-palette@1 for `id`: the image's two best colors over the approved canvas and text. */
export function fromImage(id: 'profile-image' | 'portfolio-artwork', raster: Raster): Composition {
  const base = approved(id);
  const extracted = imagePalette(raster);
  const scored = extracted.filter(({ score }) => score > 0);
  const notes: string[] = [];
  const accent = scored[0]?.hex;
  const secondary = accent
    ? scored.slice(1).find(({ hex }) => hueApart(hex, accent) >= SECONDARY_HUE_APART)?.hex
    : undefined;
  if (!accent) notes.push('No color scored, so the accent and secondary are the approved ones.');
  else if (!secondary)
    notes.push(
      `Only one color scored ${SECONDARY_HUE_APART} degrees of hue apart, so the secondary is the approved one.`,
    );
  const pick = (mode: 'light' | 'dark'): Anchors => ({
    ...base[mode],
    accent: accent ?? base[mode].accent,
    secondary: secondary ?? base[mode].secondary,
  });
  return {
    algorithm: 'image-palette@1',
    anchors: { light: pick('light'), dark: pick('dark') },
    extracted,
    notes,
  };
}
