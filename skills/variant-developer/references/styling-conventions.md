# Styling conventions

> The data-attribute scoping pattern, BEM class naming, and CSS conventions
> all variants follow. Loaded during Phase 2 Wave 1 when writing styles.css,
> and referenced when adding bespoke renderers in Wave 2.

## Data-attribute scoping

ALL of a variant's CSS lives under `[data-variant='your-slug']`. This is non-negotiable.

```css
[data-variant='your-slug'] {
  --paper: #fbfaf6;
  --ink: #1a1a1a;
  --accent: #b54a32;
  /* … other tokens … */

  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-body);
}

[data-variant='your-slug'] a {
  color: var(--ink);
  text-decoration-color: var(--ink-subtle);
}
```

Without the `data-variant` scope, your styles bleed into every other variant on `/variants`.

### Color-scheme overrides

```css
[data-variant='your-slug'][data-color-scheme='noir'] {
  --paper: #ffffff;
  --ink: #0a0a0a;
  --accent: #0044ff;
}
```

Always include the variant scope. Without it, `data-color-scheme='noir'` would leak across all variants.

### Typography preset overrides

```css
[data-variant='your-slug'][data-typography='modernist'] {
  --font-display: 'Inter Display', system-ui, sans-serif;
}
```

### Theme overrides (light/dark)

The theme attribute lives on `<html>`. Order matters in selector specificity:

```css
[data-theme='dark'] [data-variant='your-slug'] {
  --paper: #0c0b0a;
  --ink: #ebe7df;
}

[data-theme='dark'] [data-variant='your-slug'][data-color-scheme='noir'] {
  --paper: #0a0a0a;
  --ink: #ffffff;
}
```

## Bright and Black: concept-anchored modes

`bright` and `black` are opt-in modes a variant can offer alongside `light` and `dark`. They are anchored to a concept; each variant interprets the concept within its own design language.

**`bright`** — push `light` further. Paper-white or near-white background, intensified accent saturation, sharper contrast. Aim: a daytime-outdoor-screen look. The variant defines exactly what shifts.

**`black`** — push `dark` further. Pure or near-pure black background (#000–#0a0a0a), high-contrast foreground, minimal mid-tones. Aim: AMOLED/night-friendly. The variant defines exactly what shifts.

When you implement these, add `[data-theme='bright']` and `[data-theme='black']` blocks for each color scheme that supports them. The audit script warns if you claim them in `themes` without the corresponding CSS blocks.

## BEM naming

Class names follow `<variant-slug>-<block>__<element>--<modifier>`.

- Variant slug prefix prevents collisions.
- Single underscore between block and element.
- Double dash before modifier.

Examples (from editorial):

```css
.editorial-project { }
.editorial-project__title { }
.editorial-project__meta { }
.editorial-project__title--featured { }
```

Avoid generic class names (`.title`, `.card`) — they collide with other variants on `/variants`.

## No Tailwind

Variants use plain CSS with custom properties. No Tailwind classes inside variant components. The host (`apps/web`) doesn't load Tailwind globally; even if it did, scattering utility classes across variants would defeat the point of a self-contained design system.

## Print stylesheet pattern

```css
@media print {
  [data-variant='your-slug'] {
    background: #ffffff;
    color: #000000;
  }
  [data-variant='your-slug'] nav,
  [data-variant='your-slug'] .editorial-toc { display: none; }
  [data-variant='your-slug'] a::after {
    content: ' (' attr(href) ')';
    color: #555;
  }
}
```

Only ship a print stylesheet if `capabilities.print = true` in the manifest.

## Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  [data-variant='your-slug'] *,
  [data-variant='your-slug'] *::before,
  [data-variant='your-slug'] *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

For canvas/WebGL bits, gate component mounting on `useReducedMotion()` from `@portfolio/kit` (if available) — don't just disable animations; skip the GPU entirely.
