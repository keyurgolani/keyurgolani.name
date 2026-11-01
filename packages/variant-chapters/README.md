# @portfolio/variant-chapters

Chapters, a first-party composition: the portfolio as a bound book. Home is the front matter, each era of the chronology is a chapter at `/chapters/<chapter>`, the back matter ends with an index at `/back-matter`, and a work's case study at `/work/<slug>` is a section of its chapter. [DESIGN.md](DESIGN.md) is the design contract.

## The book model

`src/model/book.ts` turns any portfolio into the book, from content alone (no person, employer or year is named in the code):

1. **Eras.** Every chronology entry of kind role or study, read at its own precision (a bare year runs January to December, an open end to the render's `env.now`). Overlapping periods merge; adjacent ones don't.
2. **The cap.** `maxChapters` merges the adjacent pair with the shortest span until the book fits.
3. **Titles.** The era's organizations, each up to its first comma: "A", "A and B", or "A, B and n more"; or the principal role, or the years (`chapterTitles`). Slugs come from the title, unique, never `back-matter`.

   The owner's own chapters (the `chapters` control) replace 1 to 3: their slugs, titles and starts, records placing by date between them. A list the book can't bind is refused whole, and the derived chapters print.

4. **Placement**, first match wins, each record once: a chronology entry's works and a side thread's parent; the owner's moves (`place`, refused whole when malformed); a testimonial's organization; the record's own date (the latest era that started on or before it); present tense (undated metrics off the proof list, and unmatched testimonials, join the current chapter); else the back matter's Uncollected. External work is Also by.
5. **Fixed parts** for the kinds with no time: the hero and the thesis make the title page, the proof the imprint, the signature the frontispiece, the quote the epigraph, the first lede the preface, now, focus and GitHub the current chapter's close, fun facts About the author, services the engagements, skills and tools the index, contact and the call to action the colophon.
6. **Parts** in the authored section order: plates, series, group pages packed two to a spread by an estimate of 30 lines a page.
7. **Pages.** Roman i to iv for the front matter, arabic from chapter 1 at two a spread. Locators always link to anchors.
8. **The index.** Each skill and tool the practice lists or the book names, with a page wherever a spine entry's skills or a work's tools name it, else its practice group.
9. **Inks.** Chapter n takes `--color-data-categorical-((n - 1) mod 5 + 1)`, or the accent with `chapterAccents` off.
10. **Fallbacks.** No spine: calendar years of dated records. Nothing dated: one chapter.

It reads the published view through the kit's record helpers, which already left out what visitors may not see.

## Checks

```sh
pnpm --filter @portfolio/variant-chapters test        # the model and every page on the sample and the contract fixtures
pnpm --filter @portfolio/variant-chapters typecheck
```

Registered (K-9), and ready in `COMPOSITION_STATUS` since its design review flipped it. The web app's suites read it too: its quality unit is `quality/units/chapters.ts`, where `outlineKnown` lists the sections home and `/back-matter` frame on another page of the book.
