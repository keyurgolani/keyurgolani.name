import type { Evidence } from '@portfolio/schema';
import { present } from './primitives';

// How a record's who-and-where reads, for the kit's evidence renderer and
// every composition that sets its own (A4): a full citation stands for its
// authors, venue, and date, so a reader never gets them twice; a line gets
// one closing mark, however the owner's text ends; and a location of
// "online" says nothing, so it isn't shown. A composition may still show a
// date as layout beside a whole citation, such as a ruled row's date or a
// year in the margin: the rule is for the who-and-where line.

/** Whether the record's citation, written whole, takes the place of its authors, venue, and date. */
export function citesWhole(entry: Pick<Evidence, 'citation'>): boolean {
  return present(entry.citation);
}

/**
 * The marks a sentence may end on, in the scripts the kit sets: the full
 * stop, the question and exclamation marks, the ellipsis, the CJK full stop
 * and full-width marks, and the danda.
 */
const TERMINAL = /(?:[.!?…。．！？।]|\.\.\.)$/u;

/** Whether `text` already ends a sentence, after its trailing spaces, so a renderer adds no period. */
export function endsSentence(text: string): boolean {
  return TERMINAL.test(text.trimEnd());
}

/** An ellipsis written as three periods, after something that isn't one. */
const DOTS = /(?:^|[^.])\.\.\.$/u;

/**
 * `text` without the periods, and the spaces among and after them, it ends
 * with, so a renderer can add its one. An ellipsis written as three periods
 * stays, since it isn't a stop doubled.
 */
export function withoutTrailingPeriod(text: string): string {
  const trimmed = text.trimEnd();
  return DOTS.test(trimmed) ? trimmed : trimmed.replace(/[\s.]*\.$/u, '').trimEnd();
}

/**
 * `text` closed with one mark: as it is when it already ends a sentence, on
 * a "?", a "!", an ellipsis, or a CJK or Devanagari stop, and else its own
 * periods, doubled or not, become one.
 */
export function asSentence(text: string): string {
  const trimmed = text.trimEnd();
  if (DOTS.test(trimmed)) return trimmed;
  const base = withoutTrailingPeriod(trimmed);
  return endsSentence(base) ? base : `${base}.`;
}

/**
 * A location that says where nothing is: online or virtual, in any case,
 * alone. It knows only these English words: "En línea" or "オンライン" still
 * shows, until the content model can say a record has no place.
 */
const NOWHERE = /^\s*(?:online|virtual)\s*$/i;

/** A place worth showing: `place`, or undefined for none, an empty one, or "online". */
export function shownPlace(place: string | undefined): string | undefined {
  return present(place) && !NOWHERE.test(place) ? place : undefined;
}
