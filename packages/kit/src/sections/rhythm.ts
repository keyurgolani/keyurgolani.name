import { createElement } from 'react';
import type { Section } from '@portfolio/schema';
import { KIND_FAMILIES, type OutlineFamily } from './outline';
import { SharedFrame } from './render-section';
import type { FrameAttributes, SectionFrame } from './types';

// The section rhythm (redesign dossier G4): which of the platform's
// --rhythm-* gaps goes before each section, from the section's kind alone,
// so a page has a ladder of gaps rather than one. A composition's stack,
// the kit's `pf-stack`, reads it from `data-rhythm` on each frame:
//
// - `chapter` before the first section of a family on the page, such as
//   the first works or the first evidence, and before an opening section,
//   such as an About lede, that comes once the opening is over;
// - `group` before the section right after the hero, which continues the
//   opening, and before a section of the family the one before it has, or
//   of a family that belongs with it: Now and what the owner is focused
//   on, a contact section and its call to action;
// - `section` before any other.
//
// The first section takes none: nothing comes before it.

/** The gap before a section, by its role on the page. */
export type SectionRhythm = 'chapter' | 'section' | 'group';

/** Families that read as one region when one follows the other. */
const BELONGS_AFTER: Readonly<Partial<Record<string, readonly string[]>>> = {
  focus: ['now'],
  cta: ['contact'],
};

const familyOf = (kind: string): OutlineFamily =>
  KIND_FAMILIES[kind as keyof typeof KIND_FAMILIES] ?? 'other';

/**
 * The gap before each section but the first, by its id, for the sections in
 * the order the page renders them. Pass the sections that render, such as
 * those sectionRenders() admits, so a skipped one doesn't count.
 */
export function sectionRhythms(
  sections: readonly Pick<Section, 'id' | 'kind'>[],
): ReadonlyMap<string, SectionRhythm> {
  const rhythms = new Map<string, SectionRhythm>();
  const seen = new Set<OutlineFamily>();
  let previous: Pick<Section, 'id' | 'kind'> | undefined;
  for (const section of sections) {
    const family = familyOf(section.kind);
    if (previous !== undefined) {
      const before = familyOf(previous.kind);
      // What follows the hero continues the opening.
      const belongs =
        previous.kind === 'hero' || (BELONGS_AFTER[section.kind]?.includes(previous.kind) ?? false);
      const opens =
        family !== 'other' && (!seen.has(family) || (family === 'opening' && before !== 'opening'));
      rhythms.set(
        section.id,
        belongs || (family === before && !opens) ? 'group' : opens ? 'chapter' : 'section',
      );
    }
    seen.add(family);
    previous = section;
  }
  return rhythms;
}

/**
 * A frame that puts each section's rhythm on its root as `data-rhythm`, for
 * a stack that reads it: `Frame`'s own markup, the shared `<section>` by
 * default.
 */
export function rhythmFrame(
  rhythms: ReadonlyMap<string, SectionRhythm>,
  Frame: SectionFrame = SharedFrame,
): SectionFrame {
  return function RhythmFrame(props) {
    const rhythm = rhythms.get(props.section.id);
    if (rhythm === undefined) return createElement(Frame, props);
    const frame: FrameAttributes & { readonly 'data-rhythm': SectionRhythm } = {
      ...props.frame,
      'data-rhythm': rhythm,
    };
    return createElement(Frame, { ...props, frame });
  };
}
