// Raw Grid's quality unit (#11, Slice 1, item 4), from pnpm register-variant. As
// for the fallback composition: under read-only a site page takes the
// visitor's display mode from the preference cookie (#19, Slice 4), never
// from the query the high-contrast row sets, so the row can't take there, and
// fails closed as an ignored emulation. The display-mode cells publish
// high-contrast in the site document instead. Remove this once the row sets
// the cookie.
//
// Raw Grid's own checks (§5.3 step 10) run where a unit can't export them
// (tests/quality/lib/registration.ts takes only interactions,
// primaryActions, notApplicable, distinct, coverage, and outlineKnown):
// no cell radius and at most one red per viewport in
// tests/e2e/raw-grid.spec.ts, in the browser; ticker facts shown as DOM
// text and every sticker linking to a record the page shows in
// packages/variant-raw-grid/src/__tests__/composition.test.tsx, on every
// contract fixture too.
import type { NotApplicable } from '../../tests/quality/lib/registration';

export const notApplicable: readonly NotApplicable[] = [
  {
    match: { row: 'high-contrast' },
    reason:
      "Under read-only a site page reads the visitor's display mode from the preference cookie, not the query the row sets; the display-mode cells publish high-contrast in the site document, and the primitives run in it through the tuples that publish it.",
  },
];

// Coverage is whole since its phase 2: it renders every core kind itself
// and its own case-study page (routes.work: bespoke), so check:variants and
// the outline sweep fail it for any shared section, on home or a work's page.

// The content sweep's rulings (apps/web/src/server/content-sweep.test.tsx):
// what this composition leaves out of what the owner wrote, on purpose.
//
// Judged true duplicates, left out by the renderers themselves rather than ruled here, since
// each still shows once (the lead's rulings on the sweep, 1 Nov 2026):
// - an episode's series equal to its table's title isn't said again on its row (2(a));
// - an external work's place equal to its link's text isn't said again beside it (2(b));
// - a work with a page of its own leaves its description to that page, only while home's listing
//   links straight there and says its summary (2(c), held by content.test.tsx).
export const contentRuled = [
  {
    field: 'section(hero).greeting',
    reason:
      "The first view leads with the thesis (variants-10 brief N5), and a greeting survives only where the report specifies one, Aurora's eyebrow and Flux's first headline line, so this composition sets none.",
  },
];
