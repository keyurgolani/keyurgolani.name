// A design language's stylesheet (#19, Slice 2, item 1), read strictly. A
// language styles the shared primitives' `[data-ui-slot]` parts and their
// state attributes, and sets only the properties in LANGUAGE_PROPERTIES, the
// ones the spec's ownership table gives a design language. Every other
// property is refused, whoever owns it: the typography profile's type, the
// variant's layout, sizes, placement, and order, the color scheme's text
// colors, and the structure the shared primitives give a part, such as
// clipping a media part's corners. Colors come only as var(--color-*), and
// transforms, opacity, backdrop blur, and a control's height only through
// tokens. Outlines, shadows, padding, gaps, and borders stay within 64px or
// 4rem, and radii within 999px. No non-empty content, color literal,
// @import, @font-face, :root, html, body, or !important.
//
// The reader takes a small, explicit subset of CSS and refuses the rest. The
// compiler writes the rules back out from what it read, never the source
// text, so nothing an author writes can close the language's @scope or its
// layer, or reach the page outside them.

import { MAX_LENGTH_PX, MAX_RADIUS_PX } from '../language-grammar';
import { LANGUAGE_KEYS } from '../tokens';
import { stylesheetValueProblem } from '../values';

/**
 * #20's pack CSS lint, the rules a language stylesheet can't break to
 * escape its boundary or load anything. The reader refuses each, among
 * everything else it refuses, and names the rule, so a known-bad input can
 * require its own rule and not just any refusal:
 *
 * - `url`: no `url()`, `src()`, `image-set()`, `image()`, `cross-fade()`,
 *   or `element()` outside declared assets, and a language declares none;
 * - `import`: no `@import`;
 * - `layer-scope`: no `@layer` or `@scope` of its own, since the compiler
 *   writes the pack's;
 * - `universal`: no `*`, bare or in a compound;
 * - `prefixed-names`: `@keyframes`, `@counter-style`, and
 *   `view-transition-name` names start with the pack's id and a hyphen.
 *   The reader refuses all three outright, which is stricter, and still
 *   names an unprefixed one under this rule;
 * - `focus-outline`: focus is drawn with `outline`, which the platform
 *   stylesheet draws from the focus tokens: nothing removes an outline
 *   (`none`, `hidden`, or a zero width), and a rule that tests :focus,
 *   :focus-visible, or :focus-within draws no ring as a `box-shadow`;
 * - `javascript`: no script through CSS: `expression()`, `javascript:` or
 *   `vbscript:` URLs, `behavior`, or `-moz-binding`.
 *
 * The rules hold however a name is written: in any case, behind a comment,
 * or behind a `\` escape. The reader refuses every escape, then reads the
 * stylesheet again as a browser decodes it and names any rule an escape hid.
 */
export const LINT_RULES = [
  'url',
  'import',
  'layer-scope',
  'universal',
  'prefixed-names',
  'focus-outline',
  'javascript',
] as const;
export type LintRule = (typeof LINT_RULES)[number];

export interface StylesheetProblem {
  readonly line: number;
  readonly column: number;
  readonly message: string;
  /** The pack CSS lint rule it breaks, when it breaks one (#20). */
  readonly rule?: LintRule;
}

/** What reading a language's stylesheet needs to know of its pack. */
export interface StylesheetOptions {
  /** The pack's id, which its keyframes, counter styles, and view transition names start with. */
  readonly packId?: string;
}

export interface StyleDeclaration {
  readonly property: string;
  readonly value: string;
}

export interface StyleRule {
  readonly type: 'rule';
  readonly selectors: readonly string[];
  readonly declarations: readonly StyleDeclaration[];
}

/** An @media, @supports, or @container block of rules. */
export interface StyleGroup {
  readonly type: 'group';
  readonly name: 'media' | 'supports' | 'container';
  readonly prelude: string;
  readonly children: readonly StyleNode[];
}

export type StyleNode = StyleRule | StyleGroup;

export type StylesheetResult =
  | { readonly ok: true; readonly nodes: readonly StyleNode[] }
  | { readonly ok: false; readonly problems: readonly StylesheetProblem[] };

/** Larger than any language's stylesheet needs. */
export const MAX_STYLESHEET_BYTES = 32 * 1024;
/** Enough to report what's wrong without repeating it for every line. */
const MAX_PROBLEMS = 50;
/** @media inside @supports inside @container, and no deeper. */
const MAX_GROUP_DEPTH = 3;

