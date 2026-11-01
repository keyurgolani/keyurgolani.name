import type { Evidence, Work } from '@portfolio/schema';
import { evidenceOf, githubSnapshot, placedImage, worksOf } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import type { ViewSection } from './view';

// Which records the issue sets as numbered figures, so the numbers run in
// reading order and every renderer agrees: a work with photographs is a
// figure of them, a release a figure of its tracks, a run of figures a
// figure table, and a GitHub snapshot with its calendar a figure of it.
// Numbers mark figures and plates alone, never a section.

/** How a work sets as a figure, if it does. */
export type WorkFigure = 'gallery' | 'album';

/** A work's images that are there to show. */
export function workImages(work: Work, input: Pick<VariantRenderInput, 'media'>) {
  return (work.media ?? []).filter((placement) => placedImage(placement, input) !== undefined);
}

export function workFigure(
  work: Work,
  input: Pick<VariantRenderInput, 'media'>,
): WorkFigure | null {
  if (work.tracks?.length) return 'album';
  return workImages(work, input).length > 0 ? 'gallery' : null;
}

/** Whether every record an evidence section lists is a figure, so it sets as a figure table. */
export const isFigureTable = (entries: readonly Evidence[]) =>
  entries.length > 0 && entries.every((entry) => entry.metric?.value !== undefined);

/** Whether a GitHub section's snapshot has a calendar to draw. */
export function hasCalendar(section: ViewSection, input: VariantRenderInput): boolean {
  const snapshot = githubSnapshot(section, input);
  return snapshot?.state === 'ready' && snapshot.value.contributionCalendar.length > 0;
}

/** The figure key of a work in a section, or of a section that's one figure. */
export const figureKey = (section: string, record?: string) =>
  record === undefined ? section : `${section}/${record}`;

/**
 * Every figure's number, in the order the page sets them: through the
 * sections given, in the order given, the selection's works aside, since
 * they're plates.
 */
export function figureNumbers(
  sections: readonly ViewSection[],
  input: VariantRenderInput,
  selection: string | undefined,
  plated: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const numbers = new Map<string, number>();
  const add = (key: string) => numbers.set(key, numbers.size + 1);
  for (const section of sections) {
    if (section.kind === 'works' && section.id !== selection) {
      for (const work of worksOf(section, input)) {
        if (workFigure(work, input) && !plated.has(work.id)) add(figureKey(section.id, work.id));
      }
    } else if (section.kind === 'evidence' && isFigureTable(evidenceOf(section, input))) {
      add(figureKey(section.id));
    } else if (section.kind === 'github' && hasCalendar(section, input)) {
      add(figureKey(section.id));
    }
  }
  return numbers;
}
