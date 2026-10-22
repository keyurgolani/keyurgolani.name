// The computed contrast gate (#19, Slice 2, items 2 and 8): the pairs one
// color set must pass, painted by one design language and set in one
// typography profile, at the targets #11 holds them to. It is pure and
// browser-safe, so `pnpm check:appearance`, a generator's contrast report,
// and Studio's token inspector compute the same numbers.
//
// Text pairs need 4.5:1, and 7:1 in a high-contrast set. Non-text pairs need
// 3:1, and 4.5:1 in a high-contrast set. The signature fill on display and
// headline text needs 3:1 (4.5:1) only when both are WCAG large text. A
// surface composites at the language's surface-opacity over the worst of
// canvas, black, and white. A textured language raises every target on
// canvas and surfaces by 10%; pairs on fills (on-accent, on-status, on-scrim)
// keep theirs.

import { BLACK, composite, contrast, mix, WHITE } from './color';
import { isHighContrastSet, type ColorSetName } from './sets';
import {
  COLOR_ROLES,
  type ColorRole,
  type ColorTokens,
  type LanguageTokens,
  type TypeRole,
  type TypographyRoles,
} from './tokens';

export const GATE_TARGETS = Object.freeze({
  text: 4.5,
  largeText: 3,
  nonText: 3,
  highContrastText: 7,
  highContrastLargeText: 4.5,
  highContrastNonText: 4.5,
  /** A textured language multiplies the targets on canvas and surfaces by this. */
  textureRaise: 1.1,
  /** The narrowest focus ring, in CSS px. */
  focusWidth: 2,
});

/** What text and non-text pairs sit on: the canvas and the four surfaces. */
export const GROUND_ROLES = [
  'canvas',
  'surface-subtle',
  'surface-default',
  'surface-prominent',
  'surface-overlay',
] as const satisfies readonly ColorRole[];

/** Text that must read on canvas and every surface. */
export const TEXT_ROLES = [
  'text-primary',
  'text-secondary',
  'text-muted',
  'accent-text',
] as const satisfies readonly ColorRole[];

/** Fills and the text color that sits on each. */
export const FILL_PAIRS: readonly (readonly [ColorRole, readonly ColorRole[]])[] = [
  ['on-accent', ['accent', 'accent-hover', 'accent-active']],
  ['on-status', ['positive', 'warning', 'danger', 'information']],
  ['on-scrim', ['scrim']],
];

export const CATEGORICAL_ROLES = [
  'data-categorical-1',
  'data-categorical-2',
  'data-categorical-3',
  'data-categorical-4',
  'data-categorical-5',
  'data-categorical-6',
] as const satisfies readonly ColorRole[];

/** What the gate reads from a design language's tokens. */
export interface GateLanguage {
  /** --ui-surface-opacity, from 0 to 1. */
  readonly surfaceOpacity: number;
  /** --ui-texture is anything but none. */
  readonly textured: boolean;
  /** The color --ui-border-control draws in, or null when controls draw no border. */
  readonly borderControl: ColorRole | null;
  /** --ui-focus-width, in CSS px. */
  readonly focusWidth: number;
  /** The color roles --ui-signature-fill paints, in order. */
  readonly signature: readonly ColorRole[];
}

/** What the gate reads from a typography profile. */
export interface GateTypography {
  /** display and headline are both WCAG large text, so the signature fill needs 3:1. */
  readonly largeSignature: boolean;
}

/** An opaque, untextured language with strong control borders, for a scheme's own report. */
export const NEUTRAL_LANGUAGE: GateLanguage = Object.freeze({
  surfaceOpacity: 1,
  textured: false,
  borderControl: 'border-strong',
  focusWidth: GATE_TARGETS.focusWidth,
  signature: Object.freeze(['signature-start', 'signature-end'] as const),
});

/** The strictest reading: signature text isn't large. */
export const SMALL_SIGNATURE: GateTypography = Object.freeze({ largeSignature: false });

export interface GatePair {
  readonly set: ColorSetName;
  readonly kind: 'text' | 'large-text' | 'non-text' | 'focus-width';
  /** The role, or roles of a fill such as `signature-start to signature-end`, or `focus-width`. */
  readonly foreground: string;
  /** The role it sits on. Empty for focus-width. */
  readonly ground: string;
  /** For a translucent surface, the backdrop it reads worst over. */
  readonly backdrop?: string;
  /** The contrast ratio, or the width in px for focus-width, rounded down to two places. */
  readonly ratio: number;
  readonly target: number;
  readonly passes: boolean;
}

const ROLES: ReadonlySet<string> = new Set(COLOR_ROLES);
const COLOR_REFERENCE = /var\(--color-([a-z0-9-]+)\)/g;

