// The computed contrast gate (#19, Slice 2, items 2 and 8): the pairs one
// color set must pass, painted by one design language and set in one
// typography profile, at the targets #11 holds them to. It is pure and
// browser-safe, so `pnpm check:appearance`, a generator's contrast report,
// and Studio's token inspector compute the same numbers.
//
// Text pairs need 4.5:1, and 7:1 in a high-contrast set. Non-text pairs need
// 3:1, and 4.5:1 in a high-contrast set; focus-inverse on text-primary needs
// its own FOCUS_INVERSE_TARGETS, 3.5:1, where that's higher. The signature fill on display and
// headline text needs 3:1 (4.5:1) only when both are WCAG large text. A
// surface composites at the language's surface-opacity over the worst of
// canvas, black, and white. A texture is washes and marks (textureLayers()).
// A wash, a role laid translucent across a surface, from an edge, or in a
// band, tints the ground under the text itself, so the gate composites each
// wash over each surface (never the canvas, and not in a high-contrast set,
// which drops the texture) and holds every pair there to its target
// (LANG-5c round 2, lead A's ruling: at 8%, Material 3's accent tint passed
// the old 10% raise with 71 text pairs under 4.5:1). A mark, a dot, rule,
// stripe, hatch, or corner shape, covers too little to composite, so a
// language with any mark raises every target on canvas and surfaces by 10%,
// a budget for it; pairs on fills (on-accent, on-status, on-scrim) keep
// theirs. A texture with both gets both.
//
// A shadow key (B, 2026-11-02, the lead's ruling after CI run 41510373684):
// a raised object's or a card's shadow falls on the ground beside it, where
// a caption sits, so the gate reads the key layer of shadow-raised and
// shadow-card (shadowKey()), composites --color-shadow at SHADOW_KEY_PEAK of
// its alpha over the canvas and each surface, and holds text-secondary there,
// at the label role's size, to 4.5:1 in every set. A failure names the key
// layer and is the language's, unless the bare pair fails too.
//
// A flush focus ring (LANG-5c, lead A's ruling): with --ui-focus-offset 0 or
// less, the ring touches the part it rings, or sits inside it, so on a filled
// part the ring reads against that fill, not the ground around it. Then focus
// on each fill a focusable primitive paints (FOCUS_FILLS: the primary
// Action, the skip link, a selected chip's edge, a checked box, the
// secondary and quiet Actions, Field and Select, the selected Tab) needs the
// non-text target, 3:1 (4.5:1 in a high-contrast set). A ring offset outward
// isn't skipped: the ground shows between it and the fill, so what it reads
// against is the ground, which the focus-on-ground pairs already hold there.
//
// The targets are #11's, in quality/thresholds.json (#11, AC5). `pnpm
// check:appearance` reads them from that file and passes them in. A browser
// can't read the file, so GATE_TARGETS is the default every other caller
// gets, and apps/web/scripts/appearance-targets.test.ts fails when it drifts
// from the file.

import { BLACK, composite, contrast, luminance, mix, WHITE } from './color';
import { FOCUS_INVERSE_TARGETS } from './derived-roles';
import { isHighContrastSet, type ColorSetName } from './sets';
import {
  COLOR_ROLES,
  type ColorRole,
  type ColorTokens,
  type LanguageTokens,
  type TypeRole,
  type TypographyRoles,
} from './roles';

/** The limits the gate holds a set to. */
export interface GateTargets {
  readonly text: number;
  readonly largeText: number;
  readonly nonText: number;
  readonly highContrastText: number;
  readonly highContrastLargeText: number;
  readonly highContrastNonText: number;
  /** A textured language multiplies the targets on canvas and surfaces by this. */
  readonly textureRaise: number;
  /** The narrowest focus ring, in CSS px. */
  readonly focusWidth: number;
  /** WCAG large text: at least this many points... */
  readonly largeTextPt: number;
  /** ...or at least this many at largeBoldWeight or heavier. */
  readonly largeBoldTextPt: number;
  readonly largeBoldWeight: number;
}

