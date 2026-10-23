---
name: variant-developer
description: >
  Build a new variant for the keyurgolani.name self-hostable portfolio platform. A variant is a
  composition: how the portfolio's sections are arranged, navigated, and revealed. Use when a user
  wants to create, design, or scaffold a variant package (packages/variant-<id>), committing to
  one composition idea, rendering every section kind the schema defines through bespoke renderers
  or the kit's shared ones, and using @portfolio/kit instead of reinventing helpers. Trigger when
  the user mentions creating a variant, cloning the fallback composition, designing a new
  portfolio layout, or porting a retired variant from legacy/. Do NOT trigger for editing
  portfolio data (use portfolio-author), for color, type, or display-mode work (the appearance
  system, #19), or for general React or CSS work outside this monorepo.
license: MIT
compatibility: >
  Designed for the keyurgolani/portfolio monorepo. Requires write access to packages/,
  pnpm, Node 22+. Visual companion mockup-mode requires a browser; preview-mode requires
  the apps/web dev server running.
metadata:
  version: '2.0.0'
---

## 1. What a variant is

The platform renders a portfolio from two documents: `config/portfolio.yml` holds the content, and `config/site.yml` presents it. `site.yml`'s `appearance.variant` names the variant, and its other appearance fields (design language, color scheme, typography, display mode) belong to the appearance system (#19).

A variant owns **composition only**: which sections go where, how a visitor moves between them, what reveals itself and when, and what a section looks like structurally. Color, type, materials, geometry, interaction states, and motion timing come from #19's appearance axes. A variant ships no palette, no font, no theme, and no theme toggle.

The contract (version 2.0, `@portfolio/variant-contract`):

- **`manifest.json`** at the package root declares the variant: id, name, one-sentence promise, composition family, motion intent, performance tier, the kinds it renders bespoke, its routes, controls, content slots, enhancements, text directions, and provenance. `package.json` points at it with `"portfolio": { "kind": "variant", "manifest": "./manifest.json" }`. See `references/manifest-contract.md`.
- **The default export** of the package's `.` entry is a component that takes `{ input: VariantRenderInput }`: the visible content (no hidden section, no unregistered extension data), the presentation settings, control values, the route, ids, and a fixed time and seed. It renders synchronously from that input alone.
- **`./styles.css`**, an export registry generation compiles into one stylesheet, inside #19's `variant-layout` layer, and the host links only on the pages that render the variant. Every selector sits under `[data-variant='<id>']`. `package.json` declares `"sideEffects": false`, as the scaffold's does.

Installing a variant is a dependency of `@portfolio/web` and nothing else: `pnpm --filter @portfolio/web add @portfolio/variant-<id>@workspace:*`. `apps/web/scripts/build-registry.ts` (run by `predev`, `prebuild`, `typecheck`, `test`, and `check:variants`) checks every variant among the host's direct dependencies and writes the gitignored `apps/web/src/lib/generated/` modules the host imports. A package it can't register stops the build with a diagnostic naming the package, the file, the pointer, and the fix.

When the site selects a variant this build doesn't register, the host renders the **fallback composition** in its place, marks the boundary with `data-requested-variant`, warns `variant.unavailable` at startup and in `config.status`, and reports readiness as degraded. Visitors see no label.

Reference packages:

- **`packages/fallback-composition`**: the clone source and the smallest correct composition: every section in content order through the kit's shared renderers, one `<main>`, one visitor control slot. Read it before scaffolding.
- **`packages/kit`**: `@portfolio/kit/sections` (`renderSection`, the shared renderers, `RichText`, `seededRandom`, `VisitorControlSlot`) and `@portfolio/kit/enhancements` (`Enhancement`), plus layout primitives and hooks. Use it. If you find yourself rewriting a helper that could live there, hoist it.
- **`legacy/`**: the retired v1 Editorial package, outside the workspace, for #13 to port. Read it for ideas and inventory; never import it. Its themes, color schemes, and typography presets moved to #19.
- **`packages/variant-kinetic-cosmos`**: a port of v1 Kinetic Cosmos (#14), the first registered composition: bespoke renderers for three kinds, the rest shared, #19's Dialog and Disclosure, and the kit's `threadLanes`.

## 2. What the host does around a variant

- It renders the document boundary, `<div data-appearance-boundary="document" data-variant="<id>" data-motion="..." ...>`, with its skip link to `#<input.ids.main>` first and your component inside. #19's tokens apply at the boundary, and your stylesheet's `[data-variant='<id>']` rules start there. Don't render `data-variant` yourself.
- Your component renders exactly one `<main id={input.ids.main}>` and exactly one `<VisitorControlSlot />`, at your manifest's `visitorControl.placement`.
- The host owns the routes: `/`, `/sample` under the demo profile, and the 404 page, which renders inside the boundary too. Your manifest's `routes` says whether home and work are bespoke or shared, and declares any views.
- Every DOM id you render starts with `input.ids.prefix`, so a host page and a preview frame can share a document. A section's id is `${input.ids.prefix}${section.id}`; `renderSection` does this for you.

## 3. The pipeline (4 phases when porting, 3 when greenfield)

Every variant goes through these phases in order. Skipping or reordering produces incoherent output.

- **Phase 0: Reference inventory** (when porting a `legacy/` package, another platform, a Figma, or "make it look like X"). Read the reference end to end, list every component and signature interaction, diff the data shape against the schema, and decide what's composition (yours), what's appearance (#19's), and what's not portable. Output drives DESIGN.md. Skip only when greenfield.
- **Phase 1: Design contract.** Pick one composition idea. Write `packages/variant-<id>/DESIGN.md`. Get the user to approve it. No code yet.
- **Phase 2: Implementation in waves.** Wave 1 is foundation (scaffold, manifest, layout styles, every section through the shared renderers). Wave 1.5 is kit hoists. Wave 2 is bespoke renderers, one cluster at a time. Wave 3 is polish (navigation, controls, content slots, enhancements, right-to-left).
- **Phase 3: Pre-merge audit.** Scripted gates (`pnpm check:variants`, typecheck, lint, build, the motion contract, kit-dedup) and visual gates. See `references/audit-checklist.md` and `references/quality-gates.md`.

**Do not skip Phase 1.** A variant commits to one composition idea and carries it through layout, navigation, reveal, and copy. You can't get that by writing CSS first and explaining it later.

**Do not skip Phase 0 when porting.** The biggest source of rework is treating the reference as new design freedom while the user treats it as a fidelity requirement. Front-load the inventory, and say early which of the reference's looks become #19's appearance packs rather than the variant's.

## 3.5 Phase 0: Reference inventory (port-only)

When the user says "port Editorial", "make it look like archive page0", or "match this Figma", run Phase 0 before Phase 1.

1. Read the reference end to end. Every section file, every primitive, every helper. Note line counts: a 5,000-line reference and a planned 1,200-line port drops most of its richness; decide whether that's intended.
2. Build a **component inventory** (primitive, what it does, hoist-worthy, plan).
3. Build a **signature interactions inventory** (parallax, tilt, expand-on-click, typing animation, counters): the things that define the feel.
4. Build a **data-shape diff** against `@portfolio/schema`. For every lost field, decide: inferable, composed from several kinds, or not portable (dropped with a reason).
5. Sort the reference's look: structure and arrangement stay in the variant; palettes, fonts, and theme modes go to #19. Record each in the manifest's `provenance.sources` with its disposition (`preserved`, `folded-into-pack`, `reused-interaction`, `retired`).
6. Write `## Component inventory`, `## Signature interactions`, and `## Fidelity targets` in DESIGN.md. The fidelity targets become Phase 3 sign-off boxes.

Load `references/fidelity-comparison.md` for the recipe.

## 4. Phase 1: Design contract

1. Pick one composition idea, in one specific sentence: _"a printed monograph spread, read in order"_, _"a terminal session log"_, _"a museum wall caption beside each work"_. Not _"modern and clean"_. It becomes the manifest's `promise`, and every later choice points back to it.
2. Copy `assets/DESIGN.template.md` into `packages/variant-<id>/DESIGN.md` and fill every section. Where one doesn't apply, write _"N/A: <reason>"_.
3. Get the user to approve `DESIGN.md` before touching code.

Load when:

- `references/design-contract.md`: at the start of Phase 1, for what each section of DESIGN.md must contain.
- `references/coherence.md`: when translating the idea into layout, navigation, reveal, and motion intent.
- `references/manifest-contract.md`: when filling DESIGN.md's manifest summary. The manifest is part of the design.

Phase 1 is when the visual companion's mockup mode helps most: the user can see the composition before approving it. See section 7.

## 5. Phase 2: Implementation in waves

Finish each wave before starting the next.

### Wave 1: Foundation

Stand up a renderable variant with every section through the shared renderers. The goal is "every route renders, in the right structure", not "finished".

- Scaffold: `pnpm new-variant <id>`. It copies `packages/fallback-composition` to `packages/variant-<id>`, renames the package to `@portfolio/variant-<id>`, sets the manifest's id and name, swaps the fallback's `fc-` classes for a prefix of the id's own (never `fc`, `pf`, or `host`), adds the package to `@portfolio/web` with `pnpm --filter @portfolio/web add`, and runs `pnpm check:variants --package @portfolio/variant-<id>`.
- Edit `manifest.json` to match DESIGN.md: `promise`, `description`, `compositionFamily`, `motionIntent`, `performanceTier`, `routes`, `visitorControl.placement`, `textDirection`, and `provenance`. Leave `renderedKinds` empty until Wave 2.
- Write `src/styles.css`: layout only. Spacing, arrangement, grid, and structure, every selector under `[data-variant='<id>']`, logical properties throughout. Everything else reads #19's tokens: colors from `var(--color-*)`, borders, radii, shadows, and timing from `var(--ui-*)`, and text through `data-type-role` in the markup or `var(--type-*)` in a rule. Your own custom properties are `--layout-*` alone. No theme blocks, no rule keyed on a pack's attribute, and no raw color, font, radius, or shadow: the audit refuses one. Render actions, surfaces, disclosures, and badges with the shared primitives from `@portfolio/appearance/primitives`, and leave their styling to the packs. Load `references/styling-conventions.md` and `references/common-bugs.md` while writing it; `docs/appearance.md` is the contract behind them.
- Verify (Gate A): `scripts/visual-companion/start.sh --mode preview --variant <id>`, then open `/preview/dev/<id>/complete`, the `complete` contract fixture in the preview document. A 404 means the build doesn't register it: run `pnpm check:variants --package @portfolio/variant-<id>` and read the diagnostic.

### Wave 1.5: Kit hoists (when porting)

Before writing renderers, hoist the reusable patterns Phase 0 found, so Wave 2 consumes kit primitives and `kit-dedup` runs clean as you go.

| Pattern                                                                        | Hoist when                                                                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Pure data utilities (lane assignment, classifiers, projections, path builders) | Always. They're testable, generic, and likely reused.                                                              |
| Motion hooks (scroll-tied effects, mouse tilt, viewport-center predicates)     | When one is broadly useful. Put it under `@portfolio/kit/motion-fx`, so still variants don't bundle framer-motion. |
| Generic React components (typing animation, animated counter, lightbox)        | When the component composes data and behavior the same way every variant would.                                    |
| Brand and data registries (social platform lookups, language lookups)          | When the lookup is data, not visual style.                                                                         |
| Composition-level JSX                                                          | Stays in the variant. Different compositions arrange differently.                                                  |

1. List candidates in DESIGN.md's `## Component inventory` "Hoist plan" column.
2. Implement each as a kit module under the right subpath.
3. Test pure utilities (`tsx --test`); they're load-bearing.
4. Add every new export to `references/kit-catalog.md`. `node skills/scripts/sync-checks.mjs` enforces it.
5. Run `pnpm typecheck` and the kit's tests.

### Wave 2: Bespoke renderers

Render bespoke one cluster at a time, so the idea stays consistent within a cluster.

For each cluster:

1. Load `references/kit-catalog.md` and `references/section-kinds.md`: what the kit already does, and what each kind carries.
2. Write the renderers, `SectionRenderer` components that take `{ section, input, level }`.
3. Add each kind to the manifest's `renderedKinds` and its renderer to the map you pass `renderSection(section, input, renderers, { level })`. The two must agree: a kind in one and not the other throws.
4. A kind your composition deliberately doesn't show goes in `unsupportedKinds`, and DESIGN.md says why. Prefer the shared renderer: the visitor still gets the content.
5. Run `node skills/variant-developer/scripts/kit-dedup.mjs packages/variant-<id>` and resolve each candidate by hoisting it, or by a `// LOCAL: <reason>` comment.
6. **Visual checkpoint.** Look at `/preview/dev/<id>/complete`, then `sparse`, `large`, and `long-text` (`--fixture <name>`). HTTP 200 isn't proof. The fixtures are made up; Gate H's real data finds what they hide.

Renderer reminders:

- **Render defensively.** Every renderer handles optional fields left out and blank strings. Return `null` rather than an empty shell. The view drops a section with nothing public, so a records section always has records.
- **Read records through the kit.** A works, evidence, or chronology section lists record ids: `worksOf(section, input)`, `evidenceOf`, and `chronologyOf` give its visible records in order, and `recordAnchor` the id for each one's anchor. An image is a placement: `placedMedia(placement, ctx)` resolves it with its caption and details, and `MediaFigure` renders it, as its labeled box until it has a rendition.
- **Write no words of your own.** Every heading, label, and alt text comes from the document, formatted, or is one of #10's fixed labels, which the kit's renderers already use: no `Projects` heading for an untitled section, no `View project` link, no alt text for a decorative image.
- **Render from the input alone, synchronously.** No `async` component, no fetch, no storage, no environment, no code run from a string. Use `input.env.now` for the time and `seededRandom(input.env.seed)` for anything random-looking. `pnpm check:variants` refuses the rest.
- **Markdown goes through `RichText`.** Never `dangerouslySetInnerHTML`.
- **Slugify any synthesized SVG id** referenced by `url(#id)`, and start it with `input.ids.prefix`. (`references/common-bugs.md` §3)
- **A client component gets only what it renders**, never the whole input, so the rest stays out of the page payload. Enhancements are the exception: `<Enhancement input={input} id="..." />` from `@portfolio/kit/enhancements`.

The clusters:

- **Identity**: `hero`, `lede`, `now`, `contact`, `cta`.
- **Body of work**: `works`, a section of work records of any medium, and `evidence`, of evidence records of any type: metrics, testimonials, publications, talks, awards, press, and the rest. A work with a case study renders through `CaseStudy`.
- **Chronology**: `chronology`, roles, studies, projects, events, and milestones, each in its thread.
- **Practice**: `practice`, one part of the practice per section: the thesis, skills, tools, or services. `focus` and `fun-facts` stay short lists.
- **Voice and the rest**: `quote`, `custom`, and `github`, which renders the section's snapshot from `input.derived`, never a fetch.

### Wave 3: Polish

- **Navigation.** Pick the affordance that fits the idea: a table of contents, a sidebar, an overlay, marginalia. Link only sections that render. A link to a section is `#${input.ids.prefix}${section.id}`, and a link to a route, a view included, is `routeHref(input, target)` from `@portfolio/variant-contract`, so it works below `/sample` and #7's preview prefix too.
- **Controls and content slots.** Owner-tunable choices (a hero layout, a featured project) are manifest `controls`, read from `input.controls`. Places the composition needs content are `contentSlots`, with what happens when they're empty.
- **Enhancements.** Optional client islands, declared in the manifest's `enhancements` with their `requires` (such as `webgl2` or `motion-allowed`). The page must read completely without them. Reserve their space in the layout. If any has an empty `requires`, the home page renders one of those, where it mounts as the page hydrates, with no scrolling or input: the failed-enhancement mode expects the kit to mount one on the `complete` fixture, so a composition whose only such enhancements live on a path view, or mount once scrolled into view, fails it. One that needs a capability lists it in `requires`, and that check leaves it out.
- **Motion.** `motionIntent` says how much the composition moves. Under reduced motion, from the OS setting (which wins over every other), the site's `reduce` policy, a visitor's pause, or a preview, nothing runs at load, after a jump, or as the page scrolls, no `requestAnimationFrame` loop keeps going, and links jump; short opacity and color feedback stays. CSS takes its timing and movement from the boundary's `--ui-motion-*` and state tokens and stops motion of its own wherever the boundary's `data-motion` isn't `full`, never with a universal `!important` kill switch (`references/styling-conventions.md`). CSS rules don't reach script motion: run it on `@portfolio/kit/runtime` inside a `MotionPolicyProvider` fed `input.presentation.motionPolicy`, with `useEnhancementRuntime()`, frames through `useFrameLoop()`, and inline CSS animation through `runtimeAnimation()`, so it holds still under reduced motion and pauses with the page. `tests/e2e/motion-contract.spec.ts` and `pnpm quality:pr`'s reduced-motion row check every registered composition. (`references/common-bugs.md` §8)
- **Right to left.** With `"textDirection": ["ltr", "rtl"]`, every property is logical (`margin-inline-start`, `inset-inline-end`, `text-align: start`); the audit refuses the physical ones. Check an Arabic pair, such as the schema's `pairs/mixed` fixture.
- **Mobile sweep.** 375×667 and 430×932: no horizontal overflow, decoration hidden, navigation collapsed. (`references/quality-gates.md` Gate I)

## 6. Phase 3: Pre-merge audit

Run `references/audit-checklist.md` for the scripted gates and `references/quality-gates.md` for the visual ones. Both are required.

### Scripted gates

1. `pnpm check:variants --package @portfolio/variant-<id>` exits 0: the registry registers it, and the source audit finds nothing. Either way it checks the kit modules the variant reaches and the kit's shared stylesheet; without `--package` it checks every registered variant.
2. `pnpm typecheck` passes for the whole workspace.
3. `pnpm exec eslint packages/variant-<id>` passes.
4. `pnpm build` succeeds. The host build is the integration test. Then `pnpm check:appearance` exits 0: its appearance source audit finds no color, font, `@import`, shadow, radius, blur, or timing of the variant's own (`references/styling-conventions.md`).
5. `pnpm exec playwright test tests/e2e/motion-contract.spec.ts` passes for your composition.
6. `node skills/variant-developer/scripts/kit-dedup.mjs packages/variant-<id>`: every candidate hoisted or marked `// LOCAL: <reason>`.
7. `pnpm --filter @portfolio/kit test`, if you hoisted.
8. `node skills/scripts/sync-checks.mjs`: kit-catalog and schema parity.
9. `PORTFOLIO_VARIANTS_ONLY=<id> pnpm test:variants` passes, after `pnpm build`: every contract fixture and the bundled sample in six modes (desktop, mobile, no JavaScript, print, failed enhancement, reduced motion), the hidden canary, and render parity. Screenshots of each fixture at desktop and mobile are in `reports/variants/html/`.

The source audit's rules, each with its own code:

| Code                      | Refuses                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `audit.async-component`   | An `async` component: by name, as a default export, or wrapped in `memo()`. An async event handler is fine.                                                                                      |
| `audit.server-module`     | A Node built-in, `server-only`, `next`, `@portfolio/core`, or `process.getBuiltinModule()`.                                                                                                      |
| `audit.environment`       | `process`, however it's reached.                                                                                                                                                                 |
| `audit.network`           | `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `WebTransport`, `navigator.sendBeacon`, and an import from a URL.                                                                         |
| `audit.github-fetch`      | The kit's `fetchGitHubData`. GitHub data is the github section's snapshot in `input.derived`: read it with `githubSnapshot`.                                                                     |
| `audit.storage`           | `document.cookie`, `cookieStore`, `localStorage`, `sessionStorage`, `indexedDB`, and `caches`.                                                                                                   |
| `audit.clock`             | `Date.now()`, `Date()`, `new Date()` with no argument, `performance.now()`, and a date format's `format()` with no date.                                                                         |
| `audit.random`            | `Math.random()`, `crypto.getRandomValues()`, and `crypto.randomUUID()`.                                                                                                                          |
| `audit.dynamic-code`      | `eval`, `Function`, and a timer given a string.                                                                                                                                                  |
| `audit.dynamic-import`    | `import()` or `require()` of anything but a literal.                                                                                                                                             |
| `audit.global-access`     | A global reached in a way the audit can't follow: a computed key, or the global object passed around.                                                                                            |
| `audit.inner-html`        | `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML()`, and `document.write()`.                                                                                             |
| `audit.raw-element`       | A `<style>`, `<link>`, or `<script>`, in JSX or from `createElement()`.                                                                                                                          |
| `audit.css-import`        | Importing CSS from a module. The `./styles.css` export is the one stylesheet.                                                                                                                    |
| `audit.client-input`      | A `'use client'` component that takes `VariantRenderInput`, `PublicView`, a whole portfolio, or a prop named `input`, unless it's an enhancement. A `Pick<>` of one, or a single field, is fine. |
| `audit.css-unscoped`      | A selector that doesn't start with `[data-variant='<id>']`, or reaches its siblings with `+` or `~`, nested rules included.                                                                      |
| `audit.css-keyframes`     | Keyframes not named `<id>` or `<id>-*`.                                                                                                                                                          |
| `audit.css-remote-import` | An `@import` of a remote stylesheet.                                                                                                                                                             |
| `audit.css-bare-import`   | An `@import` of anything but your own files, by relative path.                                                                                                                                   |
| `audit.css-remote-url`    | A `url()` on another host.                                                                                                                                                                       |
| `audit.css-appearance`    | A raw color, `font-family`, `font`, radius, or shadow, rather than a `var(--...)` token.                                                                                                         |
| `audit.css-physical`      | A physical property or shorthand, such as `margin-left`, in a variant that declares `rtl`.                                                                                                       |

It's a lint over code the host already trusts, not a sandbox: a variant installs with full server trust, and a determined package can get past any syntax check. It follows a global through an alias, a destructuring, or a string key, and refuses what it can't follow.

### Visual gates

- **Gate A: Visual sanity.** `/preview/dev/<id>/complete` renders your structure.
- **Gate B: Content matrix.** The sample, a sparse pair, and a dense pair. Structure holds at each.
- **Gate C: Reduced motion.** The motion contract, plus the programmatic checks for anything it can't see, such as a canvas.
- **Gate D: Print preview.** Navigation and decoration hidden, content in reading order.
- **Gate G: Fidelity against the reference** (port-only). Every DESIGN.md fidelity target checked or dropped with a reason.
- **Gate H: Real data.** The user's own pair: long names, missing optional fields, non-ASCII text, and right to left.
- **Gate I: Mobile sweep.** 375×667 and 430×932.

**Failures are not warnings.** A variant that ships with a failing gate is broken.

## 7. Visual companion

A browser tool for showing the user layout boards and section sketches in Phase 1, then live renders in Phases 2 and 3. **It is off by default** and token-intensive. Don't launch it without the user's consent.

### The offer (its own message, nothing else in it)

> Some of this work might be easier to discuss visually. I can spin up a local browser companion: layout boards and section sketches now (mockup-mode), live renders later (preview-mode). The companion is token-intensive, so I won't launch it without your OK. Want to use it?

Wait for an explicit yes. Without one, work in the terminal; the skill works fully without the companion.

### After consent, decide per question

Would the user understand this better by seeing it than reading it? Layout comparisons and section sketches: the browser. Conceptual choices and requirements: the terminal.

### Modes

- **Mockup-mode** (Phase 1, before code). `scripts/visual-companion/start.sh --mode mockup --project-dir <repo-root>`. You write HTML fragments to the watched directory; the user's clicks land in `state_dir/events`.
- **Preview-mode** (Phases 2 and 3). `scripts/visual-companion/start.sh --mode preview --variant <id>` runs the dev server and polls `/preview/dev/<id>/complete` until it answers 200: the `complete` contract fixture in the preview document, under the preview's headers. `--fixture <name>` picks another fixture, and `?displayMode=dark`, `?contrast=more`, `?motion=reduce`, or `?enhancement=off` sets the environment. `/sample?variant=<id>` still shows the bundled sample. For screenshots in every mode, `--matrix` runs `PORTFOLIO_VARIANTS_ONLY=<id> pnpm test:variants`.

See `references/visual-companion.md`.

## 8. Gotchas

For the full catalog with reproductions and fixes, load `references/common-bugs.md`.

### Registry

- A 404 at `/preview/dev/<id>/complete` or `/sample?variant=<id>` means the build doesn't register the id. Run `pnpm check:variants --package @portfolio/variant-<id>`; it says why.
- The registry is generated, not committed. `pnpm dev` and `pnpm build` regenerate it; after adding or removing a dependency mid-session, or editing your stylesheet, run `pnpm --filter @portfolio/web build:registry`.
- The id `fallback`, the five composition ids (#13 to #17), and `missing-variant` are reserved. A package outside `@portfolio` starts its id with its scope: `@acme/ocean` is `acme-ocean`.

### CSS

- Your stylesheet loads only on the pages that render you, but a page can show another variant's boundary beside yours, such as #19's plates. A selector without `[data-variant='<id>']` restyles someone else's composition, and so does a page-wide at-rule such as `@font-face` or `@page`; the audit refuses both.
- Layout only. A color, font, or theme block in a variant fights #19's tokens; read `var(--color-*)`, `var(--ui-*)`, and `var(--type-*)` instead, and define only `--layout-*`.
- Quiet text is `var(--color-text-secondary)` or `--color-text-muted`, never a lower `opacity`.
- A rule keyed on `[data-color-scheme]`, `[data-design-language]`, `[data-typography]`, or `[data-display-mode]` makes the composition depend on a pack. Lay out the same under every one.
- Don't restyle a primitive's `[data-ui-slot]` parts: the design language owns them. Arrange the primitive by its `className`.
- No `@import` from another host, and no CSS imported from modules.
- BEM-style classes with a short prefix of your own (`fc-` is the fallback's).

### Ids

- Don't use single-word ids (`top`, `main`, `home`) for layout tricks. A hero's id is often `top`, and `main` is `input.ids.main`. (`common-bugs.md` §4)
- Slugify any synthesized SVG id, and prefix it. (`common-bugs.md` §3)

### Determinism

- The same input renders the same markup on the server, in #7's preview frame, and in #9's browser render. No clock, no randomness, no network, no storage, no environment.

### Motion and performance

- The boundary's motion tokens stop CSS movement under every reduced-motion source, and a variant's own keyframes stop under `[data-variant='<id>']:is([data-motion='reduced'], [data-motion='static'])`; a `prefers-reduced-motion` query or a universal `!important` kill switch in variant CSS is wrong. Script motion runs on `@portfolio/kit/runtime`: `useEnhancementRuntime()` and `useFrameLoop()`. (`references/styling-conventions.md`, `common-bugs.md` §8)
- `@portfolio/kit/spatial-r3f` is heavy: only with a `medium` or `heavy` tier and a reason, and better as an enhancement.
- `@portfolio/kit/motion-fx` needs `framer-motion`, an optional peer: list it in your own dependencies when you import the subpath.
- `next.config.ts` has `reactStrictMode: false` because R3F survives WebGL context loss only without strict double-mount. Don't change it from a variant.

### Layout

- With a fixed header, give every section `scroll-margin-block-start` so anchor jumps don't bury headings. (`common-bugs.md` §6)
- Decorative elements `display: none` at mobile widths rather than shrink. (`common-bugs.md` §9)

## 9. Hand-off

When every gate passes:

- Push `DESIGN.md` with the package, on the same branch as the PR.
- Tell the user how to see it: `scripts/visual-companion/start.sh --mode preview --variant <id>`, then `/preview/dev/<id>/complete`, or `/sample?variant=<id>` for the bundled sample. To render their own portfolio in it, they set `appearance.variant` in `config/site.yml`.
- Don't run `pnpm dev` for them unless they ask.

## 10. Reference docs, in reading order

| Phase               | Reference                           | Why                                                    |
| ------------------- | ----------------------------------- | ------------------------------------------------------ |
| Phase 0 (port-only) | `references/fidelity-comparison.md` | Inventory recipe before opening DESIGN.md.             |
| Phase 1             | `references/design-contract.md`     | What each section of DESIGN.md must contain.           |
| Phase 1             | `references/coherence.md`           | The idea, carried through layout, navigation, motion.  |
| Phase 1             | `references/manifest-contract.md`   | Every manifest field, valid values, examples.          |
| Phase 2 Wave 1      | `references/styling-conventions.md` | Layers, tokens, primitives, scope, logical properties. |
| Phase 2 Wave 1      | `references/common-bugs.md`         | Bug catalog. Read once before writing styles.css.      |
| Phase 2 Wave 1.5    | `references/kit-catalog.md`         | What's already in the kit.                             |
| Phase 2 Wave 2      | `references/section-kinds.md`       | Per-kind data shape, edge cases, ideal data.           |
| Phase 2 Wave 3      | `references/quality-gates.md`       | Visual validation recipes.                             |
| Phase 3             | `references/audit-checklist.md`     | Sign-off contract.                                     |
| Visual companion    | `references/visual-companion.md`    | Mockup-mode and preview-mode guide.                    |

## 11. What makes a port land

Each item exists because skipping it cost an iteration:

1. **Inventory before DESIGN.md when porting.** A scaffold that compiles isn't a port.
2. **Sort composition from appearance early.** A palette or a font isn't the variant's to keep; say so in Phase 0, and record it in `provenance`.
3. **Hoist before renderers.** Renderers then consume kit primitives directly.
4. **Look at it before declaring Wave 1 done.** "HTTP 200 and typecheck pass" isn't "it renders correctly".
5. **Real data alongside the sample.** Long names, missing optional fields, and non-ASCII text break what the sample hides.
6. **Programmatic reduced-motion checks.** The motion contract, not one look at the OS toggle.
7. **Sign off against the user's own pair.** That's what they see on launch.
