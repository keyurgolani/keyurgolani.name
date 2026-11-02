// The pack-distinctness guard's arithmetic (LANG-3, and LANG-4 after it):
// what pack-distinct.spec.ts measures, as pure functions a unit test runs
// without a browser. One composition renders under every registered pack on
// one axis, the other axes held at the guards' tuple, and every pair of packs
// gets two scores:
//
// - Pixels. The first viewport's edges, exactly as distinct.ts's clone guard
//   reads them (edgeGrid, then 1 - SSIM): 0 is the same page, 1 unrelated.
// - Tokens. A normalized distance over the pack's token vector, 0 for the
//   same tokens and 1 for every token at the far ends of its grammar.
//   Each token becomes one or more components, each scaled to 0..1 by its
//   grammar's range (language-grammar.ts for a design language): a length on
//   a log scale, log1p(px) / log1p(cap), with the grammar's cap (64px, or
//   999px for a radius), since a step from 0 to 4px reads as far more than
//   one from 500 to 504; a bounded number linearly over its bounds (an
//   opacity, a nudge's translate, scale, and rotate, an icon stroke); a
//   duration on a log scale up to the grammar's 2s; and a keyword (a line
//   style, a motion recipe, a focus style, a gradient's shape) as 0 when it
//   matches and 1 when it doesn't. A token's distance is the mean of its
//   components' differences, a group's the mean of its tokens', and the
//   pair's the mean of its groups', so a group of five radii counts as much
//   as the one material group, never five times as much.
//   For a design language, only the groups a static render shows score
//   (lead A's ruling, LANG-3b): corners, borders, depth, and density, and
//   the material only where the scored composition renders the Surface
//   primitive, which detectMaterial() reads from the page. Focus, motion,
//   state nudges, icons, and texture, which a still, unfocused,
//   reduced-motion first viewport never paints, and the material where no
//   Surface shows, are informational lines beside each pair. They never
//   enter the token score, so they can never buy a pass.
//
// - ΔE00, for a color scheme only (LANG-4, the lead's ruling), in the edges'
//   place: CIEDE2000 (ciede2000.ts) over the role pairs (SCHEME_DE_ROLES:
//   the canvas, the primary and secondary text, the accent, and the default,
//   subtle, and raised surfaces) in both base modes, combined as their mean
//   over 50 (DE00_SCALE), with each role under a ΔE00 of 2 flagged "near". Edges read
//   luminance structure, which a recolor barely moves, so a scheme's edges
//   are reported and never judged.
//
// judgePair() applies the fail rule (lead A's ruling, LANG-3b): a pair fails
// when its pixels say alike (under their "alike" threshold), whatever the
// tokens say, or when either score sits under its clone floor. The token
// score decides only while the pixels have no alike line, and never
// rescues alike pixels.
// calibrateAxis() sets those from the controls with distinct.ts's own
// calibrate() and noiseFloor(): the "alike" threshold halfway into the gap
// between the "same" and "different" controls, gating only with a gap of 0.1
// or more, and the clone floor twice the "same" controls' largest distance,
// never under CLONE_RESOLUTION.

import { PNG } from 'pngjs';
import { deltaE } from '../../packages/appearance/src/color';
import { MAX_LENGTH_PX, MAX_RADIUS_PX } from '../../packages/appearance/src/language-grammar';
import {
  COLOR_ROLES,
  LANGUAGE_KEYS,
  TYPOGRAPHY_FIELDS,
  TYPOGRAPHY_ROLES,
  type LanguageKey,
} from '../../packages/appearance/src/roles';
import {
  calibrate,
  noiseFloor,
  pairs,
  pixelDistance,
  VIEWPORT_IDS,
  type Calibration,
  type Grid,
  type NoiseFloor,
  type ViewportId,
} from './distinct';
import { decodePng } from '../quality/lib/pixels';
import { deltaE00, hexToLab } from './ciede2000';

// ---------------------------------------------------------------------------
// Components

/** One token's components: numbers already scaled to 0..1, and keywords. */
export interface Components {
  readonly values: readonly number[];
  readonly words: readonly string[];
}

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/** A length's px: px as is, rem at 16px, a bare 0 as 0, and the border keywords as browsers draw them. */
export function lengthPx(value: string): number {
  const text = value.trim().toLowerCase();
  if (text === 'thin') return 1;
  if (text === 'medium') return 3;
  if (text === 'thick') return 5;
  const number = Number.parseFloat(text);
  if (!Number.isFinite(number)) return 0;
  return text.endsWith('rem') ? number * 16 : number;
}

/** A non-negative length on its grammar's log scale: log1p(px) / log1p(cap), 0..1. */
export const logLength = (px: number, cap = MAX_LENGTH_PX) =>
  clamp01(Math.log1p(Math.min(Math.abs(px), cap)) / Math.log1p(cap));

/** A signed length on the same scale, -cap..cap mapped to 0..1, with 0 at 0.5. */
export const signedLogLength = (px: number, cap = MAX_LENGTH_PX) =>
  (1 + Math.sign(px) * logLength(px, cap)) / 2;

/** A number over its grammar's bounds, linearly, 0..1. */
export const linear = (value: number, low: number, high: number) =>
  clamp01((value - low) / (high - low));

/** The longest duration a language token may hold: 2s. */
export const MAX_DURATION_MS = 2000;

/** A duration on a log scale up to MAX_DURATION_MS, 0..1. */
export function durationScale(value: string): number {
  const text = value.trim().toLowerCase();
  const number = Number.parseFloat(text);
  if (!Number.isFinite(number)) return 0;
  const ms = text.endsWith('ms') ? number : number * 1000;
  return clamp01(Math.log1p(ms) / Math.log1p(MAX_DURATION_MS));
}

/** `value` split on its top-level commas, or spaces with `spaces`. */
export function splitTop(value: string, spaces = false): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of value) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (depth === 0 && (character === ',' || (spaces && /\s/.test(character)))) {
      if (current.trim() !== '') parts.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
}

/** A radius's four corners, as CSS's shorthand expands one to four lengths; the horizontal radii only. */
export function radiusComponents(value: string): Components {
  const horizontal = value.split('/')[0]!.trim();
  const lengths = splitTop(horizontal, true).map(lengthPx);
  const [a = 0, b = a, c = a, d = b] = lengths;
  return { values: [a, b, c, d].map((px) => logLength(px, MAX_RADIUS_PX)), words: [] };
}

const LINE_STYLES = new Set([
  'none',
  'solid',
  'dashed',
  'dotted',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset',
]);

/** A border: its width, its line style (none when it draws nothing), and the color role it names, if any. */
export function borderComponents(value: string): Components {
  const parts = splitTop(value.trim().toLowerCase(), true);
  let width = 3;
  let style = 'none';
  let color = 'inherit';
  for (const part of parts) {
    if (LINE_STYLES.has(part)) style = part;
    else if (part.startsWith('var(') || part.startsWith('color-mix(') || part === 'currentcolor')
      color = part.match(/--color-([a-z0-9-]+)/)?.[1] ?? part;
    else width = lengthPx(part);
  }
  if (style === 'none' || width === 0) return { values: [0], words: ['none', 'none'] };
  return { values: [logLength(width)], words: [style, color] };
}

/** The opacity a color names: color-mix()'s percentage, or 1 for a plain color. */
export function colorAlpha(value: string): number {
  const mix = value.match(/color-mix\([^,]+,\s*[^,]*?\)?\s*(\d+(?:\.\d+)?)%/);
  return mix ? clamp01(Number.parseFloat(mix[1]!) / 100) : 1;
}

/**
 * A shadow list: its first shadow's offsets, blur, spread, and opacity, and
 * how many it has, with whether it's inset and whether it draws at all.
 */
export function shadowComponents(value: string): Components {
  const text = value.trim().toLowerCase();
  if (text === 'none' || text === '') {
    return { values: [0.5, 0.5, 0, 0.5, 0, 0], words: ['none', 'outset'] };
  }
  const layers = splitTop(text);
  const first = layers[0]!;
  const inset = /(^|\s)inset(\s|$)/.test(first);
  const color = first.match(/(color-mix\(.*\)|var\([^)]*\)|transparent|currentcolor)/)?.[1] ?? '';
  const lengths = splitTop(first.replace(color, '').replace('inset', ''), true).map(lengthPx);
  const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
  return {
    values: [
      signedLogLength(x),
      signedLogLength(y),
      logLength(blur),
      signedLogLength(spread),
      color === 'transparent' ? 0 : colorAlpha(color),
      Math.min(layers.length, 4) / 4,
    ],
    words: ['drawn', inset ? 'inset' : 'outset'],
  };
}

/**
 * A state's nudge: translate x and y within the grammar's 8px, scale within
 * 0.9 to 1.1, and rotate within 10deg, each linearly; none is the middle.
 */
export function nudgeComponents(value: string): Components {
  let [x, y, scale, rotate] = [0, 0, 1, 0];
  for (const [, name, args] of value.toLowerCase().matchAll(/([a-z]+)\(([^()]*)\)/g)) {
    const list = args!.split(',').map((arg) => arg.trim());
    if (name === 'translate') [x, y] = [lengthPx(list[0]!), lengthPx(list[1] ?? '0')];
    else if (name === 'translatex') x = lengthPx(list[0]!);
    else if (name === 'translatey') y = lengthPx(list[0]!);
    else if (name!.startsWith('scale')) scale = Number.parseFloat(list[0]!);
    else if (name === 'rotate') rotate = Number.parseFloat(list[0]!);
  }
  return {
    values: [linear(x, -8, 8), linear(y, -8, 8), linear(scale, 0.9, 1.1), linear(rotate, -10, 10)],
    words: [],
  };
}

/** The timing functions CSS names, as their cubic-bezier() control points. */
const EASINGS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

/**
 * An easing: its cubic-bezier() control points, x over 0..1 and y over the
 * -1..2 a spring's overshoot stays in, and whether it's a curve or steps.
 * steps() and linear() with stops read as linear's points.
 */
export function easingComponents(value: string): Components {
  const text = value.trim().toLowerCase();
  const bezier = text.match(/^cubic-bezier\(([^)]*)\)$/);
  const points = bezier
    ? (bezier[1]!.split(',').map((arg) => Number.parseFloat(arg)) as [
        number,
        number,
        number,
        number,
      ])
    : (EASINGS[text] ?? EASINGS.linear!);
  const [x1, y1, x2, y2] = points;
  return {
    values: [linear(x1, 0, 1), linear(y1, -1, 2), linear(x2, 0, 1), linear(y2, -1, 2)],
    words: [text.startsWith('steps') || text.startsWith('step-') ? 'steps' : 'curve'],
  };
}

/**
 * Gradients: their shape (none, a solid fill drawn as one gradient of one
 * color, or the kinds of gradient they layer), how many layers, up to 4,
 * and the most transparent color-mix() in them.
 */
export function gradientComponents(value: string): Components {
  const text = value.trim().toLowerCase();
  if (text === 'none' || text === '') return { values: [0, 1], words: ['none'] };
  if (!text.includes('gradient(')) return { values: [0, colorAlpha(text)], words: ['color'] };
  const layers = splitTop(text);
  const kinds = layers.map((layer) => layer.slice(0, layer.indexOf('(')));
  const stops = (layer: string) => splitTop(layer.slice(layer.indexOf('(') + 1, -1));
  const solid =
    layers.length === 1 &&
    new Set(stops(layers[0]!).filter((stop) => !/^(\d|to |from )/.test(stop))).size === 1;
  const mixes = [...text.matchAll(/color-mix\([^)]*?\)\s*(\d+(?:\.\d+)?)%/g)].map((match) =>
    Number.parseFloat(match[1]!),
  );
  const alpha = mixes.length > 0 ? Math.min(...mixes) / 100 : 1;
  return {
    values: [Math.min(layers.length, 4) / 4, clamp01(alpha)],
    words: [solid ? 'solid' : [...new Set(kinds)].sort().join('+')],
  };
}

/** One word: 0 when it matches, 1 when it doesn't. */
export const wordComponents = (value: string): Components => ({
  values: [],
  words: [value.trim().toLowerCase()],
});

