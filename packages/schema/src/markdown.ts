import type { z } from 'zod';

// The Markdown cap (#10): a Markdown field's size and shape, measured before
// anything lexes it, and the limits every Markdown field keeps to. A field
// over a limit is a document finding at its pointer, so the pair is refused
// before any renderer sees it, the browser's included. The kit's renderers
// run the same measure and render a field over a limit as escaped text, so a
// field that skipped validation can't take a page with it either.
//
// The measure is one pass over the text, a line at a time, with no regular
// expression: linear in the field's length, and browser-safe, since #7's
// preview and #9's import check documents in the browser. It never runs
// marked. It follows marked's own rules for what a line continues: the `>`
// of each open quote, the indent of each open list item, the lazy lines
// marked lets into both, and the fences and indented code it leaves inert.
// Where it can't tell what marked would make of a line, it counts the line.
//
// Block mode is how a field validates and how renderMarkdown reads it: code
// is inert there. renderInlineMarkdown reads a whole field as one phrase, with
// no blocks and so no code, and its inline mode counts the marks on every
// line. Every count is per field, not per paragraph.
//
// The limits come from timing marked 15.0.12 through both renderers (#58's
// token walker and marked.parse), block and inline, on hostile shapes at
// doubling sizes, and from an adversarial search over every dimension at
// once (packages/kit/src/markdown-cap.test.ts runs it); times below are
// medians on the development machine. Every fixture, profession pair, the
// example, and the long-text contract fixture sit at least 4 times inside
// each limit.

/** What a Markdown field holds that makes marked slow or deep. */
export interface MarkdownShape {
  /** UTF-16 code units, as JavaScript counts a string. */
  readonly length: number;
  /** The most `>` markers that open or continue a block quote on one line. */
  readonly quoteDepth: number;
  /** The most list items open at once. */
  readonly listDepth: number;
  /** The most lines one list item runs, from its marker line to a blank line or the next marker. */
  readonly listItemLines: number;
  /**
   * The most block quotes and list items marked nests one line in, counting
   * the levels a lazy line adds: a line that continues a quote without its
   * `>`, after one that opened a list or another quote inside it, makes
   * marked lex everything after it again, one level deeper.
   */
  readonly nestingDepth: number;
  /** Table cells: each table's columns times its rows, the header row included, over the field. */
  readonly tableCells: number;
  /** `]:` pairs, each of which may close a link reference definition's label. */
  readonly definitions: number;
  /**
   * `*`, `_`, `~`, `!`, and backticks: the marks that start a token inside a
   * word. One escaped with a backslash doesn't count, and neither does any
   * but a backtick with whitespace on both sides.
   */
  readonly inlineMarks: number;
  /** Each `(` inside a link's destination, or opening its title, once for every link it's in. */
  readonly linkParens: number;
  /** `<` characters. */
  readonly angleBrackets: number;
  /** The most of `? ! . , : ; * _ ' " ~ ( ) &` in one bare web address. */
  readonly urlPunctuation: number;
}

/**
 * How a renderer reads a field: `block` as renderMarkdown does, where fenced
 * and indented code is inert, or `inline` as renderInlineMarkdown does, where
 * nothing is code and every line's marks count.
 */
export type MarkdownMode = 'block' | 'inline';

/**
 * Most shapes stay linear to 64 KiB and then jump 10 to 25 times by 128 KiB,
 * a prose paragraph among them (6 ms, then 65 ms). Below that, marked spends
 * up to half a microsecond a token: 8 KiB of `[` takes 4.6 ms inline. Every
 * quote level past the first lexes its content again, so this is what the
 * quote limit multiplies.
 */
export const MARKDOWN_MAX_LENGTH = 8192;

/**
 * When a lazy line follows, each level past the first lexes the quote's
 * content again, and marked lexes its inline text again too: 1.8 times the
 * time at 2 levels, 4 at 4, 7.6 at 8, and 16.5 at 16. The kit's renderer
 * lexes the inline text once, which leaves 1.3 times at 4 levels and 4.6 at
 * 16. The old renderer runs out of stack near 4,000.
 */
export const MARKDOWN_MAX_QUOTE_DEPTH = 4;

/**
 * Each level lexes its items again, and `- - - x` nests a level every two
 * characters: 458 ms at 8,192 levels, and the old renderer runs out of stack
 * at 4,096. 8 levels, each item at the line limit, take under 13 ms.
 */
export const MARKDOWN_MAX_LIST_DEPTH = 8;

/**
 * Inside a list item marked lexes each line alone, and a setext-heading
 * pattern looks ahead from each one to the next blank line, so an item costs
 * its lines times its length: 8,192 one-word lines in one item take 206 ms,
 * 1,024 lines 4 ms.
 */
export const MARKDOWN_MAX_LIST_ITEM_LINES = 128;

/**
 * A lazy line inside a quote whose last child is a list or another quote
 * makes marked re-lex the rest of the quote inside that child, so `> - a`
 * and `b`, repeated, nest two levels a repeat: 2,048 levels in 8 KiB take
 * 268 ms, and with eight lists a repeat marked runs out of stack. 12 levels,
 * the most the quote and list limits allow on one line, add under a
 * millisecond to the text inside them.
 */
export const MARKDOWN_MAX_NESTING_DEPTH = 12;

/**
 * marked splits every row to the header's width and lexes each cell, empty
 * or not, about 110 ns a cell: a 1,024-column table of one-character rows is
 * 8 KiB and 323 ms. Each reference definition adds about 10 ns to every
 * cell, so 768 columns under 256 definitions take 2.9 s. 4,096 cells take
 * under 1 ms, 2.5 under 32 definitions, and 8 four quotes deep.
 */
export const MARKDOWN_MAX_TABLE_CELLS = 4096;

