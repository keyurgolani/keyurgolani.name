import {
  defineNavigationOverrides,
  navigationModel,
  type Destination,
  type DestinationId,
  type NavigationModel,
  type PageOutline,
} from '@portfolio/kit/sections';

// Atelier's navigation (redesign, stream C): the kit's shared model, with
// its five fixed destinations and the canonical map, so a section sits in
// the same group whatever composition draws it. Atelier departs from the
// map once (ATELIER_OVERRIDES), and names the destinations content first,
// the metaphor second (OA-M2): Work, Writing, Record, Practice, Contact.
// The chrome holds none of them (its room switch is the rooms), so the
// plan of the exhibition and its doors are where they show.

export type { Destination, DestinationId, NavigationModel };

/**
 * Where Atelier places a section other than the map says: the practice's
 * thesis is the entrance's room title, on the opening wall, so no
 * destination lands on it. Every other section goes where the map puts it.
 */
export const ATELIER_OVERRIDES = defineNavigationOverrides({ 'practice:thesis': null });

/** Atelier's words for the destinations: the content, plainly; About is the practice. */
const LABELS = {
  work: { text: 'Work' },
  writing: { text: 'Writing' },
  record: { text: 'Record' },
  about: { text: 'Practice' },
  contact: { text: 'Contact' },
} as const;

/** The page's navigation: every destination with sections, each section where the map and Atelier's overrides place it. */
export function atelierNavigation(outline: PageOutline): NavigationModel {
  return navigationModel(outline, { primary: 5, overrides: ATELIER_OVERRIDES, labels: LABELS });
}

/** The destination with the id, when the page has one. */
export function destination(model: NavigationModel, id: DestinationId): Destination | undefined {
  return model.primary.find((each) => each.id === id);
}
