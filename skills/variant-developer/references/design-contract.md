# Design contract — why phase 1 exists

> The reason variant-developer is design-contract-first: coherence comes
> from committing to a metaphor before painting pixels. Loaded by the
> agent at the start of Phase 1 (DESIGN.md) and again whenever the
> design feels like it's drifting.

## What goes in DESIGN.md

The 11 required sections, in order:

1. **Metaphor** — one sentence. The driving idea. Everything else flows from this.
2. **Manifest summary** — slug, name, aesthetic, motion, density, typography, themes, performanceTier. Sanity check: do these values reinforce each other or contradict?
3. **Color schemes** — ≥1 required, multiple encouraged. Document the count's reasoning.
4. **Typography presets** — same.
5. **Motion plan** — what motion happens, what it conveys, reduced-motion fallback.
6. **Density plan** — section spacing rhythm, page padding, gutter widths.
7. **Section coverage map** — every kind from `ALL_SECTION_KINDS` minus removed kinds. Bespoke or fallback per kind.
8. **Kit usage map** — which @portfolio/kit utilities you'll lean on; which patterns you expect to hoist into kit during implementation.
9. **Performance tier** — why this tier, what lazy-loads, mobile fallbacks.
10. **Accessibility** — focus order, contrast targets, reduced-motion support, alt text policy.
11. **Print** — describe the print layout if `capabilities.print = true`; otherwise state "Not supported."

Each section is a small commitment. Together they form a contract: this is what the variant promises to be. Implementation in Phase 2 honors the contract.

## Why this isn't optional

Without the contract, the agent cycles between metaphor candidates while writing CSS, producing a mish-mash that has fragments of three different aesthetics fighting each other. The contract forces a *commitment* — once metaphor is chosen, every subsequent decision (token palette, type pairing, motion intensity, renderer composition) is judged against the metaphor.

When you find yourself in implementation thinking "should this be vintage or futuristic?" — re-read DESIGN.md. The answer is in the metaphor.

## Editorial as a worked example

Reverse-engineering `packages/variant-editorial/src/manifest.ts` and `styles.css` into the DESIGN.md it implies:

### Metaphor

> "A printed monograph spread — cream paper, deep ink, sienna accent.
> Typography-led; chrome serves type."

### Manifest summary

| Field | Value |
|-------|-------|
| slug | `editorial` |
| aesthetic | `editorial` |
| motion | `still` |
| density | `balanced` |
| typography | `mixed` (Fraunces + Source Serif 4 + Inter + JetBrains Mono) |
| themes | `['light', 'dark']` |
| performanceTier | `light` |

### Color schemes

| id | Name | Paper | Ink | Accent | Reasoning |
|----|------|-------|-----|--------|-----------|
| `warm` | Warm Sienna | #fbfaf6 | #1a1a1a | #b54a32 | The default — magazine-paper warmth. |
| `noir` | Noir | #ffffff | #0a0a0a | #0044ff | High-contrast monochrome with electric accent. |
| `ink-and-paper` | Ink & Paper | #f5f4ee | #2a2a26 | #1f4e5f | Cool, considered, gray-leaning. |

**Reasoning for count:** three distinct moods that all share the editorial spine — magazine warmth, monochrome rigor, considered cool — give the user real choice without breaking coherence.

### Typography presets

| id | Display | Body | UI | Mono | Reasoning |
|----|---------|------|----|------|-----------|
| `classic` | Fraunces | Source Serif 4 | Inter | JetBrains Mono | Magazine pairing — high-contrast serif display over readable serif body. |
| `modernist` | Inter Display | Source Serif 4 | Inter | JetBrains Mono | Bauhaus-leaning — geometric sans display still framed by editorial body. |

**Reasoning for count:** two presets cover the warm/cool axis without over-fragmenting. Both share the body face so paragraphs stay anchored.

### Motion plan

`motion: 'still'`. CSS transitions on hover/focus only. No scroll animations, no parallax, no entrance effects. Reduced-motion fallback is the default state — there is nothing to disable.

### Density plan

`density: 'balanced'`. Page padding `clamp(1.5rem, 4vw, 3rem)`. Section spacing `clamp(3rem, 8vw, 6rem)` between major sections. Gutter widths follow a 12-col grid with generous outer margins; type measure capped at 65ch for body copy.

### Section coverage map

Bespoke renderers for `hero`, `about`, `experience`, `projects`, `skills`. `FallbackSection` routes everything else (`education`, `certifications`, `awards`, `publications`, `talks`, `contact`, `social`, `footer`).

### Kit usage map

Leans on `@portfolio/kit`'s `Container`, `SectionFrame`, `Prose`, `MetaList`. Plans to hoist `EditorialDropCap` if a second variant ever needs it.

### Performance tier

`light` — no canvas, no heavy libraries, no images beyond hero. Mobile is a single-column collapse with no layout shift. Total JS budget under 30KB gzipped after tree-shake.

### Accessibility

Focus order matches reading order (top-down, left-to-right). Body text 4.5:1 against paper; headings 3:1. `prefers-reduced-motion` is the default state. All imagery has alt text; decorative rules use `aria-hidden`.

### Print

`capabilities.print = true`. Print stylesheet hides nav, expands links to `(href)`, switches to white paper / black ink, removes accents.

## When to consult this reference

- Start of Phase 1, before opening DESIGN.template.md.
- Any time you feel the metaphor slipping.
- When deciding "should I add this as a third color scheme?" — DESIGN.md's reasoning section is the place to commit.
