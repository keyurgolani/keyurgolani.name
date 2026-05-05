# DESIGN.md — variant-<slug>

> Fill this out BEFORE writing any code. Get user approval before proceeding to
> implementation. See `docs/skills/variant-developer/references/design-contract.md`.

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
