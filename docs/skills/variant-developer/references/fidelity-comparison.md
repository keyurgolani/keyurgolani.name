# Fidelity comparison — porting from a reference

> Load this when the user says "make it look like X" or "port the
> archived variant Y" or "match this Figma". Phase 0 / pre-Phase-1 work
> that the original skill missed: doing this *first* is the difference
> between an 80%-accurate one-shot and three rounds of "but the original
> had…".

## Why this step exists

When a variant is ported from a reference, the reference *is* the
spec — not your interpretation of the metaphor. You can still pick a
different framework, library, schema, or component organization, but
the user's mental model of "is the variant done?" is "does it feel like
the reference?". A scaffold that compiles is not a port.

The single biggest cause of post-implementation rework is treating
"the metaphor" as your new design freedom while the user is treating it
as a fidelity requirement. The reference inventory below resolves that
ambiguity *before* you write code.

## Step 1 — Read the reference end-to-end

Before opening DESIGN.md, walk through every file in the reference. For
an archive variant:

- Every `sections/*.tsx` — what data each section needs, what visual
  primitives it composes.
- Every `ui/*.tsx` — the shared component vocabulary (cards, buttons,
  badges, lightbox, progress bar, animated counter, typing animation,
  floating elements, etc.).
- The shared CSS / token file — what colors, gradients, fonts the
  reference depends on.
- Any `lib/` helpers — heuristics that classify, format, or transform.

Note line counts. A reference at 5,000 lines and a target at 1,200
implies you're going to drop ~75% of the visual richness. Decide
whether that's intentional (simplification) or accidental (scope creep
in disguise). If accidental, you're under-spec'd.

## Step 2 — Component inventory

For each visually distinct primitive in the reference, list:

| Primitive | What it does | Hoist-worthy? | Plan |
|---|---|---|---|
| `<TypingAnimation>` | Cycles through role text | yes — generalize | Hoist to kit. |
| `<AnimatedCounter>` | Stats counter ramp | yes | Hoist to kit. |
| `<FloatingElements>` | Brand-colored profile cards in parallax orbit | partially — extract motion hooks + brand registry | Compose from `useScrollDispersal` + `getSocialBrandStyle`; component itself stays variant-local. |
| `<TactileEventCard>` | 3D-tilt timeline card | partially — extract `useMouseTilt` | Use kit hook; visual chrome stays local. |
| `<Lightbox>` | Gallery image overlay | yes | Hoist to kit. |
| `<ProgressBar>` | Skill proficiency bar | data-shape question first | Schema doesn't carry proficiency — drop or invent. |
| `<Card variant="glass">` | Glassmorphic card | partially — class vocabulary only | Local CSS + class names. |

Write this table into DESIGN.md's new `## Component inventory` section
(see `assets/DESIGN.template.md`).

## Step 3 — Signature interactions inventory

The visual primitives are *what's there*. Signature interactions are
*how it feels*. List every motion/interaction that defines the
reference's character:

- "Floaters fade and disperse outward as you scroll past the hero."
- "Project cards expand on click, revealing per-tech proficiency rows."
- "Timeline cards tilt with the cursor; a radial-gradient glow tracks it."
- "Stats numbers ramp from zero on scroll-into-view, easing-out."
- "Typing animation cycles through 5 roles with a 2s pause and 5s pause on the last."
- "Hover on a brand card triggers a shimmer sweep."
- "Active section in the nav has a glowing pill background."

Each of these maps to a piece of work in Wave 2. Some are rendered
trivially (active-pill nav). Some require kit hoists (motion hooks).
Some are entirely variant-local. Tag each one in the inventory.

## Step 4 — Data-shape diff

Take the reference's data model (often coupled to its renderers) and
diff against the current `@portfolio/schema` types. For every field:

- **Same** — reference's `experience.items[].role` and schema's same.
- **Renamed** — reference's `experienceTracks[].entries[].dateRange.from`
  and schema's `experience.items[].period.start`.
- **Lost** — reference had `track.branch: 'work' | 'study' | 'creative'`,
  schema has no equivalent.
