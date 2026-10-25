// What each design-language token may hold (#19, Slice 2). On top of the
// value rules every token follows (values.ts), each key has a grammar of its
// own, the shapes the reviewed prototype's recipes use, so no token can
// carry a layout or visibility keyword: a motion recipe is one of the
// platform's names, never `fixed` or `hidden`; a texture is gradients; a
// state transform only nudges, and a state opacity only dims. A border,
// shadow, size, or offset is px or rem within 64px or 4rem, and a
// radius within 999px.

import { GATE_TARGETS } from './gate';
import { languageValueProblem } from './values';
import type { LanguageKey } from './tokens';

const NUMBER = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
const SIGNED = `-?${NUMBER}`;
/** A length in px or rem, or 0, never negative. Never em, which the typography profile's font size scales. */
const LENGTH = `(?:0|${NUMBER}(?:px|rem))`;
const SIGNED_LENGTH = `(?:0|${SIGNED}(?:px|rem))`;

/**
 * The longest length a language gives a border, shadow, outline, padding,
 * gap, blur, or control: 64px, or 4rem at 16px to the rem. The
 * prototype's longest is its high shadow's 60px blur, so every one of its
 * languages fits, and no outline, shadow, or padding can cover the page or
 * push content off it.
 */
export const MAX_LENGTH_PX = 64;
/** A radius's cap, the prototype's pill radius. A radius can't cover or move anything. */
export const MAX_RADIUS_PX = 999;
/** The least --ui-surface-opacity: a surface stays at least half opaque. */
const MIN_SURFACE_OPACITY = 0.5;
/** The thinnest focus ring, in px: the gate's own target, so registry generation refuses what the gate would. */
const MIN_FOCUS_WIDTH_PX = GATE_TARGETS.focusWidth;

/** Whether every px or rem length in `value` is within `px` either way. */
const within = (px: number) => (value: string) =>
  [...value.matchAll(/(-?(?:\d+(?:\.\d+)?|\.\d+))(px|rem)(?![a-z])/g)].every(
    ([, number, unit]) => Math.abs(Number.parseFloat(number!)) <= (unit === 'px' ? px : px / 16),
  );
const COLOR_REFERENCE = String.raw`var\(--color-[a-z0-9-]+\)`;
const MIXED = String.raw`color-mix\(in (?:srgb|srgb-linear|oklab|oklch), ${COLOR_REFERENCE}(?: ${NUMBER}%)?, (?:transparent|${COLOR_REFERENCE})(?: ${NUMBER}%)?\)`;
const COLOR = `(?:${COLOR_REFERENCE}|${MIXED}|transparent|currentcolor)`;
const LINE_STYLE = '(?:none|solid|dashed|dotted|double|groove|ridge|inset|outset)';

const whole = (pattern: string) => new RegExp(`^(?:${pattern})$`);

/**
 * The value, lowercased, its runs of spaces one space, no space inside
 * parentheses, and ", " between arguments, so a grammar reads one spelling.
 */
function normal(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')')
    .replace(/ ?, ?/g, ', ');
}

/** `value` split on its top-level commas. */
function topLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

/** Whether `item` is exactly one call of one of `names`: the name, its arguments, and nothing after. */
function isCall(item: string, names: RegExp): boolean {
  const open = item.indexOf('(');
  if (open < 0 || !names.test(item.slice(0, open)) || !item.endsWith(')')) return false;
  let depth = 0;
  for (let index = open; index < item.length; index += 1) {
    if (item[index] === '(') depth += 1;
    else if (item[index] === ')') {
      depth -= 1;
      if (depth === 0) return index === item.length - 1;
    }
  }
  return false;
}

const GRADIENT = /^(?:repeating-)?(?:linear|radial|conic)-gradient$/;
const gradients = (value: string) => topLevel(value).every((item) => isCall(item, GRADIENT));

const SHADOW = [
  `(?:inset )?${SIGNED_LENGTH} ${SIGNED_LENGTH}(?: ${LENGTH}(?: ${SIGNED_LENGTH})?)? ${COLOR}`,
  `${COLOR} ${SIGNED_LENGTH} ${SIGNED_LENGTH}(?: ${LENGTH}(?: ${SIGNED_LENGTH})?)?(?: inset)?`,
].join('|');
const shadows = (value: string) =>
  value === 'none' || topLevel(value).every((item) => whole(SHADOW).test(item));

const between = (value: string, low: number, high: number) => {
  const number = Number.parseFloat(value);
  const scaled = value.endsWith('%') ? number / 100 : number;
  return scaled >= low && scaled <= high;
};

