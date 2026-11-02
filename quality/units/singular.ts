// Singular's quality unit (#11, Slice 1, item 4). As for the fallback
// composition: under read-only a site page takes the visitor's display mode
// from the preference cookie (#19, Slice 4), never from the query the
// high-contrast row sets, so the row can't take there, and fails closed as
// an ignored emulation. The display-mode cells publish high-contrast in the
// site document instead. Remove this once the row sets the cookie.
//
// No interaction is registered: Contents is the shared Dialog primitive,
// named "Contents" at every size, and the pager's keys only page while a
// panel's heading has focus, which a cell can't reach by name. The tester
// checks both from the template's "None registered" item. Singular's own
// checks (brief §5.7, step 9) run where a unit can't export them: keys only
// on panel headings, focus landing on the incoming heading, snap off under
// reduced motion, the bands on the other ground, and the 390 action stack,
// in tests/e2e/singular-pager.spec.ts.
import type { NotApplicable } from '../../tests/quality/lib/registration';

export const notApplicable: readonly NotApplicable[] = [
  {
    match: { row: 'high-contrast' },
    reason:
      "Under read-only a site page reads the visitor's display mode from the preference cookie, not the query the row sets; the display-mode cells publish high-contrast in the site document, and the primitives run in it through the tuples that publish it.",
  },
];

// Its home slice is its own (variants-10 brief §5.7, P1), so the distinct
// design guards hold it to every other composition, Swiss Signal and
// Horizontal Cinema first: no `distinct` line.

// Coverage: home renders every core kind itself and, from P2, the case-study
// page is its own (routes.work bespoke), so no coverage line.

// The content sweep's rulings (apps/web/src/server/content-sweep.test.tsx):
// what this composition leaves out of what the owner wrote, on purpose.
export const contentRuled = [
  {
    field: 'section(hero).greeting',
    reason:
      "The first view leads with the thesis (variants-10 brief N5), and a greeting survives only where the report specifies one, Aurora's eyebrow and Flux's first headline line, so this composition sets none.",
  },
  {
    field: 'section(hero).name',
    reason:
      "A true duplicate: the hero's name names the same person the page's one h1 already names, from the identity, at the top of panel 1 (SG-M1), and a second name over it would be the same answer twice.",
  },
  {
    field: 'section(cta).*Action.label',
    reason:
      "A true duplicate, per address: a call to action nested in the contact panel adds its actions to the panel's links, and each address shows once, under the first of his labels for it, in this order: his portfolio's links, his contact record's, the hero's calls to action, then the nested calls to action's; his email is the band, in a call to action's own words for it when one has them ('Email me'). So a later label for an address already shown, such as 'Download CV' for the CV his 'Resume' link names, is the one left out (model.test: every address once, under one of his labels).",
  },
];
