# DESIGN.md: variant-pull-request

Issue #270, built toward its proof of concept (gist `133fd86d948cccff62f6bf89eaab718b`). The issue and the gist were the approved design; the owner reviews the built home and case page before the composition flips to `ready`.

## Composition idea

The portfolio as a pull request to the reader's team, read as a review page.

## Manifest summary

| Field                      | Value                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| `id` / `name`              | `pull-request` / Pull Request                                    |
| `compositionFamily`        | `document`                                                       |
| `motionIntent`             | `subtle`                                                         |
| `performanceTier`          | `light`                                                          |
| `textDirection`            | `["ltr", "rtl"]`                                                 |
| `visitorControl.placement` | `footer`                                                         |
| `routes`                   | home and work `bespoke`; no views                                |
| `enhancements`             | `review`, `requires: []`                                         |
| `scrollReserve`            | the phone's merge bar, `blockEnd`, under `(max-width: 47.99rem)` |

## Arrangement

- **Header band**, full width in the accent: the base and head branches (`your-team/main` from `<login>/join`) and "Change 1 of 1", the h1 "Add <name> to your team", the Open pill with the author and how many commits it proposes, and the change's size, `+N −N across N files` with twenty squares.
- **Body**, at the page width: the rail at the start (the tabs, then the file tree with its Viewed count and bar), the panels in the middle, the desk at the end (the merge box, then Reviewers, Labels and Author). Three columns from 64rem, two from 48rem (the desk under the panels), one below that.
- **Panels** (the navigation model's grouping, never moving a section's destination): Conversation is About and the index-only sections; Commits is the record's chronology; Checks is the rest of the record (evidence, GitHub); Files changed is the work and writing. Contact (contact and cta) is the merge box.
- **Conversation**: the hero as the description post ("opened this change", Author), then a timeline: the notes on the diff (the first changed file's excerpt), the commits added (the three newest), all checks passed, each About section as a comment in the owner's order, "Review requested from you", and the merge, hidden until it happens.
- **Commits**: grouped by start year, newest first, each a native disclosure: a dot, the short hash (FNV-1a of the record's id), the message built from the kind, the period; inside, the description, highlights, achievements and git-style trailers.
- **Checks**: a passing head, then each evidence record as a check (`<type>/<id>`, its claim, its figure, Passed), a disclosure only when it holds more: the rest of the record and its sources (its own links, its source, the works that cite it, the records whose highlights state its figure).
- **Files changed**: the count, the size and Unified or Split, then one file per work: the path (`works/<organization>/<slug>.md`, `works/<section>/...` with no organization, `writing/...`), New file, the size, Viewed; a unified diff table with the notes pinned under their lines; Expand for the rest; the work's pictures under it.

## Navigation and reveal

- Without a script: every panel in order with its h2, every diff whole, the tab links plain fragment links, commits and checks native disclosures, the merge link real.
- With the island: a tab list (arrow keys, Home and End; automatic activation; the hash kept with `replaceState`), one panel at a time, a link or hash into a panel showing it first; Viewed folds a file and fills the bar; the fold button; Expand, folded at first; Unified or Split at 48rem and up; Approve and merge records the merge (Merged pill, "Merged into your-team/main", Approved by you, the timeline's merge event).
- A work's own page (`/work/<slug>`): the header with the work's title as the h1, a trail back to the files and to the previous and next file, the whole diff, and the checks it cites.

## Motion plan

Subtle: the progress bar's fill and the fold chevrons on `--motion-feedback`, and the branch joining main on merge on `--motion-scene`. Under reduced motion or a static boundary the branch joins without drawing and nothing transitions. No loop, timer or frame loop (`animation: 0`).

## Section coverage map

| Kind         | Treatment | Notes                                                   |
| ------------ | --------- | ------------------------------------------------------- |
| `works`      | bespoke   | Files changed: one diff a work                          |
| `evidence`   | bespoke   | Checks                                                  |
| `chronology` | bespoke   | Commits, by year                                        |
| `practice`   | bespoke   | A comment that adds labels (skills, tools), or services |
| `contact`    | bespoke   | The merge box                                           |
| `custom`     | bespoke   | A comment with its items                                |
| `hero`       | bespoke   | The description                                         |
| `lede`       | bespoke   | A comment                                               |
| `now`        | bespoke   | A comment, with its As of                               |
| `quote`      | bespoke   | A comment's blockquote                                  |
| `focus`      | bespoke   | A checked list of what changes for the reader's team    |
| `fun-facts`  | bespoke   | A comment's list                                        |
| `cta`        | bespoke   | Beside the merge box, its primary action leading        |
| `github`     | bespoke   | The snapshot as a check, its pinned repositories listed |

## Controls and content slots

None. The composition writes none of the owner's words: a work with a case study's challenge and outcomes reads as its before and after; any other work is a new file. A `kgn/change` content extension (also proposed for Before / After) would give each work its own before and after; until then the proof of concept's drafted lines are not carried over.

## Kit usage map

**Will use:** `composePages`, `renderSection`, `navigationModel` with `grouping`, `pageOutline`, `footerOutline`, `worksOf`, `evidenceOf`, `chronologyOf`, `recordAnchor`, `anchorSection`, `placedMedia`, `MediaFigure`, `RichText`, `PeriodText`, `DateText`, `LabeledDate`, `githubSnapshot`, `safeHref`, `hrefFor`, `sameTarget`, `Enhancement`, `VisitorControlSlot`. **Expect to hoist:** nothing yet; the word diff and FNV-1a hash stay local until a second composition needs them.

## Performance tier

Light: server markup, one stylesheet within 10,240 B gzipped, one island within 6,144 B. The split view is built on demand from the unified rows, so the page ships one table a diff.

## Accessibility

One h1, panel h2s, section h3s, records h4. Diff marks, numbers, hashes and hunk rules are `aria-hidden`; each line is read as "Added:" or "Removed:" and its words; changed words are `<ins>` and `<del>`. Tabs follow the APG tab pattern once the island runs. The merge link says it opens a new tab. The phone's merge bar is reserved with `scrollReserve`. Print shows every panel and opens every disclosure.

## Appearance boundary

- **Text roles:** body for what people wrote; code for paths, hashes, numbers and diffs; display for the h1; title for headings and the description's thesis; numeric for figures.
- **Surfaces and colors:** the header on the accent with on-accent; added and removed lines as the positive and danger roles mixed into the canvas (13% and 11%, the changed words 34% and 30%); hunks as information at 10%; the merge box on the inverse pair (text-primary ground, text-inverse ink); the Open pill on on-accent with the accent, Merged on emphasis.
- **Primitives:** none; native links, buttons, a checkbox and `details`.
- **Layout properties:** `--layout-rail`, `-desk`, `-av`, `-mark`, `-bar`, `-edge`, `-round`, `-add*`, `-del*`, `-hunk`, `-wash`, `-viewed`, `--layout-line-rule`, `--layout-line-strong`, and the motion slots.
- **Moved to packs:** the proof of concept's merge green, Charter and PT Mono. A review color scheme and a Charter and PT Mono typography profile would be packs, not this composition's.
