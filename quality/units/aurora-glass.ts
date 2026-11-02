// Aurora Glass's quality unit (#11, Slice 1, item 4). As for the fallback
// composition: under read-only a site page takes the visitor's display mode
// from the preference cookie (#19, Slice 4), never from the query the
// high-contrast row sets, so the row can't take there, and fails closed as
// an ignored emulation. The display-mode cells publish high-contrast in the
// site document instead. Remove this once the row sets the cookie.
//
// No interaction is registered: a registered dialog has to show under one
// name on every cell of its route, and the capsule's Index button reads
// "Menu" on a phone, while Pause the sky shows only where the sky moves.
// The tester checks both from the template's "None registered" item.
// Aurora's own checks (brief §5.2, step 11) run where a unit can't export
// them: Pause stops both loops, the drift stops once the opening scrolls
// away, and no text sits on the sky, in tests/e2e/aurora-glass.spec.ts; the
// glass ruling, the blur count and the loops' gates in
// packages/variant-aurora-glass/src/__tests__/composition.test.tsx.
import type { NotApplicable } from '../../tests/quality/lib/registration';

export const notApplicable: readonly NotApplicable[] = [
  {
    match: { row: 'high-contrast' },
    reason:
      "Under read-only a site page reads the visitor's display mode from the preference cookie, not the query the row sets; the display-mode cells publish high-contrast in the site document, and the primitives run in it through the tuples that publish it.",
  },
];

// Its home slice is its own (variants-10 brief §5.2, P1), so the distinct
// design guards hold it to every other composition: no `distinct` line.

// Its case-study page is its own since P2 (routes.work: bespoke), so no
// `coverage` line: check:variants and the outline sweep hold it to every kind.

// What Aurora leaves out on purpose (the content sweep's flip rule): each a
// field the fallback shows, and why this composition's design omits it.
export const contentRuled = [
  {
    field: 'practice.thesis',
    reason:
      "The thesis is split at its first sentence: the display line inside the h1, and the rest as the opening's standfirst.",
  },
  {
    field: 'evidence(publication).citation',
    reason:
      "A publication's row shows the title, venue, authors and date its formatted citation is made of.",
  },
  {
    field: 'work(writing).excerpt',
    reason:
      "Only the lead essay's excerpt is set as the band's pull quote; the other essays show their summaries.",
  },
  {
    field: 'work(writing).tags',
    reason: 'Aurora files no work under tags: its bands and folds are the grouping.',
  },
  {
    field: 'work(image-series).media.tags',
    reason:
      "Aurora files no photograph under tags: the Looking stage shows each one's caption and place.",
  },
];
