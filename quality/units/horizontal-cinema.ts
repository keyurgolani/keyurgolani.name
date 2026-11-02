// Horizontal Cinema's quality unit (#11, Slice 1, item 4; #17; redesign).
// Its one status change is the scene controller's live region, which says
// the scene a step lands on once the move settles. As for the fallback composition: under
// read-only a site page takes the visitor's display mode from the
// preference cookie (#19, Slice 4), never from the query the high-contrast
// row sets, so the row can't take there, and fails closed as an ignored
// emulation. The display-mode cells publish high-contrast in the site
// document instead. Remove this once the row sets the cookie.
import type { Interaction, NotApplicable } from '../../tests/quality/lib/registration';

export const interactions: readonly Interaction[] = [
  {
    kind: 'status',
    name: 'Next scene',
    route: '/',
    announces:
      "The scene a step lands on and its place in the strip, such as 'Postmortem Template Kit, 2 of 26'",
  },
];

export const notApplicable: readonly NotApplicable[] = [
  {
    match: { row: 'high-contrast' },
    reason:
      "Under read-only a site page reads the visitor's display mode from the preference cookie, not the query the row sets; the display-mode cells publish high-contrast in the site document, and the primitives run in it through the tuples that publish it.",
  },
];

// The content sweep's rulings (apps/web/src/server/content-sweep.test.tsx):
// what this composition leaves out of what the owner wrote, on purpose.
export const contentRuled = [
  {
    field: 'section(hero).greeting',
    reason:
      "The opening leads with the thesis (F5), and the craft dossier's template smell 4, the small-name hero that opens on a greeting, rules the greeting out of it.",
  },
];
