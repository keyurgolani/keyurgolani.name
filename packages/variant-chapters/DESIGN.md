# DESIGN.md: variant-chapters

The concept, its book model and its mockups were approved at P-0 with five conditions (the r4 design review). This file is the contract the package builds to. The signature is the bound book: two equal pages around one gutter, folios in both bottom corners, a running head split across the gutter, and a fore-edge that shows the whole book and your place in it.

## Composition idea

The portfolio as a bound book: a title page and contents, one chapter for each era of the chronology, and an index.

## Manifest summary

| Field                      | Value                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `id` / `name`              | `chapters` / Chapters                                                                       |
| `compositionFamily`        | `document` (no `book` or `paged` family exists)                                             |
| `motionIntent`             | `directed`: one load moment on the title page, and the page turn                            |
| `performanceTier`          | `light`: css 9,216 B, js 0                                                                  |
| `textDirection`            | `["ltr", "rtl"]`: logical properties, so the book binds on the right                        |
| `visitorControl.placement` | `footer`: the endpaper colophon                                                             |
| `routes`                   | home and work bespoke; views `chapter` (`chapters/{chapter}`) and `back-matter`, under home |
| `transitions`              | cross-document, names `chapters-runhead`, `chapters-edge`, `chapters-mark`                  |
| `kitLayout`                | `false`: every core kind is bespoke                                                         |

## Arrangement

