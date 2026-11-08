// Mission Control's quality unit (#11, Slice 1, item 4), from pnpm register-variant. As
// for the fallback composition: under read-only a site page takes the
// visitor's display mode from the preference cookie (#19, Slice 4), never
// from the query the high-contrast row sets, so the row can't take there, and
// fails closed as an ignored emulation. The display-mode cells publish
// high-contrast in the site document instead. Remove this once the row sets
// the cookie.
//
// Its own controls (P2): each record that names others has a Linked button
// whose native popover lists them (the pin of correlate, MC-M4 and M5), and
// the full record waits behind closed native disclosures at each board's
// end, with the ended roles behind one inside Experience and a work's long
// fields behind its cell's own fold (Design gate rules 7 and 8). Each is
// registered by its control's accessible name on the complete fixture, one
// that's on the page at every width the cells run (a phone's one-quote fold
// isn't: on 8 columns and more all the quotes stand). A summary's heading
// sits inside it, so a VoiceOver run checks it's still in the headings list.
// Each name is the complete fixture's content, so each is on that state alone:
// the sparse and missing-media pages hold none of these records (#211, row 102).
import type { Interaction, NotApplicable } from '../../tests/quality/lib/registration';

export const interactions: readonly Interaction[] = [
  // The signature work's Linked control: its list opens like a non-modal dialog (focus moves
  // in, Tab off an end or Escape closes it, focus goes back to the control).
  { kind: 'dialog', name: '3 linked records', route: '/', state: 'complete' },
  // A closed panel of the full record, by its summary: its title, then its count.
  { kind: 'disclosure', name: 'Education title 1 entry', route: '/', state: 'complete' },
  // The ended entries inside Experience.
  { kind: 'disclosure', name: '2 earlier entries', route: '/', state: 'complete' },
  // A work cell's own fold, named by what it holds.
  { kind: 'disclosure', name: 'Credits and notes', route: '/', state: 'complete' },
];

export const notApplicable: readonly NotApplicable[] = [
  {
    match: { row: 'high-contrast' },
    reason:
      "Under read-only a site page reads the visitor's display mode from the preference cookie, not the query the row sets; the display-mode cells publish high-contrast in the site document, and the primitives run in it through the tuples that publish it.",
  },
];

// Its home slice is its own (variants-10 brief §5.8, P1), so the distinct
// design guards hold it to every other composition: no `distinct` line.
//
// The N12 thumbnail test's one recorded exception: Mission Control × Terra
// Field in the default recipe reads 0.576 (rank 1 of 91, over the 0.425
// line), 0.531 without the luminance term, 0.132 signed. It's the ink field
// (both light, with a dark band low in the frame), and the pair isn't
// mistakable by eye. Ruled (a) at P1 at 0.574; raised to 0.576 on
// 2026-10-31, when the P2 design delta on 117675ca4 passed it by eye again
// (kgn-e-design-review-mc-p2.md, "Delta (117675ca4)", question 5). Over 0.576
// it goes back to the lead.

// The content sweep's rulings (apps/web/src/server/content-sweep.test.tsx):
// what this composition leaves out of what the owner wrote, on purpose.
export const contentRuled = [
  {
    field: 'section(hero).greeting',
    reason:
      "The first view leads with the thesis (variants-10 brief N5), and a greeting survives only where the report specifies one, Aurora's eyebrow and Flux's first headline line, so this composition sets none.",
  },
];
