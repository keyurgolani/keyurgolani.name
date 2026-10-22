// What a pack's values may hold (#19, Slice 1, item 1). The compiler (Slice
// 2) writes each value into a custom property, so a value is CSS text that
// stays inside its declaration and loads nothing. A design language reaches
// color only through var(--color-<role>), never a literal, and references no
// other custom property.

import { COLOR_ROLES } from './tokens';

/** The characters a language value may use: no quote, brace, semicolon, backslash, #, !, @, :, or angle bracket. */
const LANGUAGE_CHARACTERS = /^[A-Za-z0-9 .,%()+\-*/_]+$/;

/** The functions a language value may call: math, gradients, color-mix, easing, transforms, and filters. */
const LANGUAGE_FUNCTIONS: ReadonlySet<string> = new Set([
  'var',
  'color-mix',
  'calc',
  'min',
  'max',
  'clamp',
  'linear-gradient',
  'radial-gradient',
  'conic-gradient',
  'repeating-linear-gradient',
  'repeating-radial-gradient',
  'repeating-conic-gradient',
  'cubic-bezier',
  'steps',
  'linear',
  'translate',
  'translatex',
  'translatey',
  'translatez',
  'translate3d',
  'scale',
  'scalex',
  'scaley',
  'scale3d',
  'rotate',
  'rotatex',
  'rotatey',
  'rotatez',
  'skew',
  'skewx',
  'skewy',
  'perspective',
  'blur',
  'brightness',
  'contrast',
  'saturate',
  'grayscale',
  'sepia',
  'hue-rotate',
  'invert',
  'opacity',
  'drop-shadow',
]);

/** Functions that make a color, which only a color scheme may. */
const COLOR_FUNCTIONS: ReadonlySet<string> = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
  'light-dark',
  'contrast-color',
  'device-cmyk',
]);

/** CSS named and system colors. `transparent` and `currentcolor` aren't palette colors, so they're allowed. */
const COLOR_KEYWORDS: ReadonlySet<string> = new Set(
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
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow ' +
    'yellowgreen accentcolor accentcolortext activetext buttonborder buttonface buttontext ' +
    'canvas canvastext field fieldtext graytext highlight highlighttext linktext mark marktext ' +
    'selecteditem selecteditemtext visitedtext activeborder activecaption appworkspace ' +
    'background buttonhighlight buttonshadow captiontext inactiveborder inactivecaption ' +
    'inactivecaptiontext infobackground infotext menu menutext scrollbar threeddarkshadow ' +
    'threedface threedhighlight threedlightshadow threedshadow window windowframe windowtext'
  ).split(' '),
);

const ROLES: ReadonlySet<string> = new Set(COLOR_ROLES);

/** Longer than any gradient a language needs. */
const MAX_LANGUAGE_VALUE = 2000;

/**
 * Why `value` can't be a design-language token, or null when it can. It's
 * CSS text using letters, digits, spaces, and `. , % ( ) + - * / _` only, so
 * no quote, brace, semicolon, comment, or backslash reaches the stylesheet;
 * it calls no url() and no function outside a fixed list; and its colors
 * are var(--color-<role>), with no fallback, no other custom property, and
 * no literal.
 */