/** Every character the subset uses. Anything else is refused before reading. */
const CHARACTERS = /[A-Za-z0-9 \t\r\n\-_[\]="':().>+~,*%/{};@#<]/;

/**
 * The attributes a selector may test: the slot, the state primitives show
 * it through, and the kind a primitive renders as, data-emphasis (an
 * action's or a surface's) and data-status (#19, Slice 3).
 */
const ATTRIBUTES: ReadonlySet<string> = new Set([
  'data-ui-slot',
  'data-state',
  'data-orientation',
  'data-emphasis',
  'data-status',
  'aria-busy',
  'aria-checked',
  'aria-current',
  'aria-disabled',
  'aria-expanded',
  'aria-invalid',
  'aria-pressed',
  'aria-selected',
  'aria-sort',
  'checked',
  'disabled',
  'open',
  'readonly',
  'required',
]);

/** State pseudo-classes, which take no argument. */
const PSEUDO_CLASSES: ReadonlySet<string> = new Set([
  'active',
  'autofill',
  'checked',
  'default',
  'disabled',
  'empty',
  'enabled',
  'first-child',
  'first-of-type',
  'focus',
  'focus-visible',
  'focus-within',
  'hover',
  'indeterminate',
  'invalid',
  'last-child',
  'last-of-type',
  'modal',
  'only-child',
  'only-of-type',
  'open',
  'optional',
  'placeholder-shown',
  'popover-open',
  'read-only',
  'read-write',
  'required',
  'user-invalid',
  'user-valid',
  'valid',
]);

const NTH_PSEUDO_CLASSES: ReadonlySet<string> = new Set([
  'nth-child',
  'nth-last-child',
  'nth-of-type',
  'nth-last-of-type',
]);

const PSEUDO_ELEMENTS: ReadonlySet<string> = new Set([
  'after',
  'backdrop',
  'before',
  'file-selector-button',
  'marker',
  'placeholder',
]);

/** A box's sides, physical and logical, as their longhands spell them. */
const SIDES = [
  '-top',
  '-right',
  '-bottom',
  '-left',
  '-block',
  '-block-start',
  '-block-end',
  '-inline',
  '-inline-start',
  '-inline-end',
] as const;

const CORNERS = [
  'top-left',
  'top-right',
  'bottom-right',
  'bottom-left',
  'start-start',
  'start-end',
  'end-start',
  'end-end',
] as const;

const BACKGROUND_LONGHANDS = [
  'attachment',
  'blend-mode',
  'clip',
  'color',
  'image',
  'origin',
  'position',
  'position-x',
  'position-y',
  'repeat',
  'size',
] as const;

const serving = (reason: string, properties: readonly string[]) =>
  properties.map((property) => [property, reason] as const);

/**
 * Every property a design language's stylesheet may set, with what the
 * spec's ownership table gives a language that it serves. The reader refuses
 * every other property: what the table gives typography (family, size,
 * weight, tracking, leading), variants (layout, sizes, placement, order), and
 * color schemes (text color), and what a part needs structurally, which the
 * shared primitives' stylesheet sets. A -webkit- or -moz- property reads as
 * its unprefixed name.
 */
export const LANGUAGE_PROPERTIES: ReadonlyMap<string, string> = new Map([
  ...serving(
    "borders: a part's edges, with their width, line style, and color",
    ['', ...SIDES].flatMap((side) =>
      ['', '-width', '-style', '-color'].map((part) => `border${side}${part}`),
    ),
  ),
  ...serving("radii: a part's corners", [
    'border-radius',
    ...CORNERS.map((corner) => `border-${corner}-radius`),
  ]),
  ...serving("elevation: a part's shadows", ['box-shadow']),
  ...serving("surfaces: a part's material and texture", [
    'background',
    ...BACKGROUND_LONGHANDS.map((part) => `background-${part}`),
  ]),
  ...serving(
    'translucency and state: backdrop blur, and the opacity that dims a disabled or busy part, through the tokens',
    ['opacity', 'backdrop-filter'],
  ),
  ...serving("control anatomy: a control's height, as var(--ui-control-height)", [
    'min-height',
    'min-block-size',
  ]),
  ...serving("density inside parts: a part's padding and the gaps between its children", [
    'padding',
    ...SIDES.map((side) => `padding${side}`),
    'gap',
    'row-gap',
    'column-gap',
  ]),
  ...serving('focus treatment: the outline a focused part draws', [
    'outline',
    'outline-color',
    'outline-offset',
    'outline-style',
    'outline-width',
  ]),
  ...serving("icon treatment: an icon's fill and stroke weight", ['fill', 'stroke-width']),
  ...serving('duration, easing, and transition character', [
    'transition',
    'transition-delay',
    'transition-duration',
    'transition-property',
    'transition-timing-function',
  ]),
  ...serving(
    'transition character: the state nudges, through the tokens reduced motion turns off',
    ['transform', 'translate', 'scale', 'rotate'],
  ),
  ...serving('decoration: an empty ::before or ::after', ['content']),
]);

const SIZES =
  "sizes the part, which is the variant's layout to decide: a language sizes only a control, as min-height: var(--ui-control-height).";

/**
 * Why a property off the list is refused, for the ones a language reaches
 * for: whose it is, or how it would hide a part. The first match says.
 */
const REFUSALS: readonly (readonly [RegExp, string])[] = [
  [/^all$/, 'resets every property, including what the accessibility layer sets.'],
  [
    /^text-indent$/,
    "indents the text, which can push it out of sight: indentation is the typography profile's.",
  ],
  [
    /^(?:font|font-[a-z-]+|letter-spacing|line-height|word-spacing|text-transform)$/,
    'sets type, which belongs to the typography profile.',
  ],
  [
    /^(?:order|direction|writing-mode|unicode-bidi|reading-flow|reading-order)$/,
    'reorders content, which a language must not.',
  ],
  [
    /^grid-(?:area|row|column)(?:-start|-end)?$/,
    "places a grid item, which is the variant's layout to decide.",
  ],
  [
    /^(?:position|inset|inset-[a-z-]+|top|right|bottom|left|z-index|float|clear)$/,
    "places the part, which is the variant's layout to decide.",
  ],
  [
    /^display$/,
    "lays the part out, or takes it off the page: display is the shared primitives' and the variant's, never a language's.",
  ],
  [
    /^visibility$/,
    'can hide the part, from assistive technology too: languages style parts, never hide them.',
  ],
  [/^content-visibility$/, "can skip rendering the part's contents, which hides them."],
  [/^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|aspect-ratio)$/, SIZES],
  [
    /^(?:overflow|overflow-[a-z-]+|text-overflow)$/,
    "can clip the part's contents, which hides them: a part that clips, such as media with rounded corners, does so in the shared primitives.",
  ],
  [
    /^(?:clip|clip-path|clip-rule|mask|mask-[a-z-]+)$/,
    'can clip or mask the part, which hides it.',
  ],
  [/^zoom$/, 'scales the part and its layout, which can shrink it out of sight.'],
  [
    /^filter$/,
    'filters the part, which no accessibility setting undoes: blur goes through backdrop-filter and --ui-backdrop-blur.',
  ],
  [
    /^(?:forced-color-adjust|print-color-adjust)$/,
    'changes how forced colors or print treat the part, which only the accessibility layer may.',
  ],
  [
    /^(?:color|text-fill-color|text-stroke|text-stroke-[a-z]+|text-shadow|text-decoration-color|text-emphasis-color|accent-color|caret-color|color-scheme)$/,
    "colors the part's text or controls, which the color scheme does through the shared primitives: a language never colors text.",
  ],
  [
    /^(?:animation|animation-[a-z-]+)$/,
    "animates through keyframes, and a language can't declare any: motion comes from the --ui-motion-* tokens.",
  ],
  [
    /^(?:flex|flex-[a-z-]+|grid|grid-[a-z-]+|align-[a-z-]+|justify-[a-z-]+|place-[a-z-]+|margin|margin-[a-z-]+|columns|column-[a-z-]+|box-sizing|vertical-align|table-layout|container|container-[a-z-]+)$/,
    "lays out the part or its contents, which the shared primitives and the variant's layout own.",
  ],
  [
    /^(?:cursor|pointer-events|user-select|touch-action|appearance|resize|scroll-[a-z-]+|overscroll-[a-z-]+|will-change|contain|isolation|mix-blend-mode)$/,
    'changes how the part behaves or composites, which the shared primitives own.',
  ],
];

