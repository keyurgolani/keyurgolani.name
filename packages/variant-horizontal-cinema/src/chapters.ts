// Horizontal Cinema's five chapters (#17; redesign), their anchors, which
// way an arrow key steps, and which scene the strip's travel has reached.
// Pure and browser-safe: the server render, the controller, and the tests
// all read them from here.

/** The chapters, in their authored order: always five, never more, never fewer. */
export const CHAPTERS = [
  { key: 'prologue', label: 'Prologue' },
  { key: 'origins', label: 'Origins' },
  { key: 'journey', label: 'Journey' },
  { key: 'craft', label: 'Craft' },
  { key: 'epilogue', label: 'Epilogue' },
] as const;

export type ChapterKey = (typeof CHAPTERS)[number]['key'];

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

/**
 * Which way an arrow key steps: the inline end is next, so in a
 * right-to-left page ArrowLeft goes forward. Any other key steps nowhere.
 */
export function arrowStep(key: string, rtl: boolean): 1 | -1 | undefined {
  if (key === 'ArrowRight') return rtl ? -1 : 1;
  if (key === 'ArrowLeft') return rtl ? 1 : -1;
  return undefined;
}

/**
 * The scene at `along` px of the strip's travel, from where each scene
 * starts on it. At the strip's end the last few scenes can't reach its
 * start, so they all sit at its full travel: there the scene a step landed
 * on, if it's one of them, stays current rather than the last one taking
 * over, so stepping back from the end, or onto one of them, lands where it
 * says.
 */
export function sceneAlong(
  offsets: readonly number[],
  along: number,
  travel: number,
  current: number,
): number {
  let found = 0;
  offsets.forEach((offset, index) => {
    if (offset <= along + 1) found = index;
  });
  if (along >= travel - 1 && current < found && (offsets[current] ?? 0) >= travel - 1)
    return current;
  return found;
}
