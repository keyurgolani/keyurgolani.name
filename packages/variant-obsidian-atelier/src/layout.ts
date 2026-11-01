// How a gallery's blocks share its columns (redesign, stream C), worked out
// in reading order where the order is known, so no rule in the stylesheet
// has to count siblings: Contact's halves pair up.

/**
 * Contact's blocks: each reads across, or in half of the
 * gallery. Halves pair up in reading order; a half that starts a row with
 * no half after it reads across, so no half is left bare beside it.
 */
export function pairHalves(across: readonly boolean[]): ('wide' | 'half')[] {
  let starts = true;
  return across.map((wide, index) => {
    const alone = wide || (starts && across[index + 1] !== false);
    starts = alone || !starts;
    return alone ? 'wide' : 'half';
  });
}

/** A character set wide, two columns of a monospace line: Han, kana, Hangul, and the fullwidth forms. */
const WIDE =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff01-\uff60\uffe0-\uffe6]/u;

/**
 * How wide a title reads: grapheme clusters, not code units, and a wide
 * East Asian character as two, as it sets about twice a Latin letter's
 * width, so a title in Japanese gets about half the characters.
 */
export function readWidth(text: string): number {
  let width = 0;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
    text,
  )) {
    width += WIDE.test(segment) ? 2 : 1;
  }
  return width;
}

/** What a title breaks at, which the name doesn't keep at its end: a space, a hyphen, a dash, a slash. */
const BREAK = /^[\s\-\u2010-\u2015/]+$/u;
/** East Asian punctuation, after which a title with no spaces may break. */
const WIDE_STOP = /[\u3000-\u303f\uff00-\uffef]$/u;
/** What a name never ends on: spaces, separating punctuation, and an opening bracket or quote. */
const DANGLING = /[\s,;:\-\u2010-\u2015/\u00b7([{\u2018\u201c\u00ab\u300c\u300e]+$/u;

/** Each opening quote or bracket and what closes it. */
const PAIRS: readonly (readonly [string, string])[] = [
  ['\u201c', '\u201d'],
  ['\u2018', '\u2019'],
  ['\u00ab', '\u00bb'],
  ['\u300c', '\u300d'],
  ['\u300e', '\u300f'],
  ['(', ')'],
  ['[', ']'],
];

/** Whether every quote and bracket the text opens, it closes. A straight quote closes the one before it. */
function closed(text: string): boolean {
  const count = (char: string) => text.split(char).length - 1;
  if (count('"') % 2 === 1) return false;
  return PAIRS.every(([open, close]) => count(open) <= count(close));
}

/**
 * A room's name in the switch: the work's title, or, past `budget`
 * characters (graphemes, a wide East Asian one counted as two), its first
 * words that fit, cut where the language's own word breaks fall
 * (Intl.Segmenter, so a title in Japanese or a hyphenated run cuts too).
 * It cuts only where the title itself breaks: at a space, a hyphen, a
 * dash, or a slash, or between two words with nothing joining them, as
 * Japanese sets them, so what's attached to a word stays with it: the
 * pluses of C++, the stops of A.I., a closing quote. No small word, no
 * separating punctuation, and no opening quote is left dangling at its
 * end. When not even the first word fits, it's empty, and the room is its
 * numeral alone.
 */
export function roomName(title: string, budget: number, locale?: string): string {
  const trimmed = title.trim();
  if (readWidth(trimmed) <= budget) return trimmed;
  const segments = [...new Intl.Segmenter(locale, { granularity: 'word' }).segment(trimmed)];
  // Each place the title may be cut: its text up to there, and the last word in it.
  const cuts: { text: string; word: string }[] = [];
  let text = '';
  let word = '';
  for (const [index, { segment, isWordLike }] of segments.entries()) {
    if (readWidth(text + segment) > budget) break;
    text += segment;
    if (isWordLike) word = segment;
    const next = segments[index + 1];
    const breaks =
      BREAK.test(next?.segment ?? ' ') ||
      (isWordLike === true && next?.isWordLike === true) ||
      WIDE_STOP.test(segment);
    // A cut inside a quote or a bracket would leave it open: the name ends before it, or after it closes.
    if (breaks && word !== '' && closed(text)) cuts.push({ text, word });
  }
  while (cuts.length > 1 && SMALL.has(cuts[cuts.length - 1]!.word.toLowerCase())) cuts.pop();
  return (cuts.at(-1)?.text ?? '').replace(DANGLING, '');
}

const SMALL = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

/**
 * The owner's Markdown in two: its first paragraph, and the rest, split at
 * the first blank line, so a hall's wall label is the first and the rest
 * reads in its fold. Undefined rest when there's one paragraph.
 */
export function firstParagraph(body: string): { first: string; rest: string | undefined } {
  const text = body.trim();
  const at = text.search(/\n[ \t]*\n/);
  if (at < 0) return { first: text, rest: undefined };
  const rest = text.slice(at).trim();
  return { first: text.slice(0, at).trim(), rest: rest === '' ? undefined : rest };
}