/** The color roles `value` references with var(--color-<role>), in order. */
function colorReferences(value: string): ColorRole[] {
  return [...value.matchAll(COLOR_REFERENCE)]
    .map((match) => match[1]!)
    .filter((role): role is ColorRole => ROLES.has(role));
}

/** A length in CSS px: px, or rem and em at the 16px default. */
function pixels(value: string): number | null {
  if (value === '0') return 0;
  const match = /^(\d+(?:\.\d+)?|\.\d+)(px|rem|em)$/.exec(value);
  if (!match) return null;
  const amount = Number.parseFloat(match[1]!);
  return match[2] === 'px' ? amount : amount * 16;
}

/** An opacity from 0 to 1, written as a number or a percentage. */
function opacity(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?|\.\d+)(%?)$/.exec(value);
  if (!match) return null;
  const amount = Number.parseFloat(match[1]!) / (match[2] === '%' ? 100 : 1);
  return amount >= 0 && amount <= 1 ? amount : null;
}

/** Whether a border shorthand draws nothing: zero width, or style none or hidden, or a transparent color. */
function drawsNoBorder(value: string): boolean {
  const words = value.toLowerCase().split(/\s+/);
  return (
    words.includes('none') ||
    words.includes('hidden') ||
    words.includes('transparent') ||
    words.some((word) => pixels(word) === 0)
  );
}

/**
 * What the gate reads from a language's tokens, or why it can't: a value
 * it can't compute fails the gate rather than passing unchecked.
 */