/** The mean difference of two tokens' components: |a - b| for each number, 0 or 1 for each word. */
export function componentDistance(a: Components, b: Components): number {
  if (a.values.length !== b.values.length || a.words.length !== b.words.length) return 1;
  const differences = [
    ...a.values.map((value, index) => Math.abs(value - b.values[index]!)),
    ...a.words.map((word, index) => (word === b.words[index] ? 0 : 1)),
  ];
  return differences.length === 0
    ? 0
    : differences.reduce((sum, value) => sum + value, 0) / differences.length;
}

// ---------------------------------------------------------------------------
// Token vectors

/**
 * A pack's token vector: each token's components, by token, the groups
 * that score, and the groups reported beside the score but never in it.
 */
export interface TokenVector {
  readonly tokens: Readonly<Record<string, Components>>;
  /** The groups the token score averages. */
  readonly groups: Readonly<Record<string, readonly string[]>>;
  /** Groups a static render can't show: each pair reports their distances, which never score. */
  readonly informational?: Readonly<Record<string, readonly string[]>>;
}

/**
 * A design language's tokens, in groups: LANG-2's six signature dimensions
 * (corners, depth, borders, density, focus, and motion), then the material,
 * the states (the hover and press nudges among them), the icons, and the
 * texture, a group of its own since no composition paints it yet
 * (review-lang2-sheets.md P1-4).
 */
export const LANGUAGE_TOKEN_GROUPS: Readonly<Record<string, readonly LanguageKey[]>> = {
  corners: ['radius-control', 'radius-card', 'radius-overlay', 'radius-media', 'radius-badge'],
  depth: ['shadow-card', 'shadow-overlay', 'shadow-raised', 'shadow-inset', 'emphasis-glow'],
  borders: ['border-control', 'border-card', 'border-divider'],
  density: [
    'control-height',
    'space-control-inline',
    'space-control-block',
    'space-surface-inline',
    'space-surface-block',
  ],
  surface: ['surface-material', 'surface-opacity', 'backdrop-blur', 'signature-fill'],
  focus: ['focus-width', 'focus-offset', 'focus-style'],
  motion: [
    'motion-fast',
    'motion-standard',
    'motion-slow',
    'motion-easing',
    'motion-enter',
    'motion-exit',
    'motion-emphasis',
  ],
  states: [
    'state-hover-transform',
    'state-active-transform',
    'state-selected-emphasis',
    'state-disabled-opacity',
    'state-loading-opacity',
    'state-validation-emphasis',
  ],
  icons: ['icon-stroke-width', 'icon-fill'],
  texture: ['texture'],
};

/**
 * The groups a static render shows, the only ones the verdict's token score
 * reads (lead A's ruling, LANG-3b): radius, border, shadow, and density,
 * and the material only when `scoreMaterial`, which detectMaterial() sets
 * from the scored composition's render.
 */
export const languageStaticGroups = (scoreMaterial = false): readonly string[] => [
  'corners',
  'borders',
  'depth',
  'density',
  ...(scoreMaterial ? ['surface'] : []),
];

/**
 * LANGUAGE_TOKEN_GROUPS split into the groups that score (the static ones)
 * and the informational rest, each of which a pair reports as a line of its
 * own and none of which scores.
 */
export function languageGroupSplit(scoreMaterial = false): {
  readonly groups: Readonly<Record<string, readonly LanguageKey[]>>;
  readonly informational: Readonly<Record<string, readonly LanguageKey[]>>;
} {
  const scored = new Set(languageStaticGroups(scoreMaterial));
  const entries = Object.entries(LANGUAGE_TOKEN_GROUPS);
  return {
    groups: Object.fromEntries(entries.filter(([group]) => scored.has(group))),
    informational: Object.fromEntries(entries.filter(([group]) => !scored.has(group))),
  };
}

/** A design language's scored groups while the material doesn't score: radius, border, shadow, and density. */
export const LANGUAGE_GROUPS = languageGroupSplit().groups;
/** Its informational groups then: the material, focus, motion, states, icons, and texture. */
export const LANGUAGE_INFORMATIONAL_GROUPS = languageGroupSplit().informational;

// ---------------------------------------------------------------------------
// The material: scored only where the composition renders the Surface primitive

/**
 * Where a design language's material paints: the Surface primitive
 * (packages/appearance/src/primitives/surface.tsx). surface-material,
 * surface-opacity, backdrop-blur, and signature-fill reach the page only
 * through it, and neither Spatial Bento nor Editorial Evidence renders it
 * yet (LANG-2's finding, 2026-10-28).
 */
export const SURFACE_SELECTOR = "[data-ui-slot='surface']";

/**
 * The share of the first viewport visible Surfaces must cover, at every
 * viewport, for the material to score: 0.02, 2%. That's one card's worth,
 * about 160px square at 1440x900 and 80px square at 390x844, so a page that
 * sets content on a Surface counts, and a stray badge or a sliver at the
 * fold doesn't.
 */
export const MIN_SURFACE_SHARE = 0.02;

/** What a page shows of its Surfaces: the viewport, and each Surface's box and whether it's visible. */
export interface SurfaceProbe {
  readonly width: number;
  readonly height: number;
  readonly elements: readonly {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly visible: boolean;
  }[];
}

/** The area of a union of rectangles, each [x0, y0, x1, y1], by coordinate compression. */
export function unionArea(rects: readonly (readonly [number, number, number, number])[]): number {
  const xs = [...new Set(rects.flatMap(([x0, , x1]) => [x0, x1]))].sort((p, q) => p - q);
  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const [left, right] = [xs[i]!, xs[i + 1]!];
    const spans = rects
      .filter(([x0, , x1]) => x0 <= left && x1 >= right)
      .map(([, y0, , y1]) => [y0, y1] as const)
      .sort((p, q) => p[0] - q[0]);
    let covered = 0;
    let run: [number, number] | null = null;
    for (const [y0, y1] of spans) {
      if (run === null || y0 > run[1]) {
        if (run !== null) covered += run[1] - run[0];
        run = [y0, y1];
      } else run[1] = Math.max(run[1], y1);
    }
    if (run !== null) covered += run[1] - run[0];
    area += covered * (right - left);
  }
  return area;
}

/** The share of the first viewport a probe's visible Surfaces cover, their union clipped to it, to 0.001. */
export function surfaceShare(probe: SurfaceProbe): number {
  if (probe.width <= 0 || probe.height <= 0) return 0;
  const rects = probe.elements
    .filter((element) => element.visible && element.width > 0 && element.height > 0)
    .map((element) => {
      const x0 = Math.max(0, element.x);
      const y0 = Math.max(0, element.y);
      const x1 = Math.min(probe.width, element.x + element.width);
      const y1 = Math.min(probe.height, element.y + element.height);
      return [x0, y0, x1, y1] as const;
    })
    .filter(([x0, y0, x1, y1]) => x1 > x0 && y1 > y0);
  return Math.round((unionArea(rects) / (probe.width * probe.height)) * 1000) / 1000;
}

/** How the guard decides whether the material scores: from the render, the default, or forced either way. */
export const MATERIAL_MODES = ['detected', 'on', 'off'] as const;
export type MaterialMode = (typeof MATERIAL_MODES)[number];

/** The mode PORTFOLIO_PACK_DISTINCT_MATERIAL names, `detected` when it names none. */
export function materialMode(name = process.env.PORTFOLIO_PACK_DISTINCT_MATERIAL): MaterialMode {
  const mode = (name ?? 'detected') as MaterialMode;
  if (!MATERIAL_MODES.includes(mode)) {
    throw new Error(
      `PORTFOLIO_PACK_DISTINCT_MATERIAL is ${name}; it must be one of ${MATERIAL_MODES}`,
    );
  }
  return mode;
}

/** Whether a composition's material scores, and why: the report records it. */
export interface MaterialDetection {
  readonly mode: MaterialMode;
  readonly scored: boolean;
  /** Each probed viewport's visible Surface share. */
  readonly shares: Readonly<Partial<Record<ViewportId, number>>>;
  readonly reason: string;
}

/**
 * Whether the material scores on a composition, from its probes at each
 * viewport: in `detected` mode, when visible Surfaces cover at least
 * MIN_SURFACE_SHARE of the first viewport at every viewport, and at least
 * one was probed. `on` and `off` override it, and still record the shares.
 */
export function detectMaterial(
  probes: Readonly<Partial<Record<ViewportId, SurfaceProbe>>>,
  mode: MaterialMode = 'detected',
): MaterialDetection {
  const shares: Partial<Record<ViewportId, number>> = {};
  for (const viewport of VIEWPORT_IDS) {
    const probe = probes[viewport];
    if (probe) shares[viewport] = surfaceShare(probe);
  }
  const measured = Object.entries(shares)
    .map(([viewport, share]) => `${share} at ${viewport}`)
    .join(' and ');
  const seen = measured === '' ? 'no viewport was probed' : `visible Surfaces cover ${measured}`;
  if (mode !== 'detected') {
    return {
      mode,
      scored: mode === 'on',
      shares,
      reason: `PORTFOLIO_PACK_DISTINCT_MATERIAL=${mode} forces the material ${mode === 'on' ? 'to score' : 'out of the score'} (${seen})`,
    };
  }
  const values = Object.values(shares);
  const scored = values.length > 0 && values.every((share) => share >= MIN_SURFACE_SHARE);
  return {
    mode,
    scored,
    shares,
    reason: scored
      ? `${seen}, at least ${MIN_SURFACE_SHARE} of the first viewport at every viewport: the material scores`
      : `${seen}, under ${MIN_SURFACE_SHARE} of the first viewport at ${values.length === 0 ? 'every' : 'one or more'} viewport: the material is informational`,
  };
}

/** Each design-language token's components, by its grammar (language-grammar.ts). */
export function languageComponents(key: LanguageKey, value: string): Components {
  if (key.startsWith('radius-')) return radiusComponents(value);
  if (key.startsWith('border-')) return borderComponents(value);
  if (key.startsWith('shadow-') || key === 'emphasis-glow') return shadowComponents(value);
  if (key === 'state-hover-transform' || key === 'state-active-transform')
    return nudgeComponents(value);
  if (key === 'surface-opacity')
    return { values: [linear(Number.parseFloat(value) / 100, 0.5, 1)], words: [] };
  if (key === 'state-disabled-opacity' || key === 'state-loading-opacity') {
    const number = Number.parseFloat(value);
    return { values: [linear(value.endsWith('%') ? number / 100 : number, 0.3, 1)], words: [] };
  }
  if (key === 'focus-offset') return { values: [signedLogLength(lengthPx(value))], words: [] };
  if (key === 'icon-stroke-width')
    return { values: [linear(Number.parseFloat(value), 0.5, 4)], words: [] };
  if (key === 'motion-fast' || key === 'motion-standard' || key === 'motion-slow')
    return { values: [durationScale(value)], words: [] };
  if (key === 'motion-easing') return easingComponents(value);
  if (key === 'surface-material' || key === 'texture' || key === 'signature-fill')
    return gradientComponents(value);
  if (
    key === 'focus-style' ||
    key === 'icon-fill' ||
    key === 'motion-enter' ||
    key === 'motion-exit' ||
    key === 'motion-emphasis'
  )
    return wordComponents(value);
  // backdrop-blur, control-height, the spaces, focus-width, and the state emphases: lengths.
  return { values: [logLength(lengthPx(value))], words: [] };
}

/**
 * A design language's token vector: the static groups score, the rest are
 * informational (languageGroupSplit()).
 */
export function languageVector(
  tokens: Readonly<Record<string, string>>,
  scoreMaterial = false,
): TokenVector {
  const { groups, informational } = languageGroupSplit(scoreMaterial);
  return {
    tokens: Object.fromEntries(
      LANGUAGE_KEYS.map((key) => [key, languageComponents(key, tokens[key] ?? '')]),
    ),
    groups,
    informational,
  };
}

/** The largest OKLab distance two sRGB colors can have, black to white, which a role's distance is scaled by. */
export const MAX_DELTA_E = 1;

/**
 * A color scheme's token vector: each role in each base mode as its OKLab
 * coordinates, so a role's distance is its colors' deltaE over MAX_DELTA_E.
 * Its groups are the roles' families (canvas and surfaces, text, accents,
 * borders, status, and the rest), in each mode.
 */
