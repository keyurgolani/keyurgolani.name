// Horizontal Cinema's five chapters (#17; redesign), their anchors, which
// way an arrow key steps, which scene the strip's travel has reached,
// which one a travel that rests between two finishes on, and the words a
// heading may only break between.
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

/**
 * The scene a travel that came to rest between scenes finishes on, from
 * where each scene starts on the strip, where the travel rests (`at`), and
 * where it set out from (`from`): of the scenes past its start the way it
 * went, the nearer, as a wheel or a key snaps. So a slow wheel, a notch at a
 * time with the page at rest between, travels on rather than being pulled
 * back to the scene it left, and a travel that runs a little past a scene
 * keeps that one. Within a pixel of a scene, or not having gone anywhere
 * (a nudge of up to TRAVEL_FLOOR px from where it set out), the nearest.
 */
/** How far a travel must go from where it set out to count as one: a 2 or 3 px nudge returns to its scene, a 4 px notch travels. */
export const TRAVEL_FLOOR = 3;

export function snapAlong(offsets: readonly number[], at: number, from: number): number {
  const nearestOf = (indices: readonly number[]): number =>
    indices.reduce(
      (best, index) =>
        Math.abs(offsets[index]! - at) < Math.abs(offsets[best]! - at) ? index : best,
      indices[0] ?? 0,
    );
  const all = offsets.map((_, index) => index);
  const nearest = nearestOf(all);
  if (
    all.length === 0 ||
    Math.abs(offsets[nearest]! - at) <= 1 ||
    Math.abs(at - from) <= TRAVEL_FLOOR
  )
    return nearest;
  const ahead = all.filter((index) =>
    at > from ? offsets[index]! > from + 1 : offsets[index]! < from - 1,
  );
  return ahead.length > 0 ? nearestOf(ahead) : nearest;
}

/**
 * The words of a heading's text, as [start, end) spans: the runs a line may
 * not break inside. Spaces of any kind part them, and so do the joins a line
 * may break at, a hyphen, a dash, a slash and a soft hyphen; punctuation stays
 * with its word, as a line holds it. A single letter can't break, so it isn't
 * one. The fit check reads each span's boxes: a word in two boxes broke
 * inside itself, a heading that doesn't fit its scene. `WORD` is the pattern, for a reader in the page.
 */
export const WORD = /[^\s\u00ad\-\u2010-\u2015/]{2,}/gu;

export function wordSpans(text: string): Array<[number, number]> {
  return [...text.matchAll(new RegExp(WORD))].map((match) => [
    match.index,
    match.index + match[0].length,
  ]);
}