- **Added** — schema has new fields the reference didn't model.

For *Lost* fields, decide per field:

- **Inferable** — `track.branch` can be heuristically inferred from
  `role + organization` keywords. Use `inferKindFromText` from
  `@portfolio/kit/timeline`. Document the rule set in the renderer's lib file.
- **Multi-section composition** — reference composed `experienceTracks`
  internally; new schema separates `experience`, `education`, `awards`,
  `publications`. Pull from multiple section kinds in the renderer
  (e.g. the multi-kind Timeline Odyssey).
- **Not portable** — `proficiency: 80%` per skill doesn't exist anywhere
  in the new schema. Don't fake it. Drop the visual element (progress
  bar) or replace with one that uses available data. Document in
  DESIGN.md.

This step is *the* place where porting goes off the rails. A renderer
that crashes on a missing field at the cluster-walkthrough is a Wave 2
stall, not a Wave 1 problem. Catching it in Phase 0 is cheap.

## Step 5 — Identify what's *not* portable

Be explicit about what you're *not* porting. For example:

- Skill proficiency bars (no schema field).
- Project filter buttons by category (no schema category field — could
  derive from technologies but the UX adds dependencies the metaphor may
  not need).
- Per-track color (track concept doesn't exist in new schema).

Drop these intentionally with a documented reason. The audit doesn't
catch missing fidelity — but the user comparing screenshots will. Better
to have the conversation in DESIGN.md than mid-Wave-2.

## Step 6 — Fidelity gate planning

In DESIGN.md, write a `## Fidelity targets` subsection:

```markdown
## Fidelity targets (vs reference)

The variant ports `archive/page0`. Signature elements that must be
present in the final variant:

- [ ] Falling code-glyph canvas backdrop with theme-aware colors.
- [ ] 5 brand-colored social profile cards in parallax orbit, draggable.
- [ ] Multi-text typing animation cycling roles.
- [ ] Animated counters in stats tiles.
- [ ] SVG fork/merge timeline with per-kind colored branches.
- [ ] 3D mouse-tilt on expanded timeline cards with radial-gradient glow.
- [ ] Project cards expand on click; show technologies as chips.
- [ ] Project badges auto-derived from text (Hackathon / Published / Open Source).
- [ ] Glassmorphic card vocabulary (backdrop-blur, border, hover lift).
- [ ] Brand-colored buttons in contact section (ordered by preferred channel).

Signature elements **intentionally dropped**:

- Skill proficiency bars (schema doesn't carry per-skill `proficiency`).
- Project category filter buttons (schema doesn't model `category`).
- Per-skill context tooltip on project expansion (no `context` field).
```

The boxes become the Phase 3 fidelity gate (`references/quality-gates.md`
Gate G). At sign-off, every box is checked or has an inline justification.

## When you skip this step

If you go straight to Phase 1 without Steps 1–6, the typical failure mode is:

1. DESIGN.md is approved on the *metaphor* (one sentence) without
   committing to the *implementation richness*.
2. Wave 2 produces a simpler renderer than the reference had.
3. Phase 3 audit passes (typecheck, audit script, sync-checks).
4. User looks at the result and says "it doesn't feel like the original."
5. You re-do Wave 2 with the missing pieces. Possibly hoist new kit
   primitives mid-implementation, which forces re-running tests and
   updating docs.

The whole sequence (4–5) costs as much time as Steps 1–6 would have.
Front-load the work.

## How to brief the user

When the user says "port variant X" or "make it look like reference Y",
respond with:

> "Before I write DESIGN.md, I'll do a Phase 0 inventory pass:
> read the reference end-to-end, list every component and signature
> interaction, diff its data shape against the schema, and flag what
> can't be ported. I'll come back with a fidelity plan for you to
> approve, then write DESIGN.md against it. About [N] minutes."

Then deliver Steps 1–6 as a single message before opening any code. The
user gets to challenge the inventory before commitments are made; you
get an explicit fidelity contract that drives Wave 2's scope.
