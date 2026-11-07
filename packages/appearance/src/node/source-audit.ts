// The appearance source audit (#19, Slice 5, item 12): `pnpm check:appearance`
// reads every variant package and `packages/kit/src` for appearance that
// belongs to a pack, so a composition or the kit can't carry a palette, a
// font, or a material of its own past review. It flags:
//
// - `color-literal`: a hex color, `rgb()`, `hsl()`, `hwb()`, `lab()`,
//   `lch()`, `oklab()`, `oklch()`, or `color()`, and a named color such as
//   `red` or `canvastext` where a color goes, in a stylesheet or in a
//   string in code, such as a canvas fill or an inline style. A color
//   function whose every argument is a template interpolation, a color the
//   code read from somewhere else, passes, and the code inside each
//   interpolation is read for strings of its own;
// - `font-family`: a `font-family` or `font` that isn't a `var(--type-*)`;
// - `font-face`: an `@font-face`, which only a typography pack declares;
// - `import`: an `@import`;
// - `shadow`: a `box-shadow` or `text-shadow` that isn't `none` or a
//   `var(--ui-*)`;
// - `radius`: a nonzero `border-radius`, or one of its longhands, that isn't
//   a `var(--ui-*)`;
// - `blur`: a `blur()` in a `filter` or `backdrop-filter` that isn't a
//   `var(--ui-*)`;
// - `timing`: a duration or a delay in `transition` or `animation`, or one
//   of their longhands, written as a literal time, or read from anything
//   but a `var(--ui-*)` or the platform's `var(--motion-*)`, and a
//   composition's motion slot that's out of bounds: --layout-motion-feedback,
//   --layout-motion-scene, or --layout-motion-ambient (K-4 b, 20 to 60 s)
//   other than a literal time in its band
//   (MOTION_BANDS, the variant contract's, the redesign dossier's M3), a
//   --layout-motion-curve other than the language's easing or a
//   cubic-bezier() that doesn't overshoot, or a slot read straight into a
//   duration, past the reduced-motion and still-language holds;
// - `legacy-property`: the retired v1 properties, `--paper`, `--ink`, and
//   any `--kc-` or `--vt-` one;
// - `custom-property`: in a variant's stylesheet, a custom property of its
//   own that isn't a `--layout-*` one or one COMPOSITION_SETTABLE names in
//   its value forms (row 73: --color-focus and --ui-focus-offset, which
//   code never sets), or one of the platform's defaults
//   (`--layout-grid-*`, `--layout-width-*`, `--layout-motion-*`) set
//   anywhere but the composition's root rule, `[data-variant='<id>']`, or
//   from code.
// - `motion-gate` (K-4): in a variant's stylesheet, an infinite animation
//   (the `animation` shorthand or `animation-iteration-count` saying
//   `infinite`, or a count over LOOP_ITERATIONS) whose rule doesn't set
//   `animation-play-state: var(--motion-ambient-state)` after its last
//   `animation` shorthand, the one way the runtime's pause reaches a loop:
//   `[data-kit-runtime]`, the attribute the kit's runtime sets on its root
//   while the runtime may run, can keep a loop from starting, but it no
//   longer stands in for the state, since the pause holds loops alone and
//   lets a one-shot entrance finish (OWN-1); any
//   `animation-play-state: running`, which would undo every gate; and, in a
//   variant's code, any `data-kit-runtime` or `kitRuntime`, since only the
//   kit sets the gate.
// - `layout-line` (K-5): in a variant's stylesheet, a `--layout-line-*` or
//   `--layout-rule-*` (but not one whose name ends in -height, -size,
//   -length, -clamp, or -gap, which is geometry) that isn't a border
//   shorthand of a px width, `solid`
//   or `dashed`, and a role color: `var(--color-<role>)`, `currentColor`,
//   a --layout-* property the file declares as one, or a `color-mix()` of
//   those and `transparent`.
// - `escape` (K-5 round 5): a backslash outside a string, in a name, a
//   selector, a value, or an unquoted url(), anywhere in a stylesheet. Every
//   check here reads a name as written, so an escape could get past each of
//   them. A string keeps its escapes: `content: '\201C'` is first-party CSS.
// - `at-rule` (K-5 round 7): in a variant's stylesheet, an at-rule but
//   @media, @supports, @layer, @container, @keyframes, and @import, or a
//   @supports selector() that isn't one compound of pseudo-classes and
//   pseudo-elements: the variant contract's list (variantAtRuleProblem),
//   the one the variant audit holds as audit.css-at-rule.
//
// K-5's amendments, beside F1's element design: `var(--layout-round)` is a
// radius when the file declares `--layout-round: 50%` (and only that); a
// mask on a ::before or ::after may name black, white, and transparent,
// which a mask reads for their alpha alone; and the root rule may carry
// attribute selectors of the composition's own, such as
// `[data-variant='<id>'][data-tf-field='quiet']`, for the platform's
// defaults.
//
// A `var()` passes only where it names the right token, or a --layout-*
// property the file declares whose own value passes, and its fallback, if
// it has one, passes too. A declaration counts whole, across every line
// Prettier splits it over, on the line it starts, and a -webkit- or -moz-
// prefix doesn't hide a property. In code, a string under one of those
// properties' style keys, such as `boxShadow` or `transition`, in a style
// attribute's text, or in a stylesheet's, such as a <style> element's,
// meets the same rules.
//
// A reviewed exception in packages/appearance/audit-exceptions.json names a
// file, a rule, why the file may break it, and who reviewed it, such as a
// photograph's own colors. An exception no finding needs anymore fails the
// audit too, so the list only ever holds what's still true.
//
// It's a lint over code the build already trusts: it reads text, without
// running anything, and it skips tests, fixtures, and test support, which
// hold known-bad values on purpose.

import fs from 'node:fs';
import path from 'node:path';
import {
  COMPOSITION_SETTABLE,
  compositionSettableProblem,
  isPlatformToken,
  MOTION_SLOT,
  motionSlotValue,
  PLATFORM_TOKENS,
  scanCss,
  shapeRadii,
  stripCssComments,
  variantAtRuleProblem,
} from '@portfolio/variant-contract';
import { isPlatformAttribute } from '../boundary';
import { ROOT_ONLY } from '../scales';

export const SOURCE_AUDIT_RULES = [
  'color-literal',
  'font-family',
  'font-face',
  'import',
  'shadow',
  'radius',
  'blur',
  'timing',
  'legacy-property',
  'custom-property',
  'motion-gate',
  'layout-line',
  'escape',
  'at-rule',
] as const;
export type SourceAuditRule = (typeof SOURCE_AUDIT_RULES)[number];

/** What fixes each rule's finding. */
export const SOURCE_AUDIT_REMEDIES: Readonly<Record<SourceAuditRule, string>> = {
  'color-literal':
    "Read the color scheme's token, var(--color-<role>), or, in a canvas, the boundary's computed value of one.",
  'font-family': 'Set the text in a role: data-type-role, or var(--type-<role>-font-family).',
  'font-face': 'Ship the font in a typography pack, whose compiler writes its @font-face.',
  import: 'Put the rules in the one stylesheet your package exports.',
  shadow: "Use the design language's shadow, var(--ui-shadow-card) or another --ui-shadow-* token.",
  radius:
    "Use the design language's radius, such as var(--ui-radius-card) or var(--ui-radius-media).",
  blur: "Use the design language's blur, var(--ui-backdrop-blur).",
  timing: 'Take durations from the design language: var(--ui-motion-fast), -standard, or -slow.',
  'legacy-property': "The v1 properties are gone: read #19's --color-, --ui-, and --type- tokens.",
  'custom-property':
    'A variant declares --layout-* properties alone: read the --color-, --ui-, and --type- tokens for the rest.',
  'motion-gate':
    "Give the loop animation-play-state: var(--motion-ambient-state), after its last animation shorthand, so reduced motion, static, print, and the runtime's pause stop it, under the kit runtime's [data-kit-runtime] gate too.",
  'layout-line':
    'Write a --layout-line-* or --layout-rule-* as a border shorthand: a px width, solid or dashed, and var(--color-<role>), currentColor, or a color-mix() of roles.',
  'at-rule':
    'Use @media, @supports, @layer, @container, @keyframes, and @import alone, and test a selector in @supports as one compound of pseudo-classes and pseudo-elements, such as selector(:popover-open).',
  escape:
    "Write names, selectors, and values out in full, with no backslash outside a string: an escape gets past every check that reads the name. A string's escape, such as content: '\\201C', is fine.",
};

