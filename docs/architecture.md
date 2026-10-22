# Architecture

How the pieces fit together.

## One-paragraph overview

An open-source portfolio platform configured by two documents and its environment. `portfolio.yml` holds the content, `site.yml` holds the presentation and product behavior, and the environment holds the deployment settings and secrets. At startup the Next.js host in `apps/web` checks its deployment settings, reads both documents once, validates them as a pair against `@portfolio/schema` and the variant contract, and renders the portfolio's public view through the site's variant: a composition package registered as a dependency of `@portfolio/web`, or the fallback composition when the selected one isn't. Variants are independent React packages that arrange the content, through `@portfolio/kit`'s shared section renderers or their own; color, type, and display modes are the appearance system's (#19). [configuration.md](configuration.md) documents both documents.

## Data flow

```
┌───────────────────┐
│  config/          │  The portfolio document and the site
│   portfolio.yml   │  document, and beside them the unit's
│   site.yml        │  derived data: snapshots/<kind>.json
│   snapshots/      │  and, from #10's slice 2, media/
└─────────┬─────────┘
          │ read once at startup by the documents adapter (CatalogReader)
          ▼
┌───────────────────┐
│  @portfolio/      │  loadPair: find, read, parse, validate the pair
│   schema          │  readUnitFiles: the snapshots and media document
│                   │  resolvePortfolioView: the published view
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  apps/web         │  buildRenderInput, then the skip link and the
│   page.tsx        │  presentation boundary; layout.tsx sets
│   layout.tsx      │  <html lang dir> and the first paint's theme
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐     ┌──────────────────┐
│  a registered     │ ──> │  packages/kit    │
│   variant, or the │     │  (sections,      │
│   fallback        │     │   enhancements,  │
│   composition     │     │   motion, SEO)   │
└─────────┬─────────┘     └──────────────────┘
          │
          ▼
       Browser
```

## Layers

### `@portfolio/schema`

The contract. Its entry points:

