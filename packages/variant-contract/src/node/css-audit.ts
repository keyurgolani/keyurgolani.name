// The stylesheet half of the variant source audit (#5, Slice 3, item 5): a
// variant's CSS stays inside its own [data-variant] scope, nested rules and
// sibling combinators included, names its keyframes after its id, loads
// nothing from another host or another package, and leaves color, type,
// radius, and shadow to #19's appearance tokens. A variant that declares rtl
// uses logical properties, shorthands included.

import { parseCss, splitSelectors, type CssNode, type Position } from './css';

/** The codes this module reports, which audit.ts describes. */
export type CssCode =
  | 'audit.css-unscoped'
  | 'audit.css-remote-import'
  | 'audit.css-remote-url'
  | 'audit.css-bare-import'
  | 'audit.css-keyframes'
  | 'audit.css-physical'
  | 'audit.css-appearance';

export type CssReport = (code: CssCode, at: Position, message: string) => void;

export interface StylesheetTarget {
  /** The variant's id, the scope every selector starts with. */
  readonly id: string;
  /** Whether it declares rtl, which brings the physical-CSS rule. */
  readonly rtl: boolean;
}

/** At-rules that apply to the whole page, wherever they sit. */
const GLOBAL_AT_RULES = new Set([
  '@font-face',
  '@page',
  '@property',
  '@counter-style',
  '@font-feature-values',
  '@font-palette-values',
]);
/** At-rules whose blocks hold descriptors, which say what a font or a page is, not how anything looks. */
const DESCRIPTOR_BLOCKS = new Set([
  '@font-face',
  '@page',
  '@property',
  '@counter-style',
  '@font-palette-values',
]);
const KEYFRAMES = /^@(?:-[a-z]+-)?keyframes$/i;
const REMOTE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

/** Where each declaration sits, which decides the rules it gets. */
type Context = 'rules' | 'keyframes' | 'descriptors';

/** Every finding in one of a variant's stylesheets. */
export function auditStylesheet(text: string, target: StylesheetTarget, report: CssReport): void {
  const scope = scopePattern(target.id);
  const walk = (nodes: readonly CssNode[], parents: readonly string[] | null, context: Context) => {
    for (const node of nodes) {
      if (node.type === 'at-rule') {
        if (node.name === '@import') {
          checkImport(node.prelude, node.at, report);
          continue;
        }
        if (KEYFRAMES.test(node.name)) {
          const name = unquote(node.prelude.trim());
          if (name !== target.id && !name.startsWith(`${target.id}-`)) {
            report(
              'audit.css-keyframes',
              node.at,
              `names keyframes ${name}, which doesn't start with ${target.id}-.`,
            );
          }
          walk(node.children ?? [], null, 'keyframes');
          continue;
        }
        if (GLOBAL_AT_RULES.has(node.name) && parents === null) {
          report(
            'audit.css-unscoped',
            node.at,
            `has ${node.name}, which applies to the whole page.`,
          );
        }
        walk(
          node.children ?? [],
          parents,
          DESCRIPTOR_BLOCKS.has(node.name) ? 'descriptors' : context,
        );
      } else if (node.type === 'rule') {
        if (context === 'keyframes') {
          walk(node.children, null, 'keyframes');
          continue;
        }
        const selectors =
          parents === null ? splitSelectors(node.selector) : nest(parents, node.selector);
        let scoped = true;
        for (const selector of selectors) {
          const problem = scopeProblem(selector, scope, target.id);
          if (problem) {
            scoped = false;
            report('audit.css-unscoped', node.at, problem);
          }
        }
        // A rule already out of scope is reported once, not again for each rule nested in it.
        walk(node.children, scoped ? selectors : null, context);
      } else {
        checkDeclaration(node, target, context, report);
      }
    }
  };
  walk(parseCss(text), null, 'rules');
}

/** The appearance findings alone, for a stylesheet such as the kit's, which has no scope of its own. */
export function auditAppearance(text: string, report: CssReport): void {
  const walk = (nodes: readonly CssNode[], context: Context) => {
    for (const node of nodes) {
      if (node.type === 'at-rule') {
        walk(node.children ?? [], DESCRIPTOR_BLOCKS.has(node.name) ? 'descriptors' : context);
      } else if (node.type === 'rule') {
        walk(node.children, context);
      } else if (context !== 'descriptors') {
        const problem = appearanceProblem(node.property, node.value);
        if (problem) report('audit.css-appearance', node.at, problem);
      }
    }
  };
  walk(parseCss(text), 'rules');
}

