import type { z } from 'zod';

// The Markdown cap (#10): a Markdown field's size and shape, measured before
// anything lexes it, and the limits every Markdown field keeps to. A field
// over a limit is a document finding at its pointer, so the pair is refused
// before any renderer sees it, the browser's included.
//
// The measure is one pass over the text, character by character, with no
// regular expression: linear in the field's length, and browser-safe, since
// #7's preview and #9's import check documents in the browser. It never runs
// marked. It counts what makes marked slow or deep from the outside, and
// where it can't tell what marked would make of a character, it counts it.
//
// The limits come from timing marked 15.0.12 through both renderers (#58's
// token walker and marked.parse), block and inline, on hostile shapes at
// doubling sizes; times below are medians on the development machine. Every
// count is per field, not per paragraph, since renderInlineMarkdown reads a
// whole field as one paragraph. Every fixture, profession pair, the example,
// and the long-text contract fixture sit at least 4 times inside each limit.

/** What a Markdown field holds that makes marked slow or deep. */
export interface MarkdownShape {
  /** UTF-16 code units, as JavaScript counts a string. */
  readonly length: number;
  /** The most block quotes open on one line. */
  readonly quoteDepth: number;
  /** The most list items open at once. */
  readonly listDepth: number;
  /** The most lines one list item runs, from its marker line to a blank line or the next marker. */
  readonly listItemLines: number;
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
 * Most shapes stay linear to 64 KiB and then jump 10 to 25 times by 128 KiB,
 * a prose paragraph among them (6 ms, then 65 ms). Below that, marked spends
 * up to half a microsecond a token: 8 KiB of `[` takes 4.6 ms inline. Every
 * quote level past the first lexes its content again, so this is what the
 * quote limit multiplies.
 */
export const MARKDOWN_MAX_LENGTH = 8192;

/**
 * Each level past the first lexes the quote's content again, inline included,
 * when a lazy line follows: 1.9 times the time at 2 levels, 3.8 at 4, 7.7 at
 * 8, and 189 ms at 16. The old renderer runs out of stack near 4,000.
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
 * An emphasis opener searches ahead for its closer, one regular-expression
 * match for every later mark (about 50 ns a pair) and a scan of the rest
 * (0.5 ns a character), and every mark inside a word makes the email-autolink
 * lookahead rescan the word (about 1.5 ns a character). `x ` and 40,000 `*`
 * take 3 s; 8 marks a paragraph across 32 KiB, 5 s inline; 8 KiB of `!`, 45
 * ms. 128 marks at the length limit take under 2 ms.
 */
export const MARKDOWN_MAX_INLINE_MARKS = 128;

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
  readonly max: number;
  readonly code: MarkdownCode;
  /** The finding's message after the pointer, from the value measured: numbers only. */
  readonly describe: (value: number) => string;
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
    dimension: 'inlineMarks',
    max: MARKDOWN_MAX_INLINE_MARKS,
    code: 'markdown.too-dense',
    describe: (value) =>
      `has ${n(value)} of the marks *, _, ~, !, and backtick; the limit is ${n(MARKDOWN_MAX_INLINE_MARKS)}.`,
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

/** The first limit a field is over, with what it measured, or null when it keeps to every one. */
export function markdownOverLimit(
  text: string,
): { readonly limit: MarkdownLimit; readonly value: number } | null {
  const shape = measureMarkdown(text);
  for (const limit of MARKDOWN_LIMITS) {
    const value = shape[limit.dimension];
    if (value > limit.max) return { limit, value };
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
    message: over.limit.describe(over.value),
    params: { [MARKDOWN_ISSUE_PARAM]: over.limit.code },
  });
}

/**
 * Where the link-parenthesis count stops: it grows with the square of the
 * links in one word, and past this it would leave small-integer arithmetic
 * and slow the pass. Every limit is far below it.
 */
const COUNT_CEILING = 2 ** 30;

// Character codes the measure compares against.
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const BANG = 0x21;
const AMPERSAND = 0x26;
const PAREN_OPEN = 0x28;
const PAREN_CLOSE = 0x29;
const STAR = 0x2a;
const PLUS = 0x2b;
const DASH = 0x2d;
const DOT = 0x2e;
const ZERO = 0x30;
const NINE = 0x39;
const LESS = 0x3c;
const GREATER = 0x3e;
const BRACKET_CLOSE = 0x5d;
const BACKSLASH = 0x5c;
const BACKTICK = 0x60;
const UNDERSCORE = 0x5f;
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
    case 0x3a: // :
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

