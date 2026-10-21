# Architecture

How the pieces fit together.

## One-paragraph overview

An open-source portfolio platform configured by two documents and its environment. `portfolio.yml` holds the content, `site.yml` holds the presentation and product behavior, and the environment holds the deployment settings and secrets. At startup the Next.js host in `apps/web` checks its deployment settings, reads both documents once, validates them as a pair against `@portfolio/schema`, and renders the portfolio's public view through the site's variant from `packages/variant-*`. Variants are independent React packages that use `@portfolio/kit` for shared utilities (theming, motion, the GitHub fetcher, formatters, SEO) and decide everything visual on their own. [configuration.md](configuration.md) documents both documents.

## Data flow

```
┌───────────────────┐
│  config/          │  The portfolio document
│   portfolio.yml   │  and the site document
│   site.yml        │
└─────────┬─────────┘
          │ read once at startup by the documents adapter (CatalogReader)
          ▼
┌───────────────────┐
│  @portfolio/      │  loadPair: find, read, parse, validate the pair
│   schema          │  toPublicView: drop hidden sections and
│                   │  unregistered extension data
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  apps/web         │  page.tsx renders the site's appearance
│   page.tsx        │  layout.tsx sets <html lang dir> and the
│   layout.tsx      │  first paint's theme; SEO from the public view
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐     ┌──────────────────┐
│  packages/        │ ──> │  packages/kit    │
│   variant-*       │     │  (theme, motion, │
│  (manifest +      │     │   github, format,│
│   React tree)     │     │   SEO, spatial)  │
└─────────┬─────────┘     └──────────────────┘
          │
          ▼
       Browser
```

## Layers

### `@portfolio/schema`

The contract. Its entry points:

- **`@portfolio/schema`**: the schemas and the pure, browser-safe functions on them.
  - `PortfolioSchema` and `SiteSchema`, both at `schemaVersion: 2`. `composeSchemas(extensions)` builds them for a set of content extensions, and `DEFAULT_SCHEMAS` is the set for none. Every object is strict, and any object may carry namespaced `extensions`.
  - The section union: 28 core kinds discriminated by `kind`, plus `<package name>/<name>` kinds from content extensions. `ALL_SECTION_KINDS` lists the core kinds for the audit script and the skill drift gates.
  - `parseSource` reads YAML or JSON within the document limits and locates every pointer by line and column. `validatePublicationUnit(unit, ctx)` takes both documents, checks each alone and then the pair against an appearance catalog, the registered extensions, and the canonical origin, and returns `Diagnostic` records. `toPublicView(pair, ctx)` drops hidden sections and unregistered extension data, so it's the only input visitors' output is built from.
  - `defineContentExtension`, `applyEdits`, `serialize`, `canonicalize`, `detectDocument`, the URL allowlist, and the secret scan.
- **`@portfolio/schema/node`**: `findPair`, `readPair`, `loadPair`, and `formatRecords`, which read a directory or two files from disk. It's Node only, and `pnpm check:deps` keeps it to server code, the config command, and tests.
- **`@portfolio/schema/migrate`**: the one-time migration from the old one-file format, which only `pnpm config:migrate` and its tests import.
- **`@portfolio/schema/ids`**: the section id and extension kind rules, free of zod so the kit and the variants can use them.

The schema is the only source of truth. If a doc disagrees, the schema wins.

### `@portfolio/kit`

Things every variant needs but shouldn't reimplement:

- **`ThemeProvider`** and **`useTheme`**: a hydration-safe theme provider, with `resolveTheme(preference, supported, systemMatch)` for variant-aware fallback (`bright` to `light`, `black` to `dark` where the variant doesn't declare them). `themeInitScript(defaultPreference)` paints the starting theme before hydration.
- **`MotionPolicyProvider`** and **`useMotionPreference`**: the site's motion policy for every component below a variant's root. A component's own policy can only add a reduce.
- **`fetchGitHubData`**: the server-side GitHub fetcher. Public pages get unauthenticated REST; GraphQL, with the contribution calendar, needs a caller that passes a token. It returns pinned repos, recently active repos, the language breakdown, and total stars.
- **`format.ts`**: `formatDate`, `formatPeriod`, `formatDuration`, `formatRelativeTime`, `formatCompactNumber`, `formatList`, `slugify`, and more.
- **`FallbackSection`**: a generic renderer for any core kind a variant doesn't support.
- **`buildStructuredData`**: JSON-LD for SEO from the public portfolio.
- **`tokens.ts`**: the CSS custom property names the theme exposes.
- **Pretext, spatial, spatial-r3f, motion-fx, and markdown**: opt-in submodules for variants that need them.

### `packages/variant-*`

A variant is an isolated package shipping:

- **`manifest.ts`**: a `VariantManifest` with `slug`, `themes`, `colorSchemes`, `typographyPresets`, `supportedKinds`, `aesthetic`, `motion`, `density`, and `capabilities`.
- **`variant.tsx`**: the default-exported React component. It receives `VariantProps`: the public `portfolio`, and the site's `colorScheme`, `typography`, and `motionPolicy`.
- **`section.tsx`**: dispatches each section to a renderer by `kind`. Extension sections render nothing yet.
- **`renderers/<kind>.tsx`**: one per supported kind, or routed through `FallbackSection`.
- **`styles.css`**: scoped by `[data-variant='<slug>']` and varied by `[data-color-scheme='<id>']`, `[data-typography='<id>']`, `[data-theme='<value>']`, and `[data-motion-policy='reduce']`.

Variants must not reach into other variants. They talk to the host only through the manifest and `VariantProps`.

### `apps/web`

The Next.js host. Responsibilities:

- **Startup**: `src/instrumentation.ts` validates the deployment settings (`src/server/config.ts`, the only code that reads them) and composes the profile before the server takes a request. The `documents.pair` startup requirement reports the pair's records, so the pair is checked once: a blocking record logs a `config.fatal` line and stops the process, and a warning logs a `config.warning` line.
- **`getLive()`**: `src/server/catalog.ts`, the one way pages and metadata routes read the pair. Under `owner` and `read-only` it's the frozen revision the documents adapter (`server/catalog-documents.ts`) loaded from `PORTFOLIO_SOURCE_DIR`; under `next dev` the adapter checks the pair again after each edit. Under `demo` it's the bundled sample pair (`server/catalog-sample.ts`), which never reads a source directory.
- **Public view**: `server/public-view.ts` turns the live pair into what visitors may see. It's the only input to the page, its metadata and JSON-LD, the feed, and the Open Graph image.
- **Appearance catalog**: `server/appearance-catalog.ts` builds the ids startup checks the site's appearance against from the registered variants' manifests.
- **Capabilities**: `src/server/capabilities.ts` is the profile matrix: what `owner`, `demo`, and `read-only` may do, as data. `CapabilityPolicy` (`server/policy.ts`) answers from it and builds the server-side navigation.
- **Route table**: `server/routes.ts` maps every route file to a capability. Pages and metadata routes export `servedPage('<pattern>', render)` as their default, and route handlers export each method as `served('<pattern>', handler)`, so a profile that doesn't serve the route gets a 404. `pnpm test` maps every app file to its URL with Next's own helpers and fails on a route file without an entry, on any other export, on a route directory outside `src/app`, and on any `'use server'` directive; the browser suite checks the build's route manifests against the table. `src/proxy.ts` answers 404 early for routes the profile doesn't serve and gives each request a fresh `x-request-id`.
- **Operations**: Studio queries and commands are entries in `server/operations.ts`, run only through `/api/studio/[name]`. Its dispatcher checks the profile, the session, the origin, the capability, the input, and the version, in that order, under the policy of the stored deployment. The auth provider supplies the session, origin, session-slide, and throttle steps; a handler answers with its output or a `StudioResult` (a status and headers, a 303, or an error from `ERRORS` it declares). `config.status` is the one operation so far.
- **Composition**: `server/composition.ts` builds what the profile needs and runs the named startup requirements. It's the only module that imports `server/owner/`, and only through `import()`: `pnpm check:deps` fails any other importer and any static import from the root itself. Auth providers register as factories that load in the owner branch, owner requirements can load their checks from owner code, and a failing `degraded` requirement starts the server and lists itself in `DeploymentState.degraded`.
- **Logs**: `server/log.ts` writes one JSON object per line on stdout, with allowlisted fields only. Startup logs the redacted `deployment.config` summary once, and `onRequestError` in `src/instrumentation.ts` logs each request error's digest with its request ID.
- **Health and readiness**: `/api/health` is liveness and does no I/O. `/api/ready` reports `server/readiness.ts`'s checks: the catalog, the site's variant, and, outside `owner`, that no owner module has loaded.
- **Headers**: `next.config.ts` sets `X-Content-Type-Options`, `Referrer-Policy`, and `Content-Security-Policy: frame-ancestors 'none'` on every route.
- **Variant registry**: `scripts/build-registry.mjs` scans `packages/variant-*` at build time and generates `src/lib/registry.generated.ts`, mapping each slug to its manifest and component.
- **Routing**: `app/page.tsx` renders the site's variant with its color scheme, typography, display mode, and motion policy. Under `demo`, `app/sample/page.tsx` starts from the sample site's appearance and overrides what its query names, and `src/proxy.ts` marks every response `noindex`. `app/not-found.tsx`, `app/error.tsx`, and `app/global-error.tsx` show generic pages that never print error details.
- **`layout.tsx`**: sets `<html lang dir>` from the portfolio's `locale` and `direction`, and injects the pre-hydration theme script with the site's display mode. Each page wraps its variant in a `ThemeProvider` fed that variant's themes (`lib/variant-tree.tsx`).
- **SEO**: metadata, JSON-LD, the Open Graph image, `robots.txt`, `sitemap.xml`, and the feed, rendered per request from the public view, with every absolute URL on `PORTFOLIO_ORIGIN`. The feed is off when the site's `features.feed` is `false`.

## Theme resolution

The site's `displayMode` (`system`, `light`, or `dark`) is the theme a visit starts in. The variants' theme toggles let a visitor pick from the kit's five preferences, which the kit stores in the browser. Only four are render targets; `system` is a resolver:

| Preference | Variant declared it? | `data-theme` attribute                       |
| ---------- | -------------------- | -------------------------------------------- |
| `light`    | always (mandatory)   | `light`                                      |
| `dark`     | always (mandatory)   | `dark`                                       |
| `bright`   | yes                  | `bright`                                     |
| `bright`   | no                   | `light` (fallback)                           |
| `black`    | yes                  | `black`                                      |
| `black`    | no                   | `dark` (fallback)                            |
| `system`   | n/a                  | `light` or `dark` per `prefers-color-scheme` |

The layout's `themeInitScript()` sets `data-theme` on `<html>` before React hydrates: the visitor's stored choice, else the site's `displayMode`. Bright and black paint as light and dark until the provider knows whether the variant supports them.

## Drift gates

Three scripts under `skills/scripts/` and `skills/<skill>/scripts/` enforce parity:

- **`skills/scripts/sync-checks.mjs`** checks that `section-kinds.md` matches `ALL_SECTION_KINDS`, that `kit-catalog.md` mentions every kit export, that `schema.md` mentions every section kind, and that both SKILL.md frontmatters parse and stay under their length caps.
- **`skills/portfolio-author/scripts/validate.mjs`** validates a directory's `portfolio.yml` and `site.yml` the way the server does at startup, and prints each problem with its file, line, column, code, and how to fix it.
- **`skills/variant-developer/scripts/audit.mjs`** checks variant manifests against the schema (every required kind handled) and warns on suspicious patterns (only one color scheme, themes claimed without CSS).

Run them with `pnpm check:skills` and the per-script test suites listed in [CONTRIBUTING.md](../CONTRIBUTING.md#checks).

## Skills

Two AI-agent skills under `skills/`:

- **`portfolio-author`** guides an agent to build the portfolio and site documents from any source (a resume PDF, a LinkedIn export, a GitHub username, a conversation). The agent loads references on demand: the schema, curation principles, quality rules, the section-kinds catalog, and examples.
- **`variant-developer`** guides an agent to build a new variant from concept to ship. It walks through DESIGN.md, the manifest, renderers, CSS, and the audit, with a visual companion (an HTTP server and file watcher in mockup mode, Playwright matrix screenshots in preview mode).

Both skills enforce drift parity through the gates above. See [skills/](../skills/) for the SKILL.md files and references.

## Why this shape

- **Documents, not code.** Content authors don't touch code, and code authors don't touch content.
- **Content apart from presentation apart from deployment.** The portfolio document is portable between sites, the site document is how one site presents it, and the environment is one deployment's settings and secrets. A presentation change never edits content, and neither document can carry a secret.
- **Profession-neutral sections plus extensions.** The core kinds don't assume a profession, and a profession package adds its own fields and kinds under its namespace without weakening the core checks.
- **One clean break.** The old one-file format has no compatibility reader. `pnpm config:migrate` converts it once, and startup refuses it.
- **Variants are packages, not configs.** That encourages real visual diversity and lets variants pull in heavy dependencies (Three.js, R3F) without burdening the rest.
- **Kit, not framework.** Variants opt into the utilities they need. The kit grows when patterns repeat across variants, not preemptively.
- **Drift gates over conventions.** Automated checks beat documentation as instructions for keeping the schema, the references, and the skills aligned.
