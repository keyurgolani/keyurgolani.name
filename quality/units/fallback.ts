// The fallback composition's quality unit (#11, Slice 1, item 4). The site
// pages render no #19 presentation boundary until #19 slice 4, and the kit
// has no high-contrast theme, so a display mode the visitor picks has
// nothing to apply to there yet: the high-contrast row can't take, and
// fails closed as an ignored emulation. #19's shared primitives still run
// in high contrast, in every cell whose tuple publishes it. Remove this
// once the boundary renders on the site pages.
import type { NotApplicable } from '../../tests/quality/lib/registration';

export const notApplicable: readonly NotApplicable[] = [
  {
    match: { row: 'high-contrast' },
    reason:
      "The site pages render no presentation boundary until #19 slice 4, so the visitor's high-contrast display mode has nothing to apply to; the primitives run in high contrast through the tuples that publish it.",
  },
];
