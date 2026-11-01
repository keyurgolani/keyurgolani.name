import {
  defineNavigationOverrides,
  navigationModel,
  type DestinationId,
  type DestinationLabel,
  type OutlineSection,
  type PageOutline,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// The issue's chapters, from the page's outline, through the kit's
// navigation model (stream A, F4): at most five destinations on its fixed
// ids, in its fixed order (Work, Writing, Record, About, Contact), with
// Writing always its own, each section where the canonical map puts it.
// This composition gives it its own names for the five and one declared
// override, and turns each destination into a chapter. Pure: it reads the
// outline alone.

export type { DestinationId };

/**
 * The chapters' names, on the kit model's fixed ids: Practice is the
 * owner's own account and craft (About), Work and Writing the works,
 * Record the evidence and the history, and Contact the way in.
 */
export const CHAPTER_LABELS: Readonly<Record<DestinationId, DestinationLabel>> = {
  about: { text: 'Practice' },
  work: { text: 'Work' },
  writing: { text: 'Writing' },
  record: { text: 'Record' },
  contact: { text: 'Contact' },
};

/**
 * Editorial Evidence's one departure from the canonical map (N7): every
 * section the issue renders sits in a chapter, so the ones the map leaves
 * to the index alone (an untitled lede, a custom section, an extension's)
 * read in Practice, with the owner's own account. Tested with
 * checkDestinationOverrides() in the composition's tests, which also hold
 * that every section but the hero lands in a chapter.
 */
export const ISSUE_OVERRIDES = defineNavigationOverrides({
  lede: 'about',
  custom: 'about',
  extension: 'about',
});

/** One chapter: its number in the issue, its name, and its sections in reading order. */
export interface Chapter {
  readonly id: DestinationId;
  readonly number: number;
  readonly label: string;
  /** The DOM id of its opener. */
  readonly anchor: string;
  readonly href: string;
  /** Its sections, as the outline lists them, in reading order. */
  readonly sections: readonly OutlineSection[];
}

/**
 * The issue's chapters: at most five, in the kit model's fixed order, so a
 * visitor switching looks finds Work before Writing before Record in every
 * composition, each keeping the owner's order inside it.
 */
export function chaptersOf(input: VariantRenderInput, outline: PageOutline): readonly Chapter[] {
  const model = navigationModel(outline, {
    primary: 5,
    labels: CHAPTER_LABELS,
    overrides: ISSUE_OVERRIDES,
  });
  return model.primary.map((destination, index) => {
    const anchor = `${input.ids.prefix}ee--chapter-${destination.id}`;
    return {
      id: destination.id,
      number: index + 1,
      label: destination.label,
      anchor,
      href: input.route.route === 'home' ? `#${anchor}` : `${outline.home}#${anchor}`,
      sections: destination.sections,
    };
  });
}
