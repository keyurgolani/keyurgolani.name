# DESIGN.md — variant-kinetic-cosmos

> Faithful re-imagining of the platform's original "page-zero" / "Variant Zero"
> as a first-class variant package on the new kit + schema architecture.

## Metaphor

A **kinetic developer cosmos** — gradient nebula background dotted with
falling code-glyph particles, brand-colored social cards floating in
parallax orbit, and an SVG-traced career timeline that forks and merges
through deep-space.

The metaphor is "your IDE made cinematic": the page is a developer's
universe — code is gravity, projects are stars, experience is a constellation
trace. Violet/cyan accents read as plasma; cards read as glassmorphic
panes catching the light.

## Manifest summary

| Field | Value |
|-------|-------|
| `slug` / `name` | `kinetic-cosmos` / `Kinetic Cosmos` |
| `aesthetic` | `kinetic` |
| `motion` | `kinetic` |
| `density` | `balanced` |
| `typography` | `mixed` (display sans + body sans + mono accents) |
| `themes` | `['light', 'dark', 'bright', 'black']` (all four — page0 supported them) |
| `performanceTier` | `medium` (one 2D canvas particle field; no R3F) |

## Color schemes

> Three schemes, all sharing the cosmos metaphor with different "spectrum" tunings.

| id | Name | Paper | Ink | Accent | Reasoning |
|----|------|-------|-----|--------|-----------|
| `nebula` (default) | Nebula Violet | `#0c0a10` (dark) / `#fafafa` (light) | `#e9e9e6` / `#1a1a1a` | `#8b5cf6` violet + `#22d3ee` cyan | The original page-zero palette — violet primary, cyan accent, deep obsidian background. |
| `aurora` | Aurora | `#0a0e1a` / `#f5f8ff` | `#e6ecff` / `#0f172a` | `#34d399` emerald + `#60a5fa` sky | Aurora-borealis interpretation — cooler, greener plasma. |
| `solar` | Solar Flare | `#1a0a0a` / `#fffaf0` | `#fef3c7` / `#1a1410` | `#f97316` orange + `#fbbf24` amber | Warmer cosmos — sunset/coronal mass ejection energy. |

## Typography presets

> Two presets — both share the "developer cosmos" mixed-typography character (sans display, sans body, mono accents for code feel).

| id | Name | Display | Body | UI | Mono | Reasoning |
|----|------|---------|------|----|------|-----------|
| `geometric` (default) | Geometric | `Plus Jakarta Sans` | `Inter` | `Inter` | `JetBrains Mono` | Modern geometric sans for the cosmic scale; mono accents reinforce the developer metaphor. |
| `humanist` | Humanist | `Manrope` | `Source Sans 3` | `Inter` | `JetBrains Mono` | Slightly warmer humanist alternate — same mono backbone, gentler display contour. |

## Motion plan

This variant is **kinetic** — motion is part of the expression, not decoration.

- **Background canvas particle field** — falling JetBrains-Mono code glyphs (`{} [] => fn const`) drift up-to-down across a dark-grid backdrop; density adapts to viewport area. Built on `@portfolio/kit/spatial`'s `ParticleField2D` if it fits, otherwise local canvas (with `// LOCAL:` justification).
- **Hero entrance** — staggered `opacity + translateY` reveal of greeting → name (gradient-animated text) → typing-animation roles cycle → tagline → CTAs.
- **Floating profile/badge cards** — appear after first user interaction (scroll/click/move/key/touch); on scroll, disperse outward from center with spring physics, fading and scaling down. Drag-to-rearrange.
- **Project cards** — scroll-triggered scale (`0.95 → 1`) and slight rotation correction; expand on click with skill-context list reveal.
- **Experience timeline** — SVG fork/merge stream paths animate `pathLength: 0 → 1` on first paint; cards have 3D mouse-tilt + scroll-velocity inertia.
- **Section headers** — fade-in-on-view with viewport `once: true`.