export function schemeVector(sets: SchemeSets): TokenVector {
  const tokens: Record<string, Components> = {};
  const groups: Record<string, string[]> = {};
  for (const mode of ['light', 'dark'] as const) {
    const set = sets[mode];
    if (!set) continue;
    for (const role of COLOR_ROLES) {
      const color = set[role];
      if (!color) continue;
      const key = `${mode}:${role}`;
      tokens[key] = { values: [], words: [color] };
      const family = role.split('-')[0]!;
      (groups[`${mode}:${family}`] ??= []).push(key);
    }
  }
  return { tokens, groups };
}

/** A scheme's two base sets, by mode, each role a six-digit hex. */
export interface SchemeSets {
  readonly light?: Readonly<Record<string, string>>;
  readonly dark?: Readonly<Record<string, string>>;
}

/**
 * The roles the color scheme guard's perceptual score compares (LANG-4, the
 * lead's ruling): the canvas, the primary and secondary text, the accent,
 * and the default, subtle, and raised surfaces. The raised surface is
 * surface-prominent, the highest of the solid surfaces (surface-overlay is
 * an overlay's, and surface-lit a derived highlight).
 */
export const SCHEME_DE_ROLES = [
  'canvas',
  'text-primary',
  'text-secondary',
  'accent',
  'surface-default',
  'surface-subtle',
  'surface-prominent',
] as const;

/** The base modes the scheme score reads, both of them. */
export const SCHEME_MODES = ['light', 'dark'] as const;
export type SchemeMode = (typeof SCHEME_MODES)[number];

/**
 * What one unit of the scheme score is in ΔE00: 50, so the score sits in
 * 0..1 as every other score does and calibrate()'s gap of 0.1 is a ΔE00 of
 * 5, a difference anyone sees at a glance. Not 100, black to white: no two
 * schemes' same role sits that far apart in practice (each canvas is light
 * in light mode and dark in dark), and over 100 the 0.1 gap would ask a
 * ΔE00 of 10 of the nearest family pair, five times what most viewers see
 * side by side. On 2026-10-29's catalog the nearest family pair (accessible
 * against neutral) sat at a mean ΔE00 of 7.5, so over 100 ΔE00 would never
 * have voted. A mean over 50 counts as 1.
 */
export const DE00_SCALE = 50;

/** A role only one side has: as far apart as CIEDE2000 puts black and white. */
export const MISSING_DE00 = 100;

/**
 * Under this ΔE00 a role is "near": about the least difference most viewers
 * see side by side. A near role is flagged in the report; it never votes.
 */
export const NEAR_DE00 = 2;

/** One pair of schemes' perceptual distance: each role's ΔE00, in each mode, and how they combine. */
export interface SchemeDelta {
  /** Each `mode:role`'s ΔE00, to 0.01. A role only one side has is MISSING_DE00 apart. */
  readonly roles: Readonly<Record<string, number>>;
  /** Each shared mode's mean ΔE00 over SCHEME_DE_ROLES, to 0.01. */
  readonly modes: Readonly<Partial<Record<(typeof SCHEME_MODES)[number], number>>>;
  /** The mode whose mean is the least, the one that decides (light on a tie); null with no shared mode. */
  readonly worst: (typeof SCHEME_MODES)[number] | null;
  /** The deciding mean ΔE00: the worst mode's, to 0.01. */
  readonly mean: number;
  /** The score: the worst mode's mean over DE00_SCALE, to 0.001, at most 1. */
  readonly score: number;
  /** The `mode:role`s under NEAR_DE00, in SCHEME_MODES then SCHEME_DE_ROLES order. */
  readonly near: readonly string[];
}

/**
 * Two schemes' perceptual distance (LANG-4): ΔE00 for each of
 * SCHEME_DE_ROLES in each base mode both carry (the guard renders both for
 * every scheme; a "same" control compares the light one alone), each mode
 * combined as the mean of its roles, every role weighted alike, with the
 * roles under NEAR_DE00 flagged. The modes are scored apart, and the worse
 * mode's mean decides (lead A's ruling, the LANG-5b fix round): a visitor
 * sees one mode at a time, so a pair that's a twin in dark is a twin
 * whatever its light mode does, and averaging the two let it pass. With no
 * mode in common they're as far apart as can be. Within a mode the mean is
 * what decides, so one far role can't hide behind six near ones, and one
 * near role can't sink a pair the rest set apart.
 */
export function schemeDelta(a: SchemeSets, b: SchemeSets): SchemeDelta {
  const roles: Record<string, number> = {};
  const modes: Partial<Record<(typeof SCHEME_MODES)[number], number>> = {};
  const shared = SCHEME_MODES.filter((mode) => a[mode] && b[mode]);
  if (shared.length === 0) {
    return { roles, modes, worst: null, mean: MISSING_DE00, score: 1, near: [] };
  }
  let worst: (typeof SCHEME_MODES)[number] = shared[0]!;
  let least = Infinity;
  for (const mode of shared) {
    let sum = 0;
    for (const role of SCHEME_DE_ROLES) {
      const first = a[mode]?.[role];
      const second = b[mode]?.[role];
      const value =
        first !== undefined && second !== undefined ? deltaE00(first, second) : MISSING_DE00;
      roles[`${mode}:${role}`] = Math.round(value * 100) / 100;
      sum += roles[`${mode}:${role}`]!;
    }
    const mean = sum / SCHEME_DE_ROLES.length;
    modes[mode] = Math.round(mean * 100) / 100;
    if (mean < least) {
      least = mean;
      worst = mode;
    }
  }
  return {
    roles,
    modes,
    worst,
    mean: Math.round(least * 100) / 100,
    score: Math.round(Math.min(1, least / DE00_SCALE) * 1000) / 1000,
    near: Object.entries(roles)
      .filter(([, value]) => value < NEAR_DE00)
      .map(([key]) => key),
  };
}

/**
 * The painted-area weights of the roles each owner-strip composition paints
 * at 1440 in its sampled regions (LANG-5b's fix round), measured as the
 * share of the first viewport each role's color covers, the ink counting
 * its anti-aliased text, averaged over every anchor scheme in both modes on
 * the captures of 413e064a3 (53 frames each). Spatial Bento paints its page
 * (surface-prominent), its hero and tiles (surface-default), the Now and
 * Stats tiles (canvas), its inverse tile and heading (text-primary), and its
 * accent tile; Editorial Evidence is almost all page, with its card
 * (surface-subtle), its text and its links (accent-text).
 */
export const PAINTED_WEIGHTS = {
  'spatial-bento': {
    'surface-prominent': 0.21,
    'surface-default': 0.26,
    canvas: 0.31,
    'text-primary': 0.14,
    accent: 0.08,
  },
  'editorial-evidence': {
    canvas: 0.925,
    'surface-subtle': 0.062,
    'text-primary': 0.012,
    'accent-text': 0.001,
  },
} as const satisfies Record<string, Readonly<Record<string, number>>>;

/** Under this painted ΔE00 a pair's painted score is printed beside its token score. */
export const PAINTED_REPORT_UNDER = 5;

/** One pair's painted score: each mode's area-weighted ΔE00 on each composition, and the least. */
export interface PaintedDelta {
  readonly modes: Readonly<
    Partial<
      Record<(typeof SCHEME_MODES)[number], Readonly<Record<keyof typeof PAINTED_WEIGHTS, number>>>
    >
  >;
  /** The least of them, to 0.01; MISSING_DE00 with no mode in common. */
  readonly least: number;
}

/**
 * Two schemes' painted score (lead A, the LANG-5 enforcement commit): in
 * each shared mode, on each composition, the ΔE00 of each role it paints,
 * weighted by the area it paints (PAINTED_WEIGHTS), so the page and the
 * large surfaces count most. It's report only: judgePair() never reads it,
 * and the report prints it for a pair under PAINTED_REPORT_UNDER.
 */
export function paintedDelta(a: SchemeSets, b: SchemeSets): PaintedDelta {
  const modes: Partial<
    Record<(typeof SCHEME_MODES)[number], Record<keyof typeof PAINTED_WEIGHTS, number>>
  > = {};
  let least = MISSING_DE00;
  for (const mode of SCHEME_MODES.filter((each) => a[each] && b[each])) {
    const per = {} as Record<keyof typeof PAINTED_WEIGHTS, number>;
    for (const [composition, weights] of Object.entries(PAINTED_WEIGHTS) as [
      keyof typeof PAINTED_WEIGHTS,
      Readonly<Record<string, number>>,
    ][]) {
      let sum = 0;
      for (const [role, weight] of Object.entries(weights)) {
        const first = a[mode]?.[role];
        const second = b[mode]?.[role];
        sum += weight * (first && second ? deltaE00(first, second) : MISSING_DE00);
      }
      per[composition] = Math.round(sum * 100) / 100;
      least = Math.min(least, per[composition]);
    }
    modes[mode] = per;
  }
  return { modes, least };
}

/** One line for a painted score: `painted light SB 5.95, EE 6.66; dark SB 5.55, EE 7.74`. */
export function describePainted(painted: PaintedDelta): string {
  return `painted ${SCHEME_MODES.filter((mode) => painted.modes[mode])
    .map(
      (mode) =>
        `${mode} SB ${painted.modes[mode]!['spatial-bento'].toFixed(2)}, EE ${painted.modes[mode]!['editorial-evidence'].toFixed(2)}`,
    )
    .join('; ')} (report only)`;
}

/**
 * A rendered color as six-digit lowercase hex: a hex as is (three digits
 * expanded), or rgb()/rgba() with its alpha dropped; null for anything else.
 */
export function hexOf(value: string): string | null {
  const text = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  const short = text.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (short) return `#${short[1]!.repeat(2)}${short[2]!.repeat(2)}${short[3]!.repeat(2)}`;
  const rgb = text.match(/^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/);
  if (!rgb) return null;
  return `#${rgb
    .slice(1, 4)
    .map((channel) =>
      Math.min(255, Math.max(0, Math.round(Number(channel))))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/**
 * The alpha a rendered color names, 0..1: an rgba() or `rgb(r g b / a)`
 * alpha (a number or a percentage), an eight- or four-digit hex's last
 * channel, 0 for `transparent`, and 1 for anything else.
 */
export function alphaOf(value: string): number {
  const text = value.trim().toLowerCase();
  if (text === 'transparent') return 0;
  const long = text.match(/^#[0-9a-f]{6}([0-9a-f]{2})$/);
  if (long) return Number.parseInt(long[1]!, 16) / 255;
  const short = text.match(/^#[0-9a-f]{3}([0-9a-f])$/);
  if (short) return Number.parseInt(short[1]!.repeat(2), 16) / 255;
  const fn = text.match(/^rgba?\((.*)\)$/);
  if (!fn) return 1;
  const parts = fn[1]!.includes('/')
    ? [fn[1]!.split('/')[1]!.trim()]
    : fn[1]!
        .split(',')
        .map((part) => part.trim())
        .slice(3);
  const alpha = parts[0];
  if (alpha === undefined || alpha === '') return 1;
  const number = alpha.endsWith('%') ? Number.parseFloat(alpha) / 100 : Number.parseFloat(alpha);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 1;
}

/**
 * The roles a color scheme's scores read: the ΔE00 score's seven, and the
 * accent text the painted score samples on Editorial Evidence. A translucent
 * one would score as the opaque color hexOf() keeps, so it's a capture
 * problem rather than a score (the LANG-5 enforcement commit).
 */
export const SCORED_COLOR_ROLES: readonly string[] = [...SCHEME_DE_ROLES, 'accent-text'];

/**
 * A page's rendered role colors (each role's computed `--color-*` value) as
 * the scores read them: each a six-digit hex, a value hexOf() can't read
 * left out, as before. A scored role computed with an alpha under 1 is a
 * problem, never scored: hexOf() would drop the alpha and score it opaque.
 */
export function renderedRoleColors(raw: Readonly<Record<string, string>>): {
  readonly colors: Record<string, string>;
  readonly problems: string[];
} {
  const colors: Record<string, string> = {};
  const problems: string[] = [];
  for (const [role, value] of Object.entries(raw)) {
    const alpha = alphaOf(value);
    if (alpha < 1 && SCORED_COLOR_ROLES.includes(role)) {
      problems.push(
        `--color-${role} computes ${value.trim()}, alpha ${Math.round(alpha * 1000) / 1000}: a translucent scored role would score as opaque, so it's a capture problem`,
      );
      continue;
    }
    const hex = hexOf(value);
    if (hex !== null) colors[role] = hex;
  }
  return { colors, problems };
}

