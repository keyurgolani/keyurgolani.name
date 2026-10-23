# Styling conventions

> The scope, the layout-only rule, logical properties, and class naming
> every variant follows. Loaded in Phase 2 Wave 1 when writing styles.css,
> and when adding bespoke renderers in Wave 2.

## Composition only

A variant's stylesheet arranges: spacing, grid and flow, sizing, ordering, stacking, overflow, and how structure responds to the viewport. It doesn't choose color, fonts, type scale, materials, borders and radii as a look, interaction states, or motion timing. Those are the appearance system's (#19), and its tokens apply at the presentation boundary the host renders around you.

Until #19 ships, the page shows the host's neutral defaults. That's expected: judge Wave 1 by structure, not by color.

The audit holds you to it (`audit.css-appearance`): a raw color (`#hex`, `rgb()`, `oklch()`, a named color), a `font-family` or `font`, a border radius, or a shadow is refused unless it reads a `var(--...)` token. `currentColor`, `transparent`, a zero radius, `none`, and CSS-wide keywords pass. The kit's shared stylesheet and the fallback pass the same rule.

## Scope every selector

The host imports every registered variant's stylesheet on every page for now (#6 loads each where it renders), so every selector starts with `[data-variant='<id>']`:

```css
[data-variant='acme-ocean'] {
  display: block;
  max-inline-size: 72rem;
  margin-inline: auto;
}

[data-variant='acme-ocean'] .ao-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
  gap: 2rem;
}
```

A selector without the scope, a page-wide at-rule such as `@font-face`, `@page`, or `@property` outside one, or a selector that reaches past the scope to its siblings, such as `[data-variant='<id>'] ~ footer`, restyles someone else's page. `pnpm check:variants` refuses all three (`audit.css-unscoped`), nested rules included.

Every variant's keyframes share the page too, so name yours after your id: `@keyframes <id>-drift` (`audit.css-keyframes`).

The one stylesheet is the file your `./styles.css` export names. Registry generation compiles it, with your own `@import`s inlined and the kit's shared renderers' layout first, inside the `variant-layout` cascade layer, so a rule of yours for the same element beats the kit's, and copies each image your `url()`s name into the host by content hash. The host links it only on the pages that render you. Don't import CSS from components (`audit.css-import`), or render a `<style>`, `<link>`, or `<script>` (`audit.raw-element`). `@import` only your own files, by relative path: not another host's (`audit.css-remote-import`) or another package's (`audit.css-bare-import`). Ship every `url()` asset in the package (`audit.css-remote-url`).

## Logical properties

Write every direction-dependent property in its logical form, so a right-to-left page mirrors without a second stylesheet:

| Physical                 | Logical                                  |
| ------------------------ | ---------------------------------------- |
| `margin-left`            | `margin-inline-start`                    |
| `padding-right`          | `padding-inline-end`                     |
| `left`, `right`          | `inset-inline-start`, `inset-inline-end` |
| `border-left`            | `border-inline-start`                    |
| `border-top-left-radius` | `border-start-start-radius`              |
| `text-align: left`       | `text-align: start`                      |
| `float: right`           | `float: inline-end`                      |
| `width`, `height`        | `inline-size`, `block-size`              |
| `scroll-margin-top`      | `scroll-margin-block-start`              |

A variant whose manifest declares `rtl` must use them: the audit refuses the physical forms (`audit.css-physical`). Use them anyway when you declare only `ltr`; the port to `rtl` is then a test, not a rewrite.

## Class naming

`<prefix>-<block>__<element>--<modifier>`, with a short prefix of your own. The fallback's is `fc-`:

```css
[data-variant='fallback'] .fc-header {
}
[data-variant='fallback'] .fc-nav {
}
```

The kit's shared renderers use `pf-` classes, inside `:where()` so any scoped rule of yours wins. You can arrange them from your scope, such as `[data-variant='<id>'] .pf-gallery`, but don't restyle their look.

## No Tailwind

Variants use plain CSS. No utility classes inside variant components.

## Print

There's no print capability flag. A visitor can always print, so leave the page printable: hide navigation and decoration, and keep the content in reading order.

```css
@media print {
  [data-variant='acme-ocean'] .ao-nav,
  [data-variant='acme-ocean'] .ao-decoration {
    display: none;
  }
}
```

## Reduced motion

Under the site's `reduce` policy the boundary, the element that carries `data-variant`, also carries `data-motion-policy='reduce'`; under `respect-os`, the visitor's `prefers-reduced-motion` decides. Stop CSS motion under both:

```css
@media (prefers-reduced-motion: reduce) {
  [data-variant='acme-ocean'] * {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}

[data-variant='acme-ocean'][data-motion-policy='reduce'] * {
  animation: none !important;
  transition: none !important;
  scroll-behavior: auto !important;
}
```

CSS doesn't reach script motion: run it on `@portfolio/kit/runtime` (`references/common-bugs.md` §8). The motion contract (`tests/e2e/motion-contract.spec.ts`) checks the result.
