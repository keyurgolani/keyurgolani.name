# DESIGN.md — variant-<slug>

> Fill this out BEFORE writing any code. Get user approval before proceeding to
> implementation. See `skills/variant-developer/references/design-contract.md`.

> **Porting from a reference?** (archive variant, another platform's design,
> Figma mockup) — also fill out the `## Component inventory`, `## Signature
> interactions`, `## Data-shape diff`, and `## Fidelity targets` sections at the
> bottom. These drive Wave 2's scope and Phase 3's sign-off. See
> `skills/variant-developer/references/fidelity-comparison.md`.

## Metaphor

> One sentence. Examples: "printed editorial magazine spread", "CRT terminal
> interface", "museum gallery wall", "obsidian luxury — depth-parallax dark".

## Manifest summary

| Field | Value |
|-------|-------|
| `slug` / `name` | … |
| `aesthetic` | `editorial \| spatial \| kinetic \| popart \| terminal \| bento \| narrative \| custom` |
| `motion` | `still \| subtle \| animated \| kinetic` |
| `density` | `minimal \| balanced \| dense` |
| `typography` | `serif \| sans \| mono \| mixed` |
| `themes` | `['light', 'dark']` (both required) |
| `performanceTier` | `light \| medium \| heavy` |

## Color schemes

> ≥1 required. Multiple encouraged when metaphor supports it. If only one,
> justify below — the audit will warn.

| id | Name | Paper | Ink | Accent | Reasoning |
|----|------|-------|-----|--------|-----------|
| … |

## Typography presets

> Same shape: ≥1 required, multiple encouraged, justify if only one.

| id | Name | Display | Body | UI | Mono | Reasoning |
|----|------|---------|------|----|------|-----------|
| … |

## Motion plan

> Where motion happens. What it conveys. Reduced-motion fallback.

## Density plan

> Section spacing rhythm. Page padding. Gutter widths. Tier signals.

## Section coverage map

> Every kind from `ALL_SECTION_KINDS`. Bespoke renderer or
> `FallbackSection`? Justify fallback briefly.

| Kind | Treatment | Notes |
|------|-----------|-------|
| `hero` | bespoke | … |
| `lede` | bespoke | … |
| `now` | bespoke | … |
| `experience` | bespoke | … |
| `education` | bespoke / fallback | … |
| `projects` | bespoke | … |
| `writings` | bespoke / fallback | … |
| `publications` | bespoke / fallback | … |
| `talks` | bespoke / fallback | … |
| `awards` | bespoke / fallback | … |
| `episodes` | bespoke / fallback | … |
| `patents` | bespoke / fallback | … |
| `gallery` | bespoke / fallback | … |
| `discography` | bespoke / fallback | … |
| `testimonials` | bespoke / fallback | … |
| `press` | bespoke / fallback | … |
| `quote` | bespoke / fallback | … |
| `skills` | bespoke / fallback | … |
| `stack` | bespoke / fallback | … |
| `services` | bespoke / fallback | … |
| `contact` | bespoke | … |
| `cta` | bespoke / fallback | … |
| `stats` | bespoke / fallback | … |
| `focus` | bespoke / fallback | … |
| `fun-facts` | bespoke / fallback | … |
| `tenure` | bespoke / fallback | … |
| `external-portfolios` | bespoke / fallback | … |
| `github` | bespoke / fallback | … |

## Kit usage map

**Will use:** … (`@portfolio/kit` utilities). **Expect to hoist:** … (patterns to promote).

## Performance tier

> Why this tier. What lazy-loads. Mobile fallbacks.

## Accessibility

> Focus order, contrast targets, reduced-motion support, alt text policy.

## Print

> If `capabilities.print = true`, describe layout. Otherwise: "Not supported.
> `capabilities.print = false`."

---

# Port-only sections (omit if greenfield)

## Component inventory

> Every visually distinct primitive in the reference. Each row drives a
> Wave 1.5 hoist decision and a Wave 2 implementation task.

| Primitive | What it does | Hoist plan |
|---|---|---|
| `<TypingAnimation>` | Cycles through role text | Hoist to `@portfolio/kit` (already there). Use directly. |
| `<AnimatedCounter>` | Stats counter ramp | Hoist to `@portfolio/kit` (already there). Use directly. |
| `<FloatingElements>` | Brand-colored profile cards in parallax orbit | Compose from `useScrollDispersal` + `useFirstInteraction` + `getSocialBrandStyle` (kit). Component itself stays variant-local. |
| `<TactileEventCard>` | 3D-tilt timeline card with hover glow | Use `useMouseTilt` from kit + `useMotionTemplate` for radial-gradient. JSX stays local. |
| `<Lightbox>` | Gallery image overlay with keyboard nav | Hoist to `@portfolio/kit/overlays` (or stay local if no second consumer). |
| `<Card variant="glass">` | Glassmorphic card | Local CSS class vocabulary (`.kc-card`, `.kc-card--hoverable`). |
| `<ProgressBar>` | Per-skill proficiency bar | Schema doesn't carry proficiency — drop. Document in `## Fidelity targets`. |
| … | | |

## Signature interactions

> Motion/interaction patterns that define the reference's character. Each
> drives Wave 2 work; missing any of these on launch will read as "doesn't
> feel like the original".

- "Floaters fade and disperse outward as you scroll past the hero."
- "Project cards expand on click, revealing per-tech proficiency rows."
- "Timeline cards tilt with the cursor; a radial-gradient glow tracks it."
- "Stats numbers ramp from zero on scroll-into-view, easing-out."
- "Typing animation cycles through 5 roles with 2s pause and 5s pause on the last."
- "Hover on a brand card triggers a shimmer sweep."
- "Active section in the nav has a glowing pill background."
- …

## Data-shape diff

> For each field the reference's renderers touch, map it to the current
> schema. For Lost fields, decide: inferable (heuristic), multi-section
> composition, or not portable.

| Reference field | Schema equivalent | Plan |
|---|---|---|
| `experienceTracks[].entries[].dateRange.from` | `experience.items[].period.start` | Renamed; pass through. |
| `track.branch` | not modeled | Inferable via `inferKindFromText` on role + organization. Document rule set. |
| `entry.skills[].proficiency` | not modeled | Not portable. Drop the per-skill progress bar visual. |
| `experienceTracks` (multiple tracks) | not modeled | Multi-section composition: pull from `experience` + `education` + `awards` + `publications` into one stream. |
| … | | |

## Fidelity targets

> The Phase 3 sign-off contract. Every box must be checked OR have an inline
> justification for being intentionally dropped before the variant ships.

The variant ports `<reference>`. Signature elements that must be present:

- [ ] Falling code-glyph canvas backdrop with theme-aware colors.
- [ ] N brand-colored social profile cards in parallax orbit, draggable.
- [ ] Multi-text typing animation cycling roles.
- [ ] Animated counters in stats tiles.
- [ ] SVG fork/merge timeline with per-kind colored branches.
- [ ] 3D mouse-tilt on expanded timeline cards with radial-gradient glow.
- [ ] Project cards expand on click; show technologies as chips.
- [ ] Project badges auto-derived from text (Hackathon / Published / Open Source).
- [ ] Glassmorphic card vocabulary (backdrop-blur, border, hover lift).
- [ ] Brand-colored buttons in contact section (ordered by preferred channel).
- …

Signature elements **intentionally dropped** (with reason):

- Skill proficiency bars — schema doesn't carry per-skill `proficiency`.
- Project category filter buttons — schema doesn't model `category`; deriving from technologies adds UX dependencies the metaphor doesn't need.
- …
