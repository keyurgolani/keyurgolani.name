# `@portfolio/fallback-composition`

The host's stand-in composition (id `fallback`, #5). It renders every visible
section in content order, in one column, through the kit's shared renderers
(`@portfolio/kit/sections`), with one `<main>`, one `h1`, a section
navigation, and one visitor control slot.

The host renders it:

- in place of a selected variant this build doesn't register, with
  `data-requested-variant` on the presentation boundary and an owner
  diagnostic, and no label for visitors;
- for the contract fixtures and #19's appearance matrices.

A site can't select it: the site schema refuses `variant: fallback`.
Registry generation fails without it.

It's also what `pnpm new-variant` copies to start a variant: a manifest that
validates, a component of the render input, and a stylesheet under its own
`[data-variant]` scope. Composition only: color, type, and motion come from
#19's appearance axes.
