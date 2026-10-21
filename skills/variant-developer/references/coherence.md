# Coherence: from one idea to layout, navigation, and motion

> How a composition stays coherent. Loaded in Phase 1, when you turn the
> idea into design decisions, and in Phase 2 Wave 1, when you write the
> layout.

## What a variant decides, and what it doesn't

A variant is a composition. It decides:

- **Arrangement**: the order of sections, what stands apart, what groups together, the grid or flow.
- **Navigation**: how a visitor finds a section and moves between them.
- **Reveal**: what shows at once, what waits, what responds to the visitor.
- **Structure inside a section**: how a renderer lays out its items.
- **Motion intent**: how much the composition moves, never the timing.

It doesn't decide color, fonts, type scale, materials, shapes as a look, interaction states, or motion timing. Those are the appearance system's (#19): design languages, color schemes, and typography packs the owner picks independently of the variant. A composition has to read well in any of them.

## The pipeline

1. **Idea**, then 2. **Arrangement**, then 3. **Navigation and reveal**, then 4. **Motion intent**.

Each stage constrains the next. "A printed monograph, read in order" leads to one column with marginal notes, a table of contents, everything shown at once, and stillness. "A gallery wall" leads to works first, captions beside them, a lightbox reveal, and subtle motion.

## Stage 1: The idea

One sentence, specific enough to resist drift. It becomes the manifest's `promise`.

Bad:

- "Modern and clean": describes nothing.
- "Like Stripe.com": copies, and drives no new decision.
- "Dark and gold": that's appearance, not composition.

Good:

- "A printed monograph spread, read front to back."
- "A terminal session log, newest command last."
- "A bento grid where each card is one piece of evidence."
- "A horizontal film strip, one scene per section."

The idea names a real arrangement the agent and the user can both picture.

## Stage 2: Arrangement

Derive the layout from the idea's object. A monograph has a column, a measure, and margins. A terminal log has lines and a prompt. A bento grid has cells of a few sizes. A film strip has frames in a row.

- **Order**: does the idea keep content order, or rearrange it? An owner's order is the default; a rearrangement needs a reason, and often a control.
- **Emphasis**: what the idea puts first. The hero, the work, the writing.
- **Density**: how much fits on a screen. It's the composition itself, not a manifest field.
- **Grouping**: which kinds sit together. `section-kinds.md` clusters them by shape.

Write the arrangement in logical terms (start and end, block and inline), so it mirrors for right-to-left text.

## Stage 3: Navigation and reveal

- **Navigation** follows the idea: a table of contents for a monograph, a prompt history for a terminal, a minimap for a grid, a scrubber for a film strip. Link only sections that render.
- **Reveal** follows it too: a monograph shows everything; a gallery may open a work in a lightbox; a sequence may show one scene at a time. Whatever waits must be reachable by keyboard and must not hide content from a visitor who can't run scripts.

## Stage 4: Motion intent

The manifest's `motionIntent`: `still`, `subtle`, `kinetic`, `adaptive`, or `directed`.

- **Still**: nothing moves beyond the appearance's own state changes.
- **Subtle**: small reveals on scroll or focus.
- **Kinetic**: motion is part of the expression: scroll-driven scenes, parallax.
- **Adaptive**: motion that responds to the visitor's input or device.
- **Directed**: motion that leads the visitor through a sequence.

Pick the lowest the idea allows: more motion costs performance and reduced-motion handling. The timing, easing, and durations come from #19's motion tokens.

### Reduced motion

Every intent settles under reduced motion: the site's `reduce` policy, or `respect-os` with the visitor's setting. Nothing runs once the page settles, and links jump. The CSS is in `styling-conventions.md`; script motion is gated on `useMotionPreference()` (`common-bugs.md` §8); the motion contract checks it.