/**
 * What a scheme renders, in each base mode: the role colors the page's
 * boundary computes (its `--color-*` properties) under a light preference
 * and in the dark display mode. Read from the render rather than the
 * registry, since a generator scheme (brand-seed, hct-tonal,
 * portfolio-artwork, profile-image) registers no sets and solves its
 * colors from the site's seed, and a scheme with one base mode renders it
 * under either preference.
 */
export type RenderedColors = Readonly<Record<string, SchemeSets>>;

/**
 * `packs` with each scheme's colors and token vector taken from what it
 * rendered (`rendered`, by id), and the problems: a pack that rendered no
 * colors, or a role either mode didn't compute as a color.
 */
export function withRenderedColors(
  packs: readonly AxisPack[],
  rendered: RenderedColors,
): { readonly packs: AxisPack[]; readonly problems: string[] } {
  const problems: string[] = [];
  const out = packs.map((pack) => {
    const sets = rendered[pack.id];
    if (!sets || (!sets.light && !sets.dark)) {
      problems.push(`${pack.id} rendered no colors`);
      return pack;
    }
    for (const mode of SCHEME_MODES) {
      const set = sets[mode];
      if (!set) {
        problems.push(`${pack.id} rendered no ${mode} colors`);
        continue;
      }
      const missing = SCHEME_DE_ROLES.filter((role) => !set[role]);
      if (missing.length > 0) problems.push(`${pack.id} ${mode} computed no ${missing.join(', ')}`);
    }
    return { ...pack, colors: sets, vector: schemeVector(sets) };
  });
  return { packs: out, problems };
}

/**
 * The roles where a scheme's rendered colors differ from its registered
 * sets, by `mode:role`, each as [registered, rendered]: a check that the
 * render paints the pack's own colors. A generator scheme registers none,
 * so it has nothing to differ from.
 */
export function colorDrift(
  registered: SchemeSets,
  rendered: SchemeSets,
): Record<string, readonly [string, string]> {
  const out: Record<string, readonly [string, string]> = {};
  for (const mode of SCHEME_MODES) {
    for (const [role, color] of Object.entries(registered[mode] ?? {})) {
      const seen = rendered[mode]?.[role];
      if (seen !== undefined && seen !== color) out[`${mode}:${role}`] = [color, seen];
    }
  }
  return out;
}

/**
 * The distance of one token: componentDistance(), except for a scheme's
 * colors, which carry their hex as their one word and compare by deltaE.
 */
export function tokenDistance(a: Components, b: Components): number {
  const colorA = a.words[0];
  const colorB = b.words[0];
  if (
    a.values.length === 0 &&
    b.values.length === 0 &&
    a.words.length === 1 &&
    b.words.length === 1 &&
    /^#[0-9a-f]{6}$/i.test(colorA!) &&
    /^#[0-9a-f]{6}$/i.test(colorB!)
  ) {
    return clamp01(deltaE(colorA!, colorB!) / MAX_DELTA_E);
  }
  return componentDistance(a, b);
}

/** A typography role's numbers, over the bounds the typography profiles keep to. */
export const TYPE_BOUNDS = {
  'font-size': [0.5, 6],
  'font-weight': [100, 900],
  'line-height': [0.8, 2.2],
  'letter-spacing': [-0.1, 0.2],
} as const;

