// Schematic's quality unit (#11, Slice 1, item 4). As for the fallback
// composition: under read-only a site page takes the visitor's display mode
// from the preference cookie (#19, Slice 4), never from the query the
// high-contrast row sets, so the row can't take there, and fails closed as
// an ignored emulation. The display-mode cells publish high-contrast in the
// site document instead. Remove this once the row sets the cookie.
//
// No interaction is registered: the drawing index is a native dialog the
// enhancement opens from buttons named "Index" on desktop and "Sheet" on
// phones, and a plain link to the footer's index without it, so one name
// can't hold on every cell of its route. The tester checks it from the
// template's "None registered" item. Schematic's own checks (brief §5.4,
// step 11) run where a unit can't export them: the title block in the
// cover's bottom-right corner, the zone references on four edges, the
// index dialog and its no-JS footer index, 0 animations at idle and the
// draw-on never holding text, the sticky chrome's clearance, in
// tests/e2e/schematic.spec.ts; right to left, the long-text fixture and the
// detail sheet in tests/e2e/schematic-{rtl,long-text,case}.spec.ts.
import type { NotApplicable } from '../../tests/quality/lib/registration';

export const notApplicable: readonly NotApplicable[] = [
  {
    match: { row: 'high-contrast' },
    reason:
      "Under read-only a site page reads the visitor's display mode from the preference cookie, not the query the row sets; the display-mode cells publish high-contrast in the site document, and the primitives run in it through the tuples that publish it.",
  },
];

// Its home slice is its own (variants-10 brief §5.4, P1), so the distinct
// design guards hold it to every other composition, Swiss Signal first: no
// `distinct` line.

// Phase 2: home renders every core kind itself and a work's own page is its
// detail sheet (routes.work is bespoke), so check:variants and the outline
// sweep hold it as complete: no `coverage` or `outlineKnown` line.

// The content sweep's rulings (apps/web/src/server/content-sweep.test.tsx):
// what this composition leaves out of what the owner wrote, on purpose.
export const contentRuled = [
  {
    field: 'section(hero).greeting',
    reason:
      "The first view leads with the thesis (variants-10 brief N5), and a greeting survives only where the report specifies one, Aurora's eyebrow and Flux's first headline line, so this composition sets none.",
  },
];
