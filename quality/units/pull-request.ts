// Pull Request's quality unit (#11, Slice 1, item 4), from pnpm register-variant. As
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

// Pending its redesign (Design gate rule 5): the distinct design guards report this
// composition's pairs with other pending ones and fail none of them, and
// fail it as stale once it differs from every other. Its lane removes this
// line when its home slice passes design review.
export const distinct = 'pending';
