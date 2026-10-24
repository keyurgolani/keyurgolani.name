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
//   but a `var(--ui-*)`;
// - `legacy-property`: the retired v1 properties, `--paper`, `--ink`, and
//   any `--kc-` or `--vt-` one;
// - `custom-property`: in a variant's stylesheet, a custom property of its
//   own that isn't a `--layout-*` one.
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
};

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
const TIMING = /^(?:transition|animation)(?:-duration|-delay)?$/;
const WIDE = 'inherit|initial|unset|revert|revert-layer';
/** A template interpolation's placeholder: a value the code reads from elsewhere. */
const SLOT = '·';

/** `css` without its comments, keeping every newline, so line numbers hold. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
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
      prefixes.some((prefix) => name.startsWith(prefix)) ||
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
  if (custom && !layout && context.variant) rules.push('custom-property');
  // A named color, past the names of the properties var() reads, a url(),
  // and a quoted string: in a color property, a layout property, or a
  // gradient's stops in any property.
  const words = replaceVars(value, ({ fallback }) => ` ${fallback ?? ''} `)
    .replace(/(?<![\w-])url\([^)]*\)/gi, ' ')
    .replace(/"[^"]*"|'[^']*'/g, ' ');
  if (
    HEX.test(value) ||
    literalColorFunction(value) ||
    ((COLOR_PROPERTY.test(property) || layout) && NAMED.test(words)) ||
    gradientNamesColor(words)
  ) {
    rules.push('color-literal');
  }
  // A layout property of the variant's own holds a length, never appearance:
  // the rules below read it where a declaration uses it.
  if (custom) return rules;
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
  if (
    RADIUS.test(property) &&
    !onlyTokens(value, ['--ui-'], new RegExp(`^(?:0(?:px|rem|em|%)?|${WIDE})$`, 'i'), context)
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
        name.startsWith('--ui-') ||
        (name.startsWith('--layout-') &&
          (layoutValues(name, context) ?? ['0s']).every(
            (own) => !TIME.test(fallbacksOf(own)) && !TIME.test(own.replace(/var\([^()]*\)/g, ' ')),
          )),
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
  let start = 0;
  let depth = 0;
  const flush = (end: number, closer: string) => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const body = raw.trim();
    if (body !== '') {
      const kind = closer === '{' ? 'prelude' : body.startsWith('@') ? 'at-rule' : 'declaration';
      statements.push({ kind, text: body, offset: start + lead });
    }
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
  for (const { kind, text: body, offset } of statements) {
    const line = lineAt(starts, offset);
    const report = (rule: SourceAuditRule) =>
      findings.push({ line, rule, found: lines[line - 1]!.trim() });
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
    for (const rule of declarationRules(body.slice(0, colon), body.slice(colon + 1), context)) {
      report(rule);
    }
  }
  return findings;
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
  const context: DeclarationContext = { layout: new Map(), variant, fromCode: new Set() };
  for (const found of stringsOf(text)) {
    const { value, offset, before } = found;
    const line = lineAt(starts, offset);
    const report = (rule: SourceAuditRule, at = line) =>
      findings.push({ line: at, rule, found: lines[at - 1]!.trim() });
    if (HEX_IN_CODE.test(value) || literalColorFunction(value)) report('color-literal');
    if (LEGACY.test(value)) report('legacy-property');
    // A variant's code sets no token but its own --layout-* ones, as its stylesheet does.
    const key = customKeyOf(found);
    if (variant && key !== null && !key.startsWith('--layout-')) report('custom-property');
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
    } else if (property === null && /(?:^|;)\s*-{0,2}[a-z][\w-]*\s*:/i.test(value)) {
      for (const declaration of value.split(';')) {
        const colon = declaration.indexOf(':');
        if (colon <= 0) continue;
        const name = declaration.slice(0, colon).trim();
        if (!/^-{0,2}[a-z][\w-]*$/i.test(name)) continue;
        for (const rule of declarationRules(name, declaration.slice(colon + 1), context)) {
          report(rule);
        }
      }
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
          `${file}:${line} ${rule}: ${found} ${SOURCE_AUDIT_REMEDIES[rule]}`,
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
