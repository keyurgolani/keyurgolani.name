# Horizontal Cinema

`@portfolio/variant-horizontal-cinema` (#17) tells a small body of work in five finite chapters, Prologue, Origins, Journey, Craft, and Epilogue, each a frame of the portfolio's own media beside its evidence, with a direct link each: `/#chapter-journey`.

It owns composition alone. Dark framing comes from the selected color scheme and grain only from a design language whose `texture` is grain, through #19's tokens and its Surface on each frame's matte. It never forces a mode, so a light scheme or high contrast gives the same chapters in those colors.

## The page

1. The chrome: the name, which goes home, `Index`, the exit, and the visitor control.
2. The filmstrip: the five chapters by number and label, #19's Navigation, then the progress (`03 / 05`) and Previous and Next chapter, which show once the controller runs.
3. The stage: the five chapters, always five, in order. Each is a section with its number and label, what it holds, and plain previous and next links. Prologue holds the page's one h1; Epilogue's next is the index.
4. The index: every chapter and every titled section by its link, then what no chapter holds, in the reading order.

What each chapter holds, from the published view alone:

| Chapter  | Holds                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prologue | the leading hero, or the identity's name and tagline, then the lede, quotes, and the practice's thesis, and the signature work as its frame      |
| Origins  | the chronology and the fun facts                                                                                                                 |
| Journey  | the featured works as frames, in the owner's order; with nothing curated, the works the works sections show, the archive's left out, six at most |
| Craft    | the evidence, the rest of the practice, GitHub, and custom sections                                                                              |
| Epilogue | now, focus, the calls to action, and contact                                                                                                     |

A works section's other works and an extension's sections read in the index. A works section the frames show whole keeps its id, on Journey. A section or record whose id is one of the six anchors (`chapter-prologue` to `chapter-epilogue`, and `chapter-index`) renders in place with no anchor of its own, so the chapter keeps its URL.

A frame is the work's cover, else its first meaningful image, on a matte beside the title, the summary, the evidence the work cites, and its links. A case study gets no link yet: the host answers `/work/<slug>` with its 404 until #10's case-study pages land, and `routes.work` is `shared`, so that page is the host's then. Decoration is never a frame's media. Nothing is cropped, and the caption, credit, and rights are the owner's, as #10 holds them, below the image. An image that isn't there yet keeps its box and says so, and the words, the evidence, and the links stay. Audio and video are links: nothing plays in the page, and there are no frames from other sites.

## Layout

One DOM, which the stylesheet lays out. On a window at least 64rem wide and 36rem tall, with a fine pointer, hover, and no `prefers-reduced-motion`, the stage is one native horizontal scroller of five full-width chapters. It doesn't snap in CSS, which would pull Tab and find back off what they reach: the controller aligns the chapter instead. Anywhere else, phones, tablets, short windows, reduced motion, and print, the same chapters stack in the page's ordinary vertical flow, with the same URLs, order, and controls. The query tests reduced motion itself, since #19 keeps `data-motion` full under the OS's reduce.

## The controller

`src/controller.tsx`, on #6's runtime, keeps one chapter state of five positions (`src/chapters.ts`), which every input lands in:

- a filmstrip, pager, or index link: the browser's own fragment navigation, one history entry, and focus on the chapter's title;
- a direct link, refresh, back, and forward: the chapter the fragment names;
- ArrowLeft and ArrowRight with focus in the experience, and Previous and Next chapter: one step, the URL replaced, and the chapter announced in one polite live region, or focus moved to the new chapter's title when it was in the old one;
- the wheel, a trackpad, a swipe, and the scrollbar: the page's or the stage's own scrolling, which it never cancels, then the nearest chapter, aligned, the URL replaced;
- Tab, find, and anything else scrolled into view: the chapter it revealed, aligned at once, so what it reached stays in view, the URL replaced.

A step past either end is no step, and its key does what it always does. The URL changes once a change settles, by `replaceState`, never per frame. A resize, a rotation, or a switch of layout keeps the chapter. Only scrolling it starts is ever smooth, and only while its runtime is active and `prefers-reduced-motion` doesn't say otherwise. In any frame it writes no history and no hash, and a chapter link scrolls the frame in place. In a plate it never starts.

## Lineage

Provisional, from the approved review lab's record of the legacy pages:

| Source                         | Taken                                                     | Left behind                   |
| ------------------------------ | --------------------------------------------------------- | ----------------------------- |
| Page 8, "Horizontal Chronicle" | the finite chapter sequence and its visible progress      | layered panel parallax        |
| Page 10, "Spotlight Gallery"   | the filmstrip as the chapter navigator, full-width frames | the mouse-following spotlight |
| Page 19, "Film Grain"          | framed scenes, and grain only from the design language    | recording and frame notation  |

The package draws no grain, glow, canvas, or shader of its own, and no recording mark, timecode, or play glyph.

## Checks

`pnpm --filter @portfolio/variant-horizontal-cinema test` checks the manifest's pins, the five-position state, every contract fixture's five chapters, ids, and fragment links, what each chapter holds, the pagers and the index, the anchor collisions, the frames' media, decoration, and failure, the mount, the plate (no runtime hook, landmark, or control), the layout query, and the controller's source (passive scroll listeners, no wheel or touch handler, `replaceState` only, never in a frame). `tests/e2e/horizontal-cinema.spec.ts` drives every input in Chromium against the five-chapter model, with history, focus, the live region, the exit, a frame, resizing, rotation, reduced motion, and no JavaScript. `pnpm check:variants` and `pnpm check:appearance` audit it. CI's variant specs run it on every contract fixture in their six modes, in the platform's default light appearance, and CI's PR quality cells run its published default appearance and, when its package changes, every stable design language. Its dark-scheme cells run in the nightly `pnpm quality:full`. Firefox, WebKit, a real trackpad, and a screen reader aren't in CI: the owner's manual pass covers them.