/** quality/thresholds.json's targets, for callers that can't read it. */
export const GATE_TARGETS: GateTargets = Object.freeze({
  text: 4.5,
  largeText: 3,
  nonText: 3,
  highContrastText: 7,
  highContrastLargeText: 4.5,
  highContrastNonText: 4.5,
  textureRaise: 1.1,
  focusWidth: 2,
  largeTextPt: 18,
  largeBoldTextPt: 14,
  largeBoldWeight: 700,
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

/**
 * The fills a focusable primitive paints at its edge, where a flush focus
 * ring (an offset of 0 or less) touches them: accent, the primary Action and
 * the skip link at rest, a selected chip's border, a checked box; its hover
 * and active states; surface-default, a secondary Action; surface-subtle,
 * Field, Select, and a hovered quiet Action; surface-prominent, the selected
 * Tab and a hovered secondary Action. Each is painted opaque.
 */
export const FOCUS_FILLS = [
  'accent',
  'accent-hover',
  'accent-active',
  'surface-default',
  'surface-subtle',
  'surface-prominent',
] as const satisfies readonly ColorRole[];

/** Fills and the text color that sits on each. */
export const FILL_PAIRS: readonly (readonly [ColorRole, readonly ColorRole[]])[] = [
  ['on-accent', ['accent', 'accent-hover', 'accent-active']],
  ['on-status', ['positive', 'warning', 'danger', 'information']],
  ['on-scrim', ['scrim']],
  // K-2: text on an emphasis fill, which gates emphasis as a fill, a tightening.
  ['on-emphasis', ['emphasis']],
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
  /** --ui-texture draws a mark (textureLayers()): its targets on canvas and surfaces rise 10%. */
  readonly textured: boolean;
  /** The washes --ui-texture lays over a surface, each composited over every surface the gate reads. */
  readonly washes?: readonly TextureWash[];
  /** The color --ui-border-control draws in, or null when controls draw no border. */
  readonly borderControl: ColorRole | null;
  /** --ui-focus-width, in CSS px. */
  readonly focusWidth: number;
  /**
   * --ui-focus-offset, in CSS px, negative inward. At 0 or less the ring
   * touches the part's fill, so the gate holds it to FOCUS_FILLS too.
   */
  readonly focusOffset: number;
  /** The color roles --ui-signature-fill paints, in order. */
  readonly signature: readonly ColorRole[];
  /** The key layers --ui-shadow-raised and --ui-shadow-card cast beside their object (shadowKey()). */
  readonly shadowKeys?: readonly ShadowKey[];
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
  focusOffset: 2,
  signature: Object.freeze(['signature-start', 'signature-end'] as const),
});

/** The strictest reading: signature text isn't large. */
export const SMALL_SIGNATURE: GateTypography = Object.freeze({ largeSignature: false });

export interface GatePair {
  readonly set: ColorSetName;
  readonly kind:
    'text' | 'large-text' | 'non-text' | 'focus-width' | 'surface-lit' | 'focus-inside';
  /**
   * The role, or roles of a fill such as `signature-start to signature-end`, or `focus-width`.
   * A `surface-lit` pair is the lit surface's order (K-2): lighter than surface-prominent in a
   * base set, and the canvas itself in a high-contrast one, its ratio their luminance ratio,
   * lit over its ground, against a target of 1.
   */
  readonly foreground: string;
  /** The role it sits on. Empty for focus-width. */
  readonly ground: string;
  /** For a translucent surface, the backdrop it reads worst over. */
  readonly backdrop?: string;
  /** For a surface under a texture wash, the wash it reads worst under, such as `the 4% accent wash`. */
  readonly wash?: string;
  /** For a ground beside a raised object, the key layer darkening it, such as `the shadow-raised key layer at 14%`. */
  readonly shadow?: string;
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

/** A length in CSS px: px, or rem and em at the 16px default; `signed` reads a leading minus too. */
function pixels(value: string, signed = false): number | null {
  if (value === '0' || (signed && value === '-0')) return 0;
  const match = (
    signed ? /^(-?)(\d+(?:\.\d+)?|\.\d+)(px|rem|em)$/ : /^()(\d+(?:\.\d+)?|\.\d+)(px|rem|em)$/
  ).exec(value);
  if (!match) return null;
  const amount = Number.parseFloat(match[2]!) * (match[1] === '-' ? -1 : 1);
  return match[3] === 'px' ? amount : amount * 16;
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

/** A texture wash: a role laid over a surface at `percent`, flat or from an edge, under the text. */
export interface TextureWash {
  readonly role: ColorRole;
  /** From 0 to 100. */
  readonly percent: number;
}

/**
 * A mark's reach: a role stop whose band ends within this many CSS px of
 * the layer's start paints a dot, a line, or a corner shape. The shipping
 * marks reach 20px at most (bauhaus-geometric's corner; memphis' circles
 * 18px), so 24px leaves room, and it's still shorter than a line of body
 * text, which a wash lies under.
 */
export const MARK_MAX_PX = 24;

/** `value` split on its top-level `separator`s, outside parentheses. */
function topLevel(value: string, separator: ',' | ' '): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter((part) => part !== '');
}

/** A texture as the gate reads it: lower case, single spaces, none inside a parenthesis's edges or before a comma. */
function normalTexture(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')')
    .replace(/ ?, ?/g, ', ');
}

const PERCENT = /^(\d+(?:\.\d+)?)%$/;
const ROLE_REFERENCE = /^var\(--color-([a-z0-9-]+)\)$/;

/**
 * What a stop's color lays down: the role and the share of it, 0 to 100, or
 * null when the gate can't read it. transparent lays nothing; a bare role
 * lays all of it; color-mix() of a role and transparent, in any color space,
 * lays the role's share, the percentages read as CSS reads them (one
 * missing is the other's complement, both missing are 50/50, and a sum over
 * 100 scales down).
 */
function stopColor(color: string): { role: ColorRole | null; percent: number } | null {
  if (color === 'transparent') return { role: null, percent: 0 };
  const bare = ROLE_REFERENCE.exec(color);
  if (bare) return ROLES.has(bare[1]!) ? { role: bare[1] as ColorRole, percent: 100 } : null;
  const mixed = /^color-mix\((.*)\)$/.exec(color);
  if (!mixed) return null;
  const [space, ...sides] = topLevel(mixed[1]!, ',');
  if (!space?.startsWith('in ') || sides.length !== 2) return null;
  const read: { color: string; percent: number | null }[] = [];
  for (const side of sides) {
    const [first, second, ...rest] = topLevel(side, ' ');
    const percent = second === undefined ? null : PERCENT.exec(second);
    if (first === undefined || rest.length > 0 || (second !== undefined && !percent)) return null;
    read.push({ color: first, percent: percent ? Number(percent[1]) : null });
  }
  const mine = read.find((side) => ROLE_REFERENCE.test(side.color));
  const clear = read.find((side) => side.color === 'transparent');
  if (!mine || !clear) return null;
  const role = ROLE_REFERENCE.exec(mine.color)![1]!;
  if (!ROLES.has(role)) return null;
  const share = mine.percent ?? (clear.percent === null ? 50 : 100 - clear.percent);
  const rest = clear.percent ?? 100 - share;
  if (share < 0 || rest < 0 || share + rest === 0) return null;
  return { role: role as ColorRole, percent: (share * 100) / Math.max(100, share + rest) };
}

/** A stop position in CSS px, or null when it isn't px, rem, or a bare 0: a percentage scales with the surface. */
function stopPx(length: string): number | null {
  if (length === '0') return 0;
  const match = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(length);
  if (!match) return null;
  return Number(match[1]) * (match[2] === 'rem' ? 16 : 1);
}

/**
 * A texture's layers, read as washes and marks (LANG-5c round 2, lead A's
 * ruling), failing closed. A mark is a `repeating-*` gradient, or one where
 * every stop that lays a role ends its band, at its own position or the next
 * stop's, in px or rem within MARK_MAX_PX: a grain dot, a 1px grid line, a
 * corner shape. It covers too little to composite. Every other layer is a
 * wash, in any direction, shape, or color space: a role laid across a
 * surface (Material 3's tonal tint), from an edge (Fluent's acrylic sheen),
 * in a band (an iridescent sweep), or as a radial vignette. Each role it
 * lays is a wash at its strongest stop. A layer the gate can't read is a
 * problem, so it never passes as a mark.
 */
export function textureLayers(texture: string): {
  readonly washes: readonly TextureWash[];
  readonly marks: number;
  readonly problems: readonly string[];
} {
  const value = normalTexture(texture);
  if (value === 'none') return { washes: [], marks: 0, problems: [] };
  const strongest = new Map<ColorRole, number>();
  const problems: string[] = [];
  let marks = 0;
  topLevel(value, ',').forEach((layer, index) => {
    const unreadable = (why: string) => {
      problems.push(
        `texture layer ${index + 1} (${layer}) ${why}, so the gate can't tell a wash from a mark: write each stop as transparent, var(--color-<role>), or color-mix(in <space>, var(--color-<role>) P%, transparent), at px or rem positions.`,
      );
    };
    const call = /^((?:repeating-)?(?:linear|radial|conic)-gradient)\((.*)\)$/.exec(layer);
    if (!call) return unreadable('is no gradient the gate reads');
    const stops: { role: ColorRole | null; percent: number; at: string[] }[] = [];
    for (const [position, arg] of topLevel(call[2]!, ',').entries()) {
      const [color, ...at] = topLevel(arg, ' ');
      const read = color === undefined ? null : stopColor(color);
      if (read) stops.push({ ...read, at });
      // The first argument may set the direction or the shape instead.
      else if (position > 0) return unreadable(`has a stop the gate can't read, ${arg}`);
    }
    if (stops.length < 2) return unreadable('has under two stops the gate can read');
    const laid = stops.filter(({ percent }) => percent > 0);
    const bounded = laid.every((stop) => {
      const next = stops[stops.indexOf(stop) + 1];
      if (next === undefined || stop.at.length === 0) return false;
      const ends = [...stop.at, ...next.at.slice(0, 1)].map(stopPx);
      return ends.every((end) => end !== null && end <= MARK_MAX_PX);
    });
    if (call[1]!.startsWith('repeating-') || bounded) {
      marks += 1;
      return;
    }
    for (const { role, percent } of laid) {
      strongest.set(role!, Math.max(strongest.get(role!) ?? 0, percent));
    }
  });
  return {
    washes: [...strongest].map(([role, percent]) => ({ role, percent })),
    marks,
    problems,
  };
}

/** The shadows whose key layer falls on the ground beside their object, where a caption sits. */
export const SHADOW_KEY_TOKENS = ['shadow-raised', 'shadow-card'] as const;
export type ShadowToken = (typeof SHADOW_KEY_TOKENS)[number];

/**
 * The share of a key layer's alpha the gate lays at its darkest point
 * beside its object (B, 2026-11-02, after CI run 41510373684's OA x
 * fluent-2-inspired captions). A box-shadow's blur is a Gaussian whose
 * sigma is half the blur length, so at the edge of the shadow's own box,
 * its offset plus its spread past the object's edge, it lays half its
 * alpha, Phi(0), whatever its blur. Content beside a raised object starts
 * there: shadow64's box ends 32px below its object, where OA's captions
 * sit, and C's probe read the darkest ground pixel there with the glyphs
 * hidden at 18% black, half the 36% key, 4.00:1 on warm-parchment's
 * surface-prominent, which this model gives to the hundredth. Nearer the
 * object the layer is darker, up to Phi((offset + spread) / sigma), 0.84
 * for every Fluent level: text inside a shadow's box reads darker than this.
 */
export const SHADOW_KEY_PEAK = 0.5;

/**
 * A shadow's key layer as the gate reads it: its alpha, the share of its
 * color's role, which the gate lays in --color-shadow, as the lead ruled
 * (the darkening a key layer casts, whatever role it's written in).
 */
export interface ShadowKey {
  /** The tokens that cast it: one key both cast is read once. */
  readonly tokens: readonly ShadowToken[];
  /** From 0 to 100. */
  readonly percent: number;
}

/**
 * A shadow's key layer, failing closed: of its outer layers with a blur,
 * the one that reaches furthest below its object, where a caption sits
 * (its y offset, plus its spread and its blur), the stronger on a tie.
 * Fluent's ambient layer, `0 0 8px`, reaches 8px; its key, `0 32px 64px`,
 * 96px; neumorphic's light upper-left layer, `-8px -8px 16px`, 8px, under
 * its dark lower-right one's 24px. An inset layer
 * paints inside the object, and a layer with no blur is an edge (a ring,
 * a hard offset block) that ends within its offset, so neither casts
 * onto the ground beside it. Null when no layer does. A layer whose
 * lengths or color the gate can't read is a problem, never a pass.
 */
export function shadowKey(
  token: ShadowToken,
  value: string,
): { readonly key: Omit<ShadowKey, 'tokens'> | null; readonly problems: readonly string[] } {
  const shadow = normalTexture(value);
  if (shadow === 'none') return { key: null, problems: [] };
  const problems: string[] = [];
  let key: { percent: number; reach: number } | null = null;
  topLevel(shadow, ',').forEach((layer, index) => {
    const words = topLevel(layer, ' ');
    if (words.includes('inset')) return;
    const lengths: number[] = [];
    const colors: string[] = [];
    for (const word of words) {
      const length = pixels(word, true);
      if (length === null) colors.push(word);
      else lengths.push(length);
    }
    const color = colors.length === 1 ? stopColor(colors[0]!) : null;
    if (lengths.length < 2 || lengths.length > 4 || !color) {
      problems.push(
        `${token} layer ${index + 1} (${layer}) isn't a shadow the gate reads: write it as two to four px, rem, or em lengths and one color, var(--color-<role>) or color-mix(in <space>, var(--color-<role>) P%, transparent).`,
      );
      return;
    }
    const [, y = 0, blur = 0, spread = 0] = lengths;
    if (blur <= 0 || color.role === null || color.percent === 0) return;
    const reach = y + spread + blur;
    if (!key || reach > key.reach || (reach === key.reach && color.percent > key.percent)) {
      key = { percent: color.percent, reach };
    }
  });
  if (problems.length > 0) return { key: null, problems };
  const found = key as { percent: number } | null;
  return { key: found && { percent: found.percent }, problems };
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
  const focusOffset = pixels(tokens['focus-offset'], true);
  if (focusOffset === null) {
    problems.push(
      'focus-offset must be a length in px, rem, or em, such as 2px, for the gate to place the focus ring.',
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
  const texture = textureLayers(tokens.texture);
  problems.push(...texture.problems);
  const shadowKeys: { tokens: ShadowToken[]; percent: number }[] = [];
  for (const token of SHADOW_KEY_TOKENS) {
    const read = shadowKey(token, tokens[token]);
    problems.push(...read.problems);
    if (!read.key) continue;
    const same = shadowKeys.find(({ percent }) => percent === read.key!.percent);
    if (same) same.tokens.push(token);
    else shadowKeys.push({ tokens: [token], ...read.key });
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    language: {
      surfaceOpacity: surfaceOpacity!,
      textured: texture.marks > 0,
      washes: texture.washes,
      borderControl,
      focusWidth: focusWidth!,
      focusOffset: focusOffset!,
      signature: colorReferences(tokens['signature-fill']),
      shadowKeys,
    },
  };
}

/** WCAG 2 large text: at least 18pt, or 14pt and bold. Sizes are rem at the 16px default. */
export function isLargeText(role: TypeRole, targets: GateTargets = GATE_TARGETS): boolean {
  const points = Number.parseFloat(role['font-size']) * 16 * 0.75;
  return (
    points >= targets.largeTextPt ||
    (points >= targets.largeBoldTextPt && role['font-weight'] >= targets.largeBoldWeight)
  );
}

export function gateTypography(
  roles: TypographyRoles,
  targets: GateTargets = GATE_TARGETS,
): GateTypography {
  return {
    largeSignature: isLargeText(roles.display, targets) && isLargeText(roles.headline, targets),
  };
}

/** A ratio rounded down to two places, so a reported 4.50 always passes 4.5. */
const floor2 = (value: number) => Math.floor(value * 100) / 100;
/** A target raised for texture, at three places. */
const raised = (target: number, by: number) => Math.round(target * by * 1000) / 1000;

interface View {
  readonly backdrop?: string;
  readonly wash?: string;
  readonly color: string;
}

interface Ground {
  readonly role: ColorRole;
  /** The ground as each backdrop shows it, or the opaque ground alone, bare and under each wash. */
  readonly views: readonly View[];
}

/**
 * The canvas, then each surface composited over the canvas, black, and
 * white, and each of those again under each wash, which paints over a
 * surface and never the canvas. A wash that starts at the top edge leaves
 * the surface bare below, so the bare views stay.
 */
function grounds(set: ColorTokens, alpha: number, washes: readonly TextureWash[] = []): Ground[] {
  return GROUND_ROLES.map((role) => {
    if (role === 'canvas') return { role, views: [{ color: set[role] }] };
    const bare: View[] =
      alpha >= 1
        ? [{ color: set[role] }]
        : [...new Set([set.canvas, BLACK, WHITE])].map((backdrop) => ({
            backdrop: backdrop === set.canvas ? 'canvas' : backdrop,
            color: composite(set[role], backdrop, alpha),
          }));
    const washed = washes.flatMap(({ role: wash, percent }) =>
      bare.map((view) => ({
        ...view,
        wash: `the ${Math.round(percent * 100) / 100}% ${wash} wash`,
        color: composite(set[wash], view.color, percent / 100),
      })),
    );
    return { role, views: [...bare, ...washed] };
  });
}

/** What a pair reads: its ratio, and the backdrop and wash of the view it reads worst on. */
interface Reading {
  readonly ratio: number;
  readonly backdrop?: string;
  readonly wash?: string;
  readonly shadow?: string;
}

/** The worst ratio of any of `colors` on any view of `ground`, with the backdrop and wash it's under. */
function worstOn(colors: readonly string[], ground: Ground): Reading {
  let worst: Reading = { ratio: Infinity };
  for (const view of ground.views) {
    for (const color of colors) {
      const ratio = contrast(color, view.color);
      if (ratio < worst.ratio) {
        worst = {
          ratio,
          ...(view.backdrop === undefined ? {} : { backdrop: view.backdrop }),
          ...(view.wash === undefined ? {} : { wash: view.wash }),
        };
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
 * fixed order: text on grounds, text-secondary under each shadow key, fills, the signature fill, non-text, a
 * flush focus ring on each fill it touches, and the focus ring's width.
 */
export function gateSet(
  set: ColorTokens,
  name: ColorSetName,
  language: GateLanguage,
  typography: GateTypography,
  targets: GateTargets = GATE_TARGETS,
): GatePair[] {
  const highContrast = isHighContrastSet(name);
  const raise = language.textured ? targets.textureRaise : 1;
  const text = highContrast ? targets.highContrastText : targets.text;
  const nonText = highContrast ? targets.highContrastNonText : targets.nonText;
  // High contrast drops the texture (the platform's HIGH_CONTRAST), so a wash never paints over its sets.
  const ground = grounds(set, language.surfaceOpacity, highContrast ? [] : language.washes);
  const pairs: GatePair[] = [];
  const add = (
    kind: GatePair['kind'],
    foreground: string,
    on: string,
    result: Reading,
    target: number,
  ) => {
    pairs.push({
      set: name,
      kind,
      foreground,
      ground: on,
      ...(result.backdrop !== undefined ? { backdrop: result.backdrop } : {}),
      ...(result.wash !== undefined ? { wash: result.wash } : {}),
      ...(result.shadow !== undefined ? { shadow: result.shadow } : {}),
      ratio: floor2(result.ratio),
      target,
      passes: result.ratio >= target,
    });
  };

  for (const role of TEXT_ROLES) {
    for (const g of ground) add('text', role, g.role, worstOn([set[role]], g), raised(text, raise));
  }
  // The shadow key (B, 2026-11-02): a caption, text-secondary at the label
  // role's size, on the ground beside a raised object or a card, darkened by
  // its key layer at SHADOW_KEY_PEAK of its alpha, keeps 4.5:1 in every set.
  for (const key of language.shadowKeys ?? []) {
    const shadow = `the ${key.tokens.join(' and ')} key layer at ${Math.round(key.percent * 100) / 100}%`;
    for (const g of ground) {
      const shaded: Ground = {
        role: g.role,
        views: g.views.map((view) => ({
          ...view,
          color: composite(set.shadow, view.color, (key.percent / 100) * SHADOW_KEY_PEAK),
        })),
      };
      add(
        'text',
        'text-secondary',
        g.role,
        { ...worstOn([set['text-secondary']], shaded), shadow },
        targets.text,
      );
    }
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
        ? targets.highContrastLargeText
        : targets.largeText
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
  // A flush ring touches the part's fill (LANG-5c): focus on each fill a focusable primitive paints.
  if (language.focusOffset <= 0) {
    for (const fill of FOCUS_FILLS) {
      add('focus-inside', 'focus', fill, { ratio: contrast(set.focus, set[fill]) }, nonText);
    }
  }
  // K-2: text-primary on the lit surface at the textured text target,
  // whatever the language, and the inverse focus ring on an inverse ground, text-primary.
  add(
    'text',
    'text-primary',
    'surface-lit',
    { ratio: contrast(set['text-primary'], set['surface-lit']) },
    raised(text, targets.textureRaise),
  );
  add(
    'non-text',
    'focus-inverse',
    'text-primary',
    { ratio: contrast(set['focus-inverse'], set['text-primary']) },
    Math.max(
      nonText,
      highContrast ? FOCUS_INVERSE_TARGETS.highContrast : FOCUS_INVERSE_TARGETS.base,
    ),
  );
  // The lit surface is lit: lighter than surface-prominent, and in high contrast the canvas.
  const litGround = highContrast ? 'canvas' : 'surface-prominent';
  const lit = luminance(set['surface-lit']);
  const below = luminance(set[litGround]);
  pairs.push({
    set: name,
    kind: 'surface-lit',
    foreground: 'surface-lit',
    ground: litGround,
    ratio: floor2((lit + 0.05) / (below + 0.05)),
    target: 1,
    passes: highContrast ? set['surface-lit'] === set.canvas : lit > below,
  });
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
    target: targets.focusWidth,
    passes: language.focusWidth >= targets.focusWidth,
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
  targets: GateTargets = GATE_TARGETS,
): ContrastReport {
  const pairs = (Object.keys(sets) as ColorSetName[])
    .sort()
    .flatMap((name) => gateSet(sets[name]!, name, language, typography, targets));
  return { passes: pairs.every((pair) => pair.passes), pairs };
}
