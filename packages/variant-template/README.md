# `@portfolio/variant-template`

Cloneable starting point for new variant packages. Not auto-registered (the
`portfolio.template: true` flag in `package.json` keeps the registry
generator from picking it up).

## Strategy: per-variant packages

The platform commits to **one renderer package per variant**. Each variant is
free to:

- ship its own typography, color, motion, and layout
- declare partial section coverage (kinds it doesn't claim fall through to
  `FallbackSection` from `@portfolio/kit`)
- depend on whatever it needs (R3F, shaders, etc.) without taxing variants
  that don't use them

The trade-off: there is no shared "TemplateVariant + tokens" baseline like
the archive's. If you want token-driven recoloring, you build it yourself
inside your variant package using `colorSchemes` + `[data-color-scheme]`
overrides, the way `variant-editorial` does.

## Cloning

```bash
node scripts/new-variant.mjs my-slug
```

That copies this directory to `packages/variant-my-slug/`, rewrites the
package name and slug, and runs `pnpm install`. The next `build:registry`
run will pick up the new variant.

## What you get out of the box

- Manifest claims full section coverage by dispatching every kind to
  `FallbackSection`, so the variant compiles and runs immediately.
- Light/dark CSS variables on `.vt-root`.
- A minimal `<ThemeToggleHost />` wired to the host's `useTheme()`.

## Where to start replacing

1. `src/manifest.ts` — change `slug`, `name`, `tagline`, `description`,
   `aesthetic`, `motion`, `density`, `typography`, `performanceTier`. Update
   `colorSchemes` and `typographyPresets` if you have any.
2. `src/variant.tsx` — keep dispatching to `FallbackSection` until you have
   bespoke renderers; replace per-kind cases as you add them.
3. `src/styles.css` — add styles for your bespoke renderers below the
   marker. The fallback renderer uses `currentColor` + `opacity`, so theme
   tokens flow through unchanged.

## Adding renderers

Mirror the pattern in `@portfolio/variant-editorial`: a `src/renderers/`
directory with one file per kind, plus a `SectionDispatch` that picks the
renderer by `section.kind`. The fallback path stays as a default for kinds
you haven't replaced yet.