const UNLISTED =
  "isn't a property a design language sets: a language styles surfaces, borders, radii, elevation, translucency, control anatomy, focus, density inside parts, icons, and motion.";

const STATE_TRANSFORMS = LANGUAGE_KEYS.filter((key) => /^state-[a-z]+-transform$/.test(key)).map(
  (key) => `var(--ui-${key})`,
);
const MOVES = {
  allowed: ['none', ...STATE_TRANSFORMS],
  message: `moves the part outside the tokens: it takes none, ${STATE_TRANSFORMS.join(', or ')}, which reduced motion turns off.`,
};

const CONTROL_HEIGHT = { allowed: ['var(--ui-control-height)'], message: SIZES };

/**
 * The tests that make a part disabled or busy, the only parts the state
 * opacities dim. aria-disabled and aria-busy count only as "true", since
 * "false" marks a part that's neither.
 */
const DIMMED_STATES = ['[disabled]', ':disabled', '[aria-disabled="true"]', '[aria-busy="true"]'];

const UNDIMMED = `dims a part the rule doesn't test as disabled or busy: the state opacities apply only where every selector's last compound tests ${DIMMED_STATES.join(', ')}, outside any pseudo-class's argument.`;

/**
 * Whether a canonical selector's subject, its last compound, tests a
 * disabled or busy state itself: not through :not(), :has(), or another
 * pseudo-class's argument, and not on an ancestor or a sibling.
 */
function testsDisabledOrBusy(selector: string): boolean {
  let depth = 0;
  let subject = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') depth -= 1;
    else if (character === ' ' && depth === 0) subject = index + 1;
  }
  let compound = selector.slice(subject);
  for (let inner = compound.replace(/\([^()]*\)/g, ''); inner !== compound;) {
    compound = inner;
    inner = compound.replace(/\([^()]*\)/g, '');
  }
  return DIMMED_STATES.some((state) => compound.includes(state));
}

/**
 * Properties on the list a language sets only through tokens: reduced motion
 * stops the state transforms, and reduced transparency, a browser without
 * backdrop-filter, forced colors, and print make surfaces opaque and the
 * blur 0. A control's height is the one size a language sets.
 */
const TOKEN_ONLY_PROPERTIES: Readonly<
  Record<string, { readonly allowed: readonly string[]; readonly message: string }>
> = {
  transform: MOVES,
  translate: MOVES,
  scale: MOVES,
  rotate: MOVES,
  'backdrop-filter': {
    allowed: ['none', 'blur(var(--ui-backdrop-blur))'],
    message:
      'blurs outside the tokens: it takes none or blur(var(--ui-backdrop-blur)), which reduced transparency sets to 0.',
  },
  opacity: {
    allowed: ['var(--ui-state-disabled-opacity)', 'var(--ui-state-loading-opacity)'],
    message:
      "sets opacity outside the tokens: it takes var(--ui-state-disabled-opacity) or var(--ui-state-loading-opacity), on a part the rule tests as disabled or busy. A surface's translucency comes from --ui-surface-material.",
  },
  'min-height': CONTROL_HEIGHT,
  'min-block-size': CONTROL_HEIGHT,
};

/** Media features a language may branch on: the viewport and the input, never a preference. */
const MEDIA_FEATURES: ReadonlySet<string> = new Set([
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height',
  'aspect-ratio',
  'min-aspect-ratio',
  'max-aspect-ratio',
  'orientation',
  'hover',
  'any-hover',
  'pointer',
  'any-pointer',
]);

const CONTAINER_FEATURES: ReadonlySet<string> = new Set([
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height',
  'inline-size',
  'min-inline-size',
  'max-inline-size',
  'block-size',
  'min-block-size',
  'max-block-size',
  'aspect-ratio',
  'min-aspect-ratio',
  'max-aspect-ratio',
  'orientation',
]);

const MEDIA_WORDS: ReadonlySet<string> = new Set(['and', 'or', 'not', 'only', 'all', 'screen']);

/** Why each at-rule a language can't use is refused. */
const REFUSED_AT_RULES: Readonly<Record<string, string>> = {
  import: "can't import another stylesheet: a language ships one.",
  'font-face': "can't declare a font: typography packs ship fonts.",
  layer: "can't declare a layer: the compiler puts the stylesheet in the language layer.",
  scope: "can't open a scope: the compiler scopes the stylesheet to its design language.",
  keyframes:
    "can't declare keyframes, whose names every boundary on the page shares: motion comes from the --ui-motion-* tokens.",
  property: "can't register a custom property.",
  'starting-style': "can't use @starting-style: entry motion comes from the --ui-motion-* tokens.",
};

const LITERAL_TIME = /(?<![\w.-])(?:\d+(?:\.\d+)?|\.\d+)m?s(?![\w-])/;

/** The properties whose lengths are capped: outlines, shadows, padding, gaps, borders, and radii. */
const CAPPED =
  /^(?:outline|outline-[a-z]+|box-shadow|padding|padding-[a-z-]+|gap|row-gap|column-gap|border|border-[a-z-]+)$/;
const VIEWPORT_UNIT = /^[sld]?v(?:w|h|i|b|min|max)$/;

/** The value with each color-mix() call, whose percentages mix colors, taken out. */
function withoutColorMixes(value: string): string {
  let text = value;
  for (let start = text.indexOf('color-mix('); start >= 0; start = text.indexOf('color-mix(')) {
    let depth = 0;
    let end = start;
    for (; end < text.length; end += 1) {
      if (text[end] === '(') depth += 1;
      else if (text[end] === ')' && --depth === 0) break;
    }
    text = `${text.slice(0, start)} color ${text.slice(end + 1)}`;
  }
  return text;
}

/**
 * Why a capped property's value can't be a language's, or null. Its lengths
 * are px or rem, never em, which the typography profile's font size scales,
 * within MAX_LENGTH_PX, or MAX_RADIUS_PX for a radius,
 * written out or read from a token whose grammar caps it the same way, so no
 * viewport unit, percentage, math, or radius token stretches one past it.
 */
