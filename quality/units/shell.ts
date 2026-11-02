// Shell's quality unit (#11, Slice 1, item 4), from pnpm register-variant. As
// for the fallback composition: under read-only a site page takes the
// visitor's display mode from the preference cookie (#19, Slice 4), never
// from the query the high-contrast row sets, so the row can't take there, and
// fails closed as an ignored emulation. The display-mode cells publish
// high-contrast in the site document instead. Remove this once the row sets
// the cookie.
//
// Shell's own widget (variants-10 brief §5.6) is the palette: the status
// line's jump button opens a modal dialog with a combobox over the page's
// sections, works and links, and its count is a polite live region.
import type { Interaction, NotApplicable } from '../../tests/quality/lib/registration';

export const interactions: readonly Interaction[] = [
  { kind: 'dialog', name: 'jump', route: '/' },
  {
    kind: 'status',
    name: 'Jump to a section, work, or link',
    route: '/',
    announces: "How many entries match the query, such as '3 matches'",
  },
];

export const notApplicable: readonly NotApplicable[] = [
  {
    match: { row: 'high-contrast' },
    reason:
      "Under read-only a site page reads the visitor's display mode from the preference cookie, not the query the row sets; the display-mode cells publish high-contrast in the site document, and the primitives run in it through the tuples that publish it.",
  },
];

// The content sweep's rulings (apps/web/src/server/content-sweep.test.tsx):
// what Shell leaves out of what the owner wrote, on purpose, each for a design
// reason that names its concept item.
export const contentRuled = [
  {
    field: 'section(hero).greeting',
    reason:
      "whoami opens on the thesis as its first output line, the page's h1, with the owner's name its prefix (SH-M1, variants-10 brief N5), and Shell prints no greeting comment over it, so the hero's greeting has no line to print on.",
  },
];

// Coverage is whole since its phase 2: it renders every core kind itself and
// its own case-study page (routes.work: bespoke), the man page, so
// check:variants and the outline sweep fail it for any shared section, on
// home or a work's page.
