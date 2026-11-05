import type { Tokenizer, Tokens } from 'marked';

// marked's emphasis tokenizer, emStrong, with its closer search walking the
// text's delimiter runs instead of reading the text (#10).
//
// marked looks for an opener's closer by running the closer expression
// (emStrongRDelimAst after *, emStrongRDelimUnd after _) from the opener to
// the end of the text, and when the opener never closes it does the same from
// the next one. So a field of openers that never close had it read the rest of
// the text once an opener: the openers times the length. CJK text makes each
// of those reads slower again, which made it the cap search's slowest field.
//
// That search only ever stops at a run. Every alternative that captures a run
// takes the one character before it, the run, and a look at the character
// after it, and the one between runs takes the text up to the character before
// the next run. So a run's match is the same from every opener whose search
// reaches it. Here each text's runs are found and matched once, by marked's
// own expression, and an opener's search walks the runs after it, keeping
// marked's count of what's still open, so every token is the one marked
// makes. An expression of another shape, as another marked might have, leaves
// the text to marked's own tokenizer.

const STAR = 0x2a;
const UNDERSCORE = 0x5f;

/** The runs of one delimiter in a text, in order. */
interface Runs {
  readonly starts: number[];
  readonly ends: number[];
  /** Where the character before each run starts: two code units back for a surrogate pair. */
  readonly leads: number[];
  /** The closer expression's group a match at that character captures the run in, 1 to 6, or 0 for none. */
  readonly groups: number[];
}

interface Delimiters {
  readonly star: Runs;
  readonly underscore: Runs;
}

/** What the closer expression's first alternative takes and its second skips, for each delimiter. */
const SHAPES = {
  star: { first: '^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|', between: '|[^*]+(?=[^*])|' },
  underscore: { first: '^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|', between: '|[^_]+(?=[^_])|' },
} as const;

/** Each closer expression's sticky copy, or null when it isn't the shape this search reads. */
const stickies = new WeakMap<RegExp, RegExp | null>();

function stickyOf(expression: RegExp, shape: (typeof SHAPES)[keyof typeof SHAPES]) {
  let sticky = stickies.get(expression);
  if (sticky === undefined) {
    const { source, flags } = expression;
    sticky =
      source.startsWith(shape.first) && source.includes(shape.between)
        ? new RegExp(source, `${flags.replace(/[gy]/g, '')}y`)
        : null;
    stickies.set(expression, sticky);
  }
  return sticky;
}

/** The delimiters of each text a lexer has searched, by lexer: it lexes many texts, and returns to each. */
const searched = new WeakMap<object, Map<string, Delimiters | null>>();

const isHigh = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/** Where the code point before `start` begins. */
const leadOf = (text: string, start: number) =>
  start >= 2 && isLow(text.charCodeAt(start - 1)) && isHigh(text.charCodeAt(start - 2))
    ? start - 2
    : start - 1;

/** The group of `match` that holds a run, 0 when none does. */
function groupOf(match: RegExpExecArray | null): number {
  if (!match) return 0;
  for (let group = 1; group < match.length; group++) if (match[group]) return group;
  return 0;
}

/**
 * Each run's group, from `sticky`'s match at the character before it: false
 * when a match is anything but that character and the whole run.
 */
function matched(text: string, runs: Runs, sticky: RegExp): boolean {
  for (let i = 0; i < runs.starts.length; i++) {
    const start = runs.starts[i]!;
    const lead = runs.leads[i]!;
    let group = 0;
    if (lead >= 0) {
      sticky.lastIndex = lead;
      const match = sticky.exec(text);
      group = groupOf(match);
      if (match && (!group || match[0].length !== runs.ends[i]! - lead)) return false;
      if (match && match[group]!.length !== runs.ends[i]! - start) return false;
    }
    runs.groups.push(group);
  }
  return true;
}

function delimitersOf(tokenizer: Tokenizer, masked: string): Delimiters | null {
  let texts = searched.get(tokenizer.lexer);
  if (!texts) searched.set(tokenizer.lexer, (texts = new Map()));
  let delimiters = texts.get(masked);
  if (delimiters !== undefined) return delimiters;
  const star: Runs = { starts: [], ends: [], leads: [], groups: [] };
  const underscore: Runs = { starts: [], ends: [], leads: [], groups: [] };
  for (let i = 0; i < masked.length;) {
    const unit = masked.charCodeAt(i);
    if (unit !== STAR && unit !== UNDERSCORE) {
      i++;
      continue;
    }
    const runs = unit === STAR ? star : underscore;
    let end = i + 1;
    while (end < masked.length && masked.charCodeAt(end) === unit) end++;
    runs.starts.push(i);
    runs.ends.push(end);
    runs.leads.push(leadOf(masked, i));
    i = end;
  }
  const { emStrongRDelimAst, emStrongRDelimUnd } = tokenizer.rules.inline;
  const starSticky = stickyOf(emStrongRDelimAst, SHAPES.star);
  const underscoreSticky = stickyOf(emStrongRDelimUnd, SHAPES.underscore);
  delimiters =
    starSticky &&
    underscoreSticky &&
    matched(masked, star, starSticky) &&
    matched(masked, underscore, underscoreSticky)
      ? { star, underscore }
      : null;
  texts.set(masked, delimiters);
  return delimiters;
}

