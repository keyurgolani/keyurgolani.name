// Dates in the book model, read at their own precision (concept, derivation 1):
// a bare year runs January to December, a month is that month, and an open
// end or `present` runs to the render's fixed now. Nothing reads the clock:
// now is the render input's `env.now`.

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** A point in time at the precision it was written: `idx` counts months from year 0. */
export interface Moment {
  readonly idx: number;
  readonly year: number;
  /** 1 to 12, when written. */
  readonly month?: number;
  readonly day?: number;
  readonly precision: 'year' | 'month' | 'day';
}

const LOOSE = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/;

/**
 * A loose date as a moment. `edge` decides where a coarse date falls: a bare
 * year starts in January and ends in December. `present` is `now`.
 */
export function moment(
  raw: string | undefined,
  edge: 'start' | 'end',
  now: string,
): Moment | undefined {
  if (raw === undefined) return undefined;
  if (raw.trim().toLowerCase() === 'present') return nowMoment(now);
  const match = LOOSE.exec(raw.trim());
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = match[2] === undefined ? undefined : Number(match[2]);
  if (month !== undefined && (month < 1 || month > 12)) return undefined;
  const day = match[3] === undefined ? undefined : Number(match[3]);
  const index = month === undefined ? (edge === 'start' ? 0 : 11) : month - 1;
  return {
    idx: year * 12 + index,
    year,
    ...(month !== undefined ? { month } : {}),
    ...(day !== undefined ? { day } : {}),
    precision: day !== undefined ? 'day' : month !== undefined ? 'month' : 'year',
  };
}

/** The render's now, at month precision. */
export function nowMoment(now: string): Moment {
  const match = LOOSE.exec(now);
  const year = match ? Number(match[1]) : 1970;
  const month = match?.[2] ? Number(match[2]) : 1;
  return { idx: year * 12 + month - 1, year, month, precision: 'month' };
}

/** A month's name. */
export const monthName = (month: number): string => MONTHS[month - 1] ?? '';

/**
 * A moment as the book prints it: "15 April 2026", "April 2023", "2016".
 * The renderers set it in a `<time>`, which the stylesheet keeps on one line (C2).
 */
export function longDate(at: Moment | undefined): string {
  if (!at) return '';
  if (at.precision === 'day') return `${at.day} ${monthName(at.month!)} ${at.year}`;
  if (at.precision === 'month') return `${monthName(at.month!)} ${at.year}`;
  return String(at.year);
}

/** A loose date string as the book prints it, or '' when it isn't one. */
export function printedDate(raw: string | undefined, now: string): string {
  return longDate(moment(raw, 'start', now));
}

/** The `datetime` value of a loose date: its written precision. */
export function dateTimeOf(at: Moment | undefined): string | undefined {
  if (!at) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (at.precision === 'day') return `${at.year}-${pad(at.month!)}-${pad(at.day!)}`;
  if (at.precision === 'month') return `${at.year}-${pad(at.month!)}`;
  return String(at.year);
}
