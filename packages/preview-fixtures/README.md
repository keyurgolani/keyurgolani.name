# `@portfolio/preview-fixtures`

The preview's environment fixture (#7, Slice 4): the `fixture-environment`
composition. It renders every visible section in one column through the
kit's shared renderers, as the fallback composition does, and styles only
against the environment attributes a preview sets on the presentation
boundary, and the visitor preferences they stand in for:

- `data-display-mode`: the color scheme the system colors follow;
- `data-contrast` and `prefers-contrast: more`: thicker rules;
- `data-motion` and `prefers-reduced-motion: reduce`: the mark that moves stops;
- `data-enhancement`: the kit loads its `mark` enhancement only while it's on.

It uses system colors and the system font stack, with no `@font-face`, so it
needs no font route and passes `pnpm check:variants` as any variant does.

It's a test fixture (`portfolio.fixture: true`): it registers only in a
build with `PREVIEW_FIXTURES=1` (`apps/web/scripts/fixture-gate.ts`), and a
build without the flag fails if its id reaches the registry another way.
`pnpm test:preview-fixtures` builds with the flag and renders previews in it.
