// Flux's quality unit (#11, Slice 1, item 4), from pnpm register-variant. As
// for the fallback composition: under read-only a site page takes the
// visitor's display mode from the preference cookie (#19, Slice 4), never
// from the query the high-contrast row sets, so the row can't take there, and
// fails closed as an ignored emulation. The display-mode cells publish
// high-contrast in the site document instead. Remove this once the row sets
// the cookie.
//
// No interaction is registered: a registered dialog has to show under one
// name on every cell of its route, and the Index is a dialog only where the
// browser has the Popover API (a contents list everywhere else), while Pause
// shows only where the field drifts. The tester checks both from the
// template's "None registered" item; tests/e2e/flux.spec.ts holds the
// Index's focus, Tab wrap, inert page and return, and Pause.
import type { NotApplicable } from '../../tests/quality/lib/registration';

export const notApplicable: readonly NotApplicable[] = [
  {
    match: { row: 'high-contrast' },
    reason:
      "Under read-only a site page reads the visitor's display mode from the preference cookie, not the query the row sets; the display-mode cells publish high-contrast in the site document, and the primitives run in it through the tuples that publish it.",
  },
];

// The content sweep's rulings (apps/web/src/server/content-sweep.test.tsx). Neither leaves a word
// out: each is a string Flux sets in two places on purpose, which the sweep, matching one
// unbroken run of text, can't find as one.
export const contentRuled = [
  {
    field: 'practice.thesis',
    reason:
      "Every word of the thesis is on the home page, split by design: its first sentence is the opening's headline (the poster line, brief N5), and the thesis section sets the rest, so the sentence isn't said twice. The sweep looks for one unbroken run (the first 50 letters of a long string), and a first sentence shorter than that puts the run across the two.",
  },
  {
    field: 'section(lede).body',
    reason:
      "Every word of the lede is on the page: its first sentence is set large and the rest folds behind More on phones and tablets (design gate item 7, the 390 length; SF-P2-4), open from 64rem. The fold's label sits between the two, and the sweep looks for one unbroken run (all of a string up to 80 letters, the first 50 of a longer one), so a lede whose first sentence is shorter than that run (the long-text fixture's two) isn't found as one.",
  },
];

// The focus perimeter on Flux's pill controls (the bar's tabs, Index, Pause, the close's links and
// buttons; 059b4d7af's ci:quality-pr, flux complete, every width) is carried as the platform's
// (lead ruling 2026-10-31 (b)): the language's 2px outline is whole round each pill, and its
// curved ends' antialiased fringe under 3:1 is a sampling artefact, which the harness now
// measures along the ring's centre line (f372b3bcb), crediting a pixel within one px of it
// (e47a6c51f). A unit exports no carried cells, so this is a note: the rounded rings clear by that
// check, and the square ones left (the contact address at 1024 and 1440, and the 390 cell, whose
// findings move with the rings' sub-pixel position) are waived in quality/exceptions.yml until the
// post-Sun platform focus target. The one real overlap the re-score found, Pause over Index's
// ring in the phone dock, is fixed in the bar (the controls a ring's reach apart).

// Its home slice is its own (variants-10 brief §5.10, P1), so the distinct
// design guards hold it to every other composition: no `distinct` line.
// Since P2 it renders every core kind and its own case-study page
// (routes.work is bespoke), so check:variants and the outline sweep hold it
// as complete: no `coverage` or `outlineKnown` line.