/** A state transform's function and argument shapes, with how far each may go. */
const NUDGES: readonly [RegExp, (args: string[]) => boolean][] = [
  [
    new RegExp(`^translate(?:x|y)?\\((${SIGNED_LENGTH})(?:, (${SIGNED_LENGTH}))?\\)$`),
    // Lengths only, at most 8px or 0.5rem either way: a nudge, never a move off the page.
    (args) =>
      args.every(
        (arg) => Math.abs(Number.parseFloat(arg)) <= (arg.endsWith('px') || arg === '0' ? 8 : 0.5),
      ),
  ],
  [
    new RegExp(`^scale(?:x|y)?\\((${NUMBER})(?:, (${NUMBER}))?\\)$`),
    (args) => args.every((arg) => between(arg, 0.9, 1.1)),
  ],
  [
    new RegExp(`^rotate\\((${SIGNED})deg\\)$`),
    (args) => args.every((arg) => Math.abs(Number.parseFloat(arg)) <= 10),
  ],
];

function nudge(value: string): boolean {
  if (value === 'none') return true;
  const parts = value.match(/[a-z]+\([^()]*\)|\S+/g) ?? [];
  return (
    parts.length > 0 &&
    parts.length <= 3 &&
    parts.every((part) =>
      NUDGES.some(([shape, fits]) => {
        const match = shape.exec(part);
        return match !== null && fits(match.slice(1).filter((arg) => arg !== undefined));
      }),
    )
  );
}

const EASING = whole(
  [
    'linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end',
    `cubic-bezier\\(${NUMBER}, ${SIGNED}, ${NUMBER}, ${SIGNED}\\)`,
    String.raw`steps\(\d{1,3}(?:, (?:start|end|jump-start|jump-end|jump-none|jump-both))?\)`,
    `linear\\(${SIGNED}(?: ${NUMBER}%){0,2}(?:, ${SIGNED}(?: ${NUMBER}%){0,2}){1,31}\\)`,
  ].join('|'),
);

const TIME = whole(`${NUMBER}(?:ms|s)`);
const duration = (value: string) =>
  TIME.test(value) &&
  (value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000) <= 2000;

/** The motion recipes the platform names, which the reviewed prototype's languages use. */
export const MOTION_RECIPES = Object.freeze({
  'motion-enter': ['none', 'fade', 'fade-rise', 'spring-in', 'slide-cut', 'pixel-in'],
  'motion-exit': ['none', 'fade', 'pixel-out'],
  'motion-emphasis': [
    'none',
    'pulse-once',
    'float-once',
    'bounce-once',
    'glitch-once',
    'blink-once',
  ],
} as const);

const oneOf = (words: readonly string[]) => (value: string) => words.includes(value);
const pattern = (expression: string) => (value: string) => whole(expression).test(value);
const list = (words: readonly string[]) =>
  words.length < 3 ? words.join(' or ') : `${words.slice(0, -1).join(', ')}, or ${words.at(-1)}`;

interface Grammar {
  readonly accepts: (value: string) => boolean;
  /** What it accepts, after "must be". */
  readonly expected: string;
}

const capped = (accepts: (value: string) => boolean, px = MAX_LENGTH_PX) => {
  const fits = within(px);
  return (value: string) => accepts(value) && fits(value);
};

const RADIUS: Grammar = {
  accepts: capped(
    pattern(`${LENGTH}(?: ${LENGTH}){0,3}(?: / ${LENGTH}(?: ${LENGTH}){0,3})?`),
    MAX_RADIUS_PX,
  ),
  expected:
    'one to four lengths in px or rem, none negative and none over 999px or 62.4375rem, such as 10px or 16px 24px',
};
const BORDER: Grammar = {
  accepts: capped(pattern(`none|(?:${LENGTH}|thin|medium|thick) ${LINE_STYLE}(?: ${COLOR})?`)),
  expected:
    'none, or a width of at most 64px or 4rem, a line style, and optionally a color, such as 1px solid var(--color-border-strong)',
};
const SHADOWS: Grammar = {
  accepts: capped(shadows),
  expected:
    'none, or shadows, each two to four lengths and a color, optionally inset, every length within 64px or 4rem, such as 0 2px 8px color-mix(in srgb, var(--color-text-primary) 12%, transparent)',
};
const SIZE: Grammar = {
  accepts: capped(pattern(LENGTH)),
  expected: 'a length in px or rem, not negative and at most 64px or 4rem, such as 1rem',
};
const FOCUS_WIDTH: Grammar = {
  accepts: (value) =>
    SIZE.accepts(value) &&
    Number.parseFloat(value) >=
      (value.endsWith('rem') ? MIN_FOCUS_WIDTH_PX / 16 : MIN_FOCUS_WIDTH_PX),
  expected:
    'a length in px or rem from 2px or 0.125rem to 64px or 4rem, such as 2px: a focus ring always draws',
};
const FOCUS_OFFSET: Grammar = {
  accepts: capped(pattern(SIGNED_LENGTH)),
  expected: 'a length in px or rem, within 64px or 4rem either way, such as 2px',
};
const STATE_OPACITY: Grammar = {
  accepts: (value) => pattern(`${NUMBER}%?`)(value) && between(value, 0.3, 1),
  expected:
    'a number from 0.3 to 1, or a percentage from 30% to 100%: a state dims a part, never hides it',
};
const NUDGE: Grammar = {
  accepts: nudge,
  expected:
    'none, or up to three of translate(), translateX(), translateY() within 8px or 0.5rem, scale() within 0.9 to 1.1, and rotate() within 10deg, such as translateY(-1px)',
};
const DURATION: Grammar = {
  accepts: duration,
  expected: 'a duration of at most 2s, such as 160ms',
};
const recipe = (key: keyof typeof MOTION_RECIPES): Grammar => ({
  accepts: oneOf(MOTION_RECIPES[key]),
  expected: `one of the platform's motion recipes: ${list(MOTION_RECIPES[key])}`,
});