function lengthProblem(base: string, value: string): string | null {
  if (!CAPPED.test(base)) return null;
  const radius = base.endsWith('radius');
  const cap = radius ? MAX_RADIUS_PX : MAX_LENGTH_PX;
  const text = withoutColorMixes(value.toLowerCase());
  for (const [, name] of text.matchAll(/([a-z-]+)\(/g)) {
    if (name !== 'var') {
      return `calls ${name}(): a length here is written out or a token, so its cap holds.`;
    }
  }
  if (!radius && text.includes('var(--ui-radius-')) {
    return `reads a radius token, which may be up to ${MAX_RADIUS_PX}px: only border-radius reads the radius tokens.`;
  }
  for (const [, number, unit] of text.matchAll(
    /(?<![\w.-])(-?(?:\d+(?:\.\d+)?|\.\d+))([a-z%]*)/g,
  )) {
    const amount = Math.abs(Number.parseFloat(number!));
    const length = `${number}${unit}`;
    if (unit === '%') {
      return `uses ${length}, a percentage, which scales with the box: a length here is px or rem.`;
    }
    if (VIEWPORT_UNIT.test(unit!)) {
      return `uses ${length}, which scales with the window: a length here is px or rem.`;
    }
    if (unit === '') {
      if (amount === 0) continue;
      return `uses ${number} with no unit: a length here is px or rem.`;
    }
    if (unit === 'em') {
      return `uses ${length}, which scales with the part's font size, the typography profile's: a length here is px or rem.`;
    }
    if (unit !== 'px' && unit !== 'rem') return `uses ${length}: a length here is px or rem.`;
    if (amount > (unit === 'px' ? cap : cap / 16)) {
      return radius
        ? `has ${length}, over a radius's cap of ${cap}px or ${cap / 16}rem.`
        : `has ${length}, over the cap of ${cap}px or ${cap / 16}rem: a language's outlines, shadows, padding, gaps, and borders stay within it, so none covers the page or pushes content off it.`;
    }
  }
  return null;
}

interface Text {
  readonly source: string;
  /** The source with comments blanked out, offset for offset. */
  readonly text: string;
  readonly lines: readonly number[];
}

/** Reads a language's stylesheet, or says everything that's wrong with it. */
export function readLanguageStylesheet(
  source: string,
  options: StylesheetOptions = {},
): StylesheetResult {
  const read = readOnce(source, options);
  if (read.ok || !source.includes('\\')) return read;
  // The reader refuses every escape, which hides what a name or value is.
  // Read it as a browser decodes it too, so a rule an escape hid is named.
  const decoded = decodeEscapes(source);
  const hidden = readOnce(decoded, options);
  if (hidden.ok) return read;
  const named = new Set(read.problems.map(({ rule }) => rule).filter(Boolean));
  const extra = hidden.problems
    .filter((problem) => problem.rule !== undefined && !named.has(problem.rule))
    .map((problem) => ({
      ...problem,
      message: `once its escapes are decoded, ${problem.message}`,
    }));
  return { ok: false, problems: [...read.problems, ...extra].slice(0, MAX_PROBLEMS) };
}

/**
 * `source` with each CSS escape decoded as CSS Syntax 3 reads it: a
 * backslash and one to six hex digits, with one whitespace after, is that
 * code point (0, a surrogate, or past U+10FFFF is U+FFFD); a backslash
 * before a newline is nothing; a backslash before anything else is that
 * character.
 */
export function decodeEscapes(source: string): string {
  return source.replace(
    /\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\r\n\f])?|(\r\n|[\n\r\f])|([\s\S]))/g,
    (_, hex: string | undefined, newline: string | undefined, other: string | undefined) => {
      if (hex !== undefined) {
        const code = Number.parseInt(hex, 16);
        return code === 0 || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff
          ? '�'
          : String.fromCodePoint(code);
      }
      if (newline !== undefined) return '';
      return other ?? '';
    },
  );
}

function readOnce(source: string, options: StylesheetOptions): StylesheetResult {
  const problems: StylesheetProblem[] = [];
  const lines = lineStarts(source);
  const report: Report = (offset, message, rule) => {
    if (problems.length < MAX_PROBLEMS) {
      problems.push({
        ...position(lines, offset),
        message: rule ? `${message} (pack lint: ${rule})` : message,
        ...(rule ? { rule } : {}),
      });
    }
  };

  if (new TextEncoder().encode(source).length > MAX_STYLESHEET_BYTES) {
    report(0, `is larger than ${MAX_STYLESHEET_BYTES / 1024} KB, more than any language needs.`);
    return { ok: false, problems };
  }
  checkCharacters(source, report);
  if (problems.length > 0) return { ok: false, problems };
  const text = blankComments(source, report);
  if (text === null || problems.length > 0) return { ok: false, problems };

  const reader = new Reader({ source, text, lines }, report, options);
  const nodes = reader.items(0, text.length, 0);
  return problems.length > 0 ? { ok: false, problems } : { ok: true, nodes };
}

type Report = (offset: number, message: string, rule?: LintRule) => void;

/** Functions that load a resource, which no language may call: it declares no asset. */
const LOADS = /(?<![\w-])(?:-(?:webkit|moz)-)?(?:url|src|image-set|image|cross-fade|element)\(/i;
/** What runs script through CSS, in a value. */
const SCRIPTED = /(?<![\w-])expression\(|(?:java|vb)script:/i;
/** Properties that run script through CSS. */
const SCRIPT_PROPERTIES: ReadonlySet<string> = new Set(['behavior', 'binding']);

/** A name a pack must prefix with its id: what a @keyframes or @counter-style prelude, or a view-transition-name, names. */
function unprefixed(name: string, packId: string | undefined): boolean {
  if (name === '' || name === 'none') return false;
  return packId === undefined || !name.startsWith(`${packId}-`);
}

function checkCharacters(source: string, report: (offset: number, message: string) => void) {
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (CHARACTERS.test(character)) continue;
    if (character === '\\') {
      report(index, "can't use a backslash: an escape hides what a name or value really is.");
    } else if (character === '!') {
      report(index, "can't use !important: accessibility rules must win over a language's.");
    } else if (character === '&') {
      report(index, "can't nest rules with &: write each rule at the top level.");
    } else if (character.charCodeAt(0) > 0x7e) {
      report(index, 'must be plain ASCII text.');
    } else {
      report(index, `can't use ${JSON.stringify(character)}.`);
    }
  }
}

/** The source with each comment turned to spaces, keeping line breaks; null when one never closes. */
function blankComments(
  source: string,
  report: (offset: number, message: string) => void,
): string | null {
  let text = '';
  let index = 0;
  while (index < source.length) {
    const character = source[index]!;
    if (character === '"' || character === "'") {
      const end = stringEnd(source, index);
      if (end < 0) {
        report(index, 'opens a string it never closes on the same line.');
        return null;
      }
      text += source.slice(index, end + 1);
      index = end + 1;
    } else if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) {
        report(index, 'opens a comment it never closes.');
        return null;
      }
      text += source.slice(index, end + 2).replace(/[^\n]/g, ' ');
      index = end + 2;
    } else {
      text += character;
      index += 1;
    }
  }
  return text;
}