/** The generic family a font stack ends on: serif, sans-serif, monospace, or another. */
export function genericFamily(stack: string): string {
  const last = splitTop(stack.toLowerCase()).at(-1)?.replace(/["']/g, '').trim() ?? '';
  return ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'].includes(last)
    ? last
    : 'other';
}

/**
 * A typography profile's token vector: each role's face (its first family
 * and the generic one it falls back to, as words) and its size, weight,
 * line height, and tracking, over TYPE_BOUNDS. Its groups are the roles.
 */
export function typographyVector(
  roles: Readonly<Record<string, Readonly<Record<string, string | number>>>>,
): TokenVector {
  const tokens: Record<string, Components> = {};
  const groups: Record<string, string[]> = {};
  for (const role of TYPOGRAPHY_ROLES) {
    const fields = roles[role];
    if (!fields) continue;
    for (const field of TYPOGRAPHY_FIELDS) {
      const raw = fields[field];
      if (raw === undefined) continue;
      const key = `${role}:${field}`;
      const value = String(raw);
      if (field === 'font-family') {
        const first = splitTop(value.toLowerCase())[0]?.replace(/["']/g, '') ?? '';
        tokens[key] = { values: [], words: [first, genericFamily(value)] };
      } else if (field === 'font-variation-settings') {
        tokens[key] = wordComponents(value);
      } else {
        const [low, high] = TYPE_BOUNDS[field];
        tokens[key] = { values: [linear(Number.parseFloat(value), low, high)], words: [] };
      }
      (groups[role] ??= []).push(key);
    }
  }
  return { tokens, groups };
}

/**
 * Each group's distance, the mean of its tokens' distances: the scored
 * groups, or with `which` 'informational', the groups reported beside them.
 */
export function groupDistances(
  a: TokenVector,
  b: TokenVector,
  which: 'groups' | 'informational' = 'groups',
): Record<string, number> {
  const out: Record<string, number> = {};
  const aGroups = a[which] ?? {};
  const bGroups = b[which] ?? {};
  for (const group of [...new Set([...Object.keys(aGroups), ...Object.keys(bGroups)])]) {
    const keys = [...new Set([...(aGroups[group] ?? []), ...(bGroups[group] ?? [])])];
    // A token only one side has is as far apart as a token can be.
    out[group] =
      keys.length === 0
        ? 0
        : keys.reduce(
            (sum, key) =>
              sum +
              (a.tokens[key] && b.tokens[key] ? tokenDistance(a.tokens[key], b.tokens[key]) : 1),
            0,
          ) / keys.length;
  }
  return out;
}

/**
 * The token score: the mean of the scored groups' distances, 0 the same
 * tokens, 1 every one at its grammar's far end. A vector's informational
 * groups never enter it.
 */
export function vectorDistance(a: TokenVector, b: TokenVector): number {
  const groups = Object.values(groupDistances(a, b));
  return groups.length === 0 ? 0 : groups.reduce((sum, value) => sum + value, 0) / groups.length;
}

const thousandths = (value: number) => Math.round(value * 1000) / 1000;

/**
 * A pair's tokens as the guard scores and reports them: the token score
 * (vectorDistance()) and each informational group's distance, rounded to
 * 0.001, the lines the report prints beside the verdict.
 */
export function pairTokens(
  a: TokenVector,
  b: TokenVector,
): { readonly token: number; readonly info: Readonly<Record<string, number>> } {
  const info = groupDistances(a, b, 'informational');
  return {
    token: thousandths(vectorDistance(a, b)),
    info: Object.fromEntries(
      Object.entries(info).map(([group, value]) => [group, thousandths(value)]),
    ),
  };
}

// ---------------------------------------------------------------------------
// Axes

/** The perceptual scores: the first viewport's edges, or a scheme's ΔE00 over its roles. */
export type PerceptualScore = 'px' | 'de';
/** Every score a pair can carry. */
export type ScoreKey = PerceptualScore | 'token';

/** The pack axes the guard can point at. */
export const GUARD_AXES = ['designLanguage', 'colorScheme', 'typography'] as const;
export type GuardAxis = (typeof GUARD_AXES)[number];

/** A registered pack as the guard needs it: its id, its family, and its token vector. */
export interface AxisPack {
  readonly id: string;
  readonly family: string;
  readonly vector: TokenVector;
  /** A color scheme's base sets, which its perceptual score (schemeDelta()) reads. */
  readonly colors?: SchemeSets;
}

/**
 * What the guard needs to know about an axis: where its thresholds live,
 * and its "same" controls, each of its packs rendered with one other axis
 * changed. An axis's "different" controls are always its family pairs'
 * median cross pairs (familyPairControls()).
 */
export interface AxisSpec {
  readonly axis: GuardAxis;
  /** The JSON beside this file that holds the axis's thresholds. */
  readonly file: string;
  /**
   * The perceptual score beside the token score: the first viewport's edges
   * (`px`), or for a color scheme ΔE00 over its roles (`de`, schemeDelta()),
   * which takes the edges' place (LANG-4, the lead's ruling: edges are
   * luminance structure, and a recolor barely moves them).
   */
  readonly perceptual: PerceptualScore;
  /**
   * The "same" controls: another value on another axis, which must not read
   * as another pack. `px` is the control's role for the pixel score, `same`
   * unless it says otherwise; for the token score it's always `same`.
   */
  readonly same: readonly {
    readonly name: string;
    readonly axis: 'designLanguage' | 'colorScheme' | 'typography';
    readonly value: string;
    readonly px?: ControlRole;
  }[];
}

/**
 * Each axis's spec. A language's "same" controls are the language under
 * another scheme (graphite, of another family than warm-parchment) and
 * another typography (editorial-serif, distinct's own typography control).
 * A scheme's are the scheme under another language and another typography,
 * and a typography's under another language and another scheme (LANG-4).
 *
 * A control that changes geometry is informational for the pixel score.
 * Another typography reflows the text, and another language moves every
 * border and padding, so the edges shift everywhere and 1 - SSIM reads a
 * different page: on Spatial Bento at 390, editorial-serif moved every
 * language's pixel score against itself by 0.77 (the median), more than
 * any family pair's median (0.54 to 0.68). Its token score stays a "same"
 * control. A re-render (always) and another scheme draw the same edges, so
 * they set the pixel score's floor.
 */
export const AXES: Readonly<Record<GuardAxis, AxisSpec>> = {
  designLanguage: {
    axis: 'designLanguage',
    file: 'languages-distinct.json',
    perceptual: 'px',
    same: [
      { name: 'scheme', axis: 'colorScheme', value: 'graphite' },
      { name: 'typography', axis: 'typography', value: 'editorial-serif', px: 'informational' },
    ],
  },
  colorScheme: {
    axis: 'colorScheme',
    file: 'schemes-distinct.json',
    perceptual: 'de',
    same: [
      { name: 'language', axis: 'designLanguage', value: 'neobrutalist', px: 'informational' },
      { name: 'typography', axis: 'typography', value: 'editorial-serif', px: 'informational' },
    ],
  },
  typography: {
    axis: 'typography',
    file: 'typography-distinct.json',
    perceptual: 'px',
    same: [
      { name: 'language', axis: 'designLanguage', value: 'neobrutalist', px: 'informational' },
      { name: 'scheme', axis: 'colorScheme', value: 'graphite' },
    ],
  },
};

/** The axis PORTFOLIO_PACK_DISTINCT_AXIS names, the design language when it names none. */
export function guardAxis(name = process.env.PORTFOLIO_PACK_DISTINCT_AXIS): GuardAxis {
  const axis = (name ?? 'designLanguage') as GuardAxis;
  if (!GUARD_AXES.includes(axis)) {
    throw new Error(`PORTFOLIO_PACK_DISTINCT_AXIS is ${name}; it must be one of ${GUARD_AXES}`);
  }
  return axis;
}

/** One "different" control: a pair of families, and the pair of packs across them at the median of one score. */
export interface FamilyPairControl {
  readonly families: readonly [string, string];
  /** The pair at the (lower) median, which the control reports. */
  readonly a: string;
  readonly b: string;
  /** Its score. */
  readonly value: number;
  /** How many cross pairs the two families have. */
  readonly pairs: number;
}

/**
 * The "different" controls, for one score: for each pair of families, the
 * cross pair (one pack from each) at the lower median of that score.
 *
 * Not the nearest cross pair: two packs from different families can be the
 * same pack (atlassian-inspired and utility-dense share all 41 tokens), and
 * those are what the guard is for, so a control can't assume them apart.
 * Not a family's medoid either: in a family as mixed as expressive, the pack
 * nearest the rest is its blandest, so medoid pairs measure how alike the
 * blandest members are. The median cross pair is what two languages from
 * those families typically are, and the nearest family pair's median sets
 * the gap, as calibrate() reads it.
 */
export function familyPairControls(
  packs: readonly Pick<AxisPack, 'id' | 'family'>[],
  score: (a: string, b: string) => number | undefined,
): FamilyPairControl[] {
  const families = [...new Set(packs.map(({ family }) => family))].sort();
  const out: FamilyPairControl[] = [];
  for (const [f, g] of pairs(families)) {
    const cross: { a: string; b: string; value: number }[] = [];
    for (const [x, y] of pairs([...packs].sort((p, q) => (p.id < q.id ? -1 : 1)))) {
      const across = (x.family === f && y.family === g) || (x.family === g && y.family === f);
      const value = across ? score(x.id, y.id) : undefined;
      if (value !== undefined) cross.push({ a: x.id, b: y.id, value });
    }
    if (cross.length === 0) continue;
    cross.sort((p, q) => p.value - q.value || (p.a + p.b < q.a + q.b ? -1 : 1));
    const median = cross[Math.floor((cross.length - 1) / 2)]!;
    out.push({ families: [f, g], ...median, pairs: cross.length });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The rule

/** The smallest clone floor a score has: its rounding, so two identical vectors at 0 are always clones. */
export const CLONE_RESOLUTION = 0.001;

type PerViewport = Readonly<Record<ViewportId, number>>;

/** One score's two lines at each viewport. */
export interface ScoreThresholds {
  /** Under it, the score says alike; null while its calibration found no gap of MIN_GAP, so it doesn't vote. */
  readonly alike: PerViewport | null;
  /** Under it, the pair is a clone on this score alone. */
  readonly clone: PerViewport;
}

/**
 * An axis's lines: its perceptual score's (the edges', `px`, or a scheme's
 * ΔE00, `de`) and the token score's. An axis carries one perceptual score;
 * one with `de` judges no edges at all.
 */
export type PackThresholds = EdgeThresholds | SchemeThresholds;

/** The lines of an axis judged on its edges: the design languages and the typographies. */
export interface EdgeThresholds {
  readonly px: ScoreThresholds;
  readonly token: ScoreThresholds;
}

/** The lines of an axis judged on ΔE00, edges dropped: the color schemes (LANG-4). */
export interface SchemeThresholds {
  readonly de: ScoreThresholds;
  readonly token: ScoreThresholds;
}

/** The perceptual score an axis's lines judge: ΔE00 when they carry its lines, else the edges. */
export function perceptualOf(thresholds: PackThresholds): PerceptualScore {
  if ('de' in thresholds && thresholds.de) return 'de';
  if ('px' in thresholds && thresholds.px) return 'px';
  throw new Error('The thresholds carry no perceptual score: neither px nor de');
}

/** One score's lines, when the thresholds carry them. */
export const linesOf = (thresholds: PackThresholds, key: ScoreKey): ScoreThresholds | undefined =>
  (thresholds as Partial<Record<ScoreKey, ScoreThresholds>>)[key];

/** One pair's scores at one viewport. The token score is the same at both. */
export interface PackPairScore {
  readonly a: string;
  readonly b: string;
  readonly viewport: ViewportId;
  readonly px: number;
  readonly token: number;
  /** A color scheme pair's ΔE00 score, schemeDelta()'s, 0..1; absent on other axes. */
  readonly de?: number;
  /** Its per-role ΔE00, by `mode:role`, which the report prints. */
  readonly deRoles?: Readonly<Record<string, number>>;
  /** Its deciding mean ΔE00, the worse mode's, unscaled. */
  readonly deMean?: number;
  /** Each shared mode's mean ΔE00, which the report prints beside the deciding one. */
  readonly deModes?: SchemeDelta['modes'];
  /** The mode whose mean decides. */
  readonly deWorst?: SchemeDelta['worst'];
  /** Its painted score (paintedDelta()), report only: never read by judgePair(). */
  readonly painted?: PaintedDelta;
  /** The `mode:role`s under NEAR_DE00: flagged, never voting. */
  readonly near?: readonly string[];
  /**
   * The informational lines (pairTokens()): each informational group's
   * distance, which the report prints and the verdict never reads.
   */
  readonly info?: Readonly<Record<string, number>>;
}

/**
 * The compositions the guard also renders on each axis for its report only
 * (LANG-2): Editorial Evidence beside the scored composition, so the owner
 * sees each language's spread on his own composition. Their scores are
 * informational: they never vote and never gate, since the verdict reads
 * only the scored composition's shots (scoreShots()).
 */
export const REPORT_ONLY: Readonly<Record<GuardAxis, readonly string[]>> = {
  designLanguage: ['editorial-evidence'],
  colorScheme: [],
  typography: [],
};

/** The report-only compositions for `axis`, never the one the axis scores. */
export const reportOnlyCompositions = (axis: GuardAxis, scored: string): readonly string[] =>
  REPORT_ONLY[axis].filter((variant) => variant !== scored);

/** One capture as the scores read it: its composition, its look, its viewport, and its edges. */
export interface ScoredShot {
  readonly variant: string;
  readonly look: string;
  readonly viewport: ViewportId;
  readonly grid: Grid;
}

/** A scheme pair's ΔE00 fields for its score, when both packs carry their colors; none otherwise. */
export function schemeScore(
  a: Pick<AxisPack, 'colors'>,
  b: Pick<AxisPack, 'colors'>,
): Pick<PackPairScore, 'de' | 'deRoles' | 'deMean' | 'deModes' | 'deWorst' | 'near' | 'painted'> {
  if (!a.colors || !b.colors) return {};
  const delta = schemeDelta(a.colors, b.colors);
  return {
    de: delta.score,
    deRoles: delta.roles,
    deMean: delta.mean,
    deModes: delta.modes,
    deWorst: delta.worst,
    near: delta.near,
    painted: paintedDelta(a.colors, b.colors),
  };
}

/** A scheme pair's per-mode means as the report prints them: `light 6.93, dark 4.08`. */
export function describeModes(modes: SchemeDelta['modes'] | undefined): string {
  return SCHEME_MODES.filter((mode) => modes?.[mode] !== undefined)
    .map((mode) => `${mode} ${modes![mode]!.toFixed(2)}`)
    .join(', ');
}

/**
 * Every pair of `packs`' scores at each viewport on `composition`'s shots
 * alone, each pack's shot named by `lookOf`, with the pair's informational
 * lines (pairTokens()). A shot of any other composition, such as a
 * report-only one, never enters a score, so it can't move a verdict.
 */
export function scoreShots(
  packs: readonly AxisPack[],
  shots: readonly ScoredShot[],
  lookOf: (id: string) => string,
  composition: string,
): PackPairScore[] {
  const own = shots.filter((shot) => shot.variant === composition);
  const shotOf = (look: string, viewport: ViewportId) => {
    const shot = own.find((each) => each.look === look && each.viewport === viewport);
    if (!shot) throw new Error(`No capture of ${look} at ${viewport} on ${composition}`);
    return shot;
  };
  const scores: PackPairScore[] = [];
  for (const viewport of VIEWPORT_IDS) {
    for (const [a, b] of pairs(packs)) {
      scores.push({
        a: a.id,
        b: b.id,
        viewport,
        px: thousandths(
          pixelDistance(shotOf(lookOf(a.id), viewport).grid, shotOf(lookOf(b.id), viewport).grid),
        ),
        ...pairTokens(a.vector, b.vector),
        ...schemeScore(a, b),
      });
    }
  }
  return scores;
}

/**
 * One line for a report-only pair: its scores, which never vote, and its
 * informational lines. It names no verdict, since the thresholds are the
 * scored composition's.
 */
export function describeReportOnlyScore(score: PackPairScore, composition: string): string {
  const info = Object.entries(score.info ?? {});
  const informational =
    info.length === 0
      ? ''
      : `; informational: ${info.map(([group, value]) => `${group} ${value.toFixed(3)}`).join(', ')}`;
  return `${score.a} and ${score.b} at ${score.viewport} on ${composition}, report only, never votes: pixels ${score.px.toFixed(3)}, tokens ${score.token.toFixed(3)}${informational}`;
}

export interface PackPairOutcome extends PackPairScore {
  /** Whether each score says alike; null when it doesn't vote, or the axis doesn't judge it. */
  readonly pxAlike: boolean | null;
  readonly tokenAlike: boolean | null;
  /** A color scheme pair's ΔE00 vote; absent on an axis that judges edges. */
  readonly deAlike?: boolean | null;
  readonly pxClone: boolean;
  readonly tokenClone: boolean;
  readonly deClone?: boolean;
  /**
   * The score whose alike line decides: the perceptual score (the edges, or
   * a scheme's ΔE00) whenever it votes, the tokens only while it doesn't,
   * and none when neither votes.
   */
  readonly decidedBy: ScoreKey | null;
  /** Fails: the deciding score alike, or either a clone. */
  readonly fail: boolean;
  /**
   * Why it fails: `clone:px`, `clone:de`, `clone:token`, `alike:px`,
   * `alike:de`, or `alike:token` while the perceptual score doesn't vote.
   */
  readonly reasons: readonly string[];
  /**
   * How close it is to failing on likeness: the deciding score's ratio to
   * its alike threshold, under 1 when it says alike. It ranks the worst
   * pairs; with no deciding score, the larger of the raw scores.
   */
  readonly alikeness: number;
  /**
   * A failing scheme row's failing modes (LANG-5c, for mode-scoped rulings):
   * each mode whose own mean, scaled, sits under the ΔE00 alike line or its
   * clone floor. Every scored mode when the tokens decide; empty on a pass;
   * absent on a row scored in no mode (a design language, a typography).
   */
  readonly failModes?: readonly SchemeMode[];
}

export interface PackVerdict {
  readonly outcomes: readonly PackPairOutcome[];
  readonly failures: readonly PackPairOutcome[];
  readonly problems: readonly string[];
}

/** A pair's perceptual score: its ΔE00 score on an axis that judges ΔE00, else its edges. */
export function perceptualValue(score: PackPairScore, perceptual: PerceptualScore): number {
  if (perceptual === 'px') return score.px;
  if (score.de === undefined) {
    throw new Error(`${score.a} and ${score.b} carry no ΔE00 score, and the lines judge one`);
  }
  return score.de;
}

/**
 * The fail rule, for one pair at one viewport (lead A's ruling, LANG-3b): a
 * pair fails when its perceptual score says alike, whatever its tokens say,
 * or when either score sits under its clone floor. The perceptual score is
 * the edges, or on an axis whose lines carry `de` (the color schemes,
 * LANG-4) the ΔE00 score, and then the edges aren't judged at all. A token
 * score over its alike line never rescues an alike perceptual score. Only
 * while the perceptual score has no alike line (an uncalibrated axis) does
 * the token score's alike line decide.
 */
export function judgePair(score: PackPairScore, thresholds: PackThresholds): PackPairOutcome {
  const { viewport } = score;
  const perceptual = perceptualOf(thresholds);
  const pLines = linesOf(thresholds, perceptual)!;
  const pValue = perceptualValue(score, perceptual);
  const alike = (value: number, line: ScoreThresholds) =>
    line.alike === null ? null : value < line.alike[viewport];
  const pAlike = alike(pValue, pLines);
  const tokenAlike = alike(score.token, thresholds.token);
  const pClone = pValue < pLines.clone[viewport];
  const tokenClone = score.token < thresholds.token.clone[viewport];
  const decidedBy: ScoreKey | null =
    pAlike !== null ? perceptual : tokenAlike !== null ? 'token' : null;
  const alikeFails = decidedBy === perceptual ? pAlike === true : tokenAlike === true;
  const reasons = [
    ...(pClone ? [`clone:${perceptual}`] : []),
    ...(tokenClone ? ['clone:token'] : []),
    ...(decidedBy !== null && alikeFails ? [`alike:${decidedBy}`] : []),
  ];
  const decidingValue = decidedBy === 'token' ? score.token : pValue;
  const fail = reasons.length > 0;
  const scored = SCHEME_MODES.filter((mode) => score.deModes?.[mode] !== undefined);
  let failModes: SchemeMode[] | undefined;
  if (perceptual === 'de' && score.deModes) {
    const scaled = (mode: SchemeMode) =>
      Math.round(Math.min(1, score.deModes![mode]! / DE00_SCALE) * 1000) / 1000;
    failModes = !fail
      ? []
      : decidedBy !== 'de'
        ? scored
        : scored.filter(
            (mode) =>
              scaled(mode) < pLines.clone[viewport] ||
              (pLines.alike !== null && scaled(mode) < pLines.alike[viewport]),
          );
    // The rounding of a mode's mean can lift it a hair over the line its unrounded worst sits under.
    if (fail && failModes.length === 0) failModes = score.deWorst ? [score.deWorst] : scored;
  }
  const alikeness =
    decidedBy === null
      ? Math.max(pValue, score.token)
      : decidingValue / linesOf(thresholds, decidedBy)!.alike![viewport];
  return {
    ...score,
    pxAlike: perceptual === 'px' ? pAlike : null,
    tokenAlike,
    ...(perceptual === 'de' ? { deAlike: pAlike, deClone: pClone } : {}),
    pxClone: perceptual === 'px' ? pClone : false,
    tokenClone,
    decidedBy,
    fail,
    reasons,
    alikeness: Math.round(alikeness * 1000) / 1000,
    ...(failModes ? { failModes } : {}),
  };
}

/** The verdict over every pair of `ids` at every viewport. */
export function judgePacks({
  ids,
  scores,
  thresholds,
}: {
  readonly ids: readonly string[];
  readonly scores: readonly PackPairScore[];
  readonly thresholds: PackThresholds;
}): PackVerdict {
  const problems: string[] = [];
  const outcomes: PackPairOutcome[] = [];
  for (const viewport of VIEWPORT_IDS) {
    for (const [a, b] of pairs(ids)) {
      const score = scores.find(
        (each) =>
          each.viewport === viewport &&
          ((each.a === a && each.b === b) || (each.a === b && each.b === a)),
      );
      if (!score) {
        problems.push(`no score for ${a} and ${b} at ${viewport}`);
        continue;
      }
      outcomes.push(judgePair({ ...score, a, b }, thresholds));
    }
  }
  return { outcomes, failures: outcomes.filter((outcome) => outcome.fail), problems };
}

/**
 * Where a ruling holds (LANG-5c, lead A's ruling): a viewport, a mode, or
 * both. A ruling without one holds on every row.
 */
export interface RulingScope {
  readonly viewport?: ViewportId;
  /** A base mode: only a row scored per mode (a color scheme's) has one. */
  readonly mode?: SchemeMode;
}

/**
 * One ruling in an axis's JSON (`rulings`): the pairs it rules, each two
 * pack ids, the ruling, and why. A ruling with no pairs records a pack's
 * standing (a keep, a fixed default) and rules nothing. A `scope` holds it
 * to one viewport and/or one mode (LANG-5c), so a pair ruled at 390 still
 * fails the day it fails at 1440. `evidence` names what carries the ruling,
 * such as the report-only composition's shots.
 */
export interface PackRuling {
  readonly pack?: string;
  readonly pairs: readonly (readonly string[])[];
  readonly ruling: string;
  readonly why?: string;
  readonly scope?: RulingScope;
  readonly evidence?: readonly string[];
  /** The scores the ruling was made at, for the record: the guard doesn't read them. */
  readonly scores?: unknown;
}

/**
 * The keys a ruling may carry (LANG-5c review): any other, such as a
 * `viewport` meant for `scope`, or `scopes`, is a problem, so a misspelled
 * scope can't quietly rule every row.
 */
export const RULING_KEYS = [
  'pack',
  'pairs',
  'ruling',
  'why',
  'scope',
  'evidence',
  'scores',
] as const satisfies readonly (keyof PackRuling)[];

/** One pair's ruling, as applyRulings() reads it. */
export interface PairRuling {
  readonly pair: readonly [string, string];
  readonly ruling: string;
  readonly scope?: RulingScope;
}

/** The verdict once the rulings are read (the LANG-5 enforcement commit). */
export interface RuledVerdict {
  /** The failing pair-viewports no ruling covers, and every clone, ruled or not. */
  readonly failures: readonly PackPairOutcome[];
  /** The failing pair-viewports a ruling covers, each with its ruling (rulings joined by "; "). */
  readonly ruled: readonly { readonly outcome: PackPairOutcome; readonly ruling: string }[];
  /**
   * Each ruling that rules no failing row in its scope: unscoped, its pair
   * fails at no viewport; scoped, no row in its viewport (and mode) fails.
   * Either way it's no longer needed.
   */
  readonly unneeded: readonly PairRuling[];
  /** A ruling that can't be read: a pair that isn't two packs the guard scores, or a scope it can't. */
  readonly problems: readonly string[];
  /**
   * Each scoped ruling whose scope matches no scored row (LANG-5c): a mode
   * on an axis that scores none, a viewport the guard didn't score. The run
   * refuses it, enforced or not, since it can never rule anything.
   */
  readonly refused: readonly PairRuling[];
  /** How many scoped rulings ruled at least one failing row (the guard prints it). */
  readonly scopedApplied: number;
}

const pairKey = (a: string, b: string) => [a, b].sort().join(' and ');

/** A scope in words: "at mobile", "in dark", "at desktop in light", or "" with none. */
export function describeScope(scope: RulingScope | undefined): string {
  return [
    ...(scope?.viewport ? [`at ${scope.viewport}`] : []),
    ...(scope?.mode ? [`in ${scope.mode}`] : []),
  ].join(' ');
}

const scoped = (ruling: PairRuling) =>
  ruling.scope?.viewport !== undefined || ruling.scope?.mode !== undefined;

/** How narrow a ruling is: 0 unscoped, 1 for a viewport or a mode, 2 for both. */
const narrowness = (ruling: PairRuling) =>
  (ruling.scope?.viewport !== undefined ? 1 : 0) + (ruling.scope?.mode !== undefined ? 1 : 0);

/**
 * The broadest first, then by the ruling's words: the order applyRulings()
 * picks in, so neither which ruling rules a row nor the applied count
 * turns on the JSON's order.
 */
const broadestFirst = (x: PairRuling, y: PairRuling) =>
  narrowness(x) - narrowness(y) || (x.ruling < y.ruling ? -1 : x.ruling > y.ruling ? 1 : 0);

/** Whether `wide` holds on every row `narrow` does: each part of its scope unset or the same. */
const covers = (wide: PairRuling, narrow: PairRuling) =>
  (wide.scope?.viewport === undefined || wide.scope.viewport === narrow.scope?.viewport) &&
  (wide.scope?.mode === undefined || wide.scope.mode === narrow.scope?.mode);

/** Where a ruling holds, in words: its scope, or "everywhere". */
const whereHolds = (ruling: PairRuling) => describeScope(ruling.scope) || 'everywhere';

/**
 * A pair's redundant rulings (LANG-5c review): one another ruling of the
 * pair already covers, such as a 390 ruling beside an unscoped one, and two
 * with the same scope. Each is named once, whatever the JSON's order.
 */
function redundancyProblems(rulings: readonly PairRuling[]): string[] {
  const sorted = [...rulings].sort(broadestFirst);
  const problems: string[] = [];
  for (const [index, narrow] of sorted.entries()) {
    const wide = sorted.find((other, at) => at < index && covers(other, narrow));
    if (!wide) continue;
    const pair = narrow.pair.join(' and ');
    problems.push(
      narrowness(wide) === narrowness(narrow)
        ? `the rulings "${wide.ruling}" and "${narrow.ruling}" both rule ${pair} ${whereHolds(narrow)}: keep one`
        : `the ruling "${narrow.ruling}" for ${pair} ${whereHolds(narrow)} is redundant: "${wide.ruling}" already rules it ${whereHolds(wide)}, so remove one`,
    );
  }
  return problems;
}

/** Whether `ruling`'s viewport holds on `outcome`'s row. */
const viewportHolds = (ruling: PairRuling, outcome: PackPairOutcome) =>
  ruling.scope?.viewport === undefined || ruling.scope.viewport === outcome.viewport;

/** The modes a row is scored in: a scheme row's own, none for a row scored in none. */
const scoredModes = (outcome: PackPairOutcome): readonly SchemeMode[] =>
  SCHEME_MODES.filter((mode) => outcome.deModes?.[mode] !== undefined);

/** Whether `ruling`'s scope matches `outcome`'s row at all, failing or not. */
const scopeMatches = (ruling: PairRuling, outcome: PackPairOutcome) =>
  viewportHolds(ruling, outcome) &&
  (ruling.scope?.mode === undefined || scoredModes(outcome).includes(ruling.scope.mode));

/** A scope's problems: an unknown key, or a viewport or mode the guard doesn't score. */
function scopeProblems(scope: unknown, key: string): string[] {
  if (scope === undefined) return [];
  if (scope === null || typeof scope !== 'object' || Array.isArray(scope)) {
    return [`the ruling for ${key} has a scope that isn't an object`];
  }
  const problems: string[] = [];
  const record = scope as Record<string, unknown>;
  for (const name of Object.keys(record)) {
    if (name !== 'viewport' && name !== 'mode') {
      problems.push(`the ruling for ${key} scopes ${name}, which isn't viewport or mode`);
    }
  }
  if ('viewport' in record && !VIEWPORT_IDS.includes(record.viewport as ViewportId)) {
    problems.push(
      `the ruling for ${key} scopes viewport ${JSON.stringify(record.viewport)}, which isn't ${VIEWPORT_IDS.join(' or ')}`,
    );
  }
  if ('mode' in record && !SCHEME_MODES.includes(record.mode as SchemeMode)) {
    problems.push(
      `the ruling for ${key} scopes mode ${JSON.stringify(record.mode)}, which isn't ${SCHEME_MODES.join(' or ')}`,
    );
  }
  if (Object.keys(record).length === 0) {
    problems.push(`the ruling for ${key} has an empty scope: leave scope out to rule every row`);
  }
  return problems;
}

/**
 * The verdict with the JSON's rulings read, as distinct's acceptances are:
 * a failing pair passes only while a ruling names it, a clone never does,
 * and a ruled pair that no longer fails anywhere is unneeded, so the list
 * can't outlive what it rules. `ids` are the packs the guard scores.
 *
 * A scoped ruling (LANG-5c) holds only on the rows its scope names: a
 * failing row is ruled when a ruling without a mode holds at its viewport,
 * or when the mode-scoped rulings that hold there cover every mode it fails
 * in. It's unneeded when no failing row in its scope fails (in its mode),
 * and refused when its scope matches no scored row at all.
 *
 * The review (LANG-5c): a key no ruling carries (RULING_KEYS) is a problem,
 * and so is a ruling another of its pair already covers. Where several
 * hold, the broadest is applied, so the JSON's order changes nothing.
 */
export function applyRulings(
  outcomes: readonly PackPairOutcome[],
  rulings: readonly PackRuling[],
  ids: readonly string[],
): RuledVerdict {
  const problems: string[] = [];
  const rulingsOf = new Map<string, PairRuling[]>();
  for (const ruling of rulings) {
    const unknownKeys = Object.keys(ruling).filter(
      (name) => !(RULING_KEYS as readonly string[]).includes(name),
    );
    if (unknownKeys.length > 0) {
      problems.push(
        `the ruling "${ruling.ruling}" has ${unknownKeys.join(', ')}, which a ruling doesn't carry: it carries ${RULING_KEYS.join(', ')}`,
      );
      continue;
    }
    for (const pair of ruling.pairs) {
      const [a, b] = pair;
      if (pair.length !== 2 || !a || !b || a === b) {
        problems.push(`a ruling names ${JSON.stringify(pair)}, which isn't a pair of two packs`);
        continue;
      }
      const unknown = pair.filter((id) => !ids.includes(id));
      if (unknown.length > 0) {
        problems.push(
          `a ruling names ${pairKey(a, b)}, and the guard scores no ${unknown.join(' or ')}`,
        );
        continue;
      }
      const key = pairKey(a, b);
      const bad = scopeProblems(ruling.scope, key);
      if (bad.length > 0) {
        problems.push(...bad);
        continue;
      }
      const entry: PairRuling = {
        pair: key.split(' and ') as [string, string],
        ruling: ruling.ruling,
        ...(ruling.scope ? { scope: ruling.scope } : {}),
      };
      rulingsOf.set(key, [...(rulingsOf.get(key) ?? []), entry]);
    }
  }
  for (const list of rulingsOf.values()) {
    list.sort(broadestFirst);
    problems.push(...redundancyProblems(list));
  }
  const failures: PackPairOutcome[] = [];
  const ruled: { outcome: PackPairOutcome; ruling: string }[] = [];
  const applied = new Set<PairRuling>();
  for (const outcome of outcomes) {
    if (!outcome.fail) continue;
    const clone = outcome.reasons.some((reason) => reason.startsWith('clone:'));
    const holding = (rulingsOf.get(pairKey(outcome.a, outcome.b)) ?? []).filter((ruling) =>
      viewportHolds(ruling, outcome),
    );
    // `holding` is broadest first, so the broadest ruling that holds is the one applied.
    const whole = holding.filter((ruling) => ruling.scope?.mode === undefined);
    const modes = outcome.failModes ?? [];
    const byMode = holding.filter(
      (ruling, index) =>
        ruling.scope?.mode !== undefined &&
        modes.includes(ruling.scope.mode) &&
        holding.findIndex((other) => other.scope?.mode === ruling.scope?.mode) === index,
    );
    const covering =
      whole.length > 0
        ? whole.slice(0, 1)
        : modes.length > 0 && modes.every((mode) => byMode.some((r) => r.scope?.mode === mode))
          ? byMode
          : [];
    if (covering.length > 0 && !clone) {
      for (const ruling of covering) applied.add(ruling);
      ruled.push({ outcome, ruling: covering.map(({ ruling }) => ruling).join('; ') });
    } else failures.push(outcome);
  }
  const all = [...rulingsOf.values()].flat();
  const unneeded = all.filter(
    (ruling) =>
      !outcomes.some(
        (outcome) =>
          outcome.fail &&
          pairKey(outcome.a, outcome.b) === pairKey(...ruling.pair) &&
          viewportHolds(ruling, outcome) &&
          (ruling.scope?.mode === undefined ||
            (outcome.failModes ?? []).includes(ruling.scope.mode)),
      ),
  );
  const refused = all.filter(
    (ruling) =>
      scoped(ruling) &&
      !outcomes.some(
        (outcome) =>
          pairKey(outcome.a, outcome.b) === pairKey(...ruling.pair) &&
          scopeMatches(ruling, outcome),
      ),
  );
  return {
    failures,
    ruled,
    // A refused ruling is named once, as refused.
    unneeded: unneeded.filter((ruling) => !refused.includes(ruling)),
    problems,
    refused,
    scopedApplied: [...applied].filter(scoped).length,
  };
}

/** One line for an unneeded ruling. */
export function describeUnneeded({ pair, ruling, scope }: PairRuling): string {
  const where = describeScope(scope);
  return `${pair.join(' and ')} fail nowhere${where ? ` ${where}` : ''}, so the ruling "${ruling}" is no longer needed: remove it`;
}

/** One line for a refused ruling: its scope matches no row the guard scored. */
export function describeRefused({ pair, ruling, scope }: PairRuling): string {
  return `the ruling "${ruling}" for ${pair.join(' and ')} is scoped ${describeScope(scope)}, which matches no row the guard scored: fix its scope or remove it`;
}

/**
 * What fails an axis's run once its rulings are read: with `enforced` true,
 * every unruled failure (each clone among them) and every unneeded ruling,
 * one line each; with it false, nothing, as the guard only reports. The
 * spec expects this to be empty.
 */
export function enforcementFailures(
  json: { readonly enforced: boolean },
  ruled: RuledVerdict,
  thresholds: PackThresholds,
  dividers: readonly SharedDivider[] = [],
): string[] {
  if (!json.enforced) return [];
  return [
    ...ruled.failures.map((outcome) => describePackOutcome(outcome, thresholds)),
    ...ruled.unneeded.map(describeUnneeded),
    ...dividers.map(describeSharedDivider),
  ];
}

// ---------------------------------------------------------------------------
// Dividers (D-1, lead A, 2026-10-31)

/** A divider as the check compares it: lower case, one space between words, none inside parentheses' edges. */
export function dividerKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\(\s/g, '(')
    .replace(/\s\)/g, ')')
    .replace(/\s,/g, ',');
}

/** Two design languages that render alike on the scored composition and draw one divider. */
export interface SharedDivider {
  readonly pair: readonly [string, string];
  /** The divider both draw, as dividerKey() reads it. */
  readonly divider: string;
  /** Where the pair renders alike, ruled or not. */
  readonly viewports: readonly ViewportId[];
}

/**
 * The divider-distinct check (D-1): a pair of design languages the guard
 * finds alike on its scored composition, at any viewport, failing or
 * ruled, must not also draw one `border-divider`. The token score counts
 * the divider among the borders, but tokens never vote (judgePair()), so
 * without this the guard can't see it. Editorial Evidence, the report-only
 * composition a ruling names as carrying a pair's signature, draws its open
 * index, its notes column, and its section rules in the divider and little
 * else of the language, so two alike languages with one divider read the
 * same there: platform-neutral and material-3-inspired did, until M3
 * drew its own (LANG-5c round 2). A pair that passes everywhere may share a divider.
 */
export function sharedDividers(
  outcomes: readonly PackPairOutcome[],
  dividerOf: (id: string) => string | undefined,
): SharedDivider[] {
  const alike = new Map<string, { pair: [string, string]; viewports: Set<ViewportId> }>();
  for (const outcome of outcomes) {
    if (!outcome.fail) continue;
    const pair = [outcome.a, outcome.b].sort() as [string, string];
    const key = pair.join(' and ');
    const entry = alike.get(key) ?? { pair, viewports: new Set<ViewportId>() };
    entry.viewports.add(outcome.viewport);
    alike.set(key, entry);
  }
  const shared: SharedDivider[] = [];
  for (const { pair, viewports } of alike.values()) {
    const [first, second] = pair.map(dividerOf);
    if (first === undefined || second === undefined) continue;
    if (dividerKey(first) !== dividerKey(second)) continue;
    shared.push({
      pair,
      divider: dividerKey(first),
      viewports: VIEWPORT_IDS.filter((viewport) => viewports.has(viewport)),
    });
  }
  return shared.sort((x, y) => (x.pair.join() < y.pair.join() ? -1 : 1));
}

/** A shared divider in words, one line. */
export function describeSharedDivider({ pair, divider, viewports }: SharedDivider): string {
  return `${pair[0]} and ${pair[1]} render alike at ${viewports.join(' and ')} and draw one divider, ${divider}, so Editorial Evidence's index and rules read the same in both`;
}

/**
 * The worst pairs first: failures before passes, clones before alike pairs,
 * then by alikeness, then by the perceptual distance (the ΔE00 score where
 * a pair has one, else the edges), then by id.
 */
export function rankPairs(outcomes: readonly PackPairOutcome[]): PackPairOutcome[] {
  const clone = (outcome: PackPairOutcome) =>
    outcome.pxClone || outcome.tokenClone || outcome.deClone === true ? 0 : 1;
  const near = (outcome: PackPairOutcome) => outcome.de ?? outcome.px;
  return [...outcomes].sort(
    (x, y) =>
      Number(y.fail) - Number(x.fail) ||
      clone(x) - clone(y) ||
      x.alikeness - y.alikeness ||
      near(x) - near(y) ||
      (x.a + x.b < y.a + y.b ? -1 : 1),
  );
}

/** A scheme pair's per-role ΔE00, as the report prints it: each `mode:role`, the near ones marked. */
export function describeRoles(score: Pick<PackPairScore, 'deRoles' | 'near'>): string {
  const near = new Set(score.near ?? []);
  return Object.entries(score.deRoles ?? {})
    .map(([role, value]) => `${role} ${value.toFixed(2)}${near.has(role) ? ' (near)' : ''}`)
    .join(', ');
}

/**
 * One line for an outcome, as the report prints it: the verdict, each
 * score with whether it decided (the perceptual score whenever it votes) or
 * was only reported, a scheme pair's per-role ΔE00 with its near roles, and
 * the informational lines, which never score.
 */
export function describePackOutcome(outcome: PackPairOutcome, thresholds: PackThresholds): string {
  const { viewport } = outcome;
  const perceptual = perceptualOf(thresholds);
  const line = (key: ScoreKey, name: string) => {
    const score = linesOf(thresholds, key)!;
    const vote =
      key === 'px' ? outcome.pxAlike : key === 'de' ? outcome.deAlike : outcome.tokenAlike;
    const role =
      outcome.decidedBy === key
        ? 'decides'
        : score.alike === null
          ? 'no vote'
          : 'reported, no vote';
    const at =
      score.alike === null
        ? 'no alike line'
        : `${vote ? 'alike <' : 'apart >='} ${score.alike[viewport]}`;
    const value = key === 'token' ? outcome.token : perceptualValue(outcome, perceptual);
    const raw =
      key === 'de' && outcome.deMean !== undefined
        ? ` (mean ΔE00 ${outcome.deMean.toFixed(2)}${outcome.deWorst ? ` in ${outcome.deWorst}, the worse mode; ${describeModes(outcome.deModes)}` : ''})`
        : '';
    return `${name} ${value.toFixed(3)}${raw} (${role}: ${at}; clone floor ${score.clone[viewport]})`;
  };
  const verdict = outcome.fail ? `FAIL ${outcome.reasons.join(', ')}` : 'pass';
  const scores =
    perceptual === 'de'
      ? `${line('de', 'ΔE00')}, ${line('token', 'tokens')}; edges ${outcome.px.toFixed(3)} (dropped on this axis, never scored)`
      : `${line('px', 'pixels')}, ${line('token', 'tokens')}`;
  const near = outcome.near ?? [];
  const roles = outcome.deRoles
    ? `; per-role ΔE00: ${describeRoles(outcome)}${near.length > 0 ? `; near (under ${NEAR_DE00}): ${near.join(', ')}` : ''}`
    : '';
  const info = Object.entries(outcome.info ?? {});
  const informational =
    info.length === 0
      ? ''
      : `; informational, never scored: ${info.map(([group, value]) => `${group} ${value.toFixed(3)}`).join(', ')}`;
  const painted =
    outcome.painted && outcome.painted.least < PAINTED_REPORT_UNDER
      ? `; ${describePainted(outcome.painted)}`
      : '';
  return `${outcome.a} and ${outcome.b} at ${viewport}: ${verdict}; ${scores}${painted}${roles}${informational}`;
}

/** A pair matrix as rows of text: `cell(a, b)` for every ordered pair, the diagonal blank. */
export function matrixRows(
  ids: readonly string[],
  cell: (a: string, b: string) => string,
): string[][] {
  return [['', ...ids], ...ids.map((a) => [a, ...ids.map((b) => (a === b ? '' : cell(a, b)))])];
}

/** A pack the report names but never scores: an unscorable one, or one the build leaves out. */
export interface UnscoredPack {
  readonly id: string;
  readonly reason: string;
}

/** What an unscorable pack's matrix row and ranked line say: it's never counted as distinct. */
export const UNSCORABLE_LABEL = "unscorable: needs the owner's input";
/** What a pack the build leaves out says. */
export const EXCLUDED_LABEL = 'not in this build';

/** The rows a matrix adds for the packs it never scores, each naming why, after the scored ones. */
export const unscoredRows = (
  unscorable: readonly UnscoredPack[],
  excluded: readonly UnscoredPack[],
): string[][] => [
  ...unscorable.map(({ id }) => [id, UNSCORABLE_LABEL]),
  ...excluded.map(({ id }) => [id, EXCLUDED_LABEL]),
];

/** The ranked list's closing lines for the packs it never scores: never counted as distinct. */
export function unscoredLines(
  unscorable: readonly UnscoredPack[],
  excluded: readonly UnscoredPack[],
): string[] {
  return [
    ...unscorable.map(
      ({ id, reason }) =>
        `${id}: ${UNSCORABLE_LABEL}. Never scored, never counted as distinct (${reason.replace(/\.$/, '')}).`,
    ),
    ...excluded.map(
      ({ id, reason }) => `${id}: ${EXCLUDED_LABEL}. Never scored (${reason.replace(/\.$/, '')}).`,
    ),
  ];
}

/** Rows as CSV. */
export const csv = (rows: readonly (readonly string[])[]) =>
  `${rows.map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join(',')).join('\n')}\n`;

// ---------------------------------------------------------------------------
// Calibration

/** One control's scores at one viewport, with its role for each score. */
export interface PackControl {
  readonly a: string;
  readonly b: string;
  readonly control: string;
  readonly viewport: ViewportId;
  /** Its role for each score; a score it has no role for reads it as informational. */
  readonly roles: Readonly<Partial<Record<ScoreKey, ControlRole>>>;
  readonly px: number;
  readonly token: number;
  /** A color scheme control's ΔE00 score; absent on other axes. */
  readonly de?: number;
}

/** A control's role: `same` and `different` set a threshold, `informational` none. */
export type ControlRole = 'same' | 'different' | 'informational';

/** One score's calibration at each viewport. */
export interface ScoreCalibration {
  readonly alike: Record<ViewportId, Calibration>;
  readonly clone: Record<ViewportId, NoiseFloor>;
}

/** The calibration of each score an axis judges: its perceptual score's and the tokens'. */
export type AxisCalibration = EdgeCalibration | SchemeCalibration;
export interface EdgeCalibration {
  readonly px: ScoreCalibration;
  readonly token: ScoreCalibration;
}
export interface SchemeCalibration {
  readonly de: ScoreCalibration;
  readonly token: ScoreCalibration;
}

/**
 * The thresholds of each of `scores` (the axis's perceptual score, the
 * edges by default, and the tokens) from the controls, by distinct.ts's
 * procedure. Each score's alike threshold is calibrate()'s, as a distance,
 * and votes only with a gap at both viewports; its clone floor is
 * noiseFloor()'s, never under CLONE_RESOLUTION.
 */
export function calibrateAxis(
  controls: readonly PackControl[],
  perceptual?: 'px',
): { readonly calibration: EdgeCalibration; readonly thresholds: EdgeThresholds };
export function calibrateAxis(
  controls: readonly PackControl[],
  perceptual: 'de',
): { readonly calibration: SchemeCalibration; readonly thresholds: SchemeThresholds };
export function calibrateAxis(
  controls: readonly PackControl[],
  perceptual: PerceptualScore,
): { readonly calibration: AxisCalibration; readonly thresholds: PackThresholds };
export function calibrateAxis(
  controls: readonly PackControl[],
  perceptual: PerceptualScore = 'px',
): { readonly calibration: AxisCalibration; readonly thresholds: PackThresholds } {
  const values = (score: ScoreKey, role: 'same' | 'different', viewport: ViewportId) =>
    controls
      .filter((each) => each.roles[score] === role && each.viewport === viewport)
      .map((each) => {
        const value = each[score];
        if (value === undefined) {
          throw new Error(
            `${each.control} (${each.a}, ${each.b}) has a ${score} role and no ${score} score`,
          );
        }
        return value;
      });
  const one = (score: ScoreKey) => {
    const alike = {} as Record<ViewportId, Calibration>;
    const clone = {} as Record<ViewportId, NoiseFloor>;
    for (const viewport of VIEWPORT_IDS) {
      alike[viewport] = calibrate(
        values(score, 'same', viewport),
        values(score, 'different', viewport),
        'distance',
      );
      clone[viewport] = noiseFloor(values(score, 'same', viewport));
    }
    const voting = VIEWPORT_IDS.every((viewport) => alike[viewport].threshold !== null);
    const lines: ScoreThresholds = {
      alike: voting
        ? (Object.fromEntries(
            VIEWPORT_IDS.map((viewport) => [viewport, alike[viewport].threshold]),
          ) as Record<ViewportId, number>)
        : null,
      clone: Object.fromEntries(
        VIEWPORT_IDS.map((viewport) => [
          viewport,
          Math.max(CLONE_RESOLUTION, clone[viewport].threshold),
        ]),
      ) as Record<ViewportId, number>,
    };
    return { calibration: { alike, clone }, lines };
  };
  const first = one(perceptual);
  const token = one('token');
  return perceptual === 'de'
    ? {
        calibration: { de: first.calibration, token: token.calibration },
        thresholds: { de: first.lines, token: token.lines },
      }
    : {
        calibration: { px: first.calibration, token: token.calibration },
        thresholds: { px: first.lines, token: token.lines },
      };
}
/** `png` scaled down to `width` px wide, each pixel the mean of the pixels it covers, as a PNG. */
export function thumbnail(png: Uint8Array, width: number): Buffer {
  const image = decodePng(png);
  const scale = image.width / width;
  const height = Math.max(1, Math.round(image.height / scale));
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.max(y0 + 1, Math.min(image.height, Math.floor((y + 1) * scale)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.max(x0 + 1, Math.min(image.width, Math.floor((x + 1) * scale)));
      const sum = [0, 0, 0, 0];
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * image.width + xx) * 4;
          for (let c = 0; c < 4; c++) sum[c]! += image.data[i + c]!;
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) out.data[o + c] = Math.round(sum[c]! / n);
    }
  }
  return PNG.sync.write(out);
}

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** One tile of a specimen sheet: an image beside the report, and its caption lines. */
export interface Tile {
  readonly file: string;
  readonly caption: readonly string[];
}

/**
 * A specimen sheet as HTML: a heading, then rows of tiles, each its image
 * (a file beside the sheet) and its caption. The spec screenshots it into a
 * PNG; the HTML stays beside it.
 */
export function sheetHtml(
  title: string,
  rows: readonly (readonly Tile[])[],
  tileWidth: number,
  note = '',
): string {
  const row = (tiles: readonly Tile[]) =>
    `<div class="row">${tiles
      .map(
        (tile) =>
          `<figure><img src="${escapeHtml(tile.file)}" width="${tileWidth}"><figcaption>${tile.caption
            .map((line, index) => (index === 0 ? `<b>${escapeHtml(line)}</b>` : escapeHtml(line)))
            .join('<br>')}</figcaption></figure>`,
      )
      .join('')}</div>`;
  return [
    '<!doctype html><html><head><meta charset="utf-8"><style>',
    'body{margin:24px;font:13px/1.35 -apple-system,Helvetica,Arial,sans-serif;color:#111;background:#fff}',
    'h1{font-size:18px;margin:0 0 4px} p{margin:0 0 16px;color:#444}',
    '.row{display:flex;flex-wrap:wrap;gap:16px;margin-bottom:16px}',
    'figure{margin:0} img{display:block;border:1px solid #bbb} figcaption{margin-top:4px}',
    `</style></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(note)}</p>`,
    ...rows.map(row),
    '</body></html>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The scored composition

/** A candidate composition as the calibration ranks it: how much of the axis its first viewport paints. */
export interface CompositionCoverage {
  readonly variant: string;
  readonly coverage: number;
}

/** Which composition an axis scores, and what the coverage procedure alone would pick. */
export interface CompositionChoice {
  readonly composition: string;
  /** forced by PORTFOLIO_PACK_DISTINCT_COMPOSITION, pinned by the axis's JSON, or the coverage procedure's pick. */
  readonly by: 'forced' | 'pinned' | 'coverage';
  /** The candidate with the most coverage, the procedure's pick, when any ranked. */
  readonly procedure: CompositionCoverage | null;
  /** The scored composition's own coverage, when it ranked. */
  readonly scoredCoverage: number | null;
  /** The report's line naming both. */
  readonly line: string;
}

/**
 * The composition an axis scores (LANG-2, the lead's ruling): a forced one
 * first, then the one the axis's JSON pins, then the candidate whose first
 * viewport the axis paints most. A pin holds whatever registers later, so a
 * new composition with more coverage never moves the scored one; the line
 * names the procedure's pick beside it.
 */
export function chooseComposition({
  ranked,
  pinned,
  forced,
}: {
  readonly ranked: readonly CompositionCoverage[];
  readonly pinned?: string | null;
  readonly forced?: string | null;
}): CompositionChoice {
  const procedure =
    [...ranked].sort((a, b) => b.coverage - a.coverage || a.variant.localeCompare(b.variant))[0] ??
    null;
  const by = forced ? 'forced' : pinned ? 'pinned' : 'coverage';
  const composition = forced || pinned || procedure?.variant;
  if (!composition) throw new Error('No composition ranked, and none is forced or pinned');
  const scoredCoverage = ranked.find((each) => each.variant === composition)?.coverage ?? null;
  const line =
    procedure === null
      ? `scored composition: ${composition} (${by}); no candidate ranked`
      : procedure.variant === composition
        ? `scored composition: ${composition} (${by}), coverage ${procedure.coverage}, which the coverage procedure also picks`
        : `scored composition: ${composition} (${by}), coverage ${scoredCoverage ?? 'not ranked'}; the coverage procedure would pick ${procedure.variant}, coverage ${procedure.coverage}`;
  return { composition, by, procedure, scoredCoverage, line };
}

/**
 * Lead A's bound on a scheme's derived roles (the LANG-5 enforcement
 * commit): a derived role may shift up to 2.0 ΔE00 for contrast, its hue
 * within 5°, while its own anchor stays; beyond that, lead review. Report
 * only: derivedShifts() lists, and nothing fails on it.
 */
export const DERIVED_BOUND = { de: 2, hue: 5 } as const;

/**
 * The anchor each derived role is drawn from, where it has one of its own:
 * the accent's family from the accent, the second color's from the
 * secondary. A role with none here (the surfaces, the inks, the borders) is
 * the canvas's and text's own family, and moves with them by design. A role
 * mixed from the accent and the canvas (the selection, the sequential data
 * ramp) is drawn from both.
 */
const ROLE_ANCHORS: readonly (readonly [RegExp, readonly string[]])[] = [
  [/^emphasis$|^on-emphasis$/, ['emphasis']],
  [/^selection$|^data-sequential-/, ['accent', 'canvas']],
  [/^accent|^on-accent$|^focus|^signature-start$/, ['accent']],
  [/^information$|^signature-end$/, ['secondary']],
];

/** One derived role's shift between two derivations of a scheme. */
export interface DerivedShift {
  readonly set: string;
  readonly role: string;
  readonly from: string;
  readonly to: string;
  readonly de: number;
  /** The CIELAB hue angle's change, in degrees, 0..180; 0 when either end is near-neutral. */
  readonly hue: number;
  /** Within DERIVED_BOUND. */
  readonly within: boolean;
}

/** A color's CIELAB hue angle, or null for a near-neutral (chroma under 5), whose hue doesn't read. */
const hueOf = (hex: string): number | null => {
  const [, a, b] = hexToLab(hex);
  return Math.hypot(a, b) < 5 ? null : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
};

/**
 * Every derived role of a scheme that moved between two derivations
 * (before and after, each its anchors by base mode and its sets by name)
 * while its own anchor stayed: a contrast derivation, measured against
 * DERIVED_BOUND. A role whose own anchor moved isn't listed; it moved with it.
 */
export function derivedShifts(
  before: {
    readonly anchors: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    readonly sets: Readonly<Record<string, Readonly<Record<string, string>>>>;
  },
  after: {
    readonly anchors: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    readonly sets: Readonly<Record<string, Readonly<Record<string, string>>>>;
  },
): DerivedShift[] {
  const out: DerivedShift[] = [];
  for (const [set, roles] of Object.entries(after.sets)) {
    const mode = set.endsWith('dark') ? 'dark' : 'light';
    for (const [role, to] of Object.entries(roles)) {
      const from = before.sets[set]?.[role];
      if (!from || from === to) continue;
      // A high-contrast set's emphasis is its accent (high-contrast-v1, derive.ts), never the emphasis anchor.
      const sources =
        set.startsWith('high-contrast') && /^emphasis$|^on-emphasis$/.test(role)
          ? ['accent']
          : ROLE_ANCHORS.find(([pattern]) => pattern.test(role))?.[1];
      if (!sources) continue;
      const own = (anchors: typeof before.anchors) =>
        JSON.stringify(
          sources.map(
            (anchor) =>
              anchors[mode]?.[anchor] ??
              (anchor === 'emphasis' ? anchors[mode]?.accent : undefined),
          ),
        );
      if (own(before.anchors) !== own(after.anchors)) continue;
      const de = Math.round(deltaE00(from, to) * 100) / 100;
      const [h1, h2] = [hueOf(from), hueOf(to)];
      let hue = h1 === null || h2 === null ? 0 : Math.abs(h1 - h2);
      if (hue > 180) hue = 360 - hue;
      hue = Math.round(hue * 10) / 10;
      out.push({
        set,
        role,
        from,
        to,
        de,
        hue,
        within: de <= DERIVED_BOUND.de && hue <= DERIVED_BOUND.hue,
      });
    }
  }
  return out;
}