/**
 * Every inline lex lists the definitions and searches its text for each
 * reference, about 10 ns a definition for every cell, heading, link, and
 * emphasis marked lexes on its own: 256 definitions over a 4,096-cell table
 * take 12 ms, 32 take 2.5.
 */
export const MARKDOWN_MAX_DEFINITIONS = 32;

/**
 * An emphasis opener searches ahead for its closer, one regular-expression
 * match for every later mark and a scan of the rest, and every mark inside a
 * word makes the email-autolink lookahead rescan the word. Openers that never
 * close cost the square of their count: 128 take 0.7 ms, 256 take 2.6, 512
 * take 11, and 1,024 take 41. `x ` and 40,000 `*` take 2.8 s; 8 KiB of `!`,
 * 39 ms. Prose closes its marks as it goes, so a 2,500-character case study
 * with inline code and emphasis (156 marks) costs what plain text does.
 *
 * Text costs its length and these marks the square of their count, so the
 * marks a field may hold grow with the square root of its length: eight
 * times that root, and 64 in any field, so 128 in 256 characters, 256 in
 * 1,024, and 724 at the length limit. Marks that close, as in a glossary of
 * bold terms and inline code, cost what text does, and the count can't tell
 * them apart, so the limit leaves room for them: 240 in a 1,700-character
 * glossary. Marks that never close, at the limit, cost about 21 times what
 * as much ordinary prose costs block and 46 times inline, at any length. One
 * limit for every length would let a document of short fields cost many
 * times what as much prose does: at 256 marks a field, 47 times.
 */
export function inlineMarksFor(length: number): number {
  return Math.max(64, Math.floor(Math.sqrt(64 * length)));
}

/** The most inline marks a field holds, at the length limit: 724. */
export const MARKDOWN_MAX_INLINE_MARKS = inlineMarksFor(MARKDOWN_MAX_LENGTH);

/**
 * A link destination that won't close makes the link pattern back off a
 * character at a time, and every `(` it backs over starts a title that scans
 * to the next `)`, 2.5 ns a character. `[a](` repeated puts every later one
 * in every earlier destination: 22 ms at 1 KiB, 1.5 s at 4.
 */
export const MARKDOWN_MAX_LINK_PARENS = 32;

/**
 * Each `<` tries a tag, a comment, a declaration, a processing instruction,
 * and an autolink, and an unclosed one scans to the end: `<?` repeated takes
 * 24 ms at 16 KiB inline, 125 ms at 32.
 */
export const MARKDOWN_MAX_ANGLE_BRACKETS = 128;

/**
 * GFM trims a bare web address's trailing punctuation one mark per pass over
 * the whole address: `www.a` and 16,384 question marks take 123 ms.
 */
export const MARKDOWN_MAX_URL_PUNCTUATION = 64;

/** The diagnostic codes a field over a limit gets. */
export const MARKDOWN_CODES = [
  'markdown.too-long',
  'markdown.too-deep',
  'markdown.too-dense',
] as const;
export type MarkdownCode = (typeof MARKDOWN_CODES)[number];

/** One limit: the dimension it holds, its value, its code, and what a message says. */
export interface MarkdownLimit {
  readonly dimension: keyof MarkdownShape;
  /** The limit, or for one that grows with the field's length, the most it grows to. */
  readonly max: number;
  /** For a limit that grows with the field's length, the limit at `length` characters. */
  readonly maxFor?: (length: number) => number;
  readonly code: MarkdownCode;
  /** The finding's message after the pointer, from the value measured and the field's length: numbers only. */
  readonly describe: (value: number, length: number) => string;
}

const n = (value: number) => value.toLocaleString('en-US');

/** Every limit, in the order a field is checked: the first one it's over is the finding. */
export const MARKDOWN_LIMITS: readonly MarkdownLimit[] = [
  {
    dimension: 'length',
    max: MARKDOWN_MAX_LENGTH,
    code: 'markdown.too-long',
    describe: (value) =>
      `is ${n(value)} characters of Markdown; a Markdown field holds at most ${n(MARKDOWN_MAX_LENGTH)}.`,
  },
  {
    dimension: 'listItemLines',
    max: MARKDOWN_MAX_LIST_ITEM_LINES,
    code: 'markdown.too-long',
    describe: (value) =>
      `has a list item ${n(value)} lines long without a blank line; the limit is ${n(MARKDOWN_MAX_LIST_ITEM_LINES)}.`,
  },
  {
    dimension: 'tableCells',
    max: MARKDOWN_MAX_TABLE_CELLS,
    code: 'markdown.too-long',
    describe: (value) =>
      `has tables of ${n(value)} cells, columns times rows; the limit is ${n(MARKDOWN_MAX_TABLE_CELLS)}.`,
  },
  {
    dimension: 'quoteDepth',
    max: MARKDOWN_MAX_QUOTE_DEPTH,
    code: 'markdown.too-deep',
    describe: (value) =>
      `nests block quotes ${n(value)} deep; the limit is ${n(MARKDOWN_MAX_QUOTE_DEPTH)}.`,
  },
  {
    dimension: 'listDepth',
    max: MARKDOWN_MAX_LIST_DEPTH,
    code: 'markdown.too-deep',
    describe: (value) =>
      `nests lists ${n(value)} deep; the limit is ${n(MARKDOWN_MAX_LIST_DEPTH)}.`,
  },
  {
    dimension: 'nestingDepth',
    max: MARKDOWN_MAX_NESTING_DEPTH,
    code: 'markdown.too-deep',
    describe: (value) =>
      `nests block quotes and lists ${n(value)} deep in all, counting a line that continues a quote without its >; the limit is ${n(MARKDOWN_MAX_NESTING_DEPTH)}.`,
  },
  {
    dimension: 'inlineMarks',
    max: MARKDOWN_MAX_INLINE_MARKS,
    maxFor: inlineMarksFor,
    code: 'markdown.too-dense',
    describe: (value, length) =>
      `has ${n(value)} of the marks *, _, ~, !, and backtick in ${n(length)} characters; the limit is ${n(inlineMarksFor(length))}.`,
  },
  {
    dimension: 'definitions',
    max: MARKDOWN_MAX_DEFINITIONS,
    code: 'markdown.too-dense',
    describe: (value) =>
      `has ${n(value)} link reference definitions; the limit is ${n(MARKDOWN_MAX_DEFINITIONS)}.`,
  },
  {
    dimension: 'linkParens',
    max: MARKDOWN_MAX_LINK_PARENS,
    code: 'markdown.too-dense',
    describe: (value) =>
      `has ${n(value)} parentheses inside link destinations; the limit is ${n(MARKDOWN_MAX_LINK_PARENS)}.`,
  },
  {
    dimension: 'angleBrackets',
    max: MARKDOWN_MAX_ANGLE_BRACKETS,
    code: 'markdown.too-dense',
    describe: (value) =>
      `has ${n(value)} < characters; the limit is ${n(MARKDOWN_MAX_ANGLE_BRACKETS)}.`,
  },
  {
    dimension: 'urlPunctuation',
    max: MARKDOWN_MAX_URL_PUNCTUATION,
    code: 'markdown.too-dense',
    describe: (value) =>
      `has a web address with ${n(value)} punctuation marks; the limit is ${n(MARKDOWN_MAX_URL_PUNCTUATION)}.`,
  },
];

