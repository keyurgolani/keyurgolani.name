// Character references in an attribute value, decoded as a browser decodes
// them, for #4's link rule to judge the URL a browser would follow: the
// renderer's links (markdown.ts) and the server's post-pass over its markup
// (markdown-sanitize.ts) both read hrefs through it.

/** The named references that spell ASCII, so a URL can hide behind them, and the no-break space. */
const NAMED: Readonly<Record<string, string>> = {
  Tab: '\t',
  NewLine: '\n',
  excl: '!',
  quot: '"',
  QUOT: '"',
  num: '#',
  dollar: '$',
  percnt: '%',
  amp: '&',
  AMP: '&',
  apos: "'",
  lpar: '(',
  rpar: ')',
  ast: '*',
  midast: '*',
  plus: '+',
  comma: ',',
  period: '.',
  sol: '/',
  colon: ':',
  semi: ';',
  lt: '<',
  LT: '<',
  equals: '=',
  gt: '>',
  GT: '>',
  quest: '?',
  commat: '@',
  lsqb: '[',
  lbrack: '[',
  bsol: '\\',
  rsqb: ']',
  rbrack: ']',
  Hat: '^',
  lowbar: '_',
  UnderBar: '_',
  grave: '`',
  DiacriticalGrave: '`',
  lcub: '{',
  lbrace: '{',
  verbar: '|',
  vert: '|',
  VerticalLine: '|',
  rcub: '}',
  rbrace: '}',
  nbsp: '\u00A0',
  NonBreakingSpace: '\u00A0',
};
/** The ones a browser also decodes without their semicolon. */
const LEGACY = new Set(['amp', 'AMP', 'lt', 'LT', 'gt', 'GT', 'quot', 'QUOT', 'nbsp']);
const REFERENCE = /&(?:#[xX]([0-9a-fA-F]+);?|#([0-9]+);?|([A-Za-z][A-Za-z0-9]*)(;?))/g;

/**
 * Character references decoded as a browser decodes an attribute value:
 * numeric ones with or without their semicolon, the names in NAMED, and a
 * legacy name without its semicolon unless `=` follows it. Any other `&`
 * stays as it is, and is escaped when the URL is written, so whatever isn't
 * decoded here reaches the page as text and never as a reference.
 */
export function decodeReferences(value: string): string {
  return value.replace(
    REFERENCE,
    (
      match: string,
      hex: string | undefined,
      decimal: string | undefined,
      name: string | undefined,
      semicolon: string | undefined,
      offset: number,
    ) => {
      if (hex !== undefined) return fromCodePoint(parseInt(hex, 16));
      if (decimal !== undefined) return fromCodePoint(parseInt(decimal, 10));
      if (name === undefined || !Object.hasOwn(NAMED, name)) return match;
      if (semicolon) return NAMED[name]!;
      // The name's letters and digits all matched, so only `=` can follow and stop it.
      return LEGACY.has(name) && value[offset + match.length] !== '=' ? NAMED[name]! : match;
    },
  );
}

/** A numeric reference's character: 0, a surrogate, or past U+10FFFF is U+FFFD, as in a browser. */
function fromCodePoint(value: number): string {
  if (value === 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return '\uFFFD';
  return String.fromCodePoint(value);
}