function scopePattern(id: string): RegExp {
  const name = escape(id);
  return new RegExp(`^\\[\\s*data-variant\\s*=\\s*(?:"${name}"|'${name}'|${name})\\s*\\]`);
}

/**
 * What's wrong with where a selector reaches, or undefined when it's inside
 * the scope: it starts with the scope, and nothing after the scope's own
 * compound selector reaches a sibling with `+` or `~`.
 */
function scopeProblem(selector: string, scope: RegExp, id: string): string | undefined {
  const match = scope.exec(selector);
  if (!match) return `has the selector ${selector}, which isn't under [data-variant="${id}"].`;
  const rest = selector.slice(endOfCompound(selector, match[0].length)).trimStart();
  if (rest.startsWith('+') || rest.startsWith('~')) {
    return `has the selector ${selector}, which reaches past [data-variant="${id}"] to its siblings.`;
  }
  return undefined;
}

/** Where the compound selector running from `index` ends: at whitespace or a combinator. */
function endOfCompound(selector: string, index: number): number {
  let depth = 0;
  for (; index < selector.length; index++) {
    const char = selector[index]!;
    if (char === '"' || char === "'") {
      const close = selector.indexOf(char, index + 1);
      index = close < 0 ? selector.length : close;
    } else if (char === '(' || char === '[') {
      depth++;
    } else if (char === ')' || char === ']') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && /[\s>+~,]/.test(char)) {
      return index;
    }
  }
  return index;
}

/** A nested rule's selectors, written out against each of its parents', as the browser reads them. */
function nest(parents: readonly string[], selector: string): string[] {
  const nested: string[] = [];
  for (const child of splitSelectors(selector)) {
    for (const parent of parents) {
      nested.push(child.includes('&') ? child.split('&').join(parent) : `${parent} ${child}`);
    }
  }
  return nested;
}

function checkImport(prelude: string, at: Position, report: CssReport) {
  const target = importTarget(prelude);
  if (REMOTE.test(target)) {
    report('audit.css-remote-import', at, 'imports a stylesheet from another host.');
  } else if (!target.startsWith('./') && !target.startsWith('../')) {
    report(
      'audit.css-bare-import',
      at,
      `imports ${target}, a stylesheet from outside the package.`,
    );
  }
}