export function languageValueProblem(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return 'must be CSS text, not empty.';
  if (value.trim() !== value) return 'must not start or end with whitespace.';
  if (value.length > MAX_LANGUAGE_VALUE) {
    return `must be at most ${MAX_LANGUAGE_VALUE} characters.`;
  }
  if (!LANGUAGE_CHARACTERS.test(value)) {
    return 'may use letters, digits, spaces, and . , % ( ) + - * / _ only: no quotes, braces, semicolons, backslashes, #, !, @, or colons.';
  }
  if (value.includes('/*') || value.includes('*/')) return "can't hold a comment.";
  let depth = 0;
  for (const character of value) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (depth < 0) return 'closes a parenthesis it never opened.';
  }
  if (depth !== 0) return 'leaves a parenthesis open.';

  for (const match of value.matchAll(/(-?[A-Za-z_][A-Za-z0-9_-]*)(\(?)/g)) {
    const name = match[1]!.toLowerCase();
    const call = match[2] === '(';
    // A dimension's unit, such as the px in 2px, isn't a word of its own.
    const before = value[match.index! - 1];
    if (before !== undefined && /[0-9.]/.test(before)) continue;
    if (call) {
      if (name === 'url') return "can't load anything, so url() isn't allowed.";
      if (COLOR_FUNCTIONS.has(name)) {
        return `can't make a color with ${name}(). Colors come from the scheme: use var(--color-<role>).`;
      }
      if (!LANGUAGE_FUNCTIONS.has(name)) return `calls ${name}(), which a language value can't.`;
      if (name === 'var') {
        const reference = /^var\(--color-([a-z0-9-]+)\)/.exec(value.slice(match.index!));
        if (!reference || !ROLES.has(reference[1]!)) {
          return 'may use var() only as var(--color-<role>), with a color role and no fallback.';
        }
      }
    } else if (COLOR_KEYWORDS.has(name)) {
      return `can't hold the color ${name}. Colors come from the scheme: use var(--color-<role>).`;
    }
  }
  return null;
}

/** CSS generic families, one of which ends every stack. */
const GENERIC_FAMILIES: ReadonlySet<string> = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
]);

/** Words an unquoted family can't be. */
const RESERVED_FAMILY_WORDS: ReadonlySet<string> = new Set([
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
  'default',
]);

const QUOTED_FAMILY = /^"[A-Za-z0-9 ._-]{1,60}"$/;
const UNQUOTED_FAMILY = /^-?[A-Za-z][A-Za-z0-9-]*(?: -?[A-Za-z][A-Za-z0-9-]*)*$/;

/**
 * Why `value` can't be a role's font-family, or null when it can: a list of
 * families, each quoted or a run of plain words, that ends with a generic
 * family, so every role falls back the same way everywhere.
 */
export function fontStackProblem(value: string): string | null {
  if (value.length > 300) return 'must be at most 300 characters.';
  const families = value.split(',').map((family) => family.trim());
  if (families.length > 12) return 'must name at most 12 families.';
  for (const family of families) {
    if (QUOTED_FAMILY.test(family)) continue;
    if (!UNQUOTED_FAMILY.test(family)) {
      return 'must be families separated by commas, each "quoted" (letters, digits, spaces, . _ -) or plain words, such as "Segoe UI", sans-serif.';
    }
    if (RESERVED_FAMILY_WORDS.has(family.toLowerCase())) {
      return `can't use ${family} as a family. Quote a family that's really called that.`;
    }
  }
  const last = families.at(-1)!;
  if (!GENERIC_FAMILIES.has(last)) {
    return `must end with a generic family: ${[...GENERIC_FAMILIES].join(', ')}.`;
  }
  return null;
}

export const REM = /^(?:0|[1-9]\d{0,1})(?:\.\d{1,4})?rem$/;
export const EM = /^(?:normal|0|-?(?:0|[1-9])(?:\.\d{1,4})?em)$/;
export const CH = /^[1-9]\d{0,2}ch$/;
export const VARIATION_SETTINGS =
  /^(?:normal|"[A-Za-z0-9]{4}" -?\d{1,4}(?:\.\d{1,4})?(?:, ?"[A-Za-z0-9]{4}" -?\d{1,4}(?:\.\d{1,4})?){0,15})$/;
/** An ISO 15924 script code, such as Latn. */
export const SCRIPT_CODE = /^[A-Z][a-z]{3}$/;
export const UNICODE_RANGE =
  /^U\+[0-9A-Fa-f?]{1,6}(?:-[0-9A-Fa-f]{1,6})?(?:, ?U\+[0-9A-Fa-f?]{1,6}(?:-[0-9A-Fa-f]{1,6})?){0,63}$/;