- **`@portfolio/schema`**: the schemas and the pure, browser-safe functions on them.
  - `PortfolioSchema` at `schemaVersion: 3` and `SiteSchema` at `schemaVersion: 2` (`SCHEMA_VERSIONS`). `composeSchemas(extensions)` builds them for a set of content extensions, and `DEFAULT_SCHEMAS` is the set for none. Every object is strict, and any object may carry namespaced `extensions`.
  - The version 3 model (#10): works, evidence, chronology entries, and media assets are records with document-unique ids; the practice and the contact record sit beside them; `signature`, `featured`, `proof`, and `archive` curate them; and the sections list them in reading order. The section union is 14 core kinds discriminated by `kind`, plus `<package name>/<name>` kinds from content extensions. `CORE_SECTION_KINDS` lists the core kinds for the variant contract and the skill drift gates.
  - `parseSource` reads YAML or JSON within the document limits and locates every pointer by line and column. `validatePublicationUnit(unit, ctx)` takes both documents, checks each alone and then the pair against an appearance catalog, the registered extensions, and the canonical origin, and returns `Diagnostic` records. `resolvePortfolioView(pair, unit, { mediaBase, extensions })` makes the published view, the only input visitors' output is built from: it drops hidden sections, private records, every record and asset nothing visible reaches, and unregistered extension data, resolves references, and wraps each derived value, a media asset's renditions or a github section's snapshot, as ready with when it was derived, or unavailable with why. It's pure: no file, no network, no clock.
  - `defineContentExtension`, `applyEdits`, `serialize`, `canonicalize`, `detectDocument`, the URL allowlist, and the secret scan.
- **`@portfolio/schema/node`**: `findPair`, `readPair`, `loadPair`, and `formatRecords`, which read a directory or two files from disk, and `readUnitFiles`, which reads the unit's `snapshots/<kind>.json` and `media/media.json` beside them. It's Node only, and `pnpm check:deps` keeps it to server code, the config command, and tests.
- **`@portfolio/schema/migrate`**: the one-time migration from the old one-file format, which only `pnpm config:migrate` and its tests import.
- **`@portfolio/schema/ids`**: the section id and extension kind rules, free of zod so the kit and the variants can use them.

The schema is the only source of truth. If a doc disagrees, the schema wins.

### `@portfolio/kit`

Things every variant needs but shouldn't reimplement:

- **`@portfolio/kit/sections`**: `renderSection`, the shared, accessible renderer of every core kind, which a variant uses for each kind it doesn't render bespoke, and which renders nothing for a section with nothing public; the pieces they're built from, `WorkEntry`, `EvidenceEntry`, `MediaFigure`, and `CaseStudy`, with the view helpers that find a section's records and a placement's image (`worksOf`, `placedImage`, and the rest); `RichText`, the one markdown path; `seededRandom`; `VisitorControlSlot`; and `registerHostModules`, through which the host hands the kit the registered extension renderers and enhancement loaders. Every text node they render is the owner's, formatted from the owner's data, a snapshot's value with its date, or one of the fixed labels #10 lists.
- **`@portfolio/kit/enhancements`**: `Enhancement`, the client component that loads a variant's declared enhancement in the browser after the page is readable, and renders nothing if it fails.
- **`MotionPolicyProvider`** and **`useMotionPreference`**: the site's motion policy for every component below them. A component's own policy can only add a reduce.
- **`themeInitScript(defaultPreference)`**: paints the starting theme before hydration. `ThemePreference`, `ThemeProvider`, and `useTheme` stay for #19's visitor control; no page wraps a variant in the provider.
- **`fetchGitHubData`**: the server-side GitHub fetcher, which no render uses: a github section renders its snapshot. #10's third slice moves it behind the snapshot adapter, and the variant audit refuses it.
- **`format.ts`**: `formatDate`, `formatPeriod`, `formatDuration`, `formatRelativeTime`, `formatCompactNumber`, `formatList`, `slugify`, and more.
- **`buildStructuredData`**, **`renderRssFeed`**, and **`deriveNavItems`**: JSON-LD, the feed, and the navigation from the published view, each record's `@id`, GUID, and anchor made from its id.
- **Pretext, spatial, spatial-r3f, motion-fx, and markdown**: opt-in submodules for variants that need them.

### `@portfolio/variant-contract`

The variant contract, version 2.0: the manifest's schema and `validateManifest`; `buildRenderInput`, which builds the one `VariantRenderInput` a variant renders from, the same way on the server, in #7's preview frame, and in #9's browser render; controls and their migrations, with `planControlsMigration`, which `pnpm variants:migrate-controls` applies; route helpers; and `compatibilityFor`, the report of how a pair renders in its composition, which `contractValidators` hands to `validatePublicationUnit` as one unit validator. Live, as startup runs it, a finding only warns when something renders in its place. `@portfolio/variant-contract/node` reads the host's dependencies into a registry, #19's packs through the pack checks the host passes it, writes the generated modules and the packs' compiled files, and audits variant source.

### `@portfolio/appearance`

The appearance axes (#19): token contract 1, the `--color-*`, `--ui-*`, and `--type-*` properties packs define; the strict manifests of design-language, color-scheme, and typography packs, with `validatePackManifest`; `createAppearanceRegistry`, over the generated metadata module; `resolveAppearance`, what a boundary renders for the published selection, the visitor's cookie or demo query, the profile, and the environment; `setAxis`, `serializeSelection`, and `parseSelection`; `resolveTokens`, typed values for server code; `validateAppearance`, the unit validator that takes over from the appearance catalog; and the appearance part of the `legacy.document` remediation. Its root entry is browser-safe. `@portfolio/appearance/node` compiles a pack into one stylesheet inside its cascade layer, each starting with `LAYER_ORDER`, builds the platform stylesheet (the `reset`, `utilities`, and `accessibility` layers), and runs the contrast gate; `@portfolio/appearance/generators` holds the browser-safe scheme generators. The fallback packs are workspace packages: `platform-neutral` in `@portfolio/appearance-languages`, `warm-parchment` in `@portfolio/appearance-schemes`, and `humanist-ui` in `@portfolio/appearance-typography`. The test fixture packs are in `packages/appearance-fixtures-*`. The host doesn't render with any of it yet: until #19's host cutover, no page links a pack stylesheet, and startup checks display modes against the interim catalog in `apps/web/src/server/appearance-catalog.ts`.

### Variants

A variant is an isolated package, a dependency of `@portfolio/web`:

- **`manifest.json`**: contract 2.0. The id, the one-sentence promise, the composition family, the motion intent, the performance tier, the kinds it renders bespoke or skips, its routes, controls, content slots, enhancements, text directions, and provenance.
- **The `.` export**: the default component, which takes `{ input: VariantRenderInput }` and renders one `<main id={input.ids.main}>` and one `VisitorControlSlot`, synchronously, from the input alone.
- **The `./styles.css` export**: layout only, every selector under `[data-variant='<id>']`.

`packages/fallback-composition` is the one registered today: every section in content order through the shared renderers. The retired v1 Editorial and Kinetic Cosmos packages sit in `legacy/`, outside the workspace, for #13 and #14 to rebuild. Variants must not reach into other variants, and talk to the host only through the manifest and the render input. [variants.md](variants.md) covers building one.

### `apps/web`

The Next.js host. Responsibilities:

- **Startup**: `src/instrumentation.ts` validates the deployment settings (`src/server/config.ts`, the only code that reads them) and composes the profile before the server takes a request. The `documents.pair` startup requirement reports the pair's records, so the pair is checked once: a blocking record logs a `config.fatal` line and stops the process, and a warning logs a `config.warning` line.
- **`getLive()`**: `src/server/catalog.ts`, the one way pages and metadata routes read the pair. Under `owner` and `read-only` it's the frozen revision the documents adapter (`server/catalog-documents.ts`) loaded from `PORTFOLIO_SOURCE_DIR`; under `next dev` the adapter checks the pair again after each edit. Under `demo` it's the bundled sample pair (`server/catalog-sample.ts`), which never reads a source directory.
- **Public view**: `server/public-view.ts` turns the live unit into the published view, with renditions under `/media`. It's the only input to the page, its metadata and JSON-LD, the feed, and the Open Graph image. Both catalog adapters read the unit's snapshots beside the pair, and a snapshot that doesn't read stops startup with a named record (`snapshot.syntax`, `snapshot.invalid`).
- **Appearance catalog**: `server/appearance-catalog.ts` is the interim catalog until #19: it names the display modes, and leaves the design language, color scheme, and typography unchecked. The contract's validators check the variant (`lib/variants.ts`'s `liveContext()`).
- **Capabilities**: `src/server/capabilities.ts` is the profile matrix: what `owner`, `demo`, and `read-only` may do, as data. `CapabilityPolicy` (`server/policy.ts`) answers from it and builds the server-side navigation.
- **Route table**: `server/routes.ts` maps every route file to a capability. Pages and metadata routes export `servedPage('<pattern>', render)` as their default, and route handlers export each method as `served('<pattern>', handler)`, so a profile that doesn't serve the route gets a 404. `pnpm test` maps every app file to its URL with Next's own helpers and fails on a route file without an entry, on any other export, on a route directory outside `src/app`, and on any `'use server'` directive; the browser suite checks the build's route manifests against the table. `src/proxy.ts` answers 404 early for routes the profile doesn't serve, gives each request a fresh `x-request-id`, and marks a path no route renders as missing.
- **Operations**: Studio queries and commands are entries in `server/operations.ts`, run only through `/api/studio/[name]`. Its dispatcher checks the profile, the session, the origin, the capability, the input, and the version, in that order, under the policy of the stored deployment. The auth provider supplies the session, origin, session-slide, and throttle steps; a handler answers with its output or a `StudioResult` (a status and headers, a 303, or an error from `ERRORS` it declares). `config.status` is the one operation so far.
- **Composition**: `server/composition.ts` builds what the profile needs and runs the named startup requirements. It's the only module that imports `server/owner/`, and only through `import()`: `pnpm check:deps` fails any other importer and any static import from the root itself. Auth providers register as factories that load in the owner branch, owner requirements can load their checks from owner code, and a failing `degraded` requirement starts the server and lists itself in `DeploymentState.degraded`.
- **Logs**: `server/log.ts` writes one JSON object per line on stdout, with allowlisted fields only. Startup logs the redacted `deployment.config` summary once, and `onRequestError` in `src/instrumentation.ts` logs each request error's digest with its request ID.
- **Health and readiness**: `/api/health` is liveness and does no I/O. `/api/ready` reports `server/readiness.ts`'s checks: the catalog, the site's variant (`packs`, `degraded` while the fallback composition renders in place of an unregistered one), and, outside `owner`, that no owner module has loaded.
- **Headers**: `next.config.ts` sets `X-Content-Type-Options`, `Referrer-Policy`, and `Content-Security-Policy: frame-ancestors 'none'` on every route.
- **Variant registry**: `scripts/build-registry.ts` reads `@portfolio/web`'s direct dependencies, checks every variant, content extension, and appearance pack among them, and writes the gitignored `src/lib/generated/` modules: the manifests, a loader per variant, the stylesheets, the extensions' definitions and, in a module of their own, their renderers, the enhancements, the packs with their compiled files, and the packages `next.config.ts` transpiles. Each pack's stylesheet and fonts, and the platform stylesheet, go by content hash into the gitignored `public/_portfolio/pack/`, which holds only what the build registers. `scripts/registry-options.ts` passes the generator #19's pack validator and compiler, so `@portfolio/variant-contract` imports neither, and the fixture gate in `scripts/fixture-gate.ts`, a table from fixture package directories to the flags that admit them: a `portfolio.fixture: true` package registers only when its flag is set, such as `APPEARANCE_FIXTURES=1` for `packages/appearance-fixtures-*`, generation fails on one no row maps and on an unmarked package in a directory a row maps, and a build without the flag fails if one of its ids registers another way. The metadata module's `FIXTURE_FLAGS` says which flags were set. `predev`, `prebuild`, `typecheck`, `test`, and `check:variants` run it; installing doesn't. `lib/variants.ts` reads the manifests, the loaders, and the extensions; `lib/host-modules.ts` registers the extension renderers with the kit on the server, and `lib/host-modules-client.tsx` registers them and the enhancement loaders in the browser. Only the browser names the loaders: `<Enhancement>` loads nothing on the server, and a server module that imported an enhancement would make it a client reference the page loads at once, not after it hydrates. `(site)/layout.tsx` imports the stylesheets.
- **Routing**: public pages sit in the `app/(site)` route group, under its own root layout, and every visitor page goes through `server/visitor-page.ts`, which asks `lib/visitor-routes.ts` what the path is. It runs `dispatch()` against the composition that renders: a view of it renders, a path only another installed variant declares is a 307 to its parent route, and anything else is the 404 page. `app/(site)/page.tsx` is home and `app/(site)/[...view]/page.tsx` the views under it; `app/(site)/work/[slug]/page.tsx` and `app/(site)/work/[slug]/[...view]/page.tsx` are a work and its views, the 404 page until #10 resolves slugs. Under `demo`, `app/(site)/sample/[[...path]]/page.tsx` serves the same routes below `/sample`, in the sample's own selection or the registered variant `?variant=` names, which every link and redirect keeps, and `src/proxy.ts` marks every response `noindex`. `lib/render-composition.tsx` renders the page: a skip link, then the presentation boundary, `<div data-variant data-motion-policy>`, with `data-requested-variant` when the fallback composition stands in, and a path view's canonical link. The root catch-all leaves every first segment the route table owns, and `_next`, to its own route, and the contract reserves each, so no view is shadowed. While `isServable()` is false, `src/proxy.ts` answers visitor pages with a static 503. `app/(site)/not-found.tsx`, and `app/global-not-found.tsx` for a URL no route matches, render inside the live site's boundary; they, `app/(site)/error.tsx`, and `app/global-error.tsx` show generic pages that never print error details. The route table also knows, from the build's manifests and never the live site, which paths name nothing: one no installed variant declares, a work until #10, a placeholder value over 64 characters, a first segment no route answers, or a `?variant=` that names nothing. `src/proxy.ts` sets `x-portfolio-route: missing` on such a request, in place of anything the client sent, and `next.config.ts` rewrites it to Next's `/_not-found` route, which renders the global 404 page from the server with its 404 status. A route spelled with a fixed segment percent-encoded, such as `/%66eed.xml`, answers the same way in every profile: the route table reads it decoded, but Next matches a fixed segment as sent and would hand it to the views catch-all, so `src/proxy.ts` marks a GET or HEAD for it `x-portfolio-not-found`, which `next.config.ts` sends to `/_not-found` before it looks anywhere else, and answers any other method with the plain 404. A missing path that is a route file's own, as sent or decoded whole, such as `/work/[slug]` or `/studio%2Fsign-in`, goes the same way, since Next's file check finds the file before the afterFiles rewrite runs. The rewrite runs after Next looks in `public/`, so a file there is still served, and `server/routes.test.ts` fails on a top-level `public/` name, or a directory the Compose files mount there, that a view could take. The one 404 that still draws in the browser is a view the live variant declares and the site document's `routes` turns off: Next 16 answers a page's `notFound()` with an error document the browser fills in, so without JavaScript that page is empty; the status is 404 either way.
- **`(site)/layout.tsx`**: sets `<html lang dir>` from the portfolio's `locale` and `direction`, injects the pre-hydration theme script with the site's display mode, imports the kit's section styles and every registered variant's stylesheet, and registers the host modules in the browser.
- **SEO**: metadata, JSON-LD, the Open Graph image, `robots.txt`, `sitemap.xml`, and the feed, rendered per request from the public view, with every absolute URL on `PORTFOLIO_ORIGIN`. The feed is off when the site's `features.feed` is `false`.

## Theme resolution

The site's `displayMode` (`system`, `light`, `dark`, or `high-contrast`) is the theme a visit starts in. The layout's `themeInitScript()` sets `data-theme` on `<html>` before React hydrates: the visitor's stored choice, else the site's `displayMode`, with `system` resolved by `prefers-color-scheme`, and `high-contrast` starting at `system` until #19 renders it. No variant renders a theme toggle; #19's visitor control, in each variant's `VisitorControlSlot`, takes that over.

## Drift gates

These scripts enforce parity:

- **`skills/scripts/sync-checks.mjs`** checks that `section-kinds.md` matches `CORE_SECTION_KINDS`, that `kit-catalog.md` mentions every kit export, that `schema.md` mentions every section kind, and that both SKILL.md frontmatters parse and stay under their length caps.
- **`skills/portfolio-author/scripts/validate.mjs`** validates a directory's `portfolio.yml` and `site.yml` the way the server does at startup, and prints each problem with its file, line, column, code, and how to fix it.
- **`pnpm check:variants`** generates the registry and lints every registered variant's source and styles, the kit modules they reach for the clock and randomness rules, and the kit's shared stylesheet for appearance. It's a lint over code the host trusts at build time, not a sandbox. CI runs it in its own `check-variants` job; `pnpm check:registry` checks that two registry builds match, with `APPEARANCE_FIXTURES=1` and without.
- **`pnpm check:appearance`** reads the registry and runs #19's contrast gate over every registered combination of design language, color scheme, typography, and display mode, with the hierarchy check and the layer order of every layered stylesheet. It also registers each known-bad input in `packages/appearance/test/fixtures/` in turn and fails unless the gate fails on each for the reason it names; `--fixture <name>` runs the gate with one of them, such as `bad-contrast`. CI runs it in the `static` job.
- **`pnpm test:variants`** renders every registered composition on every contract fixture (`packages/variant-contract/fixtures/`) and on the bundled sample, in six modes, with the hidden canary and render parity, against the production build. CI's `variants` job compares the platform's own variants' screenshots in the pinned Playwright image.
- **`pnpm test:external-variant`** packs the reference third-party variant in `tests/external-variant/`, installs the tarball in a temporary `git worktree`, runs the variant specs and its own checks, and removes it, with `git status` showing no host edit after the add and nothing after the remove.

Run them with `pnpm check:skills`, `pnpm check:variants`, `pnpm check:appearance`, `pnpm test:variants`, `pnpm test:external-variant`, and the per-script test suites listed in [CONTRIBUTING.md](../CONTRIBUTING.md#checks). [docs/variants.md](variants.md#testing-a-variant) has the details.

## Skills

Two AI-agent skills under `skills/`:

- **`portfolio-author`** guides an agent to build the portfolio and site documents from any source (a resume PDF, a LinkedIn export, a GitHub username, a conversation). The agent loads references on demand: the schema, curation principles, quality rules, the section-kinds catalog, and examples.
- **`variant-developer`** guides an agent to build a new composition from concept to ship. It walks through DESIGN.md, the manifest, renderers, layout CSS, and `pnpm check:variants`, with a visual companion (an HTTP server and file watcher in mockup mode, the dev server on the bundled sample in preview mode), and `pnpm test:variants` for screenshots in every mode.

Both skills enforce drift parity through the gates above. See [skills/](../skills/) for the SKILL.md files and references.

## Why this shape

- **Documents, not code.** Content authors don't touch code, and code authors don't touch content.
- **Content apart from presentation apart from deployment.** The portfolio document is portable between sites, the site document is how one site presents it, and the environment is one deployment's settings and secrets. A presentation change never edits content, and neither document can carry a secret.
- **Profession-neutral sections plus extensions.** The core kinds don't assume a profession, and a profession package adds its own fields and kinds under its namespace without weakening the core checks.
- **One clean break.** The old one-file format has no compatibility reader. `pnpm config:migrate` converts it once, and startup refuses it.
- **Variants are packages, not configs.** That encourages real diversity of composition and lets variants pull in heavy dependencies (Three.js, R3F) without burdening the rest. Installing one is a dependency, and nothing else.
- **Composition apart from appearance.** A variant arranges; the appearance system (#19) colors, sets type, and shapes. An owner can pair any composition with any appearance.
- **Kit, not framework.** Variants opt into the utilities they need. The kit grows when patterns repeat across variants, not preemptively.
- **Drift gates over conventions.** Automated checks beat documentation as instructions for keeping the schema, the references, and the skills aligned.