/**
 * The remedy a finding's line gets: its rule's, but for a stylesheet's bad
 * value of a property COMPOSITION_SETTABLE names (row 73), which says the
 * values that property takes.
 */
export function sourceAuditRemedy(rule: SourceAuditRule, found: string): string {
  if (rule === 'custom-property') {
    const declaration = /^(--[a-z0-9-]+)\s*:\s*(.*?)\s*;?$/.exec(found);
    const problem = declaration
      ? compositionSettableProblem(declaration[1]!, declaration[2]!)
      : null;
    if (problem) return problem;
  }
  return SOURCE_AUDIT_REMEDIES[rule];
}

export interface SourceAuditFinding {
  /** Relative to the repository root, with `/` separators. */
  readonly path: string;
  readonly line: number;
  readonly rule: SourceAuditRule;
  /** What the line holds. */
  readonly found: string;
}

export interface AuditException {
  readonly path: string;
  readonly rule: SourceAuditRule;
  readonly reason: string;
  readonly reviewer: string;
}

const CSS = /\.css$/;
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const SKIPPED_DIRS = new Set([
  'node_modules',
  '__fixtures__',
  '__tests__',
  'test-support',
  'fixtures',
  'dist',
  'coverage',
]);
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** Every audited file under `dir`: stylesheets and code, without tests, fixtures, or dependencies. */
export function auditedFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(full);
      } else if (
        CSS.test(entry.name) ||
        (CODE.test(entry.name) && !entry.name.endsWith('.d.ts') && !TEST_FILE.test(entry.name))
      ) {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found.sort();
}

