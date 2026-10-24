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

Installing a variant is a dependency of `@portfolio/web` and nothing else. `apps/web/scripts/build-registry.ts` reads the host's direct dependencies and keeps those whose `package.json` `portfolio.kind` is `variant` or `content-extension`, or one of #19's pack kinds, `design-language`, `color-scheme`, and `typography`. It checks each, and writes the gitignored `apps/web/src/lib/generated/`: `registry.meta.ts` (the manifests, the packs with their compiled files, and `ASSET_MANIFEST`, what each unit ships to the browser), which is `server-only`, so no client module can bundle it; `asset-manifest.json` and `trace-matrix.json`, which Node tools read in its place; `registry.loaders.ts`; `registry.extensions.ts` (the content extensions' definitions, which Node tools load); `registry.renderers.ts` (their section renderers, which only the server loads); `registry.enhancements.ts`; and `transpile-packages.json`, which `next.config.ts` reads. The packs' compiled stylesheets go into the gitignored `apps/web/public/_portfolio/pack/`, the fonts they ship into `apps/web/public/_portfolio/font/`, each variant's compiled stylesheet into `apps/web/public/_portfolio/variant/`, and the images it names into `apps/web/public/_portfolio/asset/`. It writes each variant's experience segment too, `apps/web/src/app/(site)/%5Fexperience/<id>/`: the route its pages render in, which imports that variant and no other, so a page's chunks hold no other variant's code. Two runs on the same dependencies write identical files.

Your stylesheet compiles into one file, `<id>.<sha256-12>.css`: #19's layer-order statement, then the kit's shared renderers' layout and your `./styles.css`, with your own `@import`s inlined, all inside the `variant-layout` cascade layer, so a rule of yours for the same element still beats the kit's. Each `url()` target in your package, an image, is copied by content hash to `/_portfolio/asset/<sha256-12>.<ext>` and the `url()` rewritten. The host links the file only on a page that renders your variant. Declare `"sideEffects": false` in your `package.json`, as the scaffold's does: nothing in a variant runs on import, and a bundle then keeps only the modules a page uses.

`predev`, `prebuild`, `typecheck`, `test`, and `check:variants` run it, and any error stops them; `typecheck`, `test`, and `check:variants` pass `--modules-only`, which writes the modules and the experience segments and leaves `public/` alone. Under `next dev`, an edit to your stylesheet reaches the page once registry generation runs again: run `pnpm --filter @portfolio/web build:registry`, or restart `pnpm dev`. Installing never runs it, so a broken package can't block `pnpm --filter @portfolio/web remove <package>`. Run it yourself with `pnpm --filter @portfolio/web build:registry`, `--check` to write nothing, and `--format json` for the whole result.

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
  "schemas": { "portfolio": { "min": 3, "max": 3 }, "site": { "min": 2, "max": 2 } },
  "tokenContract": 1,
  "compositionFamily": "document",
  "motionIntent": "still",
  "performanceTier": "light",
  "budgets": { "js": 2048, "css": 2048, "image": 0, "font": 0, "animation": 0, "enhancement": 0 },
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

`renderedKinds` are the kinds the variant renders bespoke, `unsupportedKinds` the ones it deliberately doesn't show, and every other kind renders through the kit's shared renderer. Controls are owner-tunable composition choices, never appearance. `budgets` is what the variant may ship, in JS, CSS, image, font, animation, and enhancement bytes or counts, each at most its tier's ceiling in `runtime-budgets.json`, which a kind left out gets; `pnpm check:budgets` holds every registered variant and appearance pack to its budgets (Checking a variant, below). `stills` are your catalog stills, committed PNG or WebP files with their exact width and height, which a catalog plate shows before, and instead of, a live preview; `pnpm stills` shoots them, and they count toward `image`. Every field, with valid values, is in [`manifest-contract.md`](../skills/variant-developer/references/manifest-contract.md). A v1 field (`slug`, `themes`, `colorSchemes`, `typographyPresets`, `supportedKinds`, and the rest) is refused with where it went.

## The render path

```tsx
// src/index.tsx
import { renderSection, VisitorControlSlot } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Works } from './renderers/works';

/** The kinds in the manifest's renderedKinds, each with its renderer. */
const RENDERERS = { works: Works };

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
- The input is the published view (#10). `input.portfolio` holds only what visitors may see, every list present: the sections, and the works, evidence, and chronology entries they reach. `input.media` has each placed asset, with its renditions or why it has none yet, and `input.derived` each github section's snapshot, or why it has none. A bespoke renderer finds a section's records with the kit's `worksOf(section, input)`, `evidenceOf`, and `chronologyOf`, and a placement's image with `placedMedia`, which adds the placement's caption, and when, where, and with what tags it was taken, for `MediaFigure` to render, as an `Image unavailable` box until a rendition exists.
- It renders exactly one `<main id={input.ids.main}>` and exactly one `<VisitorControlSlot />`, which #19 fills.
- `renderSection` renders each section inside its section element, with the id `${input.ids.prefix}${section.id}`, `data-section-id`, `data-kind`, `data-renderer` (`bespoke` or `shared`), the section's `lang`, and a `dir` when its language runs the other way, and renders nothing for a section with nothing public. A renderer map that disagrees with `renderedKinds` throws.
- An extension kind renders through the renderer its content extension registered, and renders nothing without one.
- Markdown goes through `RichText`; anything random-looking through `seededRandom(input.env.seed)`; the time is `input.env.now`.

## What the host does around it

- The document boundary, `<div data-appearance-boundary="document" data-variant="<id>" data-display-mode="..." data-motion="..." ...>`, with its skip link to `#<input.ids.main>` first and the variant inside. #19's tokens apply at the boundary, and so does the variant's stylesheet. The 404 page renders inside the same boundary.
- When the site selects a variant this build doesn't register, the **fallback composition** renders in its place with a 200, and the boundary carries `data-requested-variant`. Startup logs a `variant.unavailable` warning, `config.status` reports `variant: { status: 'degraded', requested, rendered: 'fallback' }`, and `/api/ready`'s `packs` check says `degraded`. Visitors see no label. #3's publish refuses the selection.
- Under the demo profile, `/sample` renders the bundled sample in the sample site's selection, and `/sample?variant=<id>` in any registered variant. `fallback`, an unregistered id, an empty one, or two are a 404.
- While `isServable()` is false, which #3's catalog sets when it has nothing to serve, visitor pages answer a static 503 with `Retry-After: 120` and `X-Robots-Tag: noindex`.

## Routes

The host owns every route, and asks `dispatch()` what each path is, against the composition that renders:

- `/` is home, and `/work/<slug>` a work's case study: one the live revision publishes, on a public work a visible section reaches. Any other slug is the 404 page. A variant whose manifest says `routes.work: bespoke` renders that page itself, and `routedWork(input)` from `@portfolio/kit/sections` is the work the route names. One that says `shared` leaves it to the host, which renders it through the fallback composition: the kit's `CaseStudy` as the page's one h1, and a link home. So every composition has case-study pages, and none shows its home at a work's address. The views a variant declares under `work` stay its own.
- A path view the manifest declares renders below its parent route, such as `/chapters/<chapter>` or `/work/<slug>/notes`, from the server, so it works without JavaScript and after a refresh. It carries a canonical link to its parent route at the site root, none under `/sample` or in a preview frame, and stays out of the sitemap. A view the site document's `routes` turns off is the 404 page.
- A placeholder takes one segment of lowercase words joined by hyphens, at most 64 characters, as a content id does. A longer value is no view. Any value that fits renders the view, whether or not it names anything: a way for a view to answer 404 for one that names nothing is a later addition to the contract.
- A path only another installed variant declares is a 307 to its parent route, so a bookmark from before a switch lands home, not on a 404.
- Anything else is the 404 page.
- Under `demo`, the same routes sit below `/sample`, and `?variant=<id>` stays on every link and redirect.

Link to a route with `routeHref(input, target)` from `@portfolio/variant-contract`. It writes the URL below `input.basePath`, keeps `input.query`, and puts `input.ids.prefix` on a fragment view's id, so one render links right at `/`, below `/sample`, and below #7's preview prefix. The kit's shared renderers do the same for a `/#section` link.

A path view can't start with a segment the host owns: `studio`, `api`, `_next`, `_fixtures`, `sample`, `reference`, `preview`, `preview-assets`, `work`, `admin`, `variants`, and the metadata files. Generation fails on one, and the root catch-all leaves each to its own route, so a view never shadows an API or metadata route.

The route table knows from the build's manifests, before any page runs, which paths name nothing: one no installed variant declares, a slug the live revision doesn't route (#10b, the one answer it reads from the live site), a placeholder value over 64 characters, or a `?variant=` that names nothing. Each gets the 404 page from the server, with its 404 status, so it works without JavaScript. One 404 still draws in the browser: a view the live variant declares and the site document's `routes` turns off. Next 16 answers a page's `notFound()` with an error document the browser fills in, so without JavaScript that page is empty; the status is 404 either way.

## Compatibility

Every check of a pair against the composition that renders it is one report, `compatibilityFor(pair, { registry })` from `@portfolio/variant-contract`. Startup and `pnpm config:validate` get its findings as diagnostics, and so will #3's publish. It needs nothing from Node, so #9 can run the same code in the browser. `evaluateCompatibility(manifest, pair, { registry })` reports on a candidate as if the site selected it, so #8 and #9 can explain one before the owner switches. The report has:

- `variant`: what the site selects, what renders (the selection, or the fallback composition in its place), and its package version. In a candidate's report both name the candidate, and a `variant.unavailable` there says what selecting it would render.
- `kinds`: each visible kind and how it renders: `bespoke`, `shared`, through its content extension's renderer, `unsupported`, or `none`.
- `slots`: each content slot's fill count, with its `whenEmpty` note when it has fewer than it asks for.
- `routes`: the previous variant's path views this one doesn't serve. Each redirects to its parent route while the previous variant stays installed, and is a 404 once it's removed.
- `inputHash`, of everything the report depends on, and `status`: `ok`, `warning`, or `blocks-publish`.

| Finding                                                            | Code                                                          | Preview                                 | Publish |
| ------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------- | ------- |
| The selected variant isn't registered                              | `variant.unavailable`                                         | the fallback composition renders        | blocked |
| A required slot holds fewer than its `min`                         | `slot.required-empty`                                         | renders, as the slot's `whenEmpty` says | blocked |
| A recommended slot is empty                                        | `slot.recommended-empty`                                      | renders, as `whenEmpty` says            | allowed |
| A slot holds more than its `max`                                   | `slot.overflow`                                               | the extras render after the slot        | allowed |
| A visible section of an `unsupportedKinds` kind                    | `kind.unsupported`                                            | visitors don't see it                   | allowed |
| A visible extension section nothing renders                        | `kind.no-renderer`                                            | the rest of the page renders            | blocked |
| A stored control value that's invalid, stale, or points at nothing | `controls.invalid`, `controls.stale`, `controls.dangling-ref` | the control renders its default         | blocked |
| Right-to-left content in a variant that declares only `ltr`        | `direction.unsupported`                                       | renders left to right                   | allowed |
| A `recommendedAppearance` this build doesn't list                  | `appearance.unknown-recipe`                                   | the site's own appearance renders       | allowed |

An empty optional slot shows only in `slots`. A slot counts the visible sections of its kind, the visible sections or records its control points at, or the values its field holds in the published view, an array counting each item. Startup checks the pair as live, so a finding that blocks publishing only warns there: something renders in its place either way.

After a variant raises its controls version, `pnpm variants:migrate-controls --site config/site.yml` steps the stored values through the manifest's migrations. It prints each change and a diff, and writes only with `--write`, through a symbolic link to the file the link names, keeping that file's mode, owner, and group, so the server's user reads it as before. Once it has written, a second run finds nothing to do. It writes nothing and exits 1 for a link whose file is named for the other format, or a file whose owner and group the user running it can't give a new file. Values of another version are never read: until they migrate, every control renders its default.

A YAML document keeps every line the migration doesn't change, comments included. A renamed control moves to the end of its `values` mapping, and a key or value the migration writes is plain, or double-quoted when it must be, whatever quotes the document used. A JSON document is written whole, in its own indent with one value per line, so a document already in that layout, as `JSON.stringify` writes it, changes only in the entries that migrate. YAML the edits can't change in place, such as a complex key (`? key`), stops the command with exit status 1 and the file as it was.

## Motion

The site's policy reaches a variant as `input.presentation.motionPolicy`: `respect-os` follows the visitor's `prefers-reduced-motion`, and `reduce` always reduces. The boundary carries the motion that renders as `data-motion`: `reduced` under `reduce` or a preview's reduced environment, `static` in a plate or once the visitor pauses motion, and `full` otherwise, when the visitor's `prefers-reduced-motion` decides. Its `--ui-motion-*` and state tokens follow all of them, so a stylesheet takes its timing and movement from the tokens and stops motion of its own under `[data-variant='<id>']:is([data-motion='reduced'], [data-motion='static'])`, never with a universal `!important` kill switch ([`styling-conventions.md`](../skills/variant-developer/references/styling-conventions.md)).

CSS rules don't reach motion that scripts run. Wrap the variant's client parts in `MotionPolicyProvider` with the policy, and run every script effect on `@portfolio/kit/runtime` (#6): attach `useEnhancementRuntime()`'s `attachRoot` to the effect's root, draw frames through `useFrameLoop(runtime, draw)`, and render the still while `runtime.state` is `static`. The runtime keeps it static before the page mounts and under reduced motion, and pauses it while the document is hidden, the root is offscreen, the visitor paused motion with `MotionControl`, or a Studio preview frame is out of focus; a root that isn't active carries `data-activity="paused"`, which pauses its CSS animations. The kit's own effects already run on it. Load an enhancement with `EnhancementIsland`, which renders your server markup, loads the chunk only while the runtime is active, and falls back to that markup if it fails. Scroll with `behavior: 'auto'` under reduce. [`common-bugs.md`](../skills/variant-developer/references/common-bugs.md) section 8 has the details.

`tests/trace/modes.spec.ts` traces `fixture-variant-medium` in each mode, with `pnpm test:trace` after a `BUDGET_FIXTURES=1` build: running, hidden, offscreen, the OS's reduced motion, the site's `reduce` policy, the visitor's pause and resume, a preview frame out of focus, no WebGL2, a failed enhancement chunk, and blocked fonts, media, and stylesheets, each holding the page for 5 seconds and counting frame loops, recurring timers, and infinite animations, with the page reading the same as without JavaScript and its layout shift recorded.

`tests/e2e/motion-contract.spec.ts` checks every registered composition: under `reduce`, and under `respect-os` with the visitor's reduced-motion setting, no animation runs once the page settles, after a navigation link's jump, or as each part of the page scrolls into view; no script keeps asking for animation frames; and the link jumps to its section, in the window or in a scroll container of the composition's own. A canvas drawn without `requestAnimationFrame` is outside what it sees. `tests/e2e/motion-harness.spec.ts` shows each check catching what it's for. A variant passes it before it registers.

## Styling conventions

A variant arranges; the appearance axes (#19) style. Color comes from the color scheme, materials, geometry, states, and timing from the design language, and text from the typography profile, all as custom properties on the presentation boundary the host renders around you. [Appearance](appearance.md) is the contract: who owns what, the tokens, the boundary, the layer order, and the shared primitives.

- **Layout only.** Spacing, arrangement, grid and flow, sizing, order, and how structure responds to the viewport. Your stylesheet compiles into the `variant-layout` layer, above the packs and below the utilities and accessibility layers, so you can arrange anything and restyle nothing.
- **Read the tokens for everything else.** Every color is a `var(--color-<role>)`, such as `--color-text-secondary` for quiet text, never a lower opacity. Every border, radius, and shadow is a `var(--ui-<key>)`, such as `--ui-border-divider` or `--ui-radius-media`, and every duration and easing a `--ui-motion-*`. Text takes a role with `data-type-role="<role>"` in your markup, such as `display` or `caption`, or reads `var(--type-<role>-<field>)` in a rule. The only custom properties you define are `--layout-*`.
- **Use the shared primitives** from `@portfolio/appearance/primitives` for actions, surfaces, disclosures, badges, fields, and the rest: you choose which goes where and with what emphasis, and the packs style them. Native elements come first.
- **No appearance of your own.** A raw color (`#hex`, `rgb()`, `oklch()`, a named color), a `font-family` or `font`, a `@font-face`, a border radius, or a shadow is refused unless it reads a `var(--...)` token; `currentColor`, `transparent`, a zero radius, `none`, and CSS-wide keywords are fine. No theme blocks, no display-mode selectors, and no theme toggle: the visitor's appearance control renders in your `VisitorControlSlot`.
- **Scope every selector under `[data-variant='<id>']`,** and reach only what's inside it: no `+` or `~` after the scope, nested rules included. Your stylesheet loads only on the pages that render you, but a page can show another variant's boundary too, such as a catalog plate, so the scope keeps yours to your own. Never key a rule on a pack's attribute, such as `[data-color-scheme]`: a composition reads the same under every pack.
- **Reduced motion is the boundary's.** It carries `data-motion`: `full`, `reduced`, or `static`. Under `reduced` the state transforms read `none` and entrances, exits, and emphasis stop moving, but the durations stay; only `static` zeroes them. So motion on the tokens needs nothing more, and a keyframe animation of your own has to stop under `[data-variant='<id>']:is([data-motion='reduced'], [data-motion='static'])`.
- **Name keyframes after your id,** as `<id>-name`, so no other stylesheet shares the name.
- **Logical properties** (`margin-inline-start`, `inset-inline-end`, `text-align: start`), so a right-to-left page mirrors. A variant that declares `rtl` must use them.
- **One stylesheet**, the `./styles.css` export. No CSS imported from modules, no `@import` but your own files by relative path, no `url()` on another host, and no `<style>`, `<link>`, or `<script>` rendered from a component.
- **BEM-style classes** with a short prefix of your own: `<prefix>-<block>__<element>--<modifier>`.

Judge a variant under more than one selection: the same layout should hold under every design language, color scheme, typography profile, and display mode. The full conventions are in [`styling-conventions.md`](../skills/variant-developer/references/styling-conventions.md).

## Checking a variant

```sh
pnpm check:variants --package @portfolio/variant-my-id
```

It generates the registry, as `build:registry` does, then audits the variant's source and styles, every `@portfolio/kit` entry the variant imports (and `@portfolio/kit/sections`, which renders its sections) with each kit module those import for the clock and randomness rules, and the kit's shared stylesheet for appearance. Without `--package` it audits every registered variant. Any error or finding fails it, with the file, the line, and the fix; when generation fails, every error shows, whichever package it names.

The audit is a lint over code the host already trusts, not a sandbox: a variant installs at build time with full server trust, and a determined package can get around any syntax check. It reads each file's syntax, follows the globals it reaches for through aliases, destructuring, string keys, and `Reflect.get`, and refuses what it can't follow, such as a computed key or the global object passed around.

The audit refuses `async` components (by name, as a default export, or wrapped in `memo()`; an async event handler is fine); Node built-ins, `server-only`, `next`, `@portfolio/core`, and an import from a URL; `process`, `process.getBuiltinModule()` included; the kit's `fetchGitHubData`; `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, and `navigator.sendBeacon`; cookies, Web Storage, `indexedDB`, and the Cache API; `Date.now()`, `Date()`, argument-less `new Date()`, `performance.now()`, and a date format's `format()` with no date; `Math.random()`, `crypto.getRandomValues()`, and `crypto.randomUUID()`; `eval`, `Function`, and a timer given a string; `import()` and `require()` of anything but a literal; `dangerouslySetInnerHTML`, `innerHTML`, and `document.write()`; a `<style>`, `<link>`, or `<script>`; CSS imported from a module; a `'use client'` component that takes the whole render input or a prop named `input`, other than a declared enhancement (a `Pick<>` of it, or one field such as `VariantRenderInput['env']`, is fine); a selector or page-wide at-rule outside `[data-variant='<id>']`, or one that reaches a sibling of it; keyframes not named after the id; a remote `@import` or `url()`, or an `@import` of another package; a raw color, font, radius, or shadow; and, in a variant that declares `rtl`, physical properties and shorthands, keyframes included.

CI runs it in a job of its own, `check-variants`. `pnpm check:registry` checks that two registry builds match and that nothing generated is committed.

```sh
PORTFOLIO_ANALYZE=1 pnpm build && pnpm test:trace && pnpm check:budgets
```

`pnpm check:budgets` holds the variant to its `budgets`, from the build output, `ASSET_MANIFEST`, and the trace: its compiled stylesheet, its image and font files, its own JavaScript on each traced route, the loops, timers, and infinite animations an idle page runs, and every chunk each enhancement's import loads, whole, a library's included. Each breach is a failure record naming the metric, the route, the asset that carries the most of it, the actual, and the limit, in `reports/budgets/budget-report.json`. A budget declared over its tier's ceiling fails too, as does a remote `@import` or `url()` in its stylesheet. CI's `trace` job runs it over every registered variant, beside the budget fixtures.

## Testing a variant

```sh
pnpm exec playwright install chromium   # once
pnpm build
pnpm test:variants                                 # every registered variant
PORTFOLIO_VARIANTS_ONLY=my-id pnpm test:variants   # one, or a comma-separated list
```

The variant specs in `tests/variants/` start the production build once for each registered composition on each contract fixture, under `read-only`, and once on the bundled sample at `/sample`, under `demo`. The fixtures are in `packages/variant-contract/fixtures/`, and `@portfolio/variant-contract/node` exports them as `CONTRACT_FIXTURES`: #4's profession pairs, plus `complete` (every core kind and record type, with media of every kind), `identity-only`, `sparse`, `large` (100 works, 100 photos, and 100 skills), `long-text` (long, non-Latin, and duplicate titles), `missing-media`, `rtl`, and `hidden-canary`. Only `hidden-canary` has a snapshot beside it, `snapshots/github.json`, which the specs hand the server too; every other `github` section shows the profile link alone. The specs mount no media root, so no fixture's asset has a rendition, and every image renders as `Image unavailable`, and a decorative one as nothing. The bundled sample's do: `demo` derives them from `example-media/` once it starts, and the sample specs wait for that before their first check. Each selects `missing-variant`, and the specs select the variant under test. The server's clock starts at 2026-01-01T00:00:00Z and keeps running, from a `NODE_OPTIONS=--import` preload, `tests/harness/fixed-clock.mjs`. Each fixture's sitemap, modified per request, shows that date, and so does every line the sample's server logs, since demo's sitemap lists nothing.

Each fixture runs in six modes: desktop (1440x900), mobile (390x844), no JavaScript, print, failed enhancement, and reduced motion. In every mode the page has one presentation boundary, the variant under test's, and one `h1`, one `main`, and one visitor-control slot; the skip link moves focus to `main`; nothing is wider than the window; every internal link answers; each section's `data-renderer` matches `renderedKinds`, and none is of a kind in `unsupportedKinds`; and the console shows no error. Without JavaScript, in print, and with the enhancements failing (every script chunk blocked while the stylesheets load, then the kit's throw switch, which must fail every enhancement the kit mounts on the page), the `h1`, the navigation, and each section's heading have a box, opacity, and visibility. Print also has nothing fixed or sticky, and under reduced motion nothing runs once the page settles.

The throw-switch run waits for the page to go idle, for up to about 15 s while it stays busy, and then needs the counts to hold for a second. So it catches an enhancement that mounts within about a second of idle, but not one that mounts later. A count of pending mounts for the check to wait on is in #6's backlog. On `complete`, which renders every kind, the kit also has to mount at least one enhancement when the manifest declares one with an empty `requires`, so the check can't pass by counting none. Such a composition renders one on its home page, where it mounts as the page hydrates, with no scrolling or input. One whose only such enhancements live on a path view, or mount once they're scrolled into view, fails the failed-enhancement mode on `complete`. An enhancement that needs a capability lists it in `requires` (headless Chromium may lack `webgl2`), and the floor leaves it out.

`hidden-canary` hides sections, the records, media, practice parts, contact record, and snapshot only they reach, private records and media wherever they're named, and a repository its visible github section excludes, each carrying a marker, which reaches neither the HTML, its JSON-LD, the RSC payload, nor the feed. Its two case studies, a private work's and one only a hidden section reaches, have no page. On every fixture, each case study the sitemap lists renders at `/work/<slug>` with its title as the one h1, without JavaScript, and any other slug answers every method as `/no-such-page` does, as a page and as an RSC request. Render parity compares the boundary in the host's server HTML with a `react-dom/server` render outside Next and a `createRoot` render in a test page, all from one render input at the fixed time, as the tags, text, roles, links, and ids inside it. `snapshotBoundary` and `compareSnapshots`, in `@portfolio/variant-contract/node`, do the comparing.

Desktop and mobile each take a screenshot of the whole page once every image on it has loaded or failed, lazy ones made eager first, attached to the report in `reports/variants/html/`. CI compares them against the baselines in `tests/variants/__screenshots__/`, pixel for pixel, and only in the pinned Playwright image (`PORTFOLIO_SCREENSHOTS=compare`) and for the platform's own `@portfolio/*` packages; a third-party variant gets the assertions alone. #11 sets the thresholds. Baselines come from CI's own run, not from a local one: when one is missing, the variants job writes it, fails, and uploads `tests/variants/__screenshots__/` as its shard's `variants-screenshots-1` or `variants-screenshots-2` artifact, and the new file is committed from there. A change that moves a first-party screenshot deletes its baseline and commits the one that run writes.

## The quality gates

The variant specs check a variant's contract. #11's quality cells check that it stays usable: every registered composition and surface, through axe at WCAG 2.2 AA and the keyboard, focus, occlusion, overlay, hover, reflow, content, enhancement, motion, transparency, and contrast checks, in each viewport and preference row the plan gives it, against a host built with the tier fixture packs.

```sh
pnpm exec playwright install chromium               # once
pnpm quality:pr                                     # the PR set, as CI's quality-pr job runs it
QUALITY_CHANGED_BASE=origin/next pnpm quality:pr    # plus the cells your changes since the merge base direct
pnpm quality:checklist -- my-id                     # the manual checklist for your composition
```

A change under your variant's package runs it against every stable design language (the owner's [37] rule), at every viewport in the default row and in every row at 1440x900, and a change to a pack runs it against every registered variant in the pack sweep, in the rule's five checks at 1440x900. Those cells' failure records name the changed axis, and their messages name the tokens the page's presentation boundaries resolved, with the `resolved-tokens.json` that keeps every one. The complete matrix, `pnpm quality:full`, runs nightly in six shards, and `pnpm quality:release` runs it whole for a release candidate. [CONTRIBUTING.md](../CONTRIBUTING.md#the-quality-cells) has every command and option, and how manual runs are recorded in `quality/manual-runs/`.

## A variant from outside this repository

A variant published on its own ships in this format, which [`tests/external-variant/`](../tests/external-variant/) follows:

- Compiled ESM, its `.d.ts`, `styles.css`, and `manifest.json`. No TypeScript source, no install script, and no file for the host's `public/`.
- `"portfolio": { "kind": "variant", "manifest": "./manifest.json" }` in `package.json`, and exports `.`, `./manifest`, `./styles.css`, `./package.json`, and one subpath per declared enhancement, such as `./enhancements/badge`.
- Peer dependencies on `react`, `react-dom`, `@portfolio/schema`, `@portfolio/variant-contract`, and `@portfolio/kit` (#19 adds `@portfolio/appearance`), so it renders with the host's copies.
- An id that starts with its npm scope: `@acme/reference` is `acme-reference`.

An enhancement module is a client module (`'use client'`) whose default export takes `{ input }`. Only the host's browser registry names it, through its own `import()`, so its chunk loads once a page that renders `<Enhancement id>` has hydrated, never with the page.

Install one with `pnpm --filter @portfolio/web add <package or tarball>` and remove it with `pnpm --filter @portfolio/web remove <package>`. Neither changes anything but `apps/web/package.json` and `pnpm-lock.yaml`. A site that still selects a removed variant renders the fallback composition, with `variant.unavailable`, until the owner selects another.

A content extension package sets `"portfolio": { "kind": "content-extension" }` and default-exports its `defineContentExtension(...)` result from `.`, with its renderers, if any, in `./renderers`. Every page loads `./renderers` in the browser too, so it must be client-safe: a server-only import there breaks `next build`. See [configuration.md](configuration.md).

`pnpm test:external-variant` checks the format end to end, without touching the checkout. It makes a temporary `git worktree` of HEAD, so commit first, and installs it from this checkout's pnpm store; the add and the remove may read package metadata from the registry, which a frozen install never needs. It builds `tests/external-variant/` (`@acme/reference`: evidence rendered bespoke as a ledger, fun facts unsupported, a recommended works slot, a `colophon` path view, a `compact` boolean control, and a `badge` enhancement), packs it, and adds the tarball, after which `git status` shows the dependency and the lockfile alone. After `pnpm build`, registry generation lists it and `check:variants` audits it; the compatibility test runs every registered composition on every contract fixture, and `pnpm config:validate` reports what the manifest earns (`kind.unsupported`, `slot.recommended-empty`, and `direction.unsupported`); the variant specs run for it alone; and its own checks cover the view, the control, and the enhancement's lazy load. Then it removes the package, after which `git status` is clean, rebuilds, and checks that a site selecting it gets the fallback composition, `variant.unavailable`, and degraded readiness. It needs `pnpm install` and Chromium, not a build of the checkout.

## The first-party compositions

Each is a dependency of `@portfolio/web`, so it runs under `test:variants`, `check:budgets`, #11's cells, the profile matrix, and the trace on every pull request. Editorial Evidence and Kinetic Cosmos rebuilt the retired v1 packages on contract 2.0, with their palettes and fonts moving to #19's packs; the v1 copies are gone from the tree, and git history keeps them.

- **Editorial Evidence** (`packages/variant-editorial-evidence`, #13): the platform default, `PLATFORM_DEFAULTS.variant`, and the composition the example site selects. It's `monograph`, `still`, and `light`. It opens with the practice thesis and the signature work on its largest plate, then the flagship works on smaller ones, the proof strip, and the rest of the reading order, with the archive behind a disclosure, and each case study gets its own page.
- **Horizontal Cinema** (`packages/variant-horizontal-cinema`, #17): five finite chapters, Prologue, Origins, Journey, Craft, and Epilogue, each a frame of the portfolio's own media beside its evidence, with a direct link each (`/#chapter-journey`) and an index after them that every chapter reaches in one link. On a wide screen with a fine pointer and no reduced motion the chapters sit side by side in one native horizontal scroller; anywhere else they stack in the page's flow, with the same URLs and controls. A controller on #6's runtime lands the filmstrip, previous and next, the arrow keys, the wheel, a swipe, find, and a direct link on the same five chapters, without cancelling a scroll or writing a history entry per step. In a frame the controller writes no history or hash, though the index's section links stay plain fragment links the browser follows. Without a script every chapter is a plain link. The appearance supplies the dark and the grain. A work's page is the host's shared one. Its [README](../packages/variant-horizontal-cinema/README.md) has the details.
- **Kinetic Cosmos** (`packages/variant-kinetic-cosmos`, #14): an orbital opening, evidence that opens in place, and a chronology in its authored lanes.
- **Obsidian Atelier** (`packages/variant-obsidian-atelier`, #15): a night gallery of chapters. The chapters are the signature and the featured works, or the works sections' works when the owner curated none. Each is a full-bleed room whose treatment follows the work's `medium`, with its premise and artifact in view and the rest of the case behind Unfold the case, a native `details`. A quiet index, each chapter's position, and previous and next are plain fragment links, so nothing needs a script, hover, or motion. The color scheme supplies the dark: it never forces a mode. A work's page is the host's shared one. Its [README](../packages/variant-obsidian-atelier/README.md) has the details.
- **Spatial Bento** (`packages/variant-spatial-bento`, #16): the portfolio as a bento of tiles in content order, with a still of its spatial stage, which a later pull request enhances on capable devices.

## The fallback composition

`packages/fallback-composition` is the host's stand-in and the clone source: every visible section in content order through the kit's shared renderers, in one column, with a navigation list and the visitor control slot in a header. It's `document`, `still`, and `light`, with empty `renderedKinds` and no slots or controls. It renders for a selection no package registers, and for the contract fixtures; a site can't select it. Fixtures select `missing-variant`, an id no package may take, to reach it.

## Visual companion

The variant-developer skill ships a visual companion at `skills/variant-developer/scripts/visual-companion/`:

- **Mockup mode** (an HTTP server and a file watcher) for layout boards and section sketches before code exists.
- **Preview mode** runs the dev server and polls the dev fixture route, `/preview/dev/<id>/<fixture>`, until it answers 200. The route renders one of the contract fixtures (`complete` unless you pass `--fixture <name>`) in the variant, in the preview document and under the preview's headers, the way Studio's preview frame will (#7). `?displayMode=`, `?contrast=more`, `?motion=reduce`, and `?enhancement=off` set its environment, and any other value is a 404. Only `next dev` serves the route: a production build answers it as a path no route matches. The dev server runs under `PORTFOLIO_PROFILE=demo`, so `/sample?variant=<id>` shows the bundled sample too.

```sh
bash skills/variant-developer/scripts/visual-companion/start.sh
bash skills/variant-developer/scripts/visual-companion/start.sh --mode preview --variant <id> [--fixture <name>]
bash skills/variant-developer/scripts/visual-companion/start.sh --mode preview --variant <id> --matrix
```

For screenshots, run the variant specs, as in [Testing a variant](#testing-a-variant); `--matrix` runs them for the one variant.

## What to read next

- AI-assisted variant building: [`skills/variant-developer/SKILL.md`](../skills/variant-developer/SKILL.md)
- System internals: [architecture.md](architecture.md)
- Available section kinds: [authoring.md](authoring.md)
- Both documents, field by field: [configuration.md](configuration.md)
