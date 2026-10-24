// Horizontal Cinema's quality unit (#11, Slice 1, item 4; #17). Its one
// status change is the chapter controller's live region, which says the
// chapter a step lands on. As for the fallback composition: under
// read-only a site page takes the visitor's display mode from the
// preference cookie (#19, Slice 4), never from the query the high-contrast
// row sets, so the row can't take there, and fails closed as an ignored
// emulation. The display-mode cells publish high-contrast in the site
// document instead. Remove this once the row sets the cookie.
import type { Interaction, NotApplicable } from '../../tests/quality/lib/registration';

export const interactions: readonly Interaction[] = [
  {
    kind: 'status',
    name: 'Next chapter',
    route: '/',
    announces: 'Chapter 2 of 5: Origins',
  },
];

export const notApplicable: readonly NotApplicable[] = [
  {
    match: { row: 'high-contrast' },
    reason:
      "Under read-only a site page reads the visitor's display mode from the preference cookie, not the query the row sets; the display-mode cells publish high-contrast in the site document, and the primitives run in it through the tuples that publish it.",
  },
];