- **Spreads.** A spread is a verso, a 1px gutter, and a recto on an 88rem book block, with book margins mirrored across the gutter (outer wider than inner), and its two folios on their own row. Beyond the block the ground is one surface step quieter, the one physical cue the paper gives. Below 60rem the book folds to single pages, each folio a page break between hairlines.
- **Home is the front matter** (pages i to iv): the title page set from the thesis, facing the signature work as the frontispiece, with the imprint (the hero's subtagline, the identity, the proof) across their foot; then the contents, a whole page with the chapter numerals in their inks, each chapter's span, roles and parts, and a tick for each of its pages, facing the preface (the quote as epigraph, the first lede with a drop cap).
- **A chapter is an era** (pages from 1): the opener (the numeral, the title, the span, the roles, In this chapter with page numbers, and the era's own opening text), then in the authored section order each work with a cover as a plate facing its text (alternating sides), each work with several images as the double-page series (the one thing across the gutter), the rest as group pages packed two to a spread, a lone group as two columns whose rule is the gutter, the current chapter's Still being written, and the turnstile.
- **The back matter**: About the author with the fun facts, the engagements, Also by, Uncollected, and the index: works by kind, then every skill and tool by letter with page locators.
- **The case study** is a section of its chapter: the fact sheet facing the plate, the story in two columns with run-in heads, the decisions across the gutter, then what changed, the afterword, and praise.

## Navigation and reveal

The running head carries the book's name and where you are on the verso, and Contents, Index and Write on the recto. On a phone it keeps Contents and Write, so contact is one tap from any page (C4). The fore-edge's segments are the front matter, each chapter and the back matter, sized by their pages; hovering or focusing one shows its label plate, and a contents entry under the pointer lights its segment. Every locator is a link to an anchor, never a page number alone. The endpaper closes every view with the contact, the call to action and the reading-light control. Nothing waits on a script: every view is a server page that works without JavaScript and after a refresh.

## Motion plan

- **The title page's one moment:** the gutter binds from the top, the title rises, the subtitle follows, then the imprint fades in. Durations are multiples of `--ui-motion-slow`. Under reduced motion or the pause it never runs.
- **The page turn** is a cross-document view transition the manifest opts into. The running head and the fore-edge are held by name and the place mark slides to the new chapter over `--ui-motion-slow` times 1.9; the host crossfades the page. Under reduced motion the host fades everything by opacity alone over `--ui-motion-fast`, with no travel; under the pause it cuts.
- **The fore-edge fills with your scroll** through a scroll-driven timeline, which does no idle work, and only when motion is welcome. Otherwise the current segment is fully inked.
- No loops, no enhancements, no frame callbacks.

## Section coverage map

| Kind         | Treatment | Notes                                                                                 |
| ------------ | --------- | ------------------------------------------------------------------------------------- |
| `works`      | bespoke   | plates, the series, or entries on group pages, in the chapter its records place in    |
| `evidence`   | bespoke   | one entry renderer per type; external work is Also by; proof is the imprint           |
| `chronology` | bespoke   | roles and studies are the spine that makes the eras; side threads are Alongside lines |
| `practice`   | bespoke   | the thesis is the title; skills and tools the index; services the engagements         |
| `contact`    | bespoke   | the endpaper colophon, on every view                                                  |
| `custom`     | bespoke   | the back matter's Uncollected pages                                                   |
| `hero`       | bespoke   | the title page: the name, the CTAs as links, the subtagline in the imprint            |
| `lede`       | bespoke   | the first is the preface; later ones go to Uncollected                                |
| `now`        | bespoke   | Still being written, at the end of the current chapter                                |
| `quote`      | bespoke   | the epigraph                                                                          |
| `focus`      | bespoke   | Still being written                                                                   |
| `fun-facts`  | bespoke   | About the author                                                                      |
| `cta`        | bespoke   | merged into the endpaper colophon                                                     |
| `github`     | bespoke   | Still being written, as prose and the pinned repositories from the snapshot           |

## Controls and content slots

`maxChapters` (2 to 7, default 6), `chapterTitles` (organization, role or years), `chapterAccents` (on by default), `spine` (left, top or off: where the fore-edge sits on a wide screen; a phone always has the top bar) and `folios` (on by default; off, no page number prints, and the contents, the index and every cite point by chapter). The owner's own chapters, `chapters` (a K-3 `periodList` of at most 7 `{ slug, title, from, teaser? }`), replace the derived boundaries and titles; records place by date between the starts, and the cap and `chapterTitles` don't apply. A list the book can't bind (malformed, out of order, a reserved slug, a start after now) is refused whole and the derived chapters print. `place` (a `recordPlacement`) moves a record into a chapter as rule (b), after links; a move the book can't make (no such record or chapter, a link that holds it, external work) keeps the record where its rules put it, and a malformed map (a move that names no chapter slug, more than 256 moves) is refused whole. No content slots: the book derives from what's there, with fallbacks for no spine (calendar years), nothing dated (one chapter), no signature (no frontispiece) and no cover (a text page, never an empty frame).

## Kit usage map

**Will use:** `composePages` with `views` (K-3) and its unknown-view note, `worksOf`, `evidenceOf`, `chronologyOf`, `placedImage` and `MediaFigure`, `RichText`, `footerOutline`, `frameAttributes`, `githubSnapshot`, `routedWork` and `caseStudyOutline`, `VisitorControlSlot`, `formatFigure`, and `routeHref`. **Expect to hoist:** nothing yet.

## Performance tier

Light. No JavaScript of its own, so 0 js. The compiled stylesheet is about 6.4 KB gzip without the kit's layout. The cost is in book-serif's fonts and a navigation per chapter; each chapter is a separate, small document.

## Accessibility

One h1 per view: the book's title at home, the chapter's title, Back matter, or the work's title. Headings run h2 for plates, groups and parts, h3 for their entries. The fore-edge and the running head are named navigation; the numerals and folios are decoration, hidden from assistive technology, and every chapter link carries its number in its name. Links are underlined. Reduced motion is designed, not removed.

## Appearance boundary

- **Text roles:** the title in `display`; chapter titles, plate titles and the contents' titles in `headline`; entries in `title`; prose in `body` (set one step up for long prose); meta lines in `body-compact`; plate captions in `caption`; the span, the preface's lead, ledes and subtitles in `quote`; folios and page numbers in `numeric`. Furniture (the running head's place, In this chapter, the turnstile's direction) is the caption role in capitals at the label role's size, the one furniture voice. Nothing visible is in `label`. No rule sets a weight on a role (C1).
- **Surfaces and colors:** the pages on the canvas, the ground beyond on `surface-subtle`, the endpaper tinted from the chapter's ink (home's from the text ink, F7). Chapter inks are `--color-data-categorical-1` to `5`, used at large sizes and as non-text; small tinted text mixes 62% ink into `text-primary`.
- **Primitives:** none rendered; the visitor slot is the host's.
- **Layout properties:** `--layout-edge`, `-inner`, `-outer`, `-book`, `-runhead`, `-bleed`, `-hair`, `-line-hair`, `-ink`, `-ink-text`, and `--layout-measure-scale` from the body face's size adjust (C2).
- **Selections to judge it under:** letterpress, paper-ink and book-serif (the recipe), and the platform defaults (platform-neutral, warm-parchment, humanist-ui), each light and dark.
- **Moved to packs:** the paper, the inks, the square plates and the faces are letterpress, paper-ink (which took in bookcloth's cloths as its categorical set) and book-serif.
