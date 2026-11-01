# DESIGN.md: variant-shell

The build brief is `S10/brief.md` §5.6, and the concept is `V10/shell/concept.json` (SH-M5). This file is the composition's design contract inside the repo. Where it and the brief disagree, the brief wins.

## Composition idea

The portfolio as one open terminal session: a transcript read top to bottom, an index that jumps anywhere, and a status line that says where you are.

## Manifest summary

| Field                      | Value                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `id` / `name`              | `shell` / Shell                                                                       |
| `compositionFamily`        | `document`                                                                            |
| `motionIntent`             | `subtle`                                                                              |
| `performanceTier`          | `light`                                                                               |
| `textDirection`            | `["ltr", "rtl"]`                                                                      |
| `visitorControl.placement` | `footer`                                                                              |
| `routes`                   | home: `bespoke`; work: `shared` at P1 and `bespoke` at P2 (the man page); views: none |
| `recommendedAppearance`    | `shell` (B's recipe: `primer-inspired`, `night-terminal`, `shell-mono`, dark)         |
| `keyBindings`              | `{ region: 'document', keys: ['mod+k', '/'], action: 'palette.open' }` (K-4 (d))      |
| `enhancements`             | `palette`, `requires: []`                                                             |
| budgets                    | css 10,240, js 1,024, enhancement 6,144, image 61,440, font 0, animation 0            |

## Arrangement

- **The session.** At 1280 px and up there are three parts: the transcript (`minmax(0, 1fr)`), a 1 px pane rule with the sticky index pane at the inline end, and a one-row status line fixed to the block end. The session caps at 170 cells, with ruled edges past that. Below 1280 px there is the transcript and the status line only.
- **The transcript.** Each section is a frame of three lines:
  1. a shell comment carrying the owner's title, which is the `h2`, with the `#` hidden from assistive tech;
  2. the prompt and the command that prints it (`aria-hidden`);
  3. its output.
- **Order (SH-M2).** First the hero and an untitled lede at `~`. Then the five directories in the index's order (Work, Writing, Record, About, Contact), with the owner's order kept inside each directory. Sections no destination takes come last before Contact, at `~`.
- **Rhythm.** Measured in rows: one blank row between sections in one directory, two at a directory change, three before the end of the session, and none below a heading.
- **The grid.** Every length is a cell (1ch of the code role) or a row (one line of the code role at the body size). Prose output caps at about 66 cells (SH-S4). Listings and tables span the full transcript width.
- **First view (SH-M1).** The `whoami` output leads with the thesis, which is the `h1`. The owner's name is its visible prefix, at the one double-height step. Key and value facts follow (tagline, pronouns, location, mail, proof, links), then the owner's actions as whiptail buttons, and a tab-completion line of the five directories. There is no greeting comment.

## Navigation and reveal

- **Chrome:** the name and the five destinations, in the status line. The window list is `~/work` to `~/contact` from `navigationModel` (K-1, no overrides), with the current one marked and the `n/N` section counter beside it.
- **The index (SH-M3):** at 1280 px and up, a docked `ls -R` pane, collapsed to the five directories with the current one expanded. Below 1280 px, the palette, a dialog opened by the status line's jump button, by `mod+k`, and by `/`. With JS, below 1280 px, no in-flow copy of the index prints: the palette is the index there. Without JS, the pane is an in-flow `nav` of real links, and the jump button is a link to it. The palette leads with the five destinations, so with nothing typed contact is the second tap; on a touch screen it opens with the field waiting for a tap, so no keyboard covers the list. Under forced colours the current row takes no fill: its `▌` and the selection colour mark it, and focus keeps the platform ring.
- **Folds (gate item 8):** on home, the minor Record and About parts print folded, as closed native disclosures. Each summary is the section's comment, its command line with `[+]`, and the first line of what it prints (how many, and the first). By kind: the figures, the words from collaborators, the roles, the thesis, the lede, Now, the focus and the quote stay open; every other record, history, GitHub, the other practice parts and the fun facts fold. A fragment, an index row or a palette jump into a fold opens it, script or none (the section with its id is inside the disclosure); print opens every fold.
- **Row folds:** a listing row prints its record line (the role, artist, series, label, guests and tools, or a record's place, categories and highlights), and its longer text sits under it in a closed native disclosure whose summary names what it holds, `[+] excerpt`, `[+] show notes`, `[+] tracks (5)`: the excerpt, description and notes as `cat` bodies, a release's tracks as a numbered `ls` with lengths, a record's statement and abstract. A figure's note and source ride its line as a `#` comment; a publication's citation is the `.bib`'s `%` comment, its awards and abstract its `note` and `abstract`. The text is in the markup, so find-in-page opens a fold; print opens every one. The hero's greeting alone is ruled out (SH-M1).
- **whoami's lines:** the hero's tagline, subtitle and subtagline print as `#` comment lines directly under the thesis, no blank row between them, the tagline in the text's ink: one command's output, not a stack of hero paragraphs. On a narrow transcript a listing row's cover is a preview at the row's indent (60% of the column, at most 8 rows), as icat places one. With large text (the column counted in cells of the text's size) a key prints over its value and the thesis drops its double size, and the bar gives up the current directory before jump.
- **Everything is visible at once.** Nothing waits for scroll, and jumps are instant.

## Motion plan

- **One orchestrated moment:** a jump paints the landed command line with a selection bar (a `scaleX` sweep over the language's durations) and leaves a persistent `▸` marker.
- **The palette** pops from 0.98 to 1 over `--ui-motion-standard`.
- **Row hover and focus** raise a selection bar.
- **The caret** blinks 4 times when the end of the transcript comes into view, then holds. It counts 0 animations (R3).
- **Gating:** every animation and transition sits inside `prefers-reduced-motion: no-preference` and an unreduced `[data-motion]`.
- **Reduced motion is a designed still:** the landed line keeps a still bar, the caret is a steady block, and the dialog appears in place. 0 rAF.
- **The enhancement:** `palette`, `requires: []`, mounted through the kit's runtime.

## Section coverage map

Since P2, every core kind renders bespoke inside the shell frame, `custom` included (`cat <id>`), and so does the case page, so coverage is whole.

### The case page (P2): man(1)

A work's own page, `/work/<slug>` (`routes.work: bespoke`), is its case study as a manual page in the same session, under the same status line, in `~/work`:

- the prompt runs `man <slug>`, and the manual's running head and foot (`SLUG(1)  Name — Portfolio  SLUG(1)`) frame it; both are shell idiom, `aria-hidden`. The head and the foot are one line each at any width: what doesn't fit is left off, as man(1) on a narrow terminal does, never stacked;
- **NAME:** the title, the page's one h1, at the 2× step, and the summary;
- **SYNOPSIS:** only the facts the work has, as ruled key and value lines (role, for, since or published or released, medium, tools, tags, links, recognition), with the cover beside it on a wide transcript;
- **DESCRIPTION:** the description, the highlights in brackets, and the other pictures;
- every case part the outline names, at the outline's anchor: decisions in bold with the reason indented and the alternatives after;
- **HISTORY:** the awards it cites, as a changelog; **SEE ALSO:** the other records it cites, then works that share a tag or a tool (`slug(N)`); **AUTHORS**. A cited record keeps every field it has (its links, slides, video, PDF and DOI, its source's role and organization), and one with no title is named by its source, author or publication, never left blank. `cat <id>` links a record home lists to its place there and prints any other whole, as SEE ALSO does;
- the way on: `man` the next work, `cd ~` to all work.

Each section is a block the index (docked at 1280 px and up) and the palette land on; the spy marks it, and the counter counts them. The man section is 1 for software, systems and interfaces, 7 otherwise.

| Kind         | Treatment | Notes                                                                                |
| ------------ | --------- | ------------------------------------------------------------------------------------ |
| `works`      | bespoke   | `ls -l`, `ls -lt` (all writing) or `open` (all image series)                         |
| `evidence`   | bespoke   | `cat .txt` (metrics), `.bib`, `mail -f`, `cat <id>/*`, or `ls -l`, by majority type  |
| `chronology` | bespoke   | `git log --graph`, with thread lanes and forks                                       |
| `practice`   | bespoke   | `cat README.md`, `ls`, `tree` or `man`, by part                                      |
| `contact`    | bespoke   | `mail <email>`, with the address at double height                                    |
| `custom`     | bespoke   | `cat <id>`: the body, then each item under head(1)'s banner, every picture captioned |
| `hero`       | bespoke   | `whoami`                                                                             |
| `lede`       | bespoke   | `cat <id>.md`                                                                        |
| `now`        | bespoke   | `finger`                                                                             |
| `quote`      | bespoke   | `cat /etc/motd`                                                                      |
| `focus`      | bespoke   | `jobs`                                                                               |
| `fun-facts`  | bespoke   | `cat <id>.txt`                                                                       |
| `cta`        | bespoke   | `./<id>`, with whiptail buttons                                                      |
| `github`     | bespoke   | `gh repo list`, from the publish snapshot                                            |

## Controls and content slots

| Control    | Type                          | Default            |
| ---------- | ----------------------------- | ------------------ |
| `prompt`   | `full`, `directory` or `bare` | `full`             |
| `pane`     | `docked` or `dialog`          | `docked`           |
| `commands` | `shown` or `titles`           | `shown`            |
| `pinned`   | contentRef to a work          | the signature work |

- Each control renders its default when a value is stale or invalid.
- `heroTyping` and `slashShortcut` are left out at P1. The host owns the `/` toggle (K-4 (d)).
- No content slots. Every derivation is in `src/model.ts`, and nothing names a person (N4).

## Kit usage map

**Will use:** `pageOutline`, `navigationModel`, `renderSection` with the shell `Frame`, `footerOutline`, `VisitorControlSlot`, the view helpers (`worksOf`, `evidenceOf`, `chronologyOf`, `placedImage`, `isSignature`, `isArchived`, `recordAnchor`, `githubSnapshot`), `RichText`, `routedWork`, and `useDocumentAction` from `@portfolio/kit/runtime`.

**Expect to hoist:** `stableDigest` and `chronologyLanes` (K-6), which are local copies in `src/model.ts` with the brief's signatures.

## Performance tier

- **Light.** The page is server-rendered, with 0 B of the variant's own JS.
- **The palette** is the one island: its chunk loads after hydration and stays at 6,144 B or less.
- **No infinite animations, and 0 rAF at rest.** The scroll spy is an IntersectionObserver, and the scroll meter is CSS (`animation-timeline`, under `@supports`).
- **Mobile:** the same transcript at 38 cells or more, the prompt shortened to `~/dir $`, and the chrome reduced to the name and jump.

## Accessibility

- **Structure:** one `h1` (the thesis, with the name as its visible prefix). Each section's `h2` is the owner's title, with the `#` hidden. An untitled section gets a visually hidden `h2` with its kind's label.
- **Hidden from assistive tech:** every prompt and command line, the hashes (SH-S3), the box rules and the git graph glyphs.
- **Order:** DOM order, visual order and tab order agree.
- **The palette** follows the APG combobox and listbox pattern, with `aria-activedescendant` and a polite count. Its groups are `role=group` with `aria-labelledby` (SH-S1), and each option has an `aria-label` with its plain title (SH-S2).
- **Focus:** the platform ring, unclipped. Sticky and fixed chrome is cleared with `scroll-margin` and `scroll-padding`. No ring sits on a ground under 3:1.
- **Reduced motion:** a designed still.

## Appearance boundary

- **Text roles:**
  - machine lines (prompts, commands, listings, key and value blocks, the status line and the pane): `code`, the family at the body role's size (K-5);
  - prose output: `body`, capped at about 66 cells;
  - the double-height lines (the name, the contact address, the case title): twice the body size, `calc()` of the role size (K-5).
- **Surfaces and colors:**
  - the transcript is the canvas, and the pane is `surface-subtle`;
  - the status line is `accent` with `on-accent`, the one loud fill;
  - comments read `text-secondary`, prompts `data-categorical-2` toward `text-primary`, directories `information` mixed toward `text-primary`, figures and hashes `emphasis` mixed toward `text-primary` (at or above 4.5:1 in every scheme), and links `accent-text`.
- **Primitives:** the platform focus ring, the native `dialog`, and the visitor control in the footer.
- **Layout properties:** `--layout-*` only at the root (`[data-variant='shell']`): the cell, the row, the pane width and the session cap.
- **Selections to judge it under:**
  - the recipe (`primer-inspired`, `night-terminal`, `shell-mono`, dark);
  - the default recipe (`warm-parchment`, `humanist-ui`, `platform-neutral`, light);
  - `editorial-serif` in high contrast;
  - every display mode.
- **Moved to packs:** the report's Primer-like palette became `night-terminal` (first-party values), and JetBrains Mono became `shell-mono`. The composition never names a family or a color.
