# Styling conventions

> The scope, the layout-only rule, logical properties, and class naming
> every variant follows. Loaded in Phase 2 Wave 1 when writing styles.css,
> and when adding bespoke renderers in Wave 2.

## Composition only

A variant's stylesheet arranges: spacing, grid and flow, sizing, ordering, stacking, overflow, and how structure responds to the viewport. It doesn't choose color, fonts, type scale, materials, borders and radii as a look, interaction states, or motion timing. Those are the appearance system's (#19), and its tokens apply at the presentation boundary the host renders around you.

Until #19 ships, the page shows the host's neutral defaults. That's expected: judge Wave 1 by structure, not by color.

## Scope every selector

The host imports every registered variant's stylesheet on every page, so every selector starts with `[data-variant='<id>']`:

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

A selector without the scope, or a page-wide at-rule such as `@font-face`, `@page`, or `@property` outside one, restyles someone else's page. `pnpm check:variants` refuses both (`audit.css-unscoped`).

The one stylesheet is the file your `./styles.css` export names. Don't import CSS from components (`audit.css-import`), and don't `@import` from another host (`audit.css-remote-import`).

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

CSS doesn't reach script motion: gate it on `useMotionPreference()` (`references/common-bugs.md` §8). The motion contract (`tests/e2e/motion-contract.spec.ts`) checks the result.
