// The changes a case study's own words report, read so the sheet can draw
// them (SPA-1): "Mean time to detect fell from fourteen minutes to three" is
// a measure, two figures and a unit; "Attendance rose from 48% to 95%" is a
// share, before and after. Horizontal Cinema's storyboard reads its frames
// the same way (figures.ts there). Nothing here invents a number: a figure
// draws only numbers the sentence states, so "from roughly half to nearly
// all", which states none, draws nothing and stays prose. A side's words
// are kept as the owner wrote them. Pure and browser-safe.

const SMALL = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
] as const;
const TENS = [
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
] as const;

/** A number written as digits or in English words up to ninety-nine. */
const NUMBER = `(\\d[\\d,]*(?:\\.\\d+)?|(?:${TENS.join('|')})(?:-(?:${SMALL.slice(1, 10).join('|')}))?|${SMALL.join('|')})`;

/** A number's value, from digits or English words, or none. */
export function numberOf(raw: string): number | undefined {
  const word = raw.toLowerCase().replace(/,/g, '').trim();
  if (/^\d+(\.\d+)?$/.test(word)) return Number(word);
  const small = (SMALL as readonly string[]).indexOf(word);
  if (small >= 0) return small;
  const [tens, units] = word.split('-');
  const at = (TENS as readonly string[]).indexOf(tens ?? '');
  if (at < 0) return undefined;
  if (units === undefined) return (at + 2) * 10;
  const unit = (SMALL as readonly string[]).indexOf(units);
  return unit >= 1 && unit <= 9 ? (at + 2) * 10 + unit : undefined;
}

/** The verbs a change is reported with. */
const MOVES = [
  'fell',
  'dropped',
  'went down',
  'went up',
  'went',
  'rose',
  'grew',
  'climbed',
  'shrank',
  'came down',
  'moved',
].join('|');

/**
 * The words that may stand before a stated share, kept as the owner wrote
 * them: "roughly 48%" is drawn at 48. A share is only ever a number the text
 * states; "roughly half" or "nearly all" states none, so it draws nothing.
 */
const HEDGES = [
  'roughly',
  'about',
  'around',
  'approximately',
  'nearly',
  'almost',
  'just under',
  'under',
  'less than',
  'just over',
  'over',
  'more than',
]
  .sort((a, b) => b.length - a.length)
  .join('|');

/** A number as NUMBER reads it, without a group of its own. */
const AMOUNT = NUMBER.replace(/^\(/, '(?:');

// The text is read with its spaces folded to one, so a space here is literal.
const SHARE = `((?:(?:${HEDGES}) )?${AMOUNT} ?(?:%|percent))`;

/** One side of a change: its words as the owner wrote them, and its value. */
export interface Side {
  readonly words: string;
  readonly value: number;
}

/** A change a sentence reports, its every value a number the sentence states. */
export type Change =
  | {
      /** A measure with a figure each side: "fell from fourteen minutes to three". */
      readonly kind: 'figure';
      /** What changed, in the owner's words: "Mean time to detect". */
      readonly measure: string;
      readonly from: Side;
      readonly to: Side;
      /** Its unit, where the sentence names one: "minutes". */
      readonly unit?: string;
    }
  | {
      /** A stated share of a whole each side, in percent: "from 48% to 95%". */
      readonly kind: 'share';
      readonly measure: string;
      readonly from: Side;
      readonly to: Side;
    };

/** A stated share's percent: the number before its "%" or "percent", from 0 to 100; else none. */
export function percentOf(words: string): number | undefined {
  const text = words.toLowerCase().replace(/\s+/g, ' ').trim();
  const match = new RegExp(`(?:^|\\s)(${AMOUNT}) ?(?:%|percent)$`).exec(text);
  const value = match ? numberOf(match[1]!) : undefined;
  return value !== undefined && value >= 0 && value <= 100 ? value : undefined;
}

/** The words of a unit, never a preposition the sentence goes on with: "minutes", not "after". */
const unitOf = (word: string | undefined) =>
  word &&
  !['after', 'before', 'when', 'while', 'since', 'in', 'by', 'and', 'of', 'for'].includes(
    word.toLowerCase(),
  )
    ? word
    : undefined;

/** A unit's singular, lower-cased: "Minutes" is "minute"; a short form as written: "ms". */
const singular = (word: string) => {
  const lower = word.toLowerCase();
  return lower.length <= 2 ? lower : lower.replace(/s$/, '');
};

/**
 * The first change a text reports from one stated number to another, or
 * none. A share needs a percent each side; a figure needs one unit both
 * sides (or none), so the bars share a scale. Number words count as numbers
 * ("fourteen minutes to three"); a quantifier without a number ("roughly
 * half", "nearly all") is no number, and draws nothing.
 */
export function changeIn(text: string | undefined): Change | undefined {
  if (!text) return undefined;
  const flat = text.replace(/\s+/g, ' ').trim();
  const lead = `(?:^|[.!?;]\\s+)([A-Z][^.!?;]*?\\s+(?:${MOVES})\\s+from\\s+`;
  // What changed: the clause's words before its verb.
  const measureOf = (opening: string) =>
    opening.replace(new RegExp(`\\s+(?:${MOVES})\\s+from\\s+$`, 'i'), '').trim();
  // A share first, so "from 48 percent to 95 percent" reads as one, not as a unit called "percent".
  const share = new RegExp(
    `${lead})${SHARE}(?=[\\s,.;!?]|$)([^.!?;,]*?)\\s+to\\s+${SHARE}(?=[\\s,.;!?]|$)`,
    'i',
  ).exec(flat);
  if (share) {
    const from = percentOf(share[2]!);
    const to = percentOf(share[4]!);
    if (from !== undefined && to !== undefined && from !== to) {
      return {
        kind: 'share',
        measure: measureOf(share[1]!),
        from: { words: share[2]!, value: from },
        to: { words: share[4]!, value: to },
      };
    }
  }
  const figure = new RegExp(
    `${lead})${NUMBER}(?:\\s+([a-z]+))?\\s+to\\s+${NUMBER}(?:\\s+([a-z]+))?`,
    'i',
  ).exec(flat);
  if (figure) {
    const from = numberOf(figure[2]!);
    const to = numberOf(figure[4]!);
    const unit = unitOf(figure[3]);
    const toUnit = unitOf(figure[5]);
    const sameUnit = !unit || !toUnit || singular(unit) === singular(toUnit);
    if (
      from !== undefined &&
      to !== undefined &&
      from !== to &&
      Math.max(from, to) > 0 &&
      sameUnit
    ) {
      const shared = unit ?? toUnit;
      return {
        kind: 'figure',
        measure: measureOf(figure[1]!),
        from: { words: figure[2]!, value: from },
        to: { words: figure[4]!, value: to },
        ...(shared ? { unit: shared } : {}),
      };
    }
  }
  return undefined;
}
