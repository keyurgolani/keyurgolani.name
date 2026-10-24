// Horizontal Cinema's five chapters (#17), and the one bounded chapter
// state every input lands in. Pure and browser-safe: the server render,
// the controller, and the tests all read the same five positions from
// here, so a filmstrip link, an arrow key, a button, a wheel, a swipe, and
// a direct link can only ever name one of them.

/** The chapters, in their authored order: always five, never more, never fewer. */
export const CHAPTERS = [
  { key: 'prologue', label: 'Prologue' },
  { key: 'origins', label: 'Origins' },
  { key: 'journey', label: 'Journey' },
  { key: 'craft', label: 'Craft' },
  { key: 'epilogue', label: 'Epilogue' },
] as const;

export type ChapterKey = (typeof CHAPTERS)[number]['key'];

/** The last chapter's position. Positions run from 0. */
export const LAST = CHAPTERS.length - 1;

/**
 * A chapter's anchor without the boundary's prefix, its direct URL's
 * fragment: `/#chapter-journey`. A content id can take the same words, and
 * then the chapter keeps them and the content gets no anchor.
 */
export const anchorOf = (position: number): string => `chapter-${CHAPTERS[position]!.key}`;

/** The index after the chapters, the exit every chapter reaches in one link. */
export const INDEX_ANCHOR = 'chapter-index';

/** Every anchor the composition reserves: the five chapters and the index. */
export const RESERVED_ANCHORS: ReadonlySet<string> = new Set([
  ...CHAPTERS.map((_, position) => anchorOf(position)),
  INDEX_ANCHOR,
]);

/** A position held to the five chapters. */
export function bounded(position: number): number {
  if (!Number.isFinite(position)) return 0;
  return Math.min(LAST, Math.max(0, Math.round(position)));
}

/**
 * The chapter one step from `from`, toward the end for `by` 1 and the start
 * for -1, or undefined at either end: nothing past Epilogue, nothing before
 * Prologue, so a step there is no step at all, and its key does what it
 * always does.
 */
export function stepFrom(from: number, by: 1 | -1): number | undefined {
  const to = from + by;
  return to < 0 || to > LAST ? undefined : to;
}

/**
 * The chapter a fragment names, `#chapter-craft` under the boundary's
 * prefix, or undefined for any other fragment, the index's among them.
 */
export function chapterOfHash(hash: string, prefix: string): number | undefined {
  let id: string;
  try {
    id = decodeURIComponent(hash.replace(/^#/, ''));
  } catch {
    return undefined;
  }
  const position = CHAPTERS.findIndex((_, index) => `${prefix}${anchorOf(index)}` === id);
  return position === -1 ? undefined : position;
}

/**
 * Which way an arrow key steps: the inline end is next, so in a
 * right-to-left page ArrowLeft goes forward. Any other key steps nowhere.
 */
export function arrowStep(key: string, rtl: boolean): 1 | -1 | undefined {
  if (key === 'ArrowRight') return rtl ? -1 : 1;
  if (key === 'ArrowLeft') return rtl ? 1 : -1;
  return undefined;
}

/** A chapter's two-digit number, `03`. */
export const numberOf = (position: number): string => String(position + 1).padStart(2, '0');

/** The visible progress, `03 / 05`. */
export const progressOf = (position: number): string => `${numberOf(position)} / ${numberOf(LAST)}`;

/** What the live region says when a chapter becomes current: `Chapter 3 of 5: Journey`. */
export const announcementOf = (position: number): string =>
  `Chapter ${position + 1} of ${CHAPTERS.length}: ${CHAPTERS[position]!.label}`;

/**
 * The chapter at `probe` along the chapters' axis, from where each starts
 * on it in order: the last that starts at or before the probe, and the
 * first while the probe is before them all.
 */
export function chapterAt(starts: readonly number[], probe: number): number {
  let found = 0;
  starts.forEach((start, position) => {
    if (start <= probe) found = position;
  });
  return bounded(found);
}
