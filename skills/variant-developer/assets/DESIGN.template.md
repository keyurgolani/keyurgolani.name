# DESIGN.md: variant-<id>

> Fill this out BEFORE writing any code, and get the user's approval before
> implementation. See `skills/variant-developer/references/design-contract.md`.

> **Porting from a reference?** (a `legacy/` package, another platform's
> design, a Figma mockup) Also fill out `## Component inventory`,
> `## Signature interactions`, `## Data-shape diff`, and `## Fidelity targets`
> at the bottom. They drive Wave 2's scope and Phase 3's sign-off. See
> `skills/variant-developer/references/fidelity-comparison.md`.

## Composition idea

> One sentence, which becomes the manifest's `promise`. Examples: "a printed
> monograph spread, read front to back", "a terminal session log", "a bento
> grid where each card is one piece of evidence".

## Manifest summary

| Field | Value |
|-------|-------|
| `id` / `name` | ... |
| `compositionFamily` | `monograph \| kinetic \| gallery \| bento \| sequence \| document \| custom` |
| `motionIntent` | `still \| subtle \| kinetic \| adaptive \| directed` |
| `performanceTier` | `light \| medium \| heavy` |
| `textDirection` | `["ltr"]` or `["ltr", "rtl"]` |
| `visitorControl.placement` | `header \| navigation \| footer` |
| `routes` | home and work: `shared \| bespoke`; views: ... |

## Arrangement

> Section order, emphasis, grouping. Density: spacing rhythm, measure, grid.
> In logical terms (start and end, block and inline).

## Navigation and reveal

> How a visitor finds and moves between sections. What shows at once, and
> what waits.

## Motion plan

> What moves and what it conveys. What it does under reduced motion (it
> settles, and links jump). Enhancements and their `requires`.

## Section coverage map

> Every kind in `ALL_SECTION_KINDS`: bespoke (in `renderedKinds`), shared
> (the kit's renderer), or unsupported (in `unsupportedKinds`, with a reason).

| Kind | Treatment | Notes |
|------|-----------|-------|
| `hero` | bespoke / shared | ... |
| `lede` | bespoke / shared | ... |
| `now` | bespoke / shared | ... |
| `experience` | bespoke / shared | ... |
| `education` | bespoke / shared | ... |
| `projects` | bespoke / shared | ... |
| `writings` | bespoke / shared | ... |
| `publications` | bespoke / shared | ... |
| `talks` | bespoke / shared | ... |
| `awards` | bespoke / shared | ... |
| `episodes` | bespoke / shared | ... |
| `patents` | bespoke / shared | ... |
| `gallery` | bespoke / shared | ... |
| `discography` | bespoke / shared | ... |
| `testimonials` | bespoke / shared | ... |
| `press` | bespoke / shared | ... |
| `quote` | bespoke / shared | ... |
| `skills` | bespoke / shared | ... |
| `stack` | bespoke / shared | ... |
| `services` | bespoke / shared | ... |
| `contact` | bespoke / shared | ... |
| `cta` | bespoke / shared | ... |
| `stats` | bespoke / shared | ... |
| `focus` | bespoke / shared | ... |
| `fun-facts` | bespoke / shared | ... |
| `tenure` | bespoke / shared | ... |
| `external-portfolios` | bespoke / shared | ... |
| `github` | bespoke / shared | ... |

## Controls and content slots

> Owner-tunable composition choices (layout, order, emphasis, interaction;
> never appearance), and the content the composition needs, with what happens
> when it's missing.

## Kit usage map

**Will use:** ... (`@portfolio/kit` pieces). **Expect to hoist:** ... (patterns to promote).

## Performance tier

> Why this tier. What's an enhancement. Mobile behavior.

## Accessibility

> Focus order, heading levels, alt text, keyboard reach, reduced motion.

## Appearance boundary

> What the composition assumes of the appearance system (#19). Which of a
> reference's palettes, fonts, or theme modes moved to packs instead, as
> `provenance` records them.

---

# Port-only sections (omit if greenfield)

## Component inventory

> Every visually distinct primitive in the reference. Each row drives a
> Wave 1.5 hoist decision and a Wave 2 task.

| Primitive | What it does | Hoist plan |
|---|---|---|
| `<TypingAnimation>` | Cycles through role text | In `@portfolio/kit` already. Use it. |
| `<AnimatedCounter>` | Ramps a stat from zero | In `@portfolio/kit` already. Use it. |
| `<FloatingElements>` | Profile cards in a parallax orbit | Compose from `useScrollDispersal` and `useFirstInteraction` (kit). The component stays local. |
| `<TactileEventCard>` | A timeline card that tilts with the cursor | `useMouseTilt` from the kit. The JSX stays local. |
| `<Lightbox>` | A gallery overlay with keyboard navigation | Hoist when a second variant needs it; until then, local. |
| `<ProgressBar>` | Per-skill proficiency bar | The schema has no proficiency: dropped. Say so in `## Fidelity targets`. |
| ... | | |

## Signature interactions

> The motion and interaction patterns that define the reference's character.
> Missing one on launch reads as "doesn't feel like the original".

- "Floaters fade and disperse outward as you scroll past the hero."
- "Project cards expand on click, revealing their technologies."
- "Timeline cards tilt with the cursor."
- "Stats ramp from zero when they scroll into view."
- "The typing animation cycles through five roles."
- ...

## Data-shape diff

> For each field the reference's renderers touch, its schema equivalent. For
> each lost field: inferable, composed from several kinds, or not portable.

| Reference field | Schema equivalent | Plan |
|---|---|---|
| `experienceTracks[].entries[].dateRange.from` | `experience.items[].period.start` | Renamed; pass through. |
| `track.branch` | not modeled | Inferable with `inferKindFromText` on role and organization. Document the rules. |
| `entry.skills[].proficiency` | not modeled | Not portable. Drop the progress bar. |
| `experienceTracks` (several tracks) | not modeled | Composed: `experience`, `education`, `awards`, and `publications` in one stream. |
| ... | | |

## Fidelity targets

> The Phase 3 sign-off contract. Every box checked, or dropped with a reason,
> before the variant ships. Palettes, fonts, and theme modes aren't targets:
> they're #19's.

The variant ports `<reference>`. Signature elements that must be present:

- [ ] Profile cards in a parallax orbit, draggable.
- [ ] Multi-text typing animation cycling roles.
- [ ] Animated counters in stats tiles.
- [ ] A fork-and-merge timeline with a branch per kind.
- [ ] Project cards that expand on click and show technologies as chips.
- ...

Signature elements **intentionally dropped** (with reason):

- Skill proficiency bars: the schema has no per-skill `proficiency`.
- ...
