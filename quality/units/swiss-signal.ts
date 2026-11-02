// Swiss Signal's quality unit (#11, Slice 1, item 4), from pnpm register-variant. As
// for the fallback composition: under read-only a site page takes the
// visitor's display mode from the preference cookie (#19, Slice 4), never
// from the query the high-contrast row sets, so the row can't take there, and
// fails closed as an ignored emulation. The display-mode cells publish
// high-contrast in the site document instead. Remove this once the row sets
// the cookie.
import type { NotApplicable } from '../../tests/quality/lib/registration';

export const notApplicable: readonly NotApplicable[] = [
  {
    match: { row: 'high-contrast' },
    reason:
      "Under read-only a site page reads the visitor's display mode from the preference cookie, not the query the row sets; the display-mode cells publish high-contrast in the site document, and the primitives run in it through the tuples that publish it.",
  },
];

// Its home slice is its own (variants-10 brief §5.1, P1), so the distinct
// design guards hold it to every other composition: no `distinct` line.

// Its phase 2 is in: every core kind renders bespoke on home, and its own
// case-study page (routes.work bespoke), so coverage and the outline sweep
// hold it as complete: no `coverage` or `outlineKnown` line.

// The content sweep's rulings (apps/web/src/server/content-sweep.test.tsx):
// what this composition leaves out of what the owner wrote, on purpose.
export const contentRuled = [
  {
    field: 'section(hero).greeting',
    reason:
      "The first view leads with the thesis (variants-10 brief N5), and a greeting survives only where the report specifies one, Aurora's eyebrow and Flux's first headline line, so this composition sets none.",
  },
];
