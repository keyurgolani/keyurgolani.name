import { z } from '@portfolio/schema/zod';

// The runtime budgets a unit declares (#6, item 3): a variant in its
// manifest, and each of #19's appearance packs in its own. Six kinds, each
// counted the way `pnpm check:budgets` measures it:
//
// - js: gzip bytes of the unit's own JavaScript a route downloads as it
//   loads, its enhancement chunks left out;
// - css: gzip bytes of the unit's compiled stylesheet;
// - image: bytes of the image files the unit ships;
// - font: bytes of the font files the unit ships, and for a typography
//   profile, the bytes of the faces a sample page loads, with every file
//   it ships reported and not gated;
// - animation: continuous work while the page is active and idle, as #6's
//   trace probes count it: frame loops, recurring timers, and running
//   infinite animations. A finite animation, such as a reveal, ends, and a
//   scroll-driven one does no work while the page sits still, so neither
//   counts (RB ruling R3); a pack's count is its stylesheet's infinite
//   declarations on the same terms. First-party compositions declare the
//   counts FIRST_PARTY_ANIMATIONS approves;
// - enhancement: gzip bytes of the unit's own code in its enhancement chunks.
//
// Each is optional. One a unit leaves out is the ceiling runtime-budgets.json
// sets for the unit's tier, or for a pack's axis, and a declared one may not
// be over that ceiling. Byte counts are whole bytes, so 30720 is 30 KB.

export const BUDGET_KINDS = ['js', 'css', 'image', 'font', 'animation', 'enhancement'] as const;
export type BudgetKind = (typeof BUDGET_KINDS)[number];

/** A unit's declared budgets, by kind. */
export type Budgets = Partial<Record<BudgetKind, number>>;

/** Bytes, up to 10 MB, which no unit comes near. */
const Bytes = z.number().int().nonnegative().max(10_000_000);
/** Things running at once, up to 64. */
const Count = z.number().int().nonnegative().max(64);

export const BudgetsSchema = z
  .object({
    js: Bytes.optional(),
    css: Bytes.optional(),
    image: Bytes.optional(),
    font: Bytes.optional(),
    animation: Count.optional(),
    enhancement: Bytes.optional(),
  })
  .strict();