/** The first index of `runs` whose run ends after `at`, or their length. */
function firstEndingAfter(runs: Runs, at: number): number {
  let low = 0;
  let high = runs.ends.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (runs.ends[middle]! > at) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** The first index at or after `at` that holds a * or an _, or -1. */
function firstDelimiter({ star, underscore }: Delimiters, at: number): number {
  let first = -1;
  for (const runs of [star, underscore]) {
    const i = firstEndingAfter(runs, at);
    if (i < runs.starts.length) {
      const index = Math.max(runs.starts[i]!, at);
      if (first < 0 || index < first) first = index;
    }
  }
  return first;
}

/**
 * Where the closer search starts reading runs: past what the expression's
 * first alternative takes at the start of the search, when it takes
 * anything. After *, that's __, text, a lone *, and text up to a __ (after _,
 * the same with the two swapped), with neither delimiter in the text.
 */
function searchStart(text: string, delimiters: Delimiters, from: number, star: boolean): number {
  const pair = star ? UNDERSCORE : STAR;
  const lone = star ? STAR : UNDERSCORE;
  const isPair = (at: number) =>
    at >= 0 && text.charCodeAt(at) === pair && text.charCodeAt(at + 1) === pair;
  const open = firstDelimiter(delimiters, from);
  if (!isPair(open)) return from;
  const middle = firstDelimiter(delimiters, open + 2);
  if (middle < 0 || text.charCodeAt(middle) !== lone) return from;
  const close = firstDelimiter(delimiters, middle + 1);
  return isPair(close) ? close : from;
}

/**
 * marked's emStrong, token for token. `false` hands the text to marked's own
 * when its expressions aren't the shape this reads.
 */
export function emStrong(
  this: Tokenizer,
  src: string,
  maskedSrc: string,
  prevChar = '',
): Tokens.Em | Tokens.Strong | undefined | false {
  const { inline, other } = this.rules;
  const opener = inline.emStrongLDelim.exec(src);
  if (!opener) return undefined;
  if (opener[3] && prevChar.match(other.unicodeAlphaNumeric)) return undefined;
  const nextChar = opener[1] || opener[2] || '';
  if (nextChar && prevChar && !inline.punctuation.exec(prevChar)) return undefined;
  const delimiters = delimitersOf(this, maskedSrc);
  if (!delimiters) return false;
  const star = opener[0][0] === '*';
  const runs = star ? delimiters.star : delimiters.underscore;
  const closer = star
    ? stickyOf(inline.emStrongRDelimAst, SHAPES.star)!
    : stickyOf(inline.emStrongRDelimUnd, SHAPES.underscore)!;
  const lLength = [...opener[0]].length - 1;
  // marked searches maskedSrc from the end of the text less what's left
  // after the opener, which is where the opener ends unless masking shortened
  // the text before it.
  const offset = Math.max(maskedSrc.length - (src.length - lLength), 0);
  const from = searchStart(maskedSrc, delimiters, offset, star);
  let delimTotal = lLength;
  let midDelimTotal = 0;
  for (let i = firstEndingAfter(runs, from); i < runs.starts.length; i++) {
    const start = runs.starts[i]!;
    let lead = runs.leads[i]!;
    let group = runs.groups[i]!;
    if (lead < from) {
      // The character before the run starts before the search does: only the
      // low half of a surrogate pair is inside it, which the search reads as
      // a character of its own.
      if (start - 1 < from) continue;
      lead = start - 1;
      closer.lastIndex = 0;
      group = groupOf(closer.exec(maskedSrc.slice(lead)));
    }
    if (!group) continue;
    let rLength = runs.ends[i]! - start;
    if (group === 3 || group === 4) {
      delimTotal += rLength;
      continue;
    }
    if ((group === 5 || group === 6) && lLength % 3 && !((lLength + rLength) % 3)) {
      midDelimTotal += rLength;
      continue;
    }
    delimTotal -= rLength;
    if (delimTotal > 0) continue;
    rLength = Math.min(rLength, rLength + delimTotal + midDelimTotal);
    const raw = src.slice(0, lLength + (start - offset) + rLength);
    if (Math.min(lLength, rLength) % 2) {
      const text = raw.slice(1, -1);
      return { type: 'em', raw, text, tokens: this.lexer.inlineTokens(text) };
    }
    const text = raw.slice(2, -2);
    return { type: 'strong', raw, text, tokens: this.lexer.inlineTokens(text) };
  }
  return undefined;
}