/** The color functions CSS has, by name. */
const COLOR_FUNCTION = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
/** A hex color: three, four, six, or eight digits, not part of a longer word. */
const HEX = /(?<![\w&-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/i;
const LEGACY = /--(?:paper|ink)(?![\w-])|--(?:kc|vt)-[\w-]+/;
/** A literal time: `2s`, `.4s`, `1.5S`, `200ms`, `1e3ms`. */
const TIME = /(?<![\w.-])(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?m?s(?![\w-])/i;
/** A hex color in a string in code: the whole string, or a value after a space, colon, comma, or parenthesis, as CSS text has it. */
const HEX_IN_CODE = /(?:^|[\s:,(])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/i;

/**
 * The named colors the audit refuses, the list primitives/styles.test.ts
 * holds the shared primitives to: CSS Color 4's 148 names, then its system
 * colors, the deprecated ones among them, which a forced-colors stylesheet
 * is the place for. `transparent`, `currentColor`, and the CSS-wide
 * keywords stay allowed.
 */
export const NAMED_COLORS = [
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'green',
  'greenyellow',
  'grey',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'rebeccapurple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen',
  'accentcolor',
  'accentcolortext',
  'activetext',
  'buttonborder',
  'buttonface',
  'buttontext',
  'canvas',
  'canvastext',
  'field',
  'fieldtext',
  'graytext',
  'highlight',
  'highlighttext',
  'linktext',
  'mark',
  'marktext',
  'selecteditem',
  'selecteditemtext',
  'visitedtext',
  'activeborder',
  'activecaption',
  'appworkspace',
  'background',
  'buttonhighlight',
  'buttonshadow',
  'captiontext',
  'inactiveborder',
  'inactivecaption',
  'inactivecaptiontext',
  'infobackground',
  'infotext',
  'menu',
  'menutext',
  'scrollbar',
  'threeddarkshadow',
  'threedface',
  'threedhighlight',
  'threedlightshadow',
  'threedshadow',
  'window',
  'windowframe',
  'windowtext',
] as const;
/** A named color as a word of its own: not part of a longer name, and not a function such as `tan()`. */
const NAMED = new RegExp(`(?<![\\w-])(?:${NAMED_COLORS.join('|')})(?![\\w(-])`, 'i');

/** The properties whose value is a color, where a named color is one. */
const COLOR_PROPERTY =
  /^(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end))?(?:-color)?|outline(?:-color)?|fill|stroke|caret-color|accent-color|column-rule(?:-color)?|text-decoration(?:-color)?|text-emphasis(?:-color)?|box-shadow|text-shadow|stop-color|flood-color|lighting-color)$/;
const RADIUS = /^border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius$/;
/** What a basic shape's `round` may hold beside its tokens: no corner, or the `/` between two radii. */
const SHAPE_CORNER = /^(?:0(?:px|rem|em|%)?|\/)$/i;
const TIMING = /^(?:transition|animation)(?:-duration|-delay)?$/;
const WIDE = 'inherit|initial|unset|revert|revert-layer';
/** A template interpolation's placeholder: a value the code reads from elsewhere. */
const SLOT = '·';

/**
 * `css` with each comment blanked, keeping every newline so line numbers hold, as CSS Syntax 3
 * reads comments: a `/*` inside a string or an unquoted url() is text (K-5 round 3, R3-H2),
 * the reading the variant stylesheet compiler shares.
 */
function withoutComments(css: string): string {
  return stripCssComments(css);
}

/** Each `var(--name[, fallback])` in `value`, with where it sits, its parentheses balanced. */
function varsIn(
  value: string,
): { start: number; end: number; name: string; fallback: string | null }[] {
  const found: { start: number; end: number; name: string; fallback: string | null }[] = [];
  const opener = /(?<![\w-])var\(\s*(--[\w-]+)\s*(,)?/gi;
  for (let match = opener.exec(value); match; match = opener.exec(value)) {
    let depth = 1;
    let i = match.index + match[0].length;
    const fallbackStart = i;
    for (; i < value.length && depth > 0; i++) {
      if (value[i] === '(') depth++;
      else if (value[i] === ')') depth--;
    }
    found.push({
      start: match.index,
      end: i,
      name: match[1]!,
      fallback: match[2] ? value.slice(fallbackStart, i - 1).trim() : null,
    });
    opener.lastIndex = i;
  }
  return found;
}

/** `value` with each `var()` replaced, outermost first, by what `replace` gives it. */
function replaceVars(
  value: string,
  replace: (found: { name: string; fallback: string | null }) => string,
): string {
  let out = '';
  let at = 0;
  for (const found of varsIn(value)) {
    out += value.slice(at, found.start) + replace(found);
    at = found.end;
  }
  return out + value.slice(at);
}

/** What a stylesheet's checks know beyond one declaration: its own --layout-* values, and whose file it is. */
interface DeclarationContext {
  /**
   * Each --layout-* property the file declares, by name, with every value
   * it gives it: a later rule may give it another, so each one must pass.
   */
  readonly layout: ReadonlyMap<string, readonly string[]>;
  /** A variant package's stylesheet, where a custom property of its own is a --layout-* one alone. */
  readonly variant: boolean;
  /** The --layout-* properties the package's code sets, whose values no stylesheet check can read. */
  readonly fromCode: ReadonlySet<string>;
  /** The selector the declaration sits under, or '' when it's unknown. */
  readonly selector?: string;
  /** A declaration in code, a style value or a style attribute's text, rather than a stylesheet's. */
  readonly code?: boolean;
}

/** A composition's motion slots, by the part of the name after --layout-motion-. */

/**
 * Whether a duration may read the --layout-* property `name`: one the file
 * declares, whose every value, followed through each --layout-* property
 * it reads in turn, holds no literal time and reaches no motion slot,
 * which would carry a composition's own duration past reduced motion and
 * the pause (M2). An undeclared one, or one the package's code sets, fails
 * closed.
 */
function layoutTiming(
  name: string,
  context: DeclarationContext,
  seen: ReadonlySet<string> = new Set(),
): boolean {
  if (MOTION_SLOT.test(name) || seen.has(name)) return false;
  const values = layoutValues(name, context);
  if (values === null) return false;
  const next = new Set([...seen, name]);
  return values.every((own) => {
    if (TIME.test(fallbacksOf(own)) || TIME.test(own.replace(/var\([^()]*\)/g, ' '))) return false;
    return varsIn(own).every(
      ({ name: inner }) =>
        ((inner.startsWith('--ui-') || inner.startsWith('--motion-')) && isPlatformToken(inner)) ||
        (inner.startsWith('--layout-') && layoutTiming(inner, context, next)),
    );
  });
}

/** The values the file gives a --layout-* property, or null when one of them can't be read. */
function layoutValues(name: string, context: DeclarationContext): readonly string[] | null {
  if (context.fromCode.has(name)) return null;
  return context.layout.get(name) ?? null;
}

/**
 * Whether `value` reads only tokens and the `keywords`: every `var()` names
 * a property with one of `prefixes`, or a --layout-* one whose own value
 * passes, and its fallback, if it has one, passes too; nothing is left but
 * keywords, commas, and a template's interpolations.
 */
function onlyTokens(
  value: string,
  prefixes: readonly string[],
  keywords: RegExp,
  context: DeclarationContext,
  seen: ReadonlySet<string> = new Set(),
): boolean {
  let ok = true;
  const rest = replaceVars(value, ({ name, fallback }) => {
    const values = name.startsWith('--layout-') ? layoutValues(name, context) : null;
    const named =
      // A token the platform defines, never a name in its namespace a composition made up (K-5).
      (prefixes.some((prefix) => name.startsWith(prefix)) && isPlatformToken(name)) ||
      (values !== null &&
        !seen.has(name) &&
        values.every((own) =>
          onlyTokens(own, prefixes, keywords, context, new Set([...seen, name])),
        ));
    if (!named) ok = false;
    if (fallback !== null && !onlyTokens(fallback, prefixes, keywords, context, seen)) ok = false;
    return ' ';
  });
  const words = rest.split(/[\s,]+/).filter((word) => word !== '' && word !== SLOT);
  return ok && words.every((word) => keywords.test(word));
}

/** `value` with each `var()` as its fallback, all the way down, or nothing where it has none. */
function fallbacksOf(value: string): string {
  return replaceVars(value, ({ fallback }) =>
    fallback === null ? ' ' : ` ${fallbacksOf(fallback)} `,
  );
}

/** Whether a gradient in `value` names a color among its stops. */
function gradientNamesColor(value: string): boolean {
  const opener = /(?<![\w-])(?:repeating-)?(?:linear|radial|conic)-gradient\(/gi;
  for (const match of value.matchAll(opener)) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    for (; i < value.length && depth > 0; i++) {
      if (value[i] === '(') depth++;
      else if (value[i] === ')') depth--;
    }
    if (NAMED.test(value.slice(start, i - 1))) return true;
  }
  return false;
}

/** The property a declaration sets, lowercase and without a -webkit- or -moz- prefix. */
function propertyName(raw: string): string {
  const name = raw.trim().toLowerCase();
  return name.startsWith('--') ? raw.trim() : name.replace(/^-(?:webkit|moz)-/, '');
}

/**
 * A line or a rule of the composition's own (K-5): --layout-line-* or
 * --layout-rule-*, but not a name ending in -height, -size, -length, -clamp,
 * or -gap, which is geometry, such as --layout-line-height.
 */
const LINE_PROPERTY = /^--layout-(?:line|rule)-(?!(?:[\w-]*-)?(?:height|size|length|clamp|gap)$)/;

/** The colors a mask may name (K-5): it reads them for their alpha alone. */
const MASK_COLORS = /(?<![\w&#-])(?:black|white|transparent|#000(?:000)?|#fff(?:fff)?)(?![\w-])/gi;

/** Whether every selector in `selector` styles a ::before or an ::after, as a mask's may (K-5). */
function onPseudoElements(selector: string): boolean {
  const list = items(selector);
  return list.length > 0 && list.every((each) => /::(?:before|after)$/i.test(each.trim()));
}

/**
 * Whether `value` is a line's color (K-5): `currentColor`, a
 * `var(--color-<role>)`, a --layout-* property the file declares as one, or
 * a `color-mix()` in some color space of those and `transparent`, each with
 * a percentage or none.
 */
function lineColor(
  value: string,
  context: DeclarationContext,
  seen: ReadonlySet<string> = new Set(),
  mixed = false,
): boolean {
  const text = value.trim();
  if (/^currentcolor$/i.test(text) || (mixed && /^transparent$/i.test(text))) return true;
  const reference = /^var\(\s*(--[\w-]+)\s*\)$/.exec(text);
  if (reference) {
    const name = reference[1]!;
    if (name.startsWith('--color-')) return true;
    if (!name.startsWith('--layout-') || seen.has(name)) return false;
    const values = layoutValues(name, context);
    const next = new Set([...seen, name]);
    return values !== null && values.every((own) => lineColor(own, context, next, mixed));
  }
  const mix =
    /^color-mix\(\s*in\s+[a-z-]+(?:\s+(?:shorter|longer|increasing|decreasing)\s+hue)?\s*,(.*)\)$/is.exec(
      text,
    );
  if (!mix) return false;
  const parts = items(mix[1]!);
  return (
    parts.length === 2 &&
    parts.every((part) => {
      const percent = /^(.*?)(?:\s+(?:\d+(?:\.\d*)?|\.\d+)%)?$/s.exec(part.trim())![1]!;
      return lineColor(percent, context, seen, true);
    })
  );
}

/**
 * Whether `value` is a line (K-5): a border shorthand of a px width,
 * `solid` or `dashed`, and a line's color, in any order, each once.
 */
function lineValue(value: string, context: DeclarationContext): boolean {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value.trim()) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (/\s/.test(char) && depth === 0) {
      if (current) parts.push(current);
      current = '';
    } else current += char;
  }
  if (current) parts.push(current);
  if (parts.length !== 3) return false;
  const width = parts.filter((part) => /^(?:\d+(?:\.\d*)?|\.\d+)px$/i.test(part));
  const style = parts.filter((part) => /^(?:solid|dashed)$/i.test(part));
  const color = parts.filter((part) => !width.includes(part) && !style.includes(part));
  return (
    width.length === 1 && style.length === 1 && color.length === 1 && lineColor(color[0]!, context)
  );
}

/** Whether the file gives --layout-round one value, 50%, which makes it a radius (K-5). */
function roundDeclared(context: DeclarationContext): boolean {
  const values = layoutValues('--layout-round', context);
  return values !== null && values.length > 0 && values.every((own) => own.trim() === '50%');
}

/** The rules one declaration breaks. */
function declarationRules(
  rawProperty: string,
  rawValue: string,
  context: DeclarationContext,
): SourceAuditRule[] {
  const rules: SourceAuditRule[] = [];
  const property = propertyName(rawProperty);
  const value = rawValue.trim();
  if (value === '') return rules;
  if (LEGACY.test(property) || LEGACY.test(value)) rules.push('legacy-property');
  const custom = property.startsWith('--');
  const layout = property.startsWith('--layout-');
  // A composition sets only --layout-* properties, and the platform properties
  // COMPOSITION_SETTABLE names (K-5), each in its value forms, in a stylesheet
  // alone (row 73): code's inline style is in no layer.
  if (
    custom &&
    !layout &&
    context.variant &&
    (!COMPOSITION_SETTABLE.includes(property) ||
      context.code === true ||
      compositionSettableProblem(property, value) !== null)
  )
    rules.push('custom-property');
  if (MOTION_SLOT.test(property) && !motionSlotValue(property, value)) rules.push('timing');
  // A named color, past the names of the properties var() reads, a url(),
  // and a quoted string: in a color property, a layout property, or a
  // gradient's stops in any property.
  // A mask on a ::before or ::after reads its colors for their alpha alone (K-5).
  const masked =
    /^mask(?:-image)?$/.test(property) && onPseudoElements(context.selector ?? '')
      ? value.replace(MASK_COLORS, ' ')
      : value;
  const words = replaceVars(masked, ({ fallback }) => ` ${fallback ?? ''} `)
    .replace(/(?<![\w-])url\([^)]*\)/gi, ' ')
    .replace(/"[^"]*"|'[^']*'/g, ' ');
  if (
    HEX.test(masked) ||
    literalColorFunction(masked) ||
    ((COLOR_PROPERTY.test(property) || layout) && NAMED.test(words)) ||
    gradientNamesColor(words)
  ) {
    rules.push('color-literal');
  }
  if (context.variant && LINE_PROPERTY.test(property) && !lineValue(value, context)) {
    rules.push('layout-line');
  }
  // --layout-round is a radius, 50%, and nothing else (K-5).
  if (property === '--layout-round' && value !== '50%') rules.push('radius');
  // A layout property of the variant's own holds a length, never appearance:
  // the rules below read it where a declaration uses it.
  if (custom) return [...new Set(rules)];
  const wide = new RegExp(`^(?:${WIDE})$`, 'i');
  if (
    (property === 'font-family' || property === 'font') &&
    !onlyTokens(value, ['--type-'], wide, context)
  ) {
    rules.push('font-family');
  }
  if (
    (property === 'box-shadow' || property === 'text-shadow') &&
    !onlyTokens(value, ['--ui-'], new RegExp(`^(?:none|${WIDE})$`, 'i'), context)
  ) {
    rules.push('shadow');
  }
  // var(--layout-round) is a radius where the file declares it 50% (K-5).
  const radius = roundDeclared(context)
    ? value.replace(/var\(\s*--layout-round\s*\)/g, '0')
    : value;
  if (
    RADIUS.test(property) &&
    !onlyTokens(radius, ['--ui-'], new RegExp(`^(?:0(?:px|rem|em|%)?|${WIDE})$`, 'i'), context)
  ) {
    rules.push('radius');
  }
  // A clip-path's or a shape-outside's `round` is a corner: a --ui-radius-* token
  // or none (K-5 review L1). circle(50%) gives none.
  if (
    (property === 'clip-path' || property === 'shape-outside') &&
    shapeRadii(radius).some(
      (corner) => !onlyTokens(corner, ['--ui-radius-'], SHAPE_CORNER, context),
    )
  ) {
    rules.push('radius');
  }
  if (property === 'filter' || property === 'backdrop-filter') {
    for (const match of value.matchAll(/(?<![\w-])blur\(/gi)) {
      let depth = 1;
      let i = match.index + match[0].length;
      const start = i;
      for (; i < value.length && depth > 0; i++) {
        if (value[i] === '(') depth++;
        else if (value[i] === ')') depth--;
      }
      if (!onlyTokens(value.slice(start, i - 1), ['--ui-'], /^0(?:px)?$/, context)) {
        rules.push('blur');
        break;
      }
    }
  }
  if (TIMING.test(property)) {
    const literal =
      TIME.test(value.replace(/var\(\s*--[\w-]+/g, 'var(')) || TIME.test(fallbacksOf(value));
    const tokens = varsIn(value).every(
      ({ name }) =>
        ((name.startsWith('--ui-') || name.startsWith('--motion-')) && isPlatformToken(name)) ||
        (name.startsWith('--layout-') && layoutTiming(name, context)),
    );
    if (literal || !tokens) rules.push('timing');
  }
  return [...new Set(rules)];
}

/** One statement of a stylesheet: a declaration, an at-rule ending in `;`, or a block's prelude. */
interface Statement {
  readonly kind: 'declaration' | 'at-rule' | 'prelude';
  readonly text: string;
  /** Where its first character is, in the text it came from. */
  readonly offset: number;
  /** The style rule's selector it sits in, through any at-rules, or '' at the top. */
  readonly selector: string;
}

/**
 * The statements of `css`, comments gone: what comes before each `{` is a
 * prelude, and what ends at a `;` or `}` a declaration or an at-rule, a
 * declaration across as many lines as it takes. Quotes and parentheses, a
 * data: URL's `;` among them, end nothing.
 */
function statementsOf(css: string): Statement[] {
  const text = withoutComments(css);
  const statements: Statement[] = [];
  const selectors: string[] = [];
  let start = 0;
  let depth = 0;
  const flush = (end: number, closer: string) => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const body = raw.trim();
    const selector = selectors.at(-1) ?? '';
    if (body !== '') {
      const kind = closer === '{' ? 'prelude' : body.startsWith('@') ? 'at-rule' : 'declaration';
      statements.push({ kind, text: body, offset: start + lead, selector });
    }
    if (closer === '{') selectors.push(body.startsWith('@') ? selector : body);
    else if (closer === '}') selectors.pop();
    start = end + 1;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"' || char === "'") {
      for (i++; i < text.length && text[i] !== char; i++) if (text[i] === '\\') i++;
    } else if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (char === '{' || char === ';' || char === '}')) flush(i, char);
  }
  flush(text.length, '');
  return statements;
}

/** The line `offset` is on, in a text whose line starts are `starts`. */
function lineAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

type Found = { line: number; rule: SourceAuditRule; found: string };

/** What the audit takes beyond the text: whether a variant package holds it, and, for a stylesheet, the --layout-* properties the package's code sets. */
export interface StylesheetOptions {
  readonly variant?: boolean;
  readonly layoutFromCode?: ReadonlySet<string>;
}

/**
 * A composition's root rule: its scope selector, and, since K-5, attribute
 * selectors of the composition's own on the same element, such as
 * [data-variant='terra-field'][data-tf-field='quiet'], each item of a list
 * alike. The platform's attributes aren't the composition's: a rule keyed
 * on one would let a mode, a pack, a plate, or a fallback move the
 * platform's defaults. No manifest records a composition's prefix, so the
 * audit refuses every attribute ../boundary's isPlatformAttribute() names,
 * the boundary's and the kit runtime's, from the one list a test holds to
 * what the boundary sets.
 */
const ROOT_SCOPE = /^\[data-variant=(['"])[\w-]+\1\]/;
const ROOT_ATTRIBUTE = /^\[\s*(data-[\w-]+)\s*(?:[~|^$*]?=\s*(?:'[^']*'|"[^"]*"|[\w-]+)\s*)?\]/;

function isRootRule(selector: string): boolean {
  const list = items(selector);
  return (
    list.length > 0 &&
    list.every((each) => {
      const scope = ROOT_SCOPE.exec(each.trim());
      if (!scope) return false;
      let rest = each.trim().slice(scope[0].length);
      while (rest !== '') {
        const attribute = ROOT_ATTRIBUTE.exec(rest);
        if (!attribute || isPlatformAttribute(attribute[1]!)) return false;
        rest = rest.slice(attribute[0].length);
      }
      return true;
    })
  );
}

/**
 * Whether a root rule may sit in this at-rule and still be the root rule: @media
 * and @layer, @supports with no selector(), and a @container size query, with no
 * style() or scroll-state(). Each is a condition on the page, never on the element.
 */
function transparentAtRule(prelude: string): boolean {
  const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase();
  const reads = (fn: string) => new RegExp(`(?<![\\w-])${fn}\\(`, 'i').test(prelude);
  if (name === 'media' || name === 'layer') return true;
  if (name === 'supports') return !reads('selector');
  if (name === 'container') return !reads('style') && !reads('scroll-state');
  return false;
}
/** What a rule under any other at-rule counts as: no root rule, however its selector reads. */
const NOT_ROOT = '\0';

/**
 * Where `css` declares one of the platform's defaults a composition may set
 * in its root rule alone (../scales ROOT_ONLY) in any other rule: a value
 * on a descendant would win there over the boundary's, which the widths,
 * the grid, and the motion the platform works out from them are computed
 * on, reduced motion's hold among them. @media, @layer, @supports, and a
 * @container size query around the root rule are fine; under any other
 * at-rule, @scope, a @container style() query, or @supports selector()
 * among them, the rule isn't the root rule any more (K-5 delta review Nit1).
 */
function rootOnlyOutsideRoot(css: string): number[] {
  const text = withoutComments(css);
  const found: number[] = [];
  const selectors: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"' || char === "'") {
      for (i++; i < text.length && text[i] !== char; i++) if (text[i] === '\\') i++;
    } else if (char === '(') {
      for (let depth = 1; depth > 0 && i + 1 < text.length;) {
        i++;
        if (text[i] === '(') depth++;
        else if (text[i] === ')') depth--;
      }
    } else if (char === '{') {
      const prelude = text.slice(start, i).trim();
      const outer = selectors.at(-1) ?? '';
      if (outer === NOT_ROOT) selectors.push(NOT_ROOT);
      else if (!prelude.startsWith('@')) selectors.push(prelude);
      else selectors.push(transparentAtRule(prelude) ? outer : NOT_ROOT);
      start = i + 1;
    } else if (char === ';' || char === '}') {
      const raw = text.slice(start, i);
      const body = raw.trim();
      const colon = body.indexOf(':');
      if (colon > 0 && ROOT_ONLY.test(body.slice(0, colon).trim())) {
        if (!isRootRule(selectors.at(-1) ?? '')) {
          found.push(start + raw.length - raw.trimStart().length);
        }
      }
      if (char === '}') selectors.pop();
      start = i + 1;
    }
  }
  return found;
}

/** A finite iteration count over this runs for as long as a page shows: the audit and the budget count read it as infinite (K-4 M3). */
export const LOOP_ITERATIONS = 1000;

/** Whether an `animation` shorthand item or an `animation-iteration-count` value loops: `infinite`, or a count over LOOP_ITERATIONS. */
export function loops(value: string): boolean {
  if (/(?<![\w-])infinite(?![\w-])/i.test(value)) return true;
  return value
    .split(/\s+/)
    .some(
      (word) => /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(word) && Number(word) > LOOP_ITERATIONS,
    );
}

/** The comma-separated items of a value, its parentheses' commas left alone. */
function items(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++;
    else if (value[i] === ')') depth = Math.max(0, depth - 1);
    else if (value[i] === ',' && depth === 0) {
      out.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(value.slice(start).trim());
  return out;
}

const AMBIENT_STATE = /^var\(\s*--motion-ambient-state\s*\)$/i;

interface LoopBlock {
  loopAt: number | null;
  stateSet: boolean;
}

/**
 * Where a variant's `css` runs an infinite animation no gate stops, and
 * where it sets `animation-play-state: running` (motion-gate, K-4 M2):
 * each rule's own declarations, nested rules walked, as the file comment
 * says.
 */
function ungatedLoops(css: string): number[] {
  const text = withoutComments(css);
  const found: number[] = [];
  const stack: LoopBlock[] = [];
  let start = 0;
  const declaration = (raw: string, at: number) => {
    const block = stack.at(-1);
    const body = raw.trim();
    const colon = body.indexOf(':');
    if (!block || colon <= 0) return;
    const property = body.slice(0, colon).trim().toLowerCase();
    const value = body.slice(colon + 1).trim();
    const offset = at + raw.length - raw.trimStart().length;
    if (property === 'animation-play-state') {
      if (items(value).some((item) => /^running$/i.test(item))) found.push(offset);
      block.stateSet = items(value).every((item) => AMBIENT_STATE.test(item));
    } else if (property === 'animation') {
      // The shorthand resets the play state to running.
      block.stateSet = false;
      if (items(value).some(loops)) block.loopAt ??= offset;
    } else if (property === 'animation-iteration-count') {
      if (items(value).some(loops)) block.loopAt ??= offset;
    }
  };
  const close = () => {
    const block = stack.pop();
    if (block && block.loopAt !== null && !block.stateSet) found.push(block.loopAt);
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"' || char === "'") {
      for (i++; i < text.length && text[i] !== char; i++) if (text[i] === '\\') i++;
    } else if (char === '(') {
      for (let depth = 1; depth > 0 && i + 1 < text.length;) {
        i++;
        if (text[i] === '(') depth++;
        else if (text[i] === ')') depth--;
      }
    } else if (char === '{') {
      stack.push({ loopAt: null, stateSet: false });
      start = i + 1;
    } else if (char === ';') {
      declaration(text.slice(start, i), start);
      start = i + 1;
    } else if (char === '}') {
      declaration(text.slice(start, i), start);
      close();
      start = i + 1;
    }
  }
  return found;
}

/** The findings in one stylesheet's text, each on the line its statement starts. */
export function auditStylesheetText(text: string, options: StylesheetOptions = {}): Found[] {
  const statements = statementsOf(text);
  const layout = new Map<string, string[]>();
  for (const { kind, text: body } of statements) {
    const colon = body.indexOf(':');
    if (kind === 'declaration' && colon > 0 && body.startsWith('--layout-')) {
      const name = body.slice(0, colon).trim();
      layout.set(name, [...(layout.get(name) ?? []), body.slice(colon + 1).trim()]);
    }
  }
  const context: DeclarationContext = {
    layout,
    variant: options.variant === true,
    fromCode: options.layoutFromCode ?? new Set(),
  };
  const starts = lineStarts(text);
  const lines = text.split('\n');
  const findings: Found[] = [];
  // A backslash outside a string, once a line (K-5 round 5).
  const escaped = new Set<number>();
  for (const offset of scanCss(text).escapes) escaped.add(lineAt(starts, offset));
  for (const line of escaped)
    findings.push({ line, rule: 'escape', found: lines[line - 1]!.trim() });
  if (context.variant) {
    for (const offset of rootOnlyOutsideRoot(text)) {
      const line = lineAt(starts, offset);
      findings.push({ line, rule: 'custom-property', found: lines[line - 1]!.trim() });
    }
    for (const offset of ungatedLoops(text)) {
      const line = lineAt(starts, offset);
      findings.push({ line, rule: 'motion-gate', found: lines[line - 1]!.trim() });
    }
  }
  for (const statement of statements) {
    const { kind, text: body, offset } = statement;
    const line = lineAt(starts, offset);
    const report = (rule: SourceAuditRule) =>
      findings.push({ line, rule, found: lines[line - 1]!.trim() });
    if ((kind === 'prelude' || kind === 'at-rule') && context.variant && body.startsWith('@')) {
      const name = /^@[\w-]*/.exec(body)![0];
      if (variantAtRuleProblem(name, body.slice(name.length))) report('at-rule');
    }
    if (kind === 'prelude') {
      if (/^@font-face\b/i.test(body)) report('font-face');
      if (LEGACY.test(body)) report('legacy-property');
      continue;
    }
    if (kind === 'at-rule') {
      if (/^@import\b/i.test(body)) report('import');
      if (LEGACY.test(body)) report('legacy-property');
      continue;
    }
    const colon = body.indexOf(':');
    if (colon <= 0) continue;
    const where = { ...context, selector: statement.selector };
    for (const rule of declarationRules(body.slice(0, colon), body.slice(colon + 1), where)) {
      report(rule);
    }
  }
  return findings;
}

/** The spacing properties the space lint reads: padding, margin, and gap, with their longhands. */
const SPACING_PROPERTY =
  /^(?:(?:padding|margin)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|(?:row-|column-)?gap)$/;
/** A nonzero length in px, rem, or vw, not part of a longer word. */
const RAW_LENGTH = /(?<![\w.#-])-?(?:\d+(?:\.\d*)?|\.\d+)(?:px|rem|vw)(?![\w-])/gi;

/** The nonzero px, rem, and vw lengths `value` holds, reading each --layout-* property the file declares through to its own values. */
function rawLengths(
  value: string,
  layout: ReadonlyMap<string, readonly string[]>,
  seen: ReadonlySet<string> = new Set(),
): string[] {
  const found: string[] = [];
  const rest = replaceVars(value, ({ name, fallback }) => {
    const own = name.startsWith('--layout-') && !seen.has(name) ? layout.get(name) : undefined;
    for (const text of own ?? []) found.push(...rawLengths(text, layout, new Set([...seen, name])));
    if (fallback !== null) found.push(...rawLengths(fallback, layout, seen));
    return ' ';
  });
  for (const [length] of rest.matchAll(RAW_LENGTH)) {
    if (Number.parseFloat(length) !== 0) found.push(length);
  }
  return found;
}

/** A padding, margin, or gap that sets a length of its own, not one from the shared space scale. */
export interface SpacingLiteral {
  readonly line: number;
  readonly property: string;
  /** The lengths it sets, as written. */
  readonly lengths: readonly string[];
}

/**
 * The redesign's space lint (dossier G3): each padding, margin, and gap in
 * a stylesheet that sets a px, rem, or vw length of its own, directly or
 * through a --layout-* property the file declares, rather than reading
 * the shared scale (var(--space-*), or the platform's --layout-grid-* and
 * --layout-width-* defaults). Zero, auto, and percentages pass. It reports
 * and never fails a check: the compositions move onto the scale with their
 * redesigns, and space-lint.test.ts lists what's left as a todo until then.
 *
 * A platform slot, --layout-width-*, --layout-grid-*, or --layout-motion-*,
 * that the composition sets in its root rule is the platform's default, as
 * the audit allows it there, so the lint reads it as one and doesn't follow
 * it to its value, such as Raw Grid's `--layout-width-page: 90rem`. The same
 * slot set on a descendant is a length of the composition's own, and reports.
 */
export function spacingLiterals(text: string): SpacingLiteral[] {
  const statements = statementsOf(text);
  const layout = new Map<string, string[]>();
  for (const { kind, text: body, selector } of statements) {
    const colon = body.indexOf(':');
    if (kind === 'declaration' && colon > 0 && body.startsWith('--layout-')) {
      const name = body.slice(0, colon).trim();
      if (ROOT_ONLY.test(name) && isRootRule(selector)) continue;
      layout.set(name, [...(layout.get(name) ?? []), body.slice(colon + 1).trim()]);
    }
  }
  const starts = lineStarts(text);
  const found: SpacingLiteral[] = [];
  for (const { kind, text: body, offset } of statements) {
    const colon = body.indexOf(':');
    if (kind !== 'declaration' || colon <= 0) continue;
    const property = propertyName(body.slice(0, colon));
    if (!SPACING_PROPERTY.test(property)) continue;
    const lengths = rawLengths(body.slice(colon + 1).trim(), layout);
    if (lengths.length > 0) found.push({ line: lineAt(starts, offset), property, lengths });
  }
  return found;
}

/** The properties the translucency lint reads as a background. */
const BACKGROUND_PROPERTY = /^background(?:-color|-image)?$/;
/** A background value that paints nothing. */
const NO_BACKGROUND = /^(?:none|transparent|inherit|initial|unset|revert|revert-layer)$/i;
/** The pane surface token: the weight the platform's surface stack gives a surface over its material. */
const PANE_OPACITY = /^var\(\s*--ui-surface-opacity\s*\)$/i;
/** The language's material tokens, translucent under a glass language: every platform token named a material. */
const MATERIAL_TOKENS: ReadonlySet<string> = new Set(
  PLATFORM_TOKENS.filter((name) => /-material(?:-|$)/.test(name)),
);
/** The color functions that take the relative syntax, `from <color> ... / <alpha>`. */
const RELATIVE_COLOR = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi;

/** A background a composition paints translucent itself, and how. */
export interface TranslucentBackground {
  readonly line: number;
  readonly selector: string;
  readonly property: string;
  /**
   * `transparent-mix`, a color-mix() with transparent; `partial-mix`, a
   * color-mix() whose two weights add up to less than 100%;
   * `relative-alpha`, a relative color with an alpha below 1; `opacity`,
   * an opacity between 0 and 1 on a rule that paints a background; or
   * `bare-material`, a material token with no surface layer over it.
   */
  readonly why: 'transparent-mix' | 'partial-mix' | 'relative-alpha' | 'opacity' | 'bare-material';
}

/** The arguments of each call `opener` finds in `value`, nested calls included, parentheses balanced. */
function callArguments(value: string, opener: RegExp): string[] {
  const found: string[] = [];
  for (const match of value.matchAll(new RegExp(opener.source, 'gi'))) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    for (; i < value.length && depth > 0; i++) {
      if (value[i] === '(') depth++;
      else if (value[i] === ')') depth--;
    }
    found.push(value.slice(start, i - 1));
  }
  return found;
}

/** `value`'s words outside parentheses. */
function topLevelWords(value: string): string[] {
  const words: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value.trim()) {
    if (char === '(') depth++;
    else if (char === ')') depth--;
    if (/\s/.test(char) && depth === 0) {
      if (current) words.push(current);
      current = '';
    } else current += char;
  }
  if (current) words.push(current);
  return words;
}

/** A percentage's number, or undefined for anything else. */
function percentage(text: string | undefined): number | undefined {
  const match = /^(-?(?:\d+(?:\.\d*)?|\.\d+))%$/.exec(text ?? '');
  return match ? Number(match[1]) : undefined;
}

/** How `value` paints translucent, or undefined where it's opaque or the pane surface stack's. */
function translucency(value: string): TranslucentBackground['why'] | undefined {
  for (const args of callArguments(value, /(?<![\w-])color-mix\(/)) {
    // The first argument is the color space; each color after it may carry a weight.
    const colors = items(args)
      .slice(1)
      .map((item) => {
        const words = topLevelWords(item);
        const weight = words.find((word) => /%$/.test(word) || PANE_OPACITY.test(word));
        return { color: words.filter((word) => word !== weight).join(' '), weight };
      });
    const clear = colors.findIndex(({ color }) => /^transparent$/i.test(color));
    if (clear !== -1) {
      const other = colors[1 - clear];
      // The language's surface stack, a surface at --ui-surface-opacity over its material.
      if (other?.weight !== undefined && PANE_OPACITY.test(other.weight)) continue;
      if (percentage(colors[clear]!.weight) === 0 || percentage(other?.weight) === 100) continue;
      return 'transparent-mix';
    }
    const weights = colors.map(({ weight }) => percentage(weight));
    if (weights.length === 2 && weights.every((each) => each !== undefined)) {
      if (weights[0]! + weights[1]! < 100) return 'partial-mix';
    }
  }
  for (const args of callArguments(value, RELATIVE_COLOR)) {
    if (!/^\s*from\s/i.test(args)) continue;
    const words = topLevelWords(args);
    const slash = words.lastIndexOf('/');
    const alpha = slash === -1 ? undefined : words[slash + 1];
    if (alpha === undefined) continue;
    const amount = alpha.endsWith('%') ? percentage(alpha) : Number(alpha) * 100;
    if (amount !== undefined && Number.isFinite(amount) && amount < 100) return 'relative-alpha';
  }
  return undefined;
}

/** `value` and each value of a --layout-* property it reads, all the way down, as `layout` holds them. */
function withLayoutValues(
  value: string,
  layout: ReadonlyMap<string, readonly string[]>,
  seen: ReadonlySet<string> = new Set(),
): string[] {
  const texts = [value];
  for (const { name } of varsIn(value)) {
    if (!name.startsWith('--layout-') || seen.has(name)) continue;
    for (const own of layout.get(name) ?? []) {
      texts.push(...withLayoutValues(own, layout, new Set([...seen, name])));
    }
  }
  return texts;
}

/** `value` with each --layout-* property the file declares replaced by its first value, all the way down. */
function expandLayout(
  value: string,
  layout: ReadonlyMap<string, readonly string[]>,
  seen: ReadonlySet<string> = new Set(),
): string {
  return replaceVars(value, ({ name, fallback }) => {
    const own = name.startsWith('--layout-') && !seen.has(name) ? layout.get(name)?.[0] : undefined;
    if (own !== undefined) return expandLayout(own, layout, new Set([...seen, name]));
    return `var(${name}${fallback === null ? '' : `, ${fallback}`})`;
  });
}

/** Whether `value` reads a material token. */
function readsMaterial(value: string): boolean {
  return varsIn(value).some(
    ({ name, fallback }) =>
      MATERIAL_TOKENS.has(name) || (fallback !== null && readsMaterial(fallback)),
  );
}

/** Whether a background layer is a surface: the surface stack's weight, or a surface role. */
function surfaceLayer(layer: string): boolean {
  return /var\(\s*--(?:ui-surface-opacity|color-surface-[\w-]+)\s*[,)]/i.test(layer);
}

/** Whether a background's layers paint a material with no surface layer above it, the first layer on top. */
function bareMaterial(value: string): boolean {
  const layers = items(value);
  const material = layers.findIndex(readsMaterial);
  return material !== -1 && !layers.slice(0, material).some(surfaceLayer);
}

/** Whether every selector of a rule styles a dialog's ::backdrop, a scrim see-through on purpose. */
function onBackdrop(selector: string): boolean {
  const list = items(selector);
  return list.length > 0 && list.every((each) => /::backdrop\s*$/i.test(each));
}

/**
 * The translucency lint (C's P-8 note, item 8): each background a
 * composition paints translucent itself, a color-mix() with transparent, a
 * color-mix() whose weights add up to less than 100%, a relative color with
 * an alpha below 1, directly or through a --layout-* property the file
 * declares, and an opacity between 0 and 1 under a selector that paints a
 * background. A pane painted so never meets the language's 97% glass floor,
 * which --ui-surface-opacity carries, so the lint skips the language's own
 * pane surface stack, a surface at var(--ui-surface-opacity) over
 * var(--ui-surface-material), and reports a material token painted with no
 * surface layer over it, as Aurora's mockup panes paint it. A dialog's
 * ::backdrop is a scrim, see-through on purpose, and passes. It reports and
 * never fails a check, like the
 * space lint: translucency-lint.test.ts lists what's left as a todo, and the
 * rule refuses once the compositions are clean.
 */
export function translucentBackgrounds(text: string): TranslucentBackground[] {
  const statements = statementsOf(text);
  const layout = new Map<string, string[]>();
  for (const { kind, text: body } of statements) {
    const colon = body.indexOf(':');
    if (kind === 'declaration' && colon > 0 && body.startsWith('--layout-')) {
      const name = body.slice(0, colon).trim();
      layout.set(name, [...(layout.get(name) ?? []), body.slice(colon + 1).trim()]);
    }
  }
  const declarations = statements.flatMap(({ kind, text: body, offset, selector }) => {
    const colon = body.indexOf(':');
    if (kind !== 'declaration' || colon <= 0) return [];
    const property = propertyName(body.slice(0, colon));
    const value = body
      .slice(colon + 1)
      .replace(/!important\s*$/i, '')
      .trim();
    return onBackdrop(selector) ? [] : [{ property, value, offset, selector }];
  });
  // The selectors that paint a background, in any rule of the file.
  const painted = new Set(
    declarations
      .filter(
        ({ property, value }) => BACKGROUND_PROPERTY.test(property) && !NO_BACKGROUND.test(value),
      )
      .map(({ selector }) => selector),
  );
  // The selectors whose background images hold a surface layer, which a background-color sits under.
  const surfaced = new Set(
    declarations
      .filter(
        ({ property, value }) =>
          (property === 'background' || property === 'background-image') &&
          items(expandLayout(value, layout)).some(surfaceLayer),
      )
      .map(({ selector }) => selector),
  );
  const starts = lineStarts(text);
  const found: TranslucentBackground[] = [];
  for (const { property, value, offset, selector } of declarations) {
    let why: TranslucentBackground['why'] | undefined;
    if (BACKGROUND_PROPERTY.test(property)) {
      why = withLayoutValues(value, layout)
        .map(translucency)
        .find((each) => each !== undefined);
      const expanded = expandLayout(value, layout);
      // A background-color sits under the rule's images; any other background's layers are its own.
      const bare =
        property === 'background-color' ? !surfaced.has(selector) : bareMaterial(expanded);
      if (!why && readsMaterial(expanded) && bare) why = 'bare-material';
    } else if (property === 'opacity' && painted.has(selector)) {
      const dims = withLayoutValues(value, layout).some((each) => {
        const amount = each.endsWith('%') ? percentage(each) : Number(each) * 100;
        return amount !== undefined && amount > 0 && amount < 100;
      });
      if (dims) why = 'opacity';
    }
    if (why) found.push({ line: lineAt(starts, offset), selector, property, why });
  }
  return found;
}

/**
 * Whether a color function in a string in code holds a literal of its own.
 * One whose every argument is an interpolation, such as
 * `rgba(${r}, ${g}, ${b}, ${alpha})`, writes out a color the code read from
 * somewhere else, such as a boundary's computed `--color-<role>`, so it
 * names no color itself. What the interpolations hold is code, which the
 * audit reads for strings of its own.
 */
function literalColorFunction(text: string): boolean {
  for (const match of text.matchAll(new RegExp(COLOR_FUNCTION.source, 'gi'))) {
    const start = match.index + match[0].length;
    const end = text.indexOf(')', start);
    const args = text.slice(start, end === -1 ? undefined : end);
    if (/[^\s,/·]/.test(args)) return true;
  }
  return false;
}

/** One string in code: its text, interpolations as placeholders, where it starts, and the code just before it. */
interface CodeString {
  readonly value: string;
  readonly offset: number;
  readonly before: string;
  /** The code just after it. */
  readonly after: string;
}

/**
 * Every string literal in `code`, comments and regular expressions aside: a
 * quoted string, and a template literal across as many lines as it takes,
 * each interpolation in it read as code in turn, so a string inside one is
 * a string too.
 */
function stringsOf(code: string): CodeString[] {
  const found: CodeString[] = [];
  /** Reads code from `i` until an unmatched `}` (inside an interpolation) or the end; returns where it stopped. */
  const readCode = (from: number, inInterpolation: boolean): number => {
    let depth = 0;
    let i = from;
    let last = '';
    while (i < code.length) {
      const char = code[i]!;
      const next = code[i + 1];
      if (char === '/' && next === '/') {
        while (i < code.length && code[i] !== '\n') i++;
        continue;
      }
      if (char === '/' && next === '*') {
        const end = code.indexOf('*/', i + 2);
        i = end === -1 ? code.length : end + 2;
        continue;
      }
      if (char === '/' && (last === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(last))) {
        // A regular expression literal.
        let inClass = false;
        for (i++; i < code.length && code[i] !== '\n'; i++) {
          if (code[i] === '\\') i++;
          else if (code[i] === '[') inClass = true;
          else if (code[i] === ']') inClass = false;
          else if (code[i] === '/' && !inClass) break;
        }
        i++;
        last = '/';
        continue;
      }
      if (char === '"' || char === "'") {
        const start = i;
        for (i++; i < code.length && code[i] !== char && code[i] !== '\n'; i++) {
          if (code[i] === '\\') i++;
        }
        found.push({
          value: code.slice(start + 1, i),
          offset: start,
          before: code.slice(Math.max(0, start - 80), start),
          after: code.slice(i + 1, i + 20),
        });
        i++;
        last = 'a';
        continue;
      }
      if (char === '`') {
        const start = i;
        let text = '';
        for (i++; i < code.length && code[i] !== '`'; i++) {
          if (code[i] === '\\') {
            text += code[i]! + (code[i + 1] ?? '');
            i++;
          } else if (code[i] === '$' && code[i + 1] === '{') {
            text += SLOT;
            i = readCode(i + 2, true);
          } else {
            text += code[i];
          }
        }
        found.push({
          value: text,
          offset: start,
          before: code.slice(Math.max(0, start - 80), start),
          after: code.slice(i + 1, i + 20),
        });
        i++;
        last = 'a';
        continue;
      }
      if (char === '{') depth++;
      if (char === '}') {
        if (depth === 0 && inInterpolation) return i;
        depth--;
      }
      if (!/\s/.test(char)) last = /[\w$)\]]/.test(char) ? 'a' : char;
      i++;
    }
    return i;
  };
  readCode(0, false);
  return found.sort((a, b) => a.offset - b.offset);
}

/** The CSS property a string in code is the value of, by the code before it, or null. */
function styleKeyBefore(before: string): string | null {
  const match =
    /(?:^|[{,\s(])(?:(['"])(-{0,2}[a-zA-Z][\w-]*)\1|([a-zA-Z_$][\w$]*))\s*:\s*\(?\s*$/.exec(
      before,
    ) ??
    /\.setProperty\(\s*(['"])(-{0,2}[a-zA-Z][\w-]*)\1\s*,\s*$/.exec(before) ??
    /\.style\.([a-zA-Z]+)\s*=\s*$/.exec(before) ??
    /\.style\[\s*['"]([\w-]+)['"]\s*\]\s*=\s*$/.exec(before);
  if (!match) return null;
  const key = match[2] ?? match[3] ?? match[1];
  if (!key) return null;
  // camelCase to kebab-case, WebkitBackdropFilter to -webkit-backdrop-filter.
  return key.includes('-')
    ? key
    : key
        .replace(/^(Webkit|Moz)(?=[A-Z])/, (vendor) => `-${vendor.toLowerCase()}`)
        .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
        .toLowerCase();
}

/** Whether the code before a string assigns it to a canvas's or an element's color. */
const COLOR_ASSIGNMENT = /(?:fillStyle|strokeStyle|shadowColor|\.style\.[a-zA-Z]*[cC]olor)\s*=\s*$/;

/**
 * The custom property a string in code names as a style key, by the code
 * around it: an object key (`{ '--ui-radius': r }`), or what
 * `setProperty()` or `style[...]` sets. Null for any other string.
 */
function customKeyOf({ value, before, after }: CodeString): string | null {
  if (!/^--[\w-]+$/.test(value)) return null;
  const key =
    /^\s*:/.test(after) ||
    /\.setProperty\(\s*$/.test(before) ||
    (/\.style\[\s*$/.test(before) && /^\s*\]\s*=/.test(after));
  return key ? value : null;
}

/** The --layout-* properties a module's code sets as style keys, whose values its package's stylesheets can't read. */
export function layoutSetInCode(text: string): Set<string> {
  const names = new Set<string>();
  for (const found of stringsOf(text)) {
    const key = customKeyOf(found);
    if (key?.startsWith('--layout-')) names.add(key);
  }
  return names;
}

/** The findings in one module's text: what its strings hold, as CSS, as a style value, or as a color. */
export function auditCodeText(text: string, options: StylesheetOptions = {}): Found[] {
  const starts = lineStarts(text);
  const lines = text.split('\n');
  const findings: Found[] = [];
  const variant = options.variant === true;
  const context: DeclarationContext = {
    layout: new Map(),
    variant,
    fromCode: new Set(),
    code: true,
  };
  for (const found of stringsOf(text)) {
    const { value, offset, before } = found;
    const line = lineAt(starts, offset);
    const report = (rule: SourceAuditRule, at = line) =>
      findings.push({ line: at, rule, found: lines[at - 1]!.trim() });
    if (HEX_IN_CODE.test(value) || literalColorFunction(value)) report('color-literal');
    if (LEGACY.test(value)) report('legacy-property');
    // A variant's code sets no token but its own --layout-* ones, as its stylesheet does.
    const key = customKeyOf(found);
    if (
      variant &&
      key !== null &&
      // COMPOSITION_SETTABLE's are a stylesheet's to set (row 73), never code's.
      (!key.startsWith('--layout-') || ROOT_ONLY.test(key))
    ) {
      report('custom-property');
    }
    const property = styleKeyBefore(before);
    const assigned = COLOR_ASSIGNMENT.test(before);
    if (
      (assigned || (property !== null && COLOR_PROPERTY.test(propertyName(property)))) &&
      new RegExp(`^\\s*${NAMED.source}\\s*$`, 'i').test(value)
    ) {
      report('color-literal');
    }
    if (property !== null) {
      for (const rule of declarationRules(property, value, context)) report(rule);
    }
    // CSS in a string: a style attribute's declarations, or a stylesheet,
    // such as a <style> element's text, each finding on its own line.
    if (/[{}]/.test(value) && /:/.test(value)) {
      for (const finding of auditStylesheetText(value, { variant })) {
        report(finding.rule, line + finding.line - 1);
      }
    } else if (
      (property === null || property === 'css-text') &&
      /(?:^|;)\s*-{0,2}[a-z][\w-]*\s*:/i.test(value)
    ) {
      for (const declaration of value.split(';')) {
        const colon = declaration.indexOf(':');
        if (colon <= 0) continue;
        const name = declaration.slice(0, colon).trim();
        if (!/^-{0,2}[a-z][\w-]*$/i.test(name)) continue;
        // A style attribute's own platform default would hold for that subtree alone.
        if (variant && ROOT_ONLY.test(name)) report('custom-property');
        for (const rule of declarationRules(name, declaration.slice(colon + 1), context)) {
          report(rule);
        }
      }
    }
  }
  // The kit runtime's gate is the kit's to set, never a composition's (motion-gate, K-4).
  if (variant) {
    const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) =>
      comment.replace(/[^\n]/g, ' '),
    );
    for (const match of code.matchAll(/data-kit-runtime|kitRuntime/g)) {
      const at = lineAt(starts, match.index);
      findings.push({ line: at, rule: 'motion-gate', found: lines[at - 1]!.trim() });
    }
  }
  // One finding per line and rule.
  const seen = new Set<string>();
  return findings.filter(({ line, rule }) => {
    const key = `${line} ${rule}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Whether `dir` is a variant package: its package.json says portfolio.kind is variant. */
function isVariantPackage(dir: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      portfolio?: { kind?: string };
    };
    return pkg.portfolio?.kind === 'variant';
  } catch {
    return false;
  }
}

/** Every finding in `dirs`, each path relative to `root`. */
export function auditSources(root: string, dirs: readonly string[]): SourceAuditFinding[] {
  return dirs.flatMap((dir) => {
    const variant = isVariantPackage(dir);
    const files = auditedFiles(dir).map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }));
    // A --layout-* property the package's code sets fails closed in its stylesheets.
    const layoutFromCode = new Set(
      files.flatMap(({ file, text }) => (CSS.test(file) ? [] : [...layoutSetInCode(text)])),
    );
    return files.flatMap(({ file, text }) => {
      const relative = path.relative(root, file).split(path.sep).join('/');
      const found = CSS.test(file)
        ? auditStylesheetText(text, { variant, layoutFromCode })
        : auditCodeText(text, { variant });
      return found.map((finding) => ({ path: relative, ...finding }));
    });
  });
}

/** A reason that says nothing, which no review accepts. */
const PLACEHOLDER = /^(?:todo|tbd|fixme|n\/?a|none|-+|\.+|x+|test)$/i;

/** The exceptions file's problems, by entry. */
export function exceptionProblems(entries: unknown): string[] {
  if (!Array.isArray(entries)) return ['audit-exceptions.json holds an array of exceptions.'];
  const problems: string[] = [];
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const at = `Exception ${index + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`${at} isn't an object with path, rule, reason, and reviewer.`);
      return;
    }
    const keys = Object.keys(entry).sort().join(',');
    if (keys !== 'path,reason,reviewer,rule') {
      problems.push(
        `${at} has the keys ${keys}; it takes path, rule, reason, and reviewer, and nothing else.`,
      );
      return;
    }
    const { path: file, rule, reason, reviewer } = entry as Record<string, unknown>;
    if (
      typeof file !== 'string' ||
      file.trim() === '' ||
      file.startsWith('/') ||
      file.includes('\\')
    ) {
      problems.push(`${at}'s path is a file relative to the repository root, with / separators.`);
    }
    if (typeof rule !== 'string' || !(SOURCE_AUDIT_RULES as readonly string[]).includes(rule)) {
      problems.push(`${at}'s rule is one of ${SOURCE_AUDIT_RULES.join(', ')}.`);
    }
    if (
      typeof reason !== 'string' ||
      reason.trim().length < 20 ||
      PLACEHOLDER.test(reason.trim())
    ) {
      problems.push(`${at}'s reason says why the file may break the rule, in a sentence.`);
    }
    if (typeof reviewer !== 'string' || reviewer.trim() === '') {
      problems.push(`${at} names who reviewed it.`);
    }
    const key = `${String(file)} ${String(rule)}`;
    if (seen.has(key)) problems.push(`${at} repeats ${key}.`);
    seen.add(key);
  });
  return problems;
}

export interface SourceAuditResult {
  /** Findings no exception covers. */
  readonly findings: readonly SourceAuditFinding[];
  /** Exceptions no finding needs: each one fails, so the list stays true. */
  readonly unused: readonly AuditException[];
  readonly exceptionProblems: readonly string[];
}

/** The findings in `dirs`, less what the reviewed exceptions cover. */
export function runSourceAudit(
  root: string,
  dirs: readonly string[],
  exceptions: unknown,
): SourceAuditResult {
  const problems = exceptionProblems(exceptions);
  const accepted = problems.length === 0 ? (exceptions as AuditException[]) : [];
  const all = auditSources(root, dirs);
  const covers = (exception: AuditException, finding: SourceAuditFinding) =>
    exception.path === finding.path && exception.rule === finding.rule;
  return {
    findings: all.filter((finding) => !accepted.some((exception) => covers(exception, finding))),
    unused: accepted.filter((exception) => !all.some((finding) => covers(exception, finding))),
    exceptionProblems: problems,
  };
}

/** The variant packages under `packagesDir`: each directory whose package.json says portfolio.kind is variant, one level of grouping deep. */
export function variantPackageDirs(packagesDir: string): string[] {
  const found: string[] = [];
  const visit = (dir: string, depth: number) => {
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest)) {
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
        portfolio?: { kind?: string };
      };
      if (pkg.portfolio?.kind === 'variant') found.push(dir);
      return;
    }
    if (depth === 0) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        visit(path.join(dir, entry.name), depth - 1);
      }
    }
  };
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.'))
      visit(path.join(packagesDir, entry.name), 1);
  }
  return found.sort();
}

/** The reviewed exceptions, relative to the repository root. */
export const AUDIT_EXCEPTIONS_FILE = 'packages/appearance/audit-exceptions.json';

/** What the audit reads under `root`: every variant package in packages/, and the kit's source. */
export function sourceAuditDirs(root: string): string[] {
  return [
    ...variantPackageDirs(path.join(root, 'packages')),
    path.join(root, 'packages', 'kit', 'src'),
  ];
}

export interface SourceAuditReport {
  /** One line per finding no exception covers, exception no finding needs, and problem with the file. */
  readonly lines: readonly string[];
  /** How many files the audit read. */
  readonly files: number;
  /** How many reviewed exceptions the file holds. */
  readonly exceptions: number;
}

/**
 * The audit of the repository at `root`, against the exceptions in
 * `exceptionsFile`, as `pnpm check:appearance` reports it: each finding
 * with the line it's on and its remedy.
 */
export function sourceAuditReport(
  root: string,
  exceptionsFile = path.join(root, AUDIT_EXCEPTIONS_FILE),
): SourceAuditReport {
  const shown = path.relative(root, exceptionsFile).split(path.sep).join('/');
  let exceptions: unknown;
  try {
    exceptions = JSON.parse(fs.readFileSync(exceptionsFile, 'utf8'));
  } catch (error) {
    return {
      lines: [`${shown} doesn't read: ${(error as Error).message}`],
      files: 0,
      exceptions: 0,
    };
  }
  const dirs = sourceAuditDirs(root);
  const result = runSourceAudit(root, dirs, exceptions);
  return {
    lines: [
      ...result.exceptionProblems.map((problem) => `${shown}: ${problem}`),
      ...result.findings.map(
        ({ path: file, line, rule, found }) =>
          `${file}:${line} ${rule}: ${found} ${sourceAuditRemedy(rule, found)}`,
      ),
      ...result.unused.map(
        ({ path: file, rule }) =>
          `${shown} excepts ${file} from ${rule}, which no finding needs anymore. Remove the exception.`,
      ),
    ],
    files: dirs.reduce((sum, dir) => sum + auditedFiles(dir).length, 0),
    exceptions: Array.isArray(exceptions) ? exceptions.length : 0,
  };
}
