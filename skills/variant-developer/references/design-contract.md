# Design contract: why Phase 1 exists

> variant-developer is contract-first because coherence comes from
> committing to one composition idea before writing layout. Loaded at the
> start of Phase 1 (DESIGN.md), and again whenever the design drifts.

## What goes in DESIGN.md

The 11 required sections, in order:

1. **Composition idea**: one sentence, which becomes the manifest's `promise`. Everything else follows from it.
2. **Manifest summary**: id, name, `compositionFamily`, `motionIntent`, `performanceTier`, `textDirection`, `visitorControl.placement`, and `routes`. Do these values reinforce each other, or contradict?
3. **Arrangement**: section order, emphasis, grouping, and density: the spacing rhythm, the measure, the grid.
4. **Navigation and reveal**: how a visitor finds and moves between sections, and what shows at once or waits.
5. **Motion plan**: what moves and what it conveys, what settles under reduced motion, and any enhancements with their `requires`.
6. **Section coverage map**: every kind in `ALL_SECTION_KINDS`, each bespoke, shared, or unsupported. Every unsupported kind gets a reason.
7. **Controls and content slots**: the owner's composition choices, and the content the composition needs, with what happens when it's missing.
8. **Kit usage map**: the `@portfolio/kit` pieces you'll lean on, and the patterns you expect to hoist.
9. **Performance tier**: why this tier, what's an enhancement, and the mobile behavior.
10. **Accessibility**: focus order, heading levels, alt text, keyboard reach, reduced motion.
11. **Appearance boundary**: what the composition assumes of the appearance system (#19), and which of a reference's looks moved to packs instead.

Each section is a small commitment. Together they're the contract: what the variant promises to be. Phase 2 honors it.

## Why it isn't optional

Without the contract, an agent cycles between candidate ideas while writing CSS, and the result has fragments of three compositions fighting each other. The contract forces a commitment: once the idea is chosen, every later decision (the grid, the navigation, the reveal, a renderer's structure) is judged against it.

When you catch yourself asking "should this be a grid or a column?" mid-implementation, reread DESIGN.md. The answer is in the idea.

It also keeps appearance out. "Cream paper and a sienna accent" isn't a composition decision: it's a color scheme, the owner's to pick, and #19's to ship. Section 11 is where a port records that.

## The fallback composition as a worked example

`packages/fallback-composition`, reverse-engineered into the DESIGN.md it implies:

### Composition idea

> "Every section in content order, in one readable column."

### Manifest summary

| Field                      | Value                             |
| -------------------------- | --------------------------------- |
| `id` / `name`              | `fallback` / Fallback composition |
| `compositionFamily`        | `document`                        |
| `motionIntent`             | `still`                           |
| `performanceTier`          | `light`                           |
| `textDirection`            | `["ltr", "rtl"]`                  |
| `visitorControl.placement` | `header`                          |
| `routes`                   | home and work shared, no views    |

### Arrangement

Content order, unchanged. One column, `max-inline-size: 46rem`, centered with `margin-inline: auto`. The first hero carries the page's one `h1`; with no hero, the identity's name does.

### Navigation and reveal

A header with a list of links to every titled section that renders, other than the hero and a call to action, and the visitor control slot beside it. Everything shows at once.

### Motion plan

Still. Nothing moves, so there's nothing to settle under reduced motion. No enhancements.

### Section coverage map

Every kind shared: `renderedKinds` and `unsupportedKinds` are both empty, so every section renders through the kit's shared renderers.

### Controls and content slots

None. The fallback renders whatever the portfolio has, and needs nothing in particular.

### Kit usage map

`renderSection` and `VisitorControlSlot` from `@portfolio/kit/sections`. Nothing to hoist.

### Performance tier

Light: HTML and CSS only.

### Accessibility

Focus order is reading order. The host's skip link lands on the `<main>`, which takes focus (`tabIndex={-1}`). Headings: one `h1`, then `h2` per section. The navigation is a labeled `nav`, its list marked `role="list"` since the styles remove its markers.

### Appearance boundary

No color, type, or theme of its own: it renders in whatever #19's appearance provides. Its provenance records the variant template's colors, fonts, and theme toggle as retired, since they belong to the appearance axes.

## When to consult this reference

- At the start of Phase 1, before opening `assets/DESIGN.template.md`.
- Whenever the idea feels like it's slipping.
- When a choice sounds like appearance: a palette, a font, a theme. It isn't the variant's.