**Reduced-motion fallback:** the canvas mounts but does NOT animate (frame loop suppressed via `useReducedMotion`); all spring/parallax `useTransform` outputs collapse to identity; hover-only effects retained.

## Density plan

`balanced` — a kinetic variant has to *breathe* or motion overwhelms.

- **Page padding:** `clamp(1rem, 5vw, 2.5rem)` horizontal; `5rem` vertical between sections.
- **Section vertical rhythm:** `py-20 sm:py-24 lg:py-32` (~80–128px).
- **Bento grid:** 1-col mobile → 2-col tablet → 4-col desktop (12-col semantic); inter-card gap `1rem` mobile / `1.5rem` desktop.
- **Card padding:** `1.5rem` mobile / `2rem` desktop interior.
- **Hero:** full-viewport min-height; content centered; floating cards positioned at viewport-relative percentages.

## Section coverage map

> Every kind from `ALL_SECTION_KINDS`. The original page-zero rendered hero/about/experience/projects/github/external-portfolios/contact directly, so those get bespoke renderers. The remaining kinds get bespoke renderers built on the same glass-card vocabulary so the variant claims full coverage with consistent feel.

| Kind | Treatment | Notes |
|------|-----------|-------|
| `hero` | bespoke | Typing-animation roles, gradient name, floating profiles + badges, CTA cluster. |
| `lede` | bespoke | Glass card, "Who I Am" header, paragraph body. (Page-zero's bio block.) |
| `now` | bespoke | Glass card with "Currently" header + bullet list. |
| `experience` | bespoke | SVG "Timeline Odyssey" — fork/merge tree with tactile 3D tilt cards. Page-zero's signature renderer; ported faithfully but trimmed for the new schema's `experience` shape (entries with `period`, `highlights`, `skills`). |
| `education` | bespoke | Glass card list — degree, institution, period, achievements. |
| `projects` | bespoke | Filterable bento grid with glass cards; expand-on-click reveals skill-with-context list and action links. |
| `writings` | bespoke | Glass-card list with publication/date metadata; mono date accent. |
| `publications` | bespoke | Glass card with citation block; DOI rendered as monospace tail. |
| `talks` | bespoke | Glass-card list with venue/type chip + recording link. |
| `awards` | bespoke | Glass-card list — organization-prominent, dated tail. |
| `episodes` | bespoke | Glass-card numbered list with duration + audio affordance. |
| `patents` | bespoke | Glass-card list; mono patent number prominent. |
| `gallery` | bespoke | Mosaic grid with lightbox click-to-expand; `focalPoint` honored in object-position. |
| `discography` | bespoke | Cover-art-prominent cards with track expansion. |
| `testimonials` | bespoke | Pull-quote cards with avatar; rotates on horizontal scroll. |
| `press` | bespoke | Outlet-prominent list; excerpt as inline pull-quote. |
| `quote` | bespoke | Oversized centered epigraph with gradient-traced quotation marks. |
| `skills` | bespoke | Grouped skill-badge clusters (page-zero's `SkillBadgeList` aesthetic — proficiency chips). |
| `stack` | bespoke | Grouped tool rows with logo accent. |
| `services` | bespoke | Glass card with pricing + highlight list + CTA. |
| `contact` | bespoke | Glass-card channel list — LinkedIn primary; email/socials secondary. |
| `cta` | bespoke | Full-width band with gradient backdrop + primary button. |
| `stats` | bespoke | `AnimatedCounter` tiles in row layout — page-zero's "By the Numbers". |
| `focus` | bespoke | Chip cluster with target-icon header. |
| `fun-facts` | bespoke | Bullet grid (4-col on desktop) — page-zero's fun-facts card. |
| `tenure` | bespoke | Oversized number card with caption. |
| `external-portfolios` | bespoke | Brand-colored profile cards (page-zero's `socialBrandConfig` per-brand glow). |
| `github` | bespoke | Stats-card row + 52-week heatmap + pinned-repo list (server-fetched via `@portfolio/kit/github`). |

No fallback usage — the variant claims full coverage with bespoke renderers.

## Kit usage map

**Will use:**
- `@portfolio/kit` core: `ThemeProvider` + `useTheme`, `resolveColorScheme` / `resolveTypographyPreset`, `cn`, `formatPeriod` / `formatYear` / `formatDate` / `formatList`, `deriveNavItems`, `useMotionPreference`, `renderMarkdown`/`renderInlineMarkdown`, `ensureSectionId`, `slugify`.
- `@portfolio/kit/github`: `fetchGitHubData`, `contributionLevelFor`, `languageColor` for the GitHub renderer.
- `@portfolio/kit/spatial`: `ParticleField2D` for the falling-glyph background; possibly `ParallaxLayer` for floating-card dispersal if the API fits.
- `@portfolio/kit/seo`: structured data is handled at app/layout level; not directly imported in variant.

**Expect to hoist:**
- `useScrollDispersal({ position, multiplier })` — the parallax-out-on-scroll pattern used by page-zero's floating cards. If general enough, hoist to `@portfolio/kit/spatial`. Otherwise mark `// LOCAL: page-zero kinetic dispersal pattern, not yet generalized`.
- `gradient-text-animated` — the animated-gradient text utility used on the hero name. Likely a CSS-only pattern; keep local under `kinetic-cosmos-hero__name` since it's purely cosmetic.
- `<TypingAnimation>` — page-zero's roles cycle. If it's the second variant to need cycling text, hoist; otherwise local.

## Performance tier

`medium`. One 2D canvas (`ParticleField2D`-shaped) for the background glyph field. No WebGL, no R3F, no shaders. Mobile devices: particle count is computed from `innerWidth × innerHeight / 25000`, capping naturally below 100 on phones; the canvas remounts on resize but does not run animation when `prefers-reduced-motion: reduce`.

Lazy-mount: the background canvas is loaded inside the variant's root with `'use client'` and a `useEffect`-gated init — it is not part of the SSR HTML. Pinned-repo + contribution-calendar data is server-fetched (Next.js memoized) so the GitHub renderer paints on first server response without client-side waterfalls.

## Accessibility

- **Focus order:** skip-link → primary nav → main → section-by-section. Floating profile cards are `role="link"` with `aria-label`; they receive focus in DOM order, not visually-positioned order.
- **Contrast:** all schemes verified ≥4.5:1 on body text and ≥3:1 on large headings against paper. Light/bright variants use deeper ink; dark/black use brighter paper-on-ink. Accent links carry `text-decoration: underline` for non-color affordance.
- **Reduced motion:** global `@media (prefers-reduced-motion: reduce)` zeroes animation/transition durations; canvas mounted but `requestAnimationFrame` loop guarded by `useReducedMotion()`; spring `useTransform` outputs gated to identity.
- **Alt text:** every image renderer (`gallery`, project images, avatars, discography covers) requires `alt`; renderer falls through to `''` only when explicitly empty, otherwise renders an `aria-label`-shaped fallback.
- **Keyboard:** filter buttons, project expand/collapse, theme toggle, contact CTAs all are `<button>` / `<a>`; expand/collapse uses `aria-expanded` + `aria-controls`.
- **Skip link:** `editorial`-style anchor at `<main id="main">`.

## Print

`capabilities.print = true`. Print stylesheet collapses canvas/floating cards (`display: none`), forces black-on-white, expands all collapsed cards (project bodies, experience entries), and surfaces link URLs via `a::after { content: ' (' attr(href) ')'; }`. The motion-driven elements (typing animation, animated counter) print their final/idle frame.

If the print layout proves intractable (timeline SVG is large at A4 widths), fall back to `capabilities.print = false` rather than ship a broken stylesheet — to be re-evaluated during Wave 3.
