# Building a variant

A variant is a composition: a workspace package that decides how the portfolio's sections are arranged, how a visitor moves between them, and what reveals itself. The host renders it from one `VariantRenderInput`, built by `buildRenderInput` in `@portfolio/variant-contract`: the visible content (no hidden section, no unregistered extension data), the site's presentation settings, the variant's control values, the route, ids, and a fixed time and seed.

Appearance isn't a variant's. Color, type, materials, geometry, interaction states, and motion timing come from the appearance system (#19), whose design languages, color schemes, and typography packs the owner picks independently. A variant ships no palette, font, theme, or theme toggle.

For an AI-assisted variant build, point an agent at [skills/variant-developer/SKILL.md](../skills/variant-developer/SKILL.md).

## Anatomy of a variant

```
packages/variant-<id>/
├── package.json     @portfolio/variant-<id>, with "portfolio": { "kind": "variant", "manifest": "./manifest.json" }
├── manifest.json    contract 2.0: id, promise, composition family, kinds, routes, controls
├── tsconfig.json
├── DESIGN.md        the design contract, from the skill's template
└── src/
    ├── index.tsx    the default export: ({ input }) => the page
    ├── styles.css   layout only, every selector under [data-variant='<id>']
    └── renderers/   one bespoke renderer per kind in renderedKinds
```

`package.json` exports `.` (the component), `./styles.css`, `./manifest`, and `./package.json`, plus a subpath per enhancement.

## Quick scaffold

```sh
pnpm new-variant my-id
```

It copies `packages/fallback-composition` to `packages/variant-my-id`, names the package and the manifest, adds it to `@portfolio/web` with `pnpm --filter @portfolio/web add @portfolio/variant-my-id@workspace:*`, and runs `pnpm check:variants --package @portfolio/variant-my-id`. `--no-install` stops before the two pnpm commands.

## Registration

Installing a variant is a dependency of `@portfolio/web` and nothing else. `apps/web/scripts/build-registry.ts` reads the host's direct dependencies and keeps those whose `package.json` `portfolio.kind` is `variant` or `content-extension` (#19's `design-language`, `color-scheme`, and `typography` kinds fail with `registry.no-validator` until it adds their validators). It checks each, and writes the gitignored `apps/web/src/lib/generated/`: `registry.meta.ts` (the manifests), `registry.loaders.ts`, `registry.styles.ts`, `registry.extensions.ts`, `registry.enhancements.ts`, and `transpile-packages.json`, which `next.config.ts` reads. Two runs on the same dependencies write identical files.

`predev`, `prebuild`, `typecheck`, `test`, and `check:variants` run it, and any error stops them. Installing never runs it, so a broken package can't block `pnpm --filter @portfolio/web remove <package>`. Run it yourself with `pnpm --filter @portfolio/web build:registry`, `--check` to write nothing, and `--format json` for the whole result.

It refuses a package with an invalid manifest, a contract major it doesn't read or a newer minor, a token contract or schema range this host doesn't match, a reserved or duplicate id, a reserved route segment, or a missing export or file. Each diagnostic names the package, its version, the manifest path, a JSON pointer, the code, what it expected and found, and the remedy: upgrade, pin, or uninstall. Without the fallback composition among the dependencies, generation fails.

A `file:` dependency must sit under `apps/` or `packages/`, the trees the Docker image's dependency stage copies.

## The manifest

`manifest.json` at the package root. The fallback composition's is the smallest correct one:

```json
{
  "id": "fallback",
  "name": "Fallback composition",
  "promise": "Every section in content order, in one readable column.",
  "description": "The host's stand-in. ...",
  "contract": "2.0",
  "schemas": { "portfolio": { "min": 2, "max": 2 }, "site": { "min": 2, "max": 2 } },
  "tokenContract": 0,
  "compositionFamily": "document",
  "motionIntent": "still",
  "performanceTier": "light",
  "renderedKinds": [],
  "unsupportedKinds": [],
  "contentSlots": [],
  "routes": { "home": "shared", "work": "shared", "views": [] },
  "controls": { "version": 1, "items": [], "migrations": [] },
  "visitorControl": { "placement": "header" },
  "textDirection": ["ltr", "rtl"],
  "provenance": { "provisional": true, "sources": [] }
}
```

`renderedKinds` are the kinds the variant renders bespoke, `unsupportedKinds` the ones it deliberately doesn't show, and every other kind renders through the kit's shared renderer. Controls are owner-tunable composition choices, never appearance. Every field, with valid values, is in [`manifest-contract.md`](../skills/variant-developer/references/manifest-contract.md). A v1 field (`slug`, `themes`, `colorSchemes`, `typographyPresets`, `supportedKinds`, and the rest) is refused with where it went.

## The render path

```tsx
// src/index.tsx
import { renderSection, VisitorControlSlot } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Projects } from './renderers/projects';

/** The kinds in the manifest's renderedKinds, each with its renderer. */
const RENDERERS = { projects: Projects };

export default function AcmeOcean({ input }: { readonly input: VariantRenderInput }) {
  const { portfolio, ids } = input;
  return (
    <>
      <header className="ao-header">
        <VisitorControlSlot />
      </header>
      <main id={ids.main} className="ao-main" tabIndex={-1}>
        {portfolio.sections.map((section) => renderSection(section, input, RENDERERS))}
      </main>
    </>
  );
}
```

- It renders synchronously from the input alone, the same markup on the server, in #7's preview frame, and in #9's browser render.
- It renders exactly one `<main id={input.ids.main}>` and exactly one `<VisitorControlSlot />`, which #19 fills.
- `renderSection` renders each section inside its section element, with the id `${input.ids.prefix}${section.id}`, `data-section-id`, `data-kind`, `data-renderer` (`bespoke` or `shared`), the section's `lang`, and a `dir` when its language runs the other way. A renderer map that disagrees with `renderedKinds` throws.
- An extension kind renders through the renderer its content extension registered, and renders nothing without one.
- Markdown goes through `RichText`; anything random-looking through `seededRandom(input.env.seed)`; the time is `input.env.now`.