/**
 * The first limit a field is over, with what it measured, or null when it
 * keeps to every one. Length is checked before anything else is measured.
 */
export function markdownOverLimit(
  text: string,
  mode: MarkdownMode = 'block',
): { readonly limit: MarkdownLimit; readonly value: number } | null {
  const [first] = MARKDOWN_LIMITS;
  if (text.length > first!.max) return { limit: first!, value: text.length };
  const shape = measureMarkdown(text, mode);
  for (const limit of MARKDOWN_LIMITS) {
    const value = shape[limit.dimension];
    if (value > (limit.maxFor ? limit.maxFor(text.length) : limit.max)) return { limit, value };
  }
  return null;
}

/** Where a schema issue carries its Markdown code, for the validator to read. */
export const MARKDOWN_ISSUE_PARAM = 'markdownCode';

/** The Markdown code a schema issue carries, or undefined for any other issue. */
export function markdownIssueCode(issue: z.ZodIssue): MarkdownCode | undefined {
  if (issue.code !== 'custom') return undefined;
  const code = (issue.params as Record<string, unknown> | undefined)?.[MARKDOWN_ISSUE_PARAM];
  return isMarkdownCode(code) ? code : undefined;
}

export function isMarkdownCode(code: unknown): code is MarkdownCode {
  return typeof code === 'string' && (MARKDOWN_CODES as readonly string[]).includes(code);
}

/**
 * The cap as a schema refinement: a field over a limit gets one issue, its
 * message naming the measure and the limit, never the text.
 */
export function checkMarkdown(value: string, ctx: z.RefinementCtx): void {
  const over = markdownOverLimit(value);
  if (!over) return;
  ctx.addIssue({
    code: 'custom',
    message: over.limit.describe(over.value, value.length),
    params: { [MARKDOWN_ISSUE_PARAM]: over.limit.code },
  });
}

/**
 * Where a count stops: the link-parenthesis count grows with the square of
 * the links in one word and the cell count with rows times columns, and past
 * this they'd leave small-integer arithmetic and slow the pass. Every limit
 * is far below it.
 */
const COUNT_CEILING = 2 ** 30;

/**
 * The most containers the measure keeps open. A field nested this deep is far
 * past every limit; levels past it still count toward the line they open on,
 * and the cap keeps each line's work bounded.
 */
const STACK_CAP = 32;

// The containers a line can be in.
const QUOTE = 0;
const ITEM = 1;
/**
 * A quote a lazy line made marked re-lex the rest of inside its last child:
 * it still stands for its level, but takes no `>`, so the containers inside
 * it read every line after, until a blank line or one that ends the quote.
 */
const SHIFTED = 2;

// Character codes the measure compares against.
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const BANG = 0x21;
const HASH = 0x23;
const AMPERSAND = 0x26;
const PAREN_OPEN = 0x28;
const PAREN_CLOSE = 0x29;
const STAR = 0x2a;
const PLUS = 0x2b;
const DASH = 0x2d;
const DOT = 0x2e;
const ZERO = 0x30;
const ONE = 0x31;
const NINE = 0x39;
const COLON = 0x3a;
const LESS = 0x3c;
const GREATER = 0x3e;
const BRACKET_CLOSE = 0x5d;
const BACKSLASH = 0x5c;
const BACKTICK = 0x60;
const UNDERSCORE = 0x5f;
const PIPE = 0x7c;
const TILDE = 0x7e;

/** ASCII punctuation, which a backslash escapes in CommonMark. */
function isAsciiPunctuation(code: number): boolean {
  return (
    (code >= 0x21 && code <= 0x2f) ||
    (code >= 0x3a && code <= 0x40) ||
    (code >= 0x5b && code <= 0x60) ||
    (code >= 0x7b && code <= 0x7e)
  );
}