export function gateLanguage(
  tokens: LanguageTokens,
):
  | { readonly ok: true; readonly language: GateLanguage }
  | { readonly ok: false; readonly problems: readonly string[] } {
  const problems: string[] = [];
  const surfaceOpacity = opacity(tokens['surface-opacity']);
  if (surfaceOpacity === null) {
    problems.push(
      'surface-opacity must be a number from 0 to 1 or a percentage, such as 0.72 or 100%, for the gate to composite surfaces.',
    );
  }
  const focusWidth = pixels(tokens['focus-width']);
  if (focusWidth === null) {
    problems.push(
      'focus-width must be a length in px, rem, or em, such as 2px, for the gate to measure.',
    );
  }
  let borderControl: ColorRole | null = null;
  const border = tokens['border-control'];
  const references = colorReferences(border);
  if (/color-mix\(/.test(border) || references.length > 1) {
    problems.push(
      'border-control must draw in one var(--color-<role>), with no color-mix(), for the gate to check its contrast.',
    );
  } else if (references.length === 1) {
    borderControl = references[0]!;
  } else if (!drawsNoBorder(border)) {
    // With no color, a border draws in the control's text color.
    borderControl = 'text-primary';
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    language: {
      surfaceOpacity: surfaceOpacity!,
      textured: tokens.texture !== 'none',
      borderControl,
      focusWidth: focusWidth!,
      signature: colorReferences(tokens['signature-fill']),
    },
  };
}

/** WCAG 2 large text: at least 18pt, or 14pt and bold. Sizes are rem at the 16px default. */
export function isLargeText(role: TypeRole): boolean {
  const points = Number.parseFloat(role['font-size']) * 16 * 0.75;
  return points >= 18 || (points >= 14 && role['font-weight'] >= 700);
}

export function gateTypography(roles: TypographyRoles): GateTypography {
  return { largeSignature: isLargeText(roles.display) && isLargeText(roles.headline) };
}

/** A ratio rounded down to two places, so a reported 4.50 always passes 4.5. */
const floor2 = (value: number) => Math.floor(value * 100) / 100;
/** A target raised for texture, at three places. */
const raised = (target: number, by: number) => Math.round(target * by * 1000) / 1000;

interface Ground {
  readonly role: ColorRole;
  /** The ground as each backdrop shows it, or the opaque ground alone. */
  readonly views: readonly { readonly backdrop?: string; readonly color: string }[];
}

/** The canvas, then each surface composited over the canvas, black, and white. */
function grounds(set: ColorTokens, alpha: number): Ground[] {
  return GROUND_ROLES.map((role) => {
    if (role === 'canvas' || alpha >= 1) return { role, views: [{ color: set[role] }] };
    const backdrops = [...new Set([set.canvas, BLACK, WHITE])];
    return {
      role,
      views: backdrops.map((backdrop) => ({
        backdrop: backdrop === set.canvas ? 'canvas' : backdrop,
        color: composite(set[role], backdrop, alpha),
      })),
    };
  });
}

/** The worst ratio of any of `colors` on any view of `ground`, and the backdrop it's on. */
function worstOn(colors: readonly string[], ground: Ground): { ratio: number; backdrop?: string } {
  let worst: { ratio: number; backdrop?: string } = { ratio: Infinity };
  for (const view of ground.views) {
    for (const color of colors) {
      const ratio = contrast(color, view.color);
      if (ratio < worst.ratio) {
        worst = view.backdrop === undefined ? { ratio } : { ratio, backdrop: view.backdrop };
      }
    }
  }
  return worst;
}

/** The colors a fill passes through: each role, and every tenth of the way between neighbors. */
function fillColors(set: ColorTokens, roles: readonly ColorRole[]): string[] {
  if (roles.length < 2) return roles.map((role) => set[role]);
  const colors: string[] = [];
  for (let index = 0; index + 1 < roles.length; index += 1) {
    for (let step = 0; step <= 10; step += 1) {
      colors.push(mix(set[roles[index]!], set[roles[index + 1]!], step * 10));
    }
  }
  return colors;
}

/**
 * Every pair one color set must pass with `language` and `typography`, in a
 * fixed order: text on grounds, fills, the signature fill, non-text, and the
 * focus ring's width.
 */
export function gateSet(
  set: ColorTokens,
  name: ColorSetName,
  language: GateLanguage,
  typography: GateTypography,
): GatePair[] {
  const highContrast = isHighContrastSet(name);
  const raise = language.textured ? GATE_TARGETS.textureRaise : 1;
  const text = highContrast ? GATE_TARGETS.highContrastText : GATE_TARGETS.text;
  const nonText = highContrast ? GATE_TARGETS.highContrastNonText : GATE_TARGETS.nonText;
  const ground = grounds(set, language.surfaceOpacity);
  const pairs: GatePair[] = [];
  const add = (
    kind: GatePair['kind'],
    foreground: string,
    on: string,
    result: { ratio: number; backdrop?: string },
    target: number,
  ) => {
    pairs.push({
      set: name,
      kind,
      foreground,
      ground: on,
      ...(result.backdrop !== undefined ? { backdrop: result.backdrop } : {}),
      ratio: floor2(result.ratio),
      target,
      passes: result.ratio >= target,
    });
  };

  for (const role of TEXT_ROLES) {
    for (const g of ground) add('text', role, g.role, worstOn([set[role]], g), raised(text, raise));
  }
  for (const [on, fills] of FILL_PAIRS) {
    for (const fill of fills) {
      add('text', on, fill, { ratio: contrast(set[on], set[fill]) }, text);
    }
  }
  // High contrast paints the signature fill solid text-primary (the platform stylesheet).
  const signature = highContrast ? (['text-primary'] as const) : language.signature;
  if (signature.length > 0) {
    const large = typography.largeSignature;
    const target = large
      ? highContrast
        ? GATE_TARGETS.highContrastLargeText
        : GATE_TARGETS.largeText
      : text;
    const colors = fillColors(set, signature);
    for (const g of ground) {
      add(
        large ? 'large-text' : 'text',
        signature.join(' to '),
        g.role,
        worstOn(colors, g),
        raised(target, raise),
      );
    }
  }
  const outlines: ColorRole[] = ['focus'];
  if (language.borderControl && language.borderControl !== 'focus')
    outlines.push(language.borderControl);
  for (const role of outlines) {
    for (const g of ground)
      add('non-text', role, g.role, worstOn([set[role]], g), raised(nonText, raise));
  }
  const surface = ground.find((g) => g.role === 'surface-default')!;
  for (const role of CATEGORICAL_ROLES) {
    add('non-text', role, 'surface-default', worstOn([set[role]], surface), raised(nonText, raise));
  }
  pairs.push({
    set: name,
    kind: 'focus-width',
    foreground: 'focus-width',
    ground: '',
    ratio: floor2(language.focusWidth),
    target: GATE_TARGETS.focusWidth,
    passes: language.focusWidth >= GATE_TARGETS.focusWidth,
  });
  return pairs;
}

/** A scheme's sets gated on their own: what a generator reports with what it generates. */
export interface ContrastReport {
  readonly passes: boolean;
  readonly pairs: readonly GatePair[];
}

/**
 * The pairs of each named set with the neutral language and the strictest
 * typography, so a generated scheme reports how it does before any
 * language or profile is chosen.
 */
export function contrastReport(
  sets: { readonly [N in ColorSetName]?: ColorTokens },
  language: GateLanguage = NEUTRAL_LANGUAGE,
  typography: GateTypography = SMALL_SIGNATURE,
): ContrastReport {
  const pairs = (Object.keys(sets) as ColorSetName[])
    .sort()
    .flatMap((name) => gateSet(sets[name]!, name, language, typography));
  return { passes: pairs.every((pair) => pair.passes), pairs };
}
