import type { Evidence } from '@portfolio/schema';

// How a section of evidence hangs (redesign, stream C), apart from its
// renderer so the model can count what it numbers:
//
//   checklist   metrics, awards, talks, publications, patents, and the
//               rest: wall labels, each with its number, title, year, and
//               medium, the catalogue's list mode
//   clippings   press: the quote at title size, its credit below
//   voices      testimonials: a visitors' book, the middle entry hung lower

export type EvidenceLayout = 'checklist' | 'clippings' | 'voices';

/** How a section of these entries hangs. */
export function layoutOf(entries: readonly Evidence[]): EvidenceLayout {
  const every = (type: Evidence['type']) =>
    entries.length > 0 && entries.every((entry) => entry.type === type);
  if (every('press')) return 'clippings';
  if (every('testimonial')) return 'voices';
  return 'checklist';
}

/** Whether a section of these entries reads across the gallery rather than in half of it. */
export function readsWide(entries: readonly Evidence[]): boolean {
  return layoutOf(entries) !== 'checklist';
}