/** The offset of the quote that closes the string opened at `start`, or -1. */
function stringEnd(text: string, start: number): number {
  const quote = text[start];
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === quote) return index;
    if (text[index] === '\n' || text[index] === '\r') return -1;
  }
  return -1;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function position(lines: readonly number[], offset: number) {
  let low = 0;
  let high = lines.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (lines[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: offset - lines[low]! + 1 };
}

const normalize = (text: string) => text.trim().replace(/\s+/g, ' ');

class Reader {
  constructor(
    private readonly input: Text,
    private readonly report: Report,
    private readonly options: StylesheetOptions = {},
  ) {}

  /** The rules and groups between `start` and `end`. */
  items(start: number, end: number, depth: number): StyleNode[] {
    const { text } = this.input;
    const nodes: StyleNode[] = [];
    let index = start;
    while (index < end) {
      while (index < end && /\s/.test(text[index]!)) index += 1;
      if (index >= end) break;
      const stop = this.nextStop(index, end);
      if (stop === null) return nodes;
      if (stop.offset >= end) {
        this.report(index, "is text after the last rule that isn't a rule.");
        return nodes;
      }
      if (stop.character === '}') {
        this.report(stop.offset, 'closes a block it never opened.');
        return nodes;
      }
      const prelude = text.slice(index, stop.offset);
      if (stop.character === ';') {
        if (prelude.trim().startsWith('@')) this.atRuleProblem(prelude.trim(), index);
        else this.report(index, 'is a declaration outside any rule.');
        index = stop.offset + 1;
        continue;
      }
      const close = this.closingBrace(stop.offset, end);
      if (close < 0) {
        this.report(stop.offset, 'opens a block it never closes.');
        return nodes;
      }
      const node = prelude.trim().startsWith('@')
        ? this.group(prelude.trim(), index, stop.offset + 1, close, depth)
        : this.rule(prelude, index, stop.offset + 1, close);
      if (node) nodes.push(node);
      index = close + 1;
    }
    return nodes;
  }

  /** The next `{`, `;`, or `}` outside strings, parentheses, and brackets. */
  private nextStop(start: number, end: number): { offset: number; character: string } | null {
    const { text } = this.input;
    const open: string[] = [];
    for (let index = start; index < end; index += 1) {
      const character = text[index]!;
      if (character === '"' || character === "'") {
        index = stringEnd(text, index);
        if (index < 0) return null;
      } else if (character === '(' || character === '[') {
        open.push(character === '(' ? ')' : ']');
      } else if (character === ')' || character === ']') {
        if (open.pop() !== character) {
          this.report(
            index,
            `closes a ${character === ')' ? 'parenthesis' : 'bracket'} it never opened.`,
          );
          return null;
        }
      } else if (
        open.length === 0 &&
        (character === '{' || character === ';' || character === '}')
      ) {
        return { offset: index, character };
      } else if (open.length > 0 && (character === '{' || character === '}' || character === ';')) {
        this.report(index, `leaves a ${open.at(-1) === ')' ? 'parenthesis' : 'bracket'} open.`);
        return null;
      }
    }
    if (open.length > 0) {
      this.report(start, `leaves a ${open.at(-1) === ')' ? 'parenthesis' : 'bracket'} open.`);
      return null;
    }
    return { offset: end, character: '' };
  }

  /** The `}` that closes the `{` at `open`, or -1. */
  private closingBrace(open: number, end: number): number {
    const { text } = this.input;
    let depth = 0;
    for (let index = open; index < end; index += 1) {
      const character = text[index]!;
      if (character === '"' || character === "'") {
        index = stringEnd(text, index);
        if (index < 0) return -1;
      } else if (character === '{') depth += 1;
      else if (character === '}' && --depth === 0) return index;
    }
    return -1;
  }

  private atRuleProblem(prelude: string, offset: number) {
    const name = /^@([a-z-]*)/i.exec(prelude)?.[1]?.toLowerCase() ?? '';
    const bare = name.replace(/^-(?:webkit|moz)-/, '');
    const refusal =
      REFUSED_AT_RULES[bare] ??
      "isn't an at-rule a language can use: only @media, @supports, and @container blocks.";
    if (bare === 'import') {
      this.report(offset, `@${name} ${refusal}`, 'import');
    } else if (bare === 'layer' || bare === 'scope') {
      this.report(offset, `@${name} ${refusal}`, 'layer-scope');
    } else if (bare === 'keyframes' || bare === 'counter-style') {
      const named = normalize(prelude.slice(name.length + 1)).replace(/^["']|["']$/g, '');
      if (unprefixed(named, this.options.packId)) {
        this.report(
          offset,
          `@${name} ${refusal} Its name, ${JSON.stringify(named)}, doesn't start with the pack's id either, as every name a pack shares with the page does: ${this.options.packId ?? '<pack id>'}-.`,
          'prefixed-names',
        );
      } else {
        this.report(offset, `@${name} ${refusal}`);
      }
    } else {
      this.report(offset, `@${name} ${refusal}`);
    }
  }

  private group(
    prelude: string,
    offset: number,
    start: number,
    end: number,
    depth: number,
  ): StyleGroup | null {
    const match = /^@([a-z-]+)(?=[\s(]|$)/.exec(prelude);
    const name = match?.[1];
    if (name !== 'media' && name !== 'supports' && name !== 'container') {
      this.atRuleProblem(prelude, offset);
      return null;
    }
    if (depth >= MAX_GROUP_DEPTH) {
      this.report(offset, `nests @${name} more than ${MAX_GROUP_DEPTH} deep.`);
      return null;
    }
    const condition = normalize(prelude.slice(name.length + 1));
    if (LOADS.test(condition)) {
      this.report(
        offset,
        `@${name} names a file in its condition, and a language declares no asset to load.`,
        'url',
      );
      return null;
    }
    const problem =
      name === 'media'
        ? mediaProblem(condition)
        : name === 'container'
          ? containerProblem(condition)
          : supportsProblem(condition);
    if (problem) {
      this.report(offset, `@${name} ${problem}`);
      return null;
    }
    const children = this.items(start, end, depth + 1);
    return { type: 'group', name, prelude: condition, children };
  }

  private rule(prelude: string, offset: number, start: number, end: number): StyleRule | null {
    const { text } = this.input;
    const selectors: string[] = [];
    let valid = true;
    for (const selector of splitTopLevel(prelude, ',')) {
      const read = readSelector(normalize(selector), 'complex');
      if ('message' in read) {
        this.report(offset, `${JSON.stringify(normalize(selector))} ${read.message}`, read.rule);
        valid = false;
      } else {
        selectors.push(read.text);
      }
    }
    // Focus is drawn with an outline (#20): a focus rule draws no shadow ring.
    const focus = splitTopLevel(prelude, ',').some((selector) => testsFocus(normalize(selector)));
    if (selectors.length === 0 && valid) {
      this.report(offset, 'is a rule with no selector.');
      return null;
    }
    const body = text.slice(start, end);
    if (/[{}]/.test(body.replace(/"[^"]*"|'[^']*'/g, ''))) {
      this.report(start, 'nests a rule inside a rule: write each rule at the top level.');
      return null;
    }
    const declarations: StyleDeclaration[] = [];
    // The state opacities dim only a part every selector tests as disabled or busy.
    const dims = selectors.length > 0 && selectors.every(testsDisabledOrBusy);
    let cursor = start;
    for (const piece of splitTopLevel(body, ';')) {
      const at = cursor + (piece.length - piece.trimStart().length);
      cursor += piece.length + 1;
      if (piece.trim() === '') continue;
      const declaration = readDeclaration(piece, dims, this.options);
      if ('message' in declaration) {
        this.report(at, declaration.message, declaration.rule);
        valid = false;
      } else if (focus && /^(?:-(?:webkit|moz)-)?box-shadow$/.test(declaration.property)) {
        this.report(
          at,
          `${declaration.property}: ${declaration.value} draws a focused part's ring as a shadow, and focus is drawn with outline: a rule that tests :focus, :focus-visible, or :focus-within sets no box-shadow.`,
          'focus-outline',
        );
        valid = false;
      } else {
        declarations.push(declaration);
      }
    }
    if (!valid || declarations.length === 0) return null;
    return { type: 'rule', selectors, declarations };
  }
}

/** `text` split at `separator` where it's outside strings, parentheses, and brackets. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === '"' || character === "'") {
      const end = stringEnd(text, index);
      if (end < 0) break;
      index = end;
    } else if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') depth = Math.max(0, depth - 1);
    else if (character === separator && depth === 0) {
      parts.push(text.slice(from, index));
      from = index + 1;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

type Read =
  | { readonly text: string; readonly slot: boolean }
  | { readonly message: string; readonly rule?: LintRule };

/**
 * Whether a selector tests focus anywhere but inside :not(), where it
 * selects what isn't focused: :focus, :focus-visible, or :focus-within, on
 * the part or on an ancestor.
 */
export function testsFocus(selector: string): boolean {
  let text = selector.toLowerCase();
  for (let start = text.indexOf(':not('); start >= 0; start = text.indexOf(':not(')) {
    const close = closingParenthesis(text, start + 4);
    if (close < 0) break;
    text = `${text.slice(0, start)}${text.slice(close + 1)}`;
  }
  return /:focus(?:-visible|-within)?(?![\w-])/.test(text);
}

/** An outline that draws nothing: none or hidden as its style, or a zero width. */
function removesOutline(base: string, value: string): boolean {
  const words = value.toLowerCase().split(/\s+/);
  if (base === 'outline') {
    return words.some(
      (word) => word === 'none' || word === 'hidden' || /^0(?:\.0*)?(?:[a-z]+)?$/.test(word),
    );
  }
  if (base === 'outline-style') return words.includes('none') || words.includes('hidden');
  if (base === 'outline-width') return /^0(?:\.0*)?(?:[a-z]+)?$/.test(value.trim());
  return false;
}

/**
 * One selector, checked, in canonical form. `complex` is a rule's selector,
 * whose every compound targets a [data-ui-slot] part; `argument` is a
 * compound inside :not(), :is(), or :where(), which may test state alone;
 * `relative` is :has()'s, which may start with a combinator.
 */
function readSelector(selector: string, mode: 'complex' | 'argument' | 'relative'): Read {
  if (selector === '') return { message: 'is empty.' };
  const parts: string[] = [];
  let index = 0;
  let compound = '';
  let slot = false;
  let pseudoElement = false;
  let compounds = 0;
  let allSlots = true;

  const finish = (): string | null => {
    if (compound === '') return 'has a combinator without a selector on each side.';
    if (mode !== 'argument' && !slot) {
      return `targets ${compound}, and every part of a language's selector is a [data-ui-slot] part.`;
    }
    allSlots &&= slot;
    parts.push(compound);
    compounds += 1;
    compound = '';
    slot = false;
    return null;
  };

  if (mode === 'relative') {
    const lead = /^([>+~])\s*/.exec(selector);
    if (lead) {
      parts.push(lead[1]!);
      index = lead[0].length;
    }
  }
  while (index < selector.length) {
    const character = selector[index]!;
    if (character === ' ' || character === '>' || character === '+' || character === '~') {
      const combinator = /^\s*([>+~])?\s*/.exec(selector.slice(index))!;
      index += combinator[0].length;
      if (index >= selector.length) break;
      if (mode === 'argument')
        return { message: 'uses a combinator inside :not(), :is(), or :where().' };
      if (pseudoElement)
        return { message: 'puts a pseudo-element before the end of the selector.' };
      const problem = finish();
      if (problem) return { message: problem };
      parts.push(combinator[1] ?? ' ');
      continue;
    }
    if (pseudoElement) return { message: 'puts a pseudo-element before the end of the selector.' };
    if (character === '[') {
      const close = selector.indexOf(']', index);
      if (close < 0) return { message: 'leaves an attribute selector open.' };
      const attribute = readAttribute(selector.slice(index + 1, close));
      if ('message' in attribute) return attribute;
      compound += attribute.text;
      slot ||= attribute.slot;
      index = close + 1;
    } else if (character === ':') {
      const element = selector.startsWith('::', index);
      const name = /^[a-z][a-z-]*/.exec(selector.slice(index + (element ? 2 : 1)))?.[0];
      if (!name) return { message: 'has a colon with no pseudo-class name after it.' };
      index += (element ? 2 : 1) + name.length;
      if (element) {
        if (mode === 'argument')
          return { message: "can't use a pseudo-element inside :not(), :is(), or :where()." };
        if (!PSEUDO_ELEMENTS.has(name)) {
          return {
            message: `uses ::${name}, and a language may use only ::${[...PSEUDO_ELEMENTS].join(', ::')}.`,
          };
        }
        compound += `::${name}`;
        pseudoElement = true;
        continue;
      }
      if (selector[index] === '(') {
        const close = closingParenthesis(selector, index);
        if (close < 0) return { message: `leaves :${name}( open.` };
        const argument = normalize(selector.slice(index + 1, close));
        const read = pseudoClassArgument(name, argument, mode);
        if ('message' in read) return read;
        compound += `:${name}(${read.text})`;
        slot ||= read.slot;
        index = close + 1;
      } else {
        if (name === 'root' || name === 'scope' || name === 'host') {
          return {
            message: `uses :${name}, and a language styles only [data-ui-slot] parts inside its boundary.`,
          };
        }
        if (!PSEUDO_CLASSES.has(name))
          return { message: `uses :${name}, which isn't a state pseudo-class a language may use.` };
        compound += `:${name}`;
      }
    } else if (character === '*') {
      return {
        message: 'uses *, and a language targets [data-ui-slot] parts, not every element.',
        rule: 'universal',
      };
    } else if (character === '.') {
      return {
        message:
          'uses a class, and a language targets [data-ui-slot] parts and state attributes, never classes.',
      };
    } else if (character === '#') {
      return {
        message: 'uses an id, and a language targets [data-ui-slot] parts and state attributes.',
      };
    } else if (/[A-Za-z]/.test(character)) {
      const word = /^[A-Za-z][A-Za-z0-9-]*/.exec(selector.slice(index))![0].toLowerCase();
      return {
        message:
          word === 'html' || word === 'body'
            ? `uses ${word}, outside every boundary: a language styles only [data-ui-slot] parts.`
            : `uses the element ${word}, and a language targets [data-ui-slot] parts, not elements.`,
      };
    } else {
      return { message: `can't use ${JSON.stringify(character)} here.` };
    }
  }
  const problem = finish();
  if (problem) return { message: problem };
  if (mode === 'argument' && compounds !== 1) return { message: 'must be one compound selector.' };
  const text = parts
    .map((part) => (part === ' ' ? ' ' : /^[>+~]$/.test(part) ? ` ${part} ` : part))
    .join('');
  return { text: text.trim(), slot: allSlots };
}

function readAttribute(inside: string): Read {
  const match =
    /^\s*([a-z][a-z0-9-]*)\s*(?:(~?=)\s*(?:"([a-z0-9._-]*)"|'([a-z0-9._-]*)'|([a-z][a-z0-9_-]*))\s*)?$/.exec(
      inside,
    );
  if (!match) {
    return {
      message: `tests [${normalize(inside)}], and an attribute test is [name], [name="value"], or [name~="value"], with a lowercase value of letters, digits, and . _ -.`,
    };
  }
  const [, name, operator, double, single, bare] = match;
  if (!ATTRIBUTES.has(name!)) {
    return {
      message: `tests [${name}], and a language tests only data-ui-slot and the state attributes: ${[...ATTRIBUTES].slice(1).join(', ')}.`,
    };
  }
  const value = double ?? single ?? bare;
  return {
    text: operator ? `[${name}${operator}"${value}"]` : `[${name}]`,
    slot: name === 'data-ui-slot',
  };
}

function closingParenthesis(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === '"' || character === "'") {
      index = stringEnd(text, index);
      if (index < 0) return -1;
    } else if (character === '(') depth += 1;
    else if (character === ')' && --depth === 0) return index;
  }
  return -1;
}

function pseudoClassArgument(
  name: string,
  argument: string,
  mode: 'complex' | 'argument' | 'relative',
): Read {
  if (NTH_PSEUDO_CLASSES.has(name)) {
    if (/^(?:odd|even|[+-]?\d*n(?: ?[+-] ?\d+)?|[+-]?\d+)$/.test(argument)) {
      return { text: argument, slot: false };
    }
    return { message: `takes :${name}(An+B), odd, or even, such as :${name}(2n + 1).` };
  }
  if (name === 'dir') {
    return argument === 'ltr' || argument === 'rtl'
      ? { text: argument, slot: false }
      : { message: 'takes :dir(ltr) or :dir(rtl).' };
  }
  if (name === 'not' || name === 'is' || name === 'where' || name === 'has') {
    if (mode === 'argument') return { message: `nests :${name}() inside another pseudo-class.` };
    const read = splitTopLevel(argument, ',').map((part) =>
      readSelector(normalize(part), name === 'has' ? 'relative' : 'argument'),
    );
    const problem = read.find((item): item is { message: string } => 'message' in item);
    if (problem) return problem;
    const items = read as { text: string; slot: boolean }[];
    return {
      text: items.map((item) => item.text).join(', '),
      // :is() and :where() target a slot when every alternative does; :not() and :has() never do.
      slot: (name === 'is' || name === 'where') && items.every((item) => item.slot),
    };
  }
  return { message: `uses :${name}(), which isn't a pseudo-class a language may use.` };
}

/** A declaration, checked, or why it can't be one. */
function readDeclaration(
  piece: string,
  dims: boolean,
  options: StylesheetOptions = {},
): StyleDeclaration | { readonly message: string; readonly rule?: LintRule } {
  const colon = piece.indexOf(':');
  if (colon < 0)
    return {
      message: `${JSON.stringify(normalize(piece))} isn't a declaration: write property: value.`,
    };
  const property = piece.slice(0, colon).trim();
  const value = normalize(piece.slice(colon + 1));
  // #20's lint rules first, so each names its rule whatever else the declaration breaks.
  const lowered = property.toLowerCase().replace(/^-(?:webkit|moz)-/, '');
  if (SCRIPT_PROPERTIES.has(lowered) || SCRIPTED.test(value)) {
    return {
      message: `${property}: ${value} runs script through CSS, and no pack ships JavaScript.`,
      rule: 'javascript',
    };
  }
  if (LOADS.test(value)) {
    return {
      message: `${property}: ${value} loads a file, and a language declares no asset: url(), src(), image-set(), image(), cross-fade(), and element() aren't allowed.`,
      rule: 'url',
    };
  }
  if (lowered === 'view-transition-name' || lowered === 'view-transition-class') {
    if (value.split(/\s+/).some((name) => unprefixed(name, options.packId))) {
      return {
        message: `${property}: ${value} names a view transition every boundary on the page shares without the pack's id: a pack's names start with ${options.packId ?? '<pack id>'}-, and a language sets no view transition.`,
        rule: 'prefixed-names',
      };
    }
  }
  if (/^outline(?:-style|-width)?$/.test(lowered) && removesOutline(lowered, value)) {
    return {
      message: `${property}: ${value} removes the outline focus is drawn with.`,
      rule: 'focus-outline',
    };
  }
  if (property.startsWith('--')) {
    return {
      message: `${property} defines a custom property, and a language gives its values as tokens: --ui-* from the manifest, and --color-*, --type-*, and --layout-* belong to other axes.`,
    };
  }
  if (!/^(?:-(?:webkit|moz)-)?[a-z]+(?:-[a-z]+)*$/.test(property)) {
    return { message: `${JSON.stringify(property)} isn't a lowercase property name.` };
  }
  const base = property.replace(/^-(?:webkit|moz)-/, '');
  const refuse = (message: string) => ({ message: `${property}: ${value} ${message}` });
  // Deny by default: a property off the list is refused whatever its value.
  if (!LANGUAGE_PROPERTIES.has(base)) {
    return refuse(REFUSALS.find(([names]) => names.test(base))?.[1] ?? UNLISTED);
  }
  let depth = 0;
  for (const character of value) {
    if (character === '(') depth += 1;
    if (character === ')' && --depth < 0) return refuse('closes a parenthesis it never opened.');
  }
  if (depth !== 0) return refuse('leaves a parenthesis open.');
  if (/\burl\(/i.test(value))
    return refuse("loads a file, and a language can't: url() isn't allowed.");
  const length = lengthProblem(base, value);
  if (length) return refuse(length);
  const tokens = TOKEN_ONLY_PROPERTIES[base];
  if (tokens) {
    if (!tokens.allowed.includes(value)) return refuse(tokens.message);
    if (base === 'opacity' && !dims) return refuse(UNDIMMED);
    return { property, value };
  }
  if (base === 'content') {
    if (value === '""' || value === "''") return { property, value: '""' };
    if (value === 'none' || value === 'normal') return { property, value };
    return refuse('adds text, and a language\'s content is only empty: "", none, or normal.');
  }
  if (value.includes('#')) {
    return refuse('has a hex color literal: colors come from the scheme, as var(--color-<role>).');
  }
  if (LITERAL_TIME.test(value)) {
    return refuse(
      'has a literal duration: timing comes from --ui-motion-fast, --ui-motion-standard, and --ui-motion-slow, which reduced motion adjusts.',
    );
  }
  const problem = stylesheetValueProblem(value);
  if (problem) return refuse(problem);
  return { property, value };
}

/** Why a media query list can't be a language's, or null. */
function mediaProblem(condition: string): string | null {
  if (condition === '') return 'needs a condition.';
  for (const query of condition.split(',')) {
    const problem = queryProblem(query.trim(), MEDIA_FEATURES, MEDIA_WORDS);
    if (problem) return problem;
  }
  return null;
}

function containerProblem(condition: string): string | null {
  const match = /^(?:([a-z][a-z0-9-]*) )?(.+)$/.exec(condition);
  if (!match) return 'needs a condition.';
  const [, name, query] = match;
  if (name && ['and', 'or', 'not', 'none'].includes(name)) return `can't be named ${name}.`;
  return queryProblem(query!, CONTAINER_FEATURES, new Set(['and', 'or', 'not']));
}

const RANGE = '(?:<=|>=|<|>|=)';
const AMOUNT = '[0-9.]+[a-z%]*|[0-9]+ ?/ ?[0-9]+';

/** One query: words, and parenthesized features from `features`, flat. */
function queryProblem(
  query: string,
  features: ReadonlySet<string>,
  words: ReadonlySet<string>,
): string | null {
  const tokens = query.match(/\([^()]*\)|[^\s()]+|\S/g) ?? [];
  if (tokens.length === 0) return 'needs a condition.';
  for (const token of tokens) {
    if (!token.startsWith('(')) {
      if (!words.has(token))
        return `uses ${JSON.stringify(token)}, which isn't a media type or keyword a language may use.`;
      continue;
    }
    const inside = token.slice(1, -1).trim();
    const name =
      new RegExp(`^([a-z-]+)(?: ?: ?[a-z0-9./ -]+| ?${RANGE} ?(?:${AMOUNT}))?$`).exec(
        inside,
      )?.[1] ??
      new RegExp(`^(?:${AMOUNT}) ?${RANGE} ?([a-z-]+)(?: ?${RANGE} ?(?:${AMOUNT}))?$`).exec(
        inside,
      )?.[1];
    if (!name) return `tests (${inside}), which isn't a feature test the stylesheet can read.`;
    if (name.startsWith('prefers-') || name === 'forced-colors' || name === 'inverted-colors') {
      return `tests ${name}, a preference the accessibility layer answers by adjusting the tokens.`;
    }
    if (!features.has(name))
      return `tests ${name}, which a language can't branch on: it may test ${[...features].join(', ')}.`;
  }
  return null;
}

function supportsProblem(condition: string): string | null {
  if (condition === '') return 'needs a condition.';
  if (!/^[a-z0-9 ().:,%/-]+$/.test(condition))
    return 'tests a condition with characters a feature test never needs.';
  if (/\b(?:selector|font-tech|font-format)\(/.test(condition)) {
    return 'tests a selector or a font, and a language tests only properties.';
  }
  let depth = 0;
  for (const character of condition) {
    if (character === '(') depth += 1;
    if (character === ')' && --depth < 0) return 'closes a parenthesis it never opened.';
  }
  return depth === 0 ? null : 'leaves a parenthesis open.';
}

/** The nodes as CSS, each line starting with `indent`. */
export function writeStyleNodes(nodes: readonly StyleNode[], indent: string): string {
  return nodes
    .map((node) =>
      node.type === 'rule'
        ? `${indent}${node.selectors.join(`,\n${indent}`)} {\n${node.declarations
            .map(({ property, value }) => `${indent}  ${property}: ${value};\n`)
            .join('')}${indent}}\n`
        : `${indent}@${node.name} ${node.prelude} {\n${writeStyleNodes(node.children, `${indent}  `)}${indent}}\n`,
    )
    .join('');
}
