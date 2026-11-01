// The figures a case study's own words hold (redesign): counts ("thirty-eight
// services, three platform teams") and a change ("fell from fourteen minutes
// to three"), read from the prose the owner wrote, so the storyboard can draw
// them. Nothing here invents a number: a sentence with none draws nothing.
// Pure and browser-safe.

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

/** One count a sentence names: 38 of "services". */
export interface Count {
  readonly count: number;
  readonly of: string;
}

/** Time, in seconds a unit: a span of time is a measure, never a count of things. */
const TIME: Readonly<Record<string, number>> = {
  millisecond: 0.001,
  ms: 0.001,
  second: 1,
  sec: 1,
  minute: 60,
  min: 60,
  hour: 3600,
  hr: 3600,
  day: 86_400,
  week: 604_800,
  month: 2_629_800,
  quarter: 7_889_400,
  year: 31_557_600,
  decade: 315_576_000,
};

/** A unit's singular, lower-cased: "Minutes" is "minute"; a short form as written: "ms", "s". */
const singular = (word: string) => {
  const lower = word.toLowerCase();
  return lower.length <= 2 ? lower : lower.replace(/s$/, '');
};

/** A year, 1900 to 2100, written in four digits: a date, never a count. */
const isYear = (raw: string) => /^\d{4}$/.test(raw) && Number(raw) >= 1900 && Number(raw) <= 2100;

/** A plural noun, not a word that only ends in s: "services", never "was", "is", "bus", or "class". */
const plural = (word: string) => word.length > 3 && /[^su]s$/i.test(word);

/**
 * The counts of things a text names, in its order: "thirty-eight services,
 * three platform teams". A count stops at its noun, one word or a modifier
 * and its noun; a decimal or a span of time is a measure, not a count.
 */
export function countsIn(text: string | undefined): Count[] {
  if (!text) return [];
  const pattern = new RegExp(`\\b${NUMBER}\\s+([a-z]+)(?:\\s+([a-z]+))?`, 'gi');
  const found: Count[] = [];
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const raw = match[1]!;
    // A year opens no count, and the words after it are read again: "In 2021 forty services moved".
    if (isYear(raw.replace(/[,.]+$/, ''))) {
      pattern.lastIndex = match.index + raw.length;
      continue;
    }
    const first = match[2]!;
    const second = match[3];
    const of = plural(first) ? first : second && plural(second) ? `${first} ${second}` : undefined;
    if (!of || raw.includes('.')) continue;
    if (TIME[singular(of.split(' ').at(-1)!)] !== undefined) continue;
    const count = numberOf(raw);
    if (count !== undefined && count > 1) found.push({ count, of: of.toLowerCase() });
  }
  return found;
}

/** A change a sentence reports: "Mean time to detect fell from fourteen minutes to three". */
export interface Change {
  /** What changed, in the owner's words: "Mean time to detect". */
  readonly measure: string;
  readonly from: number;
  readonly to: number;
  /** Its unit, where the sentence names one: "minutes". Both sides share it unless the after side names its own. */
  readonly unit?: string;
  /** The after side's own unit, where it names a different one: "seconds". */
  readonly toUnit?: string;
  /** The after side in the before side's unit, for the bars' lengths, where the two units differ. */
  readonly toAsFrom?: number;
}

const MOVES = [
  'fell',
  'dropped',
  'went',
  'rose',
  'grew',
  'climbed',
  'shrank',
  'came down',
  'went down',
  'went up',
];

/** The first change a text reports from one number to another, or none. */
export function changeIn(text: string | undefined): Change | undefined {
  if (!text) return undefined;
  const pattern = new RegExp(
    `(?:^|[.!?]\\s+)([A-Z][^.!?]*?)\\s+(?:${MOVES.join('|')})\\s+from\\s+${NUMBER}(?:\\s+([a-z]+))?\\s+to\\s+${NUMBER}(?:\\s+([a-z]+))?`,
    'i',
  );
  const match = pattern.exec(text.trim());
  if (!match) return undefined;
  const from = numberOf(match[2]!);
  const to = numberOf(match[4]!);
  if (from === undefined || to === undefined || from === to) return undefined;
  // A unit is a word like "minutes", never a preposition the sentence goes on with.
  const named = (word: string | undefined) =>
    word &&
    !['after', 'before', 'when', 'while', 'since', 'in', 'by', 'and'].includes(word.toLowerCase())
      ? word
      : undefined;
  const unit = named(match[3]);
  const toUnit = named(match[5]);
  const measure = match[1]!.trim();
  if (!unit || !toUnit || singular(unit) === singular(toUnit)) {
    const shared = unit ?? toUnit;
    return { measure, from, to, ...(shared ? { unit: shared } : {}) };
  }
  // Two units: drawn to one scale only where one converts to the other, else not drawn at all.
  const before = TIME[singular(unit)];
  const after = TIME[singular(toUnit)];
  if (before === undefined || after === undefined) return undefined;
  return { measure, from, to, unit, toUnit, toAsFrom: (to * after) / before };
}
