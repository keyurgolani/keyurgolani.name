// Horizontal Cinema's five chapters (#17; redesign), their anchors, which
// way an arrow key steps, which scene the strip's travel has reached, and
// which one a travel that rests between two finishes on.
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
 * keeps that one. Within a pixel of a scene, or not having gone anywhere,
 * the nearest.
 */
export function snapAlong(offsets: readonly number[], at: number, from: number): number {
  const nearestOf = (indices: readonly number[]): number =>
    indices.reduce(
      (best, index) =>
        Math.abs(offsets[index]! - at) < Math.abs(offsets[best]! - at) ? index : best,
      indices[0] ?? 0,
    );
  const all = offsets.map((_, index) => index);
  const nearest = nearestOf(all);
  if (all.length === 0 || Math.abs(offsets[nearest]! - at) <= 1 || Math.abs(at - from) <= 1)
    return nearest;
  const ahead = all.filter((index) =>
    at > from ? offsets[index]! > from + 1 : offsets[index]! < from - 1,
  );
  return ahead.length > 0 ? nearestOf(ahead) : nearest;
}