/** What `\s` matches in a JavaScript regular expression, which is what marked's patterns stop at. */
function isWhitespace(code: number): boolean {
  if (code <= SPACE) return code === SPACE || (code >= TAB && code <= CR);
  if (code < 0xa0) return false;
  return (
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

/** The characters marked trims from the end of a bare web address, one per pass. */
function isUrlTrailing(code: number): boolean {
  switch (code) {
    case 0x3f: // ?
    case BANG:
    case DOT:
    case 0x2c: // ,
    case COLON:
    case 0x3b: // ;
    case STAR:
    case UNDERSCORE:
    case 0x27: // '
    case 0x22: // "
    case TILDE:
    case PAREN_OPEN:
    case PAREN_CLOSE:
    case AMPERSAND:
      return true;
    default:
      return false;
  }
}

/** ASCII lowercase, for matching a web address's start in any case. */
const lower = (code: number) => (code >= 0x41 && code <= 0x5a ? code + 0x20 : code);

/** Whether `word`, in lowercase ASCII, starts at `at`, in any case. */
function startsWithAt(text: string, at: number, word: string): boolean {
  if (at + word.length > text.length) return false;
  for (let k = 0; k < word.length; k++) {
    if (lower(text.charCodeAt(at + k)) !== word.charCodeAt(k)) return false;
  }
  return true;
}

/** Whether a bare web address starts at `at`, as GFM's autolink pattern starts one. */
function urlStartsAt(text: string, at: number): boolean {
  return (
    startsWithAt(text, at, 'www.') ||
    startsWithAt(text, at, 'http://') ||
    startsWithAt(text, at, 'https://') ||
    startsWithAt(text, at, 'ftp://')
  );
}

/** Whether `[from, end)` holds nothing but spaces and tabs. */
function isBlankRun(text: string, from: number, end: number): boolean {
  for (let at = from; at < end; at++) {
    const code = text.charCodeAt(at);
    if (code !== SPACE && code !== TAB) return false;
  }
  return true;
}

/** Whether `[from, end)` holds nothing but spaces: what marked's blank-line patterns take. */
function isSpaceRun(text: string, from: number, end: number): boolean {
  for (let at = from; at < end; at++) {
    if (text.charCodeAt(at) !== SPACE) return false;
  }
  return true;
}

/**
 * The width of a list marker at `at`, or 0 when there isn't one: a bullet
 * (`-`, `+`, or `*`) or 1 to 9 digits and `.` or `)`, followed by a space, a
 * tab, or the line's end.
 */
function listMarkerWidth(text: string, at: number, end: number): number {
  const code = text.charCodeAt(at);
  let width = 0;
  if (code === DASH || code === PLUS || code === STAR) {
    width = 1;
  } else {
    let digits = 0;
    while (at + digits < end && digits <= 9) {
      const digit = text.charCodeAt(at + digits);
      if (digit < ZERO || digit > NINE) break;
      digits++;
    }
    if (digits === 0 || digits > 9 || at + digits >= end) return 0;
    const delimiter = text.charCodeAt(at + digits);
    if (delimiter !== DOT && delimiter !== PAREN_CLOSE) return 0;
    width = digits + 1;
  }
  if (at + width === end) return width;
  const next = text.charCodeAt(at + width);
  return next === SPACE || next === TAB ? width : 0;
}

/** The length of a fence's run at `at`: three or more backticks with none after them on the line, or tildes. */
function fenceRun(text: string, at: number, end: number): number {
  const mark = text.charCodeAt(at);
  if (mark !== BACKTICK && mark !== TILDE) return 0;
  let run = 0;
  while (at + run < end && text.charCodeAt(at + run) === mark) run++;
  if (run < 3) return 0;
  if (mark === BACKTICK) {
    for (let k = at + run; k < end; k++) if (text.charCodeAt(k) === BACKTICK) return 0;
  }
  return run;
}

/**
 * A table's columns if the rest of a line, from `at`, could be its delimiter
 * row (`|`, `:`, `-`, and spaces, with a `-` and a `|` or `:`), counted as
 * marked splits it, or 0.
 */
function delimiterColumns(text: string, at: number, end: number): number {
  let pipes = 0;
  let dashes = 0;
  let colons = 0;
  let last = 0;
  for (let k = at; k < end; k++) {
    const code = text.charCodeAt(k);
    if (code === PIPE) pipes++;
    else if (code === DASH) dashes++;
    else if (code === COLON) colons++;
    else if (code !== SPACE && code !== TAB) return 0;
    if (code !== SPACE) last = code;
  }
  if (dashes === 0 || (pipes === 0 && colons === 0)) return 0;
  return pipes + 1 - (text.charCodeAt(at) === PIPE ? 1 : 0) - (last === PIPE ? 1 : 0);
}

/**
 * Measures a Markdown field, a line at a time: what each line continues of
 * the containers open before it and what it opens, then, outside code in
 * block mode, every character for the inline counts.
 */
export function measureMarkdown(text: string, mode: MarkdownMode = 'block'): MarkdownShape {
  const length = text.length;
  const everyLine = mode === 'inline';
  let quoteDepth = 0;
  let listDepth = 0;
  let listItemLines = 0;
  let nestingDepth = 0;
  let tableCells = 0;
  let definitions = 0;
  let inlineMarks = 0;
  let linkParens = 0;
  let angleBrackets = 0;
  let urlPunctuation = 0;

  // Inline state, carried from one counted character to the next.
  let escaped = false;
  let previous = LF;
  // Links: `](` openers whose destination is still open, whether whitespace
  // may still come before the destination, and openers whose destination
  // ended, waiting to see whether a title opens.
  let openSites = 0;
  let siteJustOpened = false;
  let endedSites = 0;
  // A bare web address: whether one is open, and its punctuation so far.
  let inUrl = false;
  let urlMarks = 0;

  /** The inline counts over `[from, to)`. */
  const count = (from: number, to: number) => {
    for (let at = from; at < to; at++) {
      const code = text.charCodeAt(at);

      // A bare web address runs from where it starts to whitespace or `<`.
      if (inUrl && (isWhitespace(code) || code === LESS)) {
        inUrl = false;
      } else if (!inUrl && urlStartsAt(text, at)) {
        inUrl = true;
        urlMarks = 0;
      }
      if (inUrl && isUrlTrailing(code)) {
        urlMarks++;
        urlPunctuation = Math.max(urlPunctuation, urlMarks);
      }

      // Links. A destination runs from its `](` to a space or a control
      // character, after any whitespace right after the `(`, and a title may
      // open after it, past spaces and line breaks. Every `(` there starts a
      // title that scans to the next `)`, once for each link it's in. An
      // escape changes nothing here: marked's link pattern reads past
      // backslashes.
      if (siteJustOpened && isWhitespace(code)) {
        // The newest link is still before its destination, and a space or a
        // control character ends every destination opened before it.
        if (code <= SPACE && openSites > 1) {
          endedSites += openSites - 1;
          openSites = 1;
        }
      } else {
        siteJustOpened = false;
        if (code <= SPACE) {
          endedSites += openSites;
          openSites = 0;
        } else if (code === PAREN_OPEN && previous === BRACKET_CLOSE) {
          // A link's own `(`, which also sits in every destination still open.
          linkParens = Math.min(linkParens + openSites + endedSites, COUNT_CEILING);
          endedSites = 0;
          openSites++;
          siteJustOpened = true;
        } else {
          if (code === PAREN_OPEN) {
            linkParens = Math.min(linkParens + openSites + endedSites, COUNT_CEILING);
          }
          endedSites = 0;
        }
      }

      if (code === LESS) angleBrackets++;
      // A definition's label closes with `]:`, escaped or not.
      if (code === COLON && previous === BRACKET_CLOSE) definitions++;

      if (!escaped) {
        if (code === BACKTICK) {
          // One that never closes scans to the end of the text, spaces or not.
          inlineMarks++;
        } else if (code === STAR || code === UNDERSCORE || code === TILDE || code === BANG) {
          // One with whitespace, or the text's edge, on both sides opens and
          // closes nothing, and starts no word, so it costs what plain text does.
          const following = at + 1 < length ? text.charCodeAt(at + 1) : LF;
          if (!(isWhitespace(previous) && isWhitespace(following))) inlineMarks++;
        }
      }

      escaped = !escaped && code === BACKSLASH && isAsciiPunctuation(text.charCodeAt(at + 1));
      previous = code;
    }
  };

  // The containers open after the last line, outermost first, as parallel
  // arrays: each one's kind; an item's indent (marked's: the columns a line
  // needs past its parent's content to continue it); whether a blank line
  // has been inside the item, after which a line it doesn't indent ends it;
  // whether its last line was one after which such a line ends it too; and
  // whether marked may have read its marker as paragraph text instead.
  const kinds: number[] = [];
  const indents: number[] = [];
  const blanks: boolean[] = [];
  const stops: boolean[] = [];
  const doubts: boolean[] = [];
  let items = 0;
  let barriers = 0; // QUOTE and SHIFTED entries
  let shifted = 0;
  let doubtful = 0;
  let overflow = 0; // levels the current line opened past the cap
  let overflowItems = 0;

  const push = (kind: number, indent: number, blank: boolean, stop: boolean, doubt: boolean) => {
    if (kinds.length >= STACK_CAP) {
      overflow++;
      if (kind === ITEM) overflowItems++;
      return;
    }
    kinds.push(kind);
    indents.push(indent);
    blanks.push(blank);
    stops.push(stop);
    doubts.push(doubt);
    if (doubt) doubtful++;
    if (kind === ITEM) items++;
    else barriers++;
  };
  const pop = () => {
    const kind = kinds.pop()!;
    indents.pop();
    blanks.pop();
    stops.pop();
    if (doubts.pop()) doubtful--;
    if (kind === ITEM) items--;
    else {
      barriers--;
      if (kind === SHIFTED) shifted--;
    }
  };
  const popTo = (size: number) => {
    while (kinds.length > size) pop();
  };

  // Block state.
  let previousBlank = true;
  let fenceLevel = -1; // the containers an open fence sits in, or -1
  let fenceMark = 0;
  let fenceLength = 0;
  let opener = -1; // where a fence's opening line starts, until the next line shows it opened one
  let openerEnd = 0;
  let codeLevel = -1; // the containers an open indented code block sits in, or -1
  let tableColumns = 0;
  let itemLines = 0;
  // An HTML block and a link reference definition can each take in lines
  // that look like a fence or indented code (a definition's label and title
  // can run across lines, blank ones too), so in a field with a `]:`, and
  // after a line that may open an HTML block, nothing is read as code.
  let codeAllowed = !text.includes(']:');
  // The containers the last line's code sat in, when it was a fence's line
  // or indented code: a quote whose content ends in code ends at a lazy line.
  let codeBefore = -1;

  // The line being read: where it starts and ends and the next one starts,
  // and how far its containers took it.
  let start = 0;
  let end = 0;
  let next = 0;
  let pos = 0;
  let pending = 0; // columns left of a tab an item's indent took part of

  /** Takes a quote's `>` after at most 3 spaces, and the space or tab after it. */
  const takeQuote = (): boolean => {
    let spaces = pending;
    let at = pos;
    while (spaces < 4 && at < end && text.charCodeAt(at) === SPACE) {
      spaces++;
      at++;
    }
    if (spaces > 3 || at >= end || text.charCodeAt(at) !== GREATER) return false;
    pos = at + 1;
    pending = 0;
    if (pos < end) {
      const code = text.charCodeAt(pos);
      if (code === SPACE || code === TAB) pos++;
    }
    return true;
  };
  /** Takes `columns` of indentation, a tab as 4: 1 when it did, 0 when text came first, 2 when only blanks are left. */
  const takeIndent = (columns: number): number => {
    let have = pending;
    let at = pos;
    while (have < columns) {
      if (at >= end) return 2;
      const code = text.charCodeAt(at);
      if (code === SPACE) have += 1;
      else if (code === TAB) have += 4;
      else return 0;
      at++;
    }
    pos = at;
    pending = have - columns;
    return 1;
  };
  /** The spaces before the rest of the line, a split tab's columns included. */
  const leadingSpaces = (): number => {
    let at = pos;
    while (at < end && text.charCodeAt(at) === SPACE) at++;
    return pending + at - pos;
  };
  // isThematicBreak for the line being read, remembered: a line asks it from
  // further along each time, and a later start with the same mark sees what
  // the last scan saw past it, so each character is scanned about once.
  let breakLine = -1;
  let breakMark = 0;
  let breakTabs = false;
  let breakFrom = 0; // the mark the last scan started at
  let breakStop = 0; // where a character other than the mark or a blank stopped it
  let breakMarks = 0; // marks from breakFrom to breakStop
  /**
   * Whether the rest of the line, from `at`, is a thematic break: three or
   * more of one of `-`, `*`, or `_`, and nothing else but spaces and, unless
   * `spacesOnly`, tabs.
   */
  const thematicBreak = (at: number, spacesOnly = false): boolean => {
    let first = at;
    while (first < end) {
      const code = text.charCodeAt(first);
      if (code === SPACE || (code === TAB && !spacesOnly)) first++;
      else break;
    }
    if (first >= end) return false;
    const mark = text.charCodeAt(first);
    if (mark !== DASH && mark !== STAR && mark !== UNDERSCORE) return false;
    if (
      breakLine !== start ||
      breakMark !== mark ||
      breakTabs === spacesOnly ||
      first < breakFrom ||
      first > breakStop
    ) {
      breakLine = start;
      breakMark = mark;
      breakTabs = !spacesOnly;
      breakFrom = first;
      breakMarks = 0;
      let k = first;
      for (; k < end; k++) {
        const code = text.charCodeAt(k);
        if (code === mark) breakMarks++;
        else if (code !== SPACE && (code !== TAB || spacesOnly)) break;
      }
      breakStop = k;
    } else {
      for (let k = breakFrom; k < first; k++) if (text.charCodeAt(k) === mark) breakMarks--;
      breakFrom = first;
    }
    return breakStop >= end && breakMarks >= 3;
  };
  /**
   * Whether a line not indented past an item ends it, as marked's list reads
   * one: a fence, a heading, an HTML tag or comment, another marker, or a
   * thematic break, within the item's first `min(3, indent - 1)` spaces.
   */
  const endsItem = (indent: number): boolean => {
    const spaces = leadingSpaces();
    const at = pos + spaces - pending;
    if (spaces > Math.min(3, indent - 1) || at >= end) return false;
    const code = text.charCodeAt(at);
    if (
      (code === BACKTICK || code === TILDE) &&
      text.charCodeAt(at + 1) === code &&
      text.charCodeAt(at + 2) === code
    ) {
      return true;
    }
    if (code === HASH || listMarkerWidth(text, at, end) > 0) return true;
    if (code === LESS) {
      // `<` and a letter with a `>` later on the line, or `<!--`.
      const letter = lower(text.charCodeAt(at + 1));
      if (letter >= 0x61 && letter <= 0x7a) {
        for (let k = at + 2; k < end; k++) if (text.charCodeAt(k) === GREATER) return true;
        return false;
      }
      return (
        letter === BANG && text.charCodeAt(at + 2) === DASH && text.charCodeAt(at + 3) === DASH
      );
    }
    return thematicBreak(at, true);
  };
  /**
   * Whether an item's line, from `from` with `columns` of spaces before it
   * and tabs read as 4, means a line after it that the item doesn't indent
   * ends the item: one indented 4 or more, or a fence, a heading, or a
   * thematic break within the item's first `min(3, indent - 1)` spaces. On
   * the marker's own line marked keeps tabs inside a thematic break as tabs.
   */
  const stopsItem = (from: number, columns: number, indent: number, first: boolean): boolean => {
    let width = columns;
    let at = from;
    while (at < end) {
      const code = text.charCodeAt(at);
      if (code === SPACE) width++;
      else if (code === TAB) width += 4;
      else break;
      at++;
    }
    if (at >= end) return false;
    if (width >= 4) return true;
    if (width > Math.min(3, indent - 1)) return false;
    const code = text.charCodeAt(at);
    if (
      (code === BACKTICK || code === TILDE) &&
      text.charCodeAt(at + 1) === code &&
      text.charCodeAt(at + 2) === code
    ) {
      return true;
    }
    return code === HASH || thematicBreak(at, first);
  };
  /** stopsItem for a line an item took lazily, as written: marked cuts the item's indent off it first, character by character. */
  const stopsLazy = (from: number, columns: number, indent: number): boolean => {
    if (columns >= indent) return stopsItem(from, columns - indent, indent, false);
    let cut = indent - columns;
    let left = 0;
    let at = from;
    while (cut > 0 && at < end) {
      const width = text.charCodeAt(at) === TAB ? 4 : 1;
      at++;
      if (width > cut) left = width - cut;
      cut -= Math.min(cut, width);
    }
    return stopsItem(at, left, indent, false);
  };
  /** Whether the line after this one continues the first `level` containers as written. */
  const nextContinues = (level: number): boolean => {
    if (end >= length) return false;
    for (let k = 0; k < level; k++) if (kinds[k] === SHIFTED) return false;
    const [savedPos, savedPending, savedEnd] = [pos, pending, end];
    let lineEnd = next;
    while (lineEnd < length) {
      const code = text.charCodeAt(lineEnd);
      if (code === LF || code === CR) break;
      lineEnd++;
    }
    pos = next;
    pending = 0;
    end = lineEnd;
    const result = continues(level);
    pos = savedPos;
    pending = savedPending;
    end = savedEnd;
    return result;
  };
  /**
   * Whether the rest of the line ends the quote at `level` it doesn't
   * continue, as the lines marked lets into a quote lazily stop at: a
   * thematic break, a heading, a list's first marker, or a fence with a line
   * after it inside the quote's parent.
   */
  const interrupts = (level: number): boolean => {
    const spaces = leadingSpaces();
    const at = pos + spaces - pending;
    if (spaces > 3 || at >= end) return false;
    const code = text.charCodeAt(at);
    if ((code === DASH || code === UNDERSCORE || code === STAR) && thematicBreak(at)) {
      return true;
    }
    if (code === HASH) {
      let marks = 0;
      while (at + marks < end && text.charCodeAt(at + marks) === HASH) marks++;
      return marks <= 6 && (at + marks >= end || isWhitespace(text.charCodeAt(at + marks)));
    }
    const after = at + 1;
    if (code === DASH || code === PLUS || code === STAR) return text.charCodeAt(after) === SPACE;
    if (code === ONE) {
      const delimiter = text.charCodeAt(after);
      return (
        (delimiter === DOT || delimiter === PAREN_CLOSE) && text.charCodeAt(after + 1) === SPACE
      );
    }
    return fenceRun(text, at, end) > 0 && nextContinues(level);
  };
  /** Whether the line continues the first `level` containers as written, past each `>` and each item's indent. */
  const continues = (level: number): boolean => {
    for (let i = 0; i < level; i++) {
      const kind = kinds[i];
      if (kind === QUOTE) {
        if (!takeQuote()) return false;
      } else if (kind === ITEM) {
        if (takeIndent(indents[i]!) === 0) return false;
      } else if (isSpaceRun(text, pos, end) || interrupts(i)) {
        return false;
      }
    }
    return true;
  };
  /** Whether the line, from where its containers took it, closes the open fence. */
  const closesFence = (): boolean => {
    const spaces = leadingSpaces();
    let at = pos + spaces - pending;
    if (spaces > 3) return false;
    let run = 0;
    while (at < end && text.charCodeAt(at) === fenceMark) {
      run++;
      at++;
    }
    if (run < fenceLength) return false;
    while (at < end) {
      const code = text.charCodeAt(at);
      if (code !== BACKTICK && code !== TILDE) break;
      at++;
    }
    return isBlankRun(text, at, end);
  };

  /**
   * Whether the quote at `level` ends at a lazy line because the code on the
   * line before sat in it with only quotes between: marked continues no
   * quote whose content ends in code, nor the quotes it was re-lexed from.
   */
  const endsInCode = (level: number, codeLast: number): boolean => {
    if (codeLast <= level) return false;
    for (let k = level; k < codeLast; k++) if (kinds[k] !== QUOTE) return false;
    return true;
  };

  for (;;) {
    end = start;
    while (end < length) {
      const code = text.charCodeAt(end);
      if (code === LF || code === CR) break;
      end++;
    }
    next =
      end >= length
        ? length
        : text.charCodeAt(end) === CR && text.charCodeAt(end + 1) === LF
          ? end + 2
          : end + 1;
    const afterBlank = previousBlank;
    // A fence's opening line from the line before, waiting on this one.
    const waiting = opener;
    const waitingEnd = openerEnd;
    opener = -1;
    const codeLast = codeBefore;
    codeBefore = -1;
    // An inert line holds code: no structure, and in block mode no inline counts.
    let inert = false;
    // Whether this line shows that a fence opened on the line before.
    let opened = false;
    overflow = 0;
    overflowItems = 0;

    if (isSpaceRun(text, start, end)) {
      // A line of spaces ends every quote, and every shifted region with it,
      // and is a blank line inside every item left open.
      while (barriers > 0) pop();
      for (let k = 0; k < kinds.length; k++) {
        blanks[k] = true;
        stops[k] = false;
      }
      if (fenceLevel > kinds.length) fenceLevel = -1;
      if (codeLevel > kinds.length) codeLevel = -1;
      opened = fenceLevel >= 0;
      previousBlank = true;
      tableColumns = 0;
      itemLines = 0;
    } else {
      pos = start;
      pending = 0;
      // An open fence or indented code block takes a line that continues its containers.
      if (fenceLevel >= 0 || codeLevel >= 0) {
        if (continues(fenceLevel >= 0 ? fenceLevel : codeLevel)) {
          if (fenceLevel >= 0) {
            inert = true;
            opened = true;
            codeBefore = fenceLevel;
            if (closesFence()) fenceLevel = -1;
          } else if (isBlankRun(text, pos, end) || leadingSpaces() >= 4) {
            inert = true;
            codeBefore = codeLevel;
          } else {
            codeLevel = -1;
          }
        } else {
          fenceLevel = -1;
          codeLevel = -1;
        }
        if (!inert) {
          pos = start;
          pending = 0;
        }
      }

      if (inert) {
        previousBlank = false;
      } else {
        // What the line continues of the open containers.
        let lazy = false;
        let closeFrom = -1;
        let quotes = 0;
        for (let i = 0; i < kinds.length; i++) {
          const kind = kinds[i];
          if (kind === QUOTE) {
            if (takeQuote()) {
              quotes++;
              continue;
            }
            if (isSpaceRun(text, pos, end) || interrupts(i) || endsInCode(i, codeLast)) {
              closeFrom = i;
              break;
            }
            // A lazy line: it continues the quote without its `>`.
            lazy = true;
            if (i === kinds.length - 1) break;
            // A list or a quote is open inside it, so marked re-lexes the
            // rest of the quote inside that: from here on the quote takes no
            // `>`, and what's inside it reads the line.
            kinds[i] = SHIFTED;
            shifted++;
            // marked works out how far the quote ran from the text it
            // re-lexed, which can leave it lexing again from inside a line,
            // so from here on no line is surely code.
            codeAllowed = false;
            continue;
          }
          if (kind === SHIFTED) {
            if (isSpaceRun(text, pos, end) || interrupts(i)) {
              closeFrom = i;
              break;
            }
            continue;
          }
          const from = pos;
          const columns = pending;
          const indent = indents[i]!;
          const taken = takeIndent(indent);
          if (taken === 1) {
            stops[i] = stopsItem(pos, pending, indent, false);
            continue;
          }
          if (taken === 2) {
            blanks[i] = true;
            stops[i] = false;
            continue;
          }
          if (blanks[i] || stops[i] || endsItem(indent)) {
            closeFrom = i;
            break;
          }
          // marked takes the line into the item lazily, as written, and the
          // containers inside the item read it from the same place.
          lazy = true;
          stops[i] = stopsLazy(from, columns, indent);
        }
        if (closeFrom >= 0) popTo(closeFrom);

        if (isBlankRun(text, pos, end)) {
          // A blank line inside the containers it continues: `>` alone, say.
          // A tab in it keeps a paragraph going in marked, so then it isn't one
          // for the line after.
          previousBlank = isSpaceRun(text, pos, end);
          tableColumns = 0;
          itemLines = 0;
          quoteDepth = Math.max(quoteDepth, quotes);
        } else {
          previousBlank = false;
          // What the line opens: quotes and list items, then code, a fence, or text.
          // Code is read only where marked surely reads it: not on a lazy
          // line, not past a quote marked re-lexed, and not inside an item
          // whose marker may have been paragraph text.
          const codeHere = () => codeAllowed && shifted === 0 && doubtful === 0;
          let canCode = afterBlank && !lazy && codeHere();
          let opens = 0;
          let markers = 0;
          let tableAt = pos;
          for (;;) {
            const spaces = leadingSpaces();
            const at = pos + spaces - pending;
            if (canCode && spaces >= 4) {
              codeLevel = kinds.length;
              codeBefore = codeLevel;
              inert = true;
              break;
            }
            if (spaces > 3) break;
            const code = text.charCodeAt(at);
            if (code === GREATER) {
              push(QUOTE, 0, false, false, false);
              quotes++;
              opens++;
              pos = at + 1;
              pending = 0;
              if (pos < end && (text.charCodeAt(pos) === SPACE || text.charCodeAt(pos) === TAB)) {
                pos++;
              }
              canCode = codeHere();
              tableAt = pos;
              continue;
            }
            if (markers === 0) tableAt = at;
            const run = !lazy && codeHere() ? fenceRun(text, at, end) : 0;
            if (run > 0) {
              fenceLevel = kinds.length;
              codeBefore = fenceLevel;
              fenceMark = code;
              fenceLength = run;
              if (!everyLine) {
                opener = start;
                openerEnd = next;
              }
              break;
            }
            if (markers === 0 && thematicBreak(at)) break;
            const width = listMarkerWidth(text, at, end);
            if (width === 0) break;
            // marked's indent: the marker and the spaces after it, or one
            // space when there are more than 4 (the rest is code) or none.
            const after = at + width;
            let gap = 0;
            while (after + gap < end && text.charCodeAt(after + gap) === SPACE) gap++;
            const empty = isBlankRun(text, after, end);
            const indent = spaces + width + (empty || gap > 4 ? 1 : gap);
            // marked reads the rest of the marker's line with its leading
            // tabs as 3 spaces each, and judges the item's next line by it.
            let tabs = 0;
            while (after + tabs < end && text.charCodeAt(after + tabs) === TAB) tabs++;
            // marked may read the marker as text: only a bullet and a space,
            // or `1.` or `1)` and a space, interrupt a paragraph, and a line
            // right after a line of text may continue one; a setext heading
            // takes in a marker after spaces or before a tab or the line's
            // end; and a list doesn't start with a marker and one space alone.
            const spaced = text.charCodeAt(after) === SPACE;
            const interrupting =
              spaced && (width === 1 || (width === 2 && text.charCodeAt(at) === ONE));
            const doubt =
              spaces > 0 ||
              !spaced ||
              (empty && after + 1 >= end) ||
              (!interrupting &&
                !afterBlank &&
                opens === 0 &&
                (kinds.length === 0 || kinds[kinds.length - 1] !== ITEM));
            push(
              ITEM,
              indent,
              empty,
              !empty && stopsItem(after + tabs, 3 * tabs, indent, true),
              doubt,
            );
            markers++;
            opens++;
            if (empty) break;
            if (gap > 4) {
              pos = after + 1;
              pending = 0;
            } else if (gap === 0) {
              pos = after + tabs;
              pending = 3 * tabs;
            } else {
              pos = after + gap;
              pending = 0;
            }
            canCode = codeHere();
          }

          if (!inert) {
            const spaces = leadingSpaces();
            const at = pos + spaces - pending;
            if (spaces <= 3 && at < end && text.charCodeAt(at) === LESS) codeAllowed = false;
          }
          quoteDepth = Math.max(quoteDepth, quotes);
          if (markers > 0) itemLines = 1;
          else if (inert) {
            // Code is one token to marked, however many lines it runs.
          } else if (items > 0) itemLines++;
          else itemLines = 0;
          if (!inert) {
            const columns = opener === start ? 0 : delimiterColumns(text, tableAt, end);
            if (columns > 0) tableColumns = Math.max(tableColumns, columns);
            if (tableColumns > 0) tableCells = Math.min(tableCells + tableColumns, COUNT_CEILING);
          }
        }
        listDepth = Math.max(listDepth, items + overflowItems);
        nestingDepth = Math.max(nestingDepth, kinds.length + overflow);
        listItemLines = Math.max(listItemLines, itemLines);
      }
    }

    // The inline counts, in the text's order. A fence's opening line waits
    // for the next one to show it opened a fence, and is counted if not.
    if (waiting >= 0 && !opened) count(waiting, waitingEnd);
    if (everyLine || (!inert && opener !== start)) count(start, next);

    if (end >= length) break;
    start = next;
  }
  if (opener >= 0) count(opener, openerEnd);

  return {
    length,
    quoteDepth,
    listDepth,
    listItemLines,
    nestingDepth,
    tableCells,
    definitions,
    inlineMarks,
    linkParens,
    angleBrackets,
    urlPunctuation,
  };
}