/** Where the line that starts at `from` ends: its line break, or the end of the text. */
function lineEnd(text: string, from: number): number {
  let at = from;
  while (at < text.length) {
    const code = text.charCodeAt(at);
    if (code === LF || code === CR) break;
    at++;
  }
  return at;
}

/**
 * Whether the rest of a line, from `from`, is a thematic break: three or more
 * of one of `-`, `*`, or `_`, and nothing else but spaces and tabs.
 */
function isThematicBreak(text: string, from: number, end: number): boolean {
  let mark = 0;
  let count = 0;
  for (let at = from; at < end; at++) {
    const code = text.charCodeAt(at);
    if (code === SPACE || code === TAB) continue;
    if (mark === 0 && (code === DASH || code === STAR || code === UNDERSCORE)) mark = code;
    if (code !== mark) return false;
    count++;
  }
  return count >= 3;
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

/**
 * Measures a Markdown field. One pass: each line's leading block quote and
 * list markers, then every character for the inline counts. Columns count a
 * tab to the next multiple of 4, as CommonMark does.
 */
export function measureMarkdown(text: string): MarkdownShape {
  const length = text.length;
  let quoteDepth = 0;
  let listDepth = 0;
  let listItemLines = 0;
  let inlineMarks = 0;
  let linkParens = 0;
  let angleBrackets = 0;
  let urlPunctuation = 0;

  // Block structure, a line at a time. `items` holds the column of each open
  // list item's marker. A marker past an open item's marker nests in it, and
  // one at or before it closes it; after a blank line, so does any line that
  // starts at or before it. CommonMark nests only from the item's content
  // column on, past its marker and a space, and keeps an item open through
  // lazy lines, so an item is never closed here before marked closes it.
  const items: number[] = [];
  let itemLines = 0;
  let afterBlank = false;

  // Inline state.
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

  let lineStart = true;
  for (let at = 0; at < length; at++) {
    if (lineStart) {
      lineStart = false;
      const end = lineEnd(text, at);
      let column = 0;
      let cursor = at;
      let quotes = 0;
      const markers: number[] = [];
      // The line's prefix: indentation, quote markers, and list markers.
      for (;;) {
        while (cursor < end) {
          const code = text.charCodeAt(cursor);
          if (code === SPACE) column++;
          else if (code === TAB) column += 4 - (column % 4);
          else break;
          cursor++;
        }
        if (cursor >= end) break;
        if (text.charCodeAt(cursor) === GREATER) {
          quotes++;
          cursor++;
          column++;
          continue;
        }
        // A thematic break is checked once, where the first list marker
        // could be, so a line like `- - -` isn't three markers.
        if (markers.length === 0 && isThematicBreak(text, cursor, end)) break;
        const width = listMarkerWidth(text, cursor, end);
        if (width === 0) break;
        markers.push(column);
        cursor += width;
        column += width;
      }
      quoteDepth = Math.max(quoteDepth, quotes);
      const blank = quotes === 0 && markers.length === 0 && cursor >= end;
      if (markers.length > 0) {
        while (items.length > 0 && items[items.length - 1]! >= markers[0]!) items.pop();
        for (const marker of markers) items.push(marker);
        listDepth = Math.max(listDepth, items.length);
        itemLines = 1;
      } else if (blank) {
        itemLines = 0;
      } else {
        if (afterBlank) {
          while (items.length > 0 && items[items.length - 1]! >= column) items.pop();
        }
        itemLines = items.length === 0 ? 0 : itemLines + 1;
      }
      afterBlank = blank;
      listItemLines = Math.max(listItemLines, itemLines);
    }

    const code = text.charCodeAt(at);
    if (code === LF || (code === CR && text.charCodeAt(at + 1) !== LF)) lineStart = true;

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
    // title that scans to the next `)`, once for each link it's in. An escape
    // changes nothing here: marked's link pattern reads past backslashes.
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

    if (!escaped) {
      if (code === BACKTICK) {
        // One that never closes scans to the end of the text, spaces or not.
        inlineMarks++;
      } else if (code === STAR || code === UNDERSCORE || code === TILDE || code === BANG) {
        // One with whitespace, or the text's edge, on both sides opens and
        // closes nothing, and starts no word, so it costs what plain text does.
        const next = at + 1 < length ? text.charCodeAt(at + 1) : LF;
        if (!(isWhitespace(previous) && isWhitespace(next))) inlineMarks++;
      }
    }

    escaped = !escaped && code === BACKSLASH && isAsciiPunctuation(text.charCodeAt(at + 1));
    previous = code;
  }

  return {
    length,
    quoteDepth,
    listDepth,
    listItemLines,
    inlineMarks,
    linkParens,
    angleBrackets,
    urlPunctuation,
  };
}