/** Every key's grammar. */
export const LANGUAGE_GRAMMARS: Readonly<Record<LanguageKey, Grammar>> = {
  'surface-material': {
    accepts: gradients,
    expected:
      'one or more gradients, such as linear-gradient(var(--color-surface-default), var(--color-surface-default))',
  },
  // A percentage, since color-mix() reads it, and at least half opaque: the
  // prototype's most translucent surface is 66%.
  'surface-opacity': {
    accepts: (value) => pattern(`${NUMBER}%`)(value) && between(value, MIN_SURFACE_OPACITY, 1),
    expected:
      'a percentage from 50% to 100%, such as 72% or 100%: color-mix() reads it, and a surface stays at least half opaque',
  },
  'radius-control': RADIUS,
  'radius-card': RADIUS,
  'radius-overlay': RADIUS,
  'radius-media': RADIUS,
  'radius-badge': RADIUS,
  'border-control': BORDER,
  'border-card': BORDER,
  'border-divider': BORDER,
  'shadow-card': SHADOWS,
  'shadow-overlay': SHADOWS,
  'shadow-raised': SHADOWS,
  'shadow-inset': SHADOWS,
  'backdrop-blur': SIZE,
  'control-height': SIZE,
  'space-control-inline': SIZE,
  'space-control-block': SIZE,
  'space-surface-inline': SIZE,
  'space-surface-block': SIZE,
  'focus-width': FOCUS_WIDTH,
  'focus-offset': FOCUS_OFFSET,
  'focus-style': {
    accepts: oneOf([
      'auto',
      'solid',
      'dashed',
      'dotted',
      'double',
      'groove',
      'ridge',
      'inset',
      'outset',
    ]),
    expected:
      'an outline style that draws: auto, solid, dashed, dotted, double, groove, ridge, inset, or outset',
  },
  'state-hover-transform': NUDGE,
  'state-active-transform': NUDGE,
  'state-selected-emphasis': SIZE,
  'state-disabled-opacity': STATE_OPACITY,
  'state-loading-opacity': STATE_OPACITY,
  'state-validation-emphasis': SIZE,
  'icon-stroke-width': {
    accepts: (value) => pattern(NUMBER)(value) && between(value, 0.5, 4),
    expected: 'a number from 0.5 to 4, such as 1.75',
  },
  'icon-fill': {
    accepts: pattern(`none|currentcolor|${COLOR_REFERENCE}`),
    expected: 'none, currentColor, or var(--color-<role>)',
  },
  'motion-fast': DURATION,
  'motion-standard': DURATION,
  'motion-slow': DURATION,
  'motion-easing': {
    accepts: (value) => EASING.test(value),
    expected:
      'a timing function: a keyword such as ease-out, cubic-bezier(), steps(), or linear() with stops',
  },
  'motion-enter': recipe('motion-enter'),
  'motion-exit': recipe('motion-exit'),
  'motion-emphasis': recipe('motion-emphasis'),
  texture: {
    accepts: (value) => value === 'none' || gradients(value),
    expected: 'none, or one or more gradients',
  },
  'signature-fill': {
    accepts: (value) => whole(COLOR_REFERENCE).test(value) || gradients(value),
    expected:
      'var(--color-<role>), or one or more gradients, such as linear-gradient(90deg, var(--color-signature-start), var(--color-signature-end))',
  },
  'emphasis-glow': SHADOWS,
};

/**
 * The keys whose value is one length, which the platform may read inside
 * calc(), such as the field gap's `calc(var(--ui-focus-width) +
 * var(--ui-focus-offset))`. A bare 0 there makes the calc() invalid, so the
 * compiler writes it as 0px (#11).
 */
export const LENGTH_KEYS: ReadonlySet<LanguageKey> = new Set(
  (Object.keys(LANGUAGE_GRAMMARS) as LanguageKey[]).filter((key) =>
    [SIZE, FOCUS_WIDTH, FOCUS_OFFSET].includes(LANGUAGE_GRAMMARS[key]),
  ),
);

/**
 * Why `value` can't be the design-language token `key`, or null when it can:
 * the value rules every token follows, then the key's own grammar.
 */
export function languageTokenProblem(key: LanguageKey, value: unknown): string | null {
  const problem = languageValueProblem(value);
  if (problem) return problem;
  const grammar = LANGUAGE_GRAMMARS[key];
  return grammar.accepts(normal(value as string)) ? null : `must be ${grammar.expected}.`;
}