/** The URL an @import names: url(...), or a string. */
function importTarget(prelude: string): string {
  const trimmed = prelude.trim();
  const url = /^url\(\s*(['"]?)([^'")]*)\1\s*\)/i.exec(trimmed);
  if (url) return url[2]!.trim();
  const quoted = /^(['"])(.*?)\1/.exec(trimmed);
  return quoted ? quoted[2]! : (trimmed.split(/\s+/)[0] ?? '');
}

function checkDeclaration(
  node: Extract<CssNode, { type: 'declaration' }>,
  target: StylesheetTarget,
  context: Context,
  report: CssReport,
) {
  const { property, value } = node;
  if (target.rtl) {
    const physical = physicalProperty(property, value);
    if (physical) {
      report(
        'audit.css-physical',
        node.at,
        `uses ${physical}, which doesn't flip for right-to-left text.`,
      );
    }
  }
  for (const url of remoteUrls(value)) {
    report('audit.css-remote-url', node.at, `loads ${url}, from another host.`);
  }
  if (context !== 'descriptors') {
    const problem = appearanceProblem(property, value);
    if (problem) report('audit.css-appearance', node.at, problem);
  }
}

/** Every URL a value loads from another host: in url(), and in image-set() and src() strings. */
function remoteUrls(value: string): string[] {
  const found: string[] = [];
  for (const match of value.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
    const url = match[2]!.trim();
    if (REMOTE.test(url)) found.push(url);
  }
  if (/(?:^|[^a-z-])(?:-webkit-)?image-set\(|(?:^|[^a-z-])src\(/i.test(value)) {
    for (const match of value.matchAll(/(['"])([^'"]*)\1/g)) {
      if (REMOTE.test(match[2]!)) found.push(match[2]!);
    }
  }
  return found;
}

// Physical properties, for a variant that declares rtl.

const PHYSICAL_PROPERTY =
  /^(?:left|right|(?:margin|padding|scroll-margin|scroll-padding)-(?:left|right)|border-(?:left|right)(?:-(?:width|style|color))?|border-(?:top|bottom)-(?:left|right)-radius)$/;
/** Shorthands whose four values run top, right, bottom, left. */
const BOX_SHORTHANDS = new Set([
  'margin',
  'padding',
  'inset',
  'scroll-margin',
  'scroll-padding',
  'border-width',
  'border-style',
  'border-color',
]);

/** The physical part of a declaration, or undefined when it's logical. */
function physicalProperty(property: string, value: string): string | undefined {
  if (PHYSICAL_PROPERTY.test(property)) return property;
  if (
    ['text-align', 'float', 'clear'].includes(property) &&
    /^(?:left|right)\b/i.test(value.trim())
  ) {
    return `${property}: ${value.trim()}`;
  }
  if (BOX_SHORTHANDS.has(property)) {
    const values = splitValues(value);
    if (values.length === 4 && values[1] !== values[3]) return `${property}: ${value.trim()}`;
  }
  if (property === 'border-radius') {
    for (const radii of value.split('/')) {
      const [topLeft, topRight = topLeft, bottomRight = topLeft, bottomLeft = topRight] =
        splitValues(radii);
      if (topLeft !== topRight || bottomLeft !== bottomRight) {
        return `${property}: ${value.trim()}`;
      }
    }
  }
  return undefined;
}

/** A value's space-separated parts, keeping functions such as calc() whole. */
function splitValues(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value.trim()) {
    if (char === '(') depth++;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (/\s/.test(char) && depth === 0) {
      if (current) parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts;
}

// Appearance: #19's tokens own color, type, radius, and shadow.

const CSS_WIDE = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const SYSTEM_FONTS = new Set([
  'caption',
  'icon',
  'menu',
  'message-box',
  'small-caption',
  'status-bar',
]);
const RADIUS = /^border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius$/;
const COLOR_FUNCTION =
  /(?:^|[^a-z-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|device-cmyk)\(/i;
const HEX = /(?:^|[^&\w-])(#[0-9a-f]{3,8})\b/i;
/** Properties whose values a color name can stand in, where a word is a color. */
const COLOR_PROPERTY =
  /^(?:--.*|color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|outline(?:-color)?|(?:box|text)-shadow|fill|stroke|caret-color|accent-color|text-decoration(?:-color)?|text-emphasis(?:-color)?|column-rule(?:-color)?|scrollbar-color|flood-color|lighting-color|stop-color|filter|-webkit-text-(?:fill|stroke)(?:-color)?|-webkit-tap-highlight-color)$/;
/** CSS's named colors, which are raw colors too. System colors such as Canvas aren't: they follow the visitor's settings. */
const NAMED_COLORS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
    'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
    'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
    'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
    'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
    'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
    'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
);

/** Why a declaration sets appearance itself, or undefined when it's composition or a token. */
export function appearanceProblem(property: string, value: string): string | undefined {
  const trimmed = value.trim();
  if (/\bvar\(\s*--/.test(trimmed) || CSS_WIDE.has(trimmed.toLowerCase())) return undefined;
  if (property === 'font-family') return `sets font-family: ${trimmed}.`;
  if (property === 'font' && !SYSTEM_FONTS.has(trimmed.toLowerCase())) {
    return `sets font: ${trimmed}.`;
  }
  if (RADIUS.test(property) && !/^(?:0(?:[a-z%]+)?(?:\s+|\s*\/\s*|$))+$/i.test(trimmed)) {
    return `sets ${property}: ${trimmed}.`;
  }
  if (
    (property === 'box-shadow' || property === 'text-shadow') &&
    trimmed.toLowerCase() !== 'none'
  ) {
    return `sets ${property}: ${trimmed}.`;
  }
  if (/(?:^|[^a-z-])drop-shadow\(/i.test(trimmed)) return `sets a drop shadow: ${trimmed}.`;
  const color = rawColor(property, trimmed);
  return color === undefined ? undefined : `sets ${property} to ${color}, a raw color.`;
}

/** The first raw color in a value, outside its strings and url()s. */
function rawColor(property: string, value: string): string | undefined {
  const bare = value.replace(/(['"])(?:\\.|(?!\1)[^\\])*\1/g, ' ').replace(/url\([^)]*\)/gi, ' ');
  const hex = HEX.exec(bare);
  if (hex) return hex[1];
  const fn = COLOR_FUNCTION.exec(bare);
  if (fn) return `${fn[1]}()`;
  if (!COLOR_PROPERTY.test(property)) return undefined;
  for (const word of bare.toLowerCase().split(/[^a-z]+/)) {
    if (NAMED_COLORS.has(word)) return word;
  }
  return undefined;
}

function unquote(text: string): string {
  return /^(['"]).*\1$/.test(text) ? text.slice(1, -1) : text;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