## What the host does around it

- A skip link to `#<input.ids.main>`, then the presentation boundary, `<div data-variant="<id>" data-motion-policy="...">`, with the variant inside. #19's tokens apply at the boundary, and so does the variant's stylesheet. The 404 page renders inside the same boundary.
- When the site selects a variant this build doesn't register, the **fallback composition** renders in its place with a 200, and the boundary carries `data-requested-variant`. Startup logs a `variant.unavailable` warning, `config.status` reports `variant: { status: 'degraded', requested, rendered: 'fallback' }`, and `/api/ready`'s `packs` check says `degraded`. Visitors see no label. #3's publish refuses the selection.
- Under the demo profile, `/sample` renders the bundled sample in the sample site's selection, and `/sample?variant=<id>` in any registered variant. `fallback`, an unregistered id, an empty one, or two are a 404.
- While `isServable()` is false, which #3's catalog sets when it has nothing to serve, visitor pages answer a static 503 with `Retry-After: 120` and `X-Robots-Tag: noindex`.

## Motion

The site's policy reaches a variant as `input.presentation.motionPolicy`: `respect-os` follows the visitor's `prefers-reduced-motion`, and `reduce` always reduces. The boundary carries it as `data-motion-policy`, so a stylesheet reduces CSS motion under `[data-variant='<id>'][data-motion-policy='reduce']` as it does under `prefers-reduced-motion`.

CSS rules don't reach motion that scripts run. Wrap the variant's client parts in `MotionPolicyProvider` with the policy, and gate a canvas loop, an entrance, or an animation that repeats on `useMotionPreference()`; scroll with `behavior: 'auto'` under reduce. [`common-bugs.md`](../skills/variant-developer/references/common-bugs.md) section 8 has the details.

`tests/e2e/motion-contract.spec.ts` checks every registered composition: under `reduce`, and under `respect-os` with the visitor's reduced-motion setting, nothing runs once the page settles and a navigation link jumps to its section. A variant passes it before it registers.

## Styling conventions

- **Layout only.** Spacing, arrangement, grid and flow, sizing. No color, font, theme, or material.
- **Scope every selector under `[data-variant='<id>']`.** Every registered variant's stylesheet loads on every page.
- **Logical properties** (`margin-inline-start`, `inset-inline-end`, `text-align: start`), so a right-to-left page mirrors. A variant that declares `rtl` must use them.
- **One stylesheet**, the `./styles.css` export. No CSS imported from modules, and no `@import` from another host.
- **BEM-style classes** with a short prefix of your own: `<prefix>-<block>__<element>--<modifier>`.

The full conventions are in [`styling-conventions.md`](../skills/variant-developer/references/styling-conventions.md).

## Checking a variant

```sh
pnpm check:variants --package @portfolio/variant-my-id
```

It generates the registry, as `build:registry` does, then audits the variant's source and styles. Without `--package` it audits every registered variant, and `@portfolio/kit/sections` with every kit module it imports for the clock and randomness rules. Any diagnostic or finding fails it, with the file, the line, and the fix.

The audit refuses `async` components; Node built-ins, `server-only`, `next`, and `@portfolio/core`; `process.env`; the kit's `fetchGitHubData`; `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, and `navigator.sendBeacon`; cookies, Web Storage, and `indexedDB`; `Date.now()` and argument-less `new Date()`; `Math.random()`; `dangerouslySetInnerHTML`; CSS imported from a module; a `'use client'` module that takes the whole render input, other than a declared enhancement; a selector or page-wide at-rule outside `[data-variant='<id>']`; a remote `@import`; and, in a variant that declares `rtl`, physical properties.

CI runs it in `pnpm check:registry`, with two registry builds that must match and a check that nothing generated is committed.

## The fallback composition

`packages/fallback-composition` is the host's stand-in and the clone source: every visible section in content order through the kit's shared renderers, in one column, with a navigation list and the visitor control slot in a header. It's `document`, `still`, and `light`, with empty `renderedKinds` and no slots or controls. It renders for a selection no package registers, and for the contract fixtures; a site can't select it. Fixtures select `missing-variant`, an id no package may take, to reach it.

## Retired variants

`legacy/` holds the v1 Editorial and Kinetic Cosmos packages, their screenshots, and their browser specs, outside the workspace: nothing installs, builds, lints, or tests them. #13 and #14 rebuild them on contract 2.0 as `editorial-evidence` and `kinetic-cosmos`, with their palettes and fonts moving to #19's packs. Read them for inventory; never import them.

## Visual companion

The variant-developer skill ships a visual companion at `skills/variant-developer/scripts/visual-companion/`:

- **Mockup mode** (an HTTP server and a file watcher) for layout boards and section sketches before code exists.
- **Preview mode** runs the dev server under `PORTFOLIO_PROFILE=demo` for `/sample?variant=<id>`, and with `--matrix` captures it in light and dark at a desktop and a phone viewport.

```sh
bash skills/variant-developer/scripts/visual-companion/start.sh
bash skills/variant-developer/scripts/visual-companion/start.sh --mode preview --variant <id> --matrix
```

Output lands in `.variant-preview/<id>/` (gitignored).

## What to read next

- AI-assisted variant building: [`skills/variant-developer/SKILL.md`](../skills/variant-developer/SKILL.md)
- System internals: [architecture.md](architecture.md)
- Available section kinds: [authoring.md](authoring.md)
- Both documents, field by field: [configuration.md](configuration.md)
