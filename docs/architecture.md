# Architecture

How the pieces fit together.

## One-paragraph overview

A single `portfolio.yml` in the deployment's source directory (`config/` in a checkout) drives everything. At startup the Next.js host in `apps/web` checks its deployment settings, reads that file once, validates it against the Zod schema in `@portfolio/schema`, and renders it through the active variant from `packages/variant-*`. Variants are independent React packages that consume `@portfolio/kit` for shared utilities (theming, GitHub fetcher, formatters) and decide everything visual on their own.

## Data flow

```
┌───────────────────┐
│  config/          │  Author's content
│   portfolio.yml   │
└─────────┬─────────┘
          │ read once at startup (CatalogReader)
          ▼
┌───────────────────┐
│  @portfolio/      │  Zod parse + validate
│   schema          │  → typed Portfolio object
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  apps/web         │  Next.js route reads Portfolio
│   layout.tsx      │  Wraps in <ThemeProvider supportedThemes={…}>
│   [...].tsx       │  Renders the active variant component
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐     ┌──────────────────┐
│  packages/        │ ──> │  packages/kit    │
│   variant-*       │     │  (theme, github, │
│  (manifest +      │     │   format, SEO,   │
│   React tree)     │     │   primitives)    │
└─────────┬─────────┘     └──────────────────┘
          │
          ▼
       Browser
```

## Layers

### `@portfolio/schema`

The contract. Defines:

- **`PortfolioSchema`** — top-level shape: `identity`, `variant`, `theme`, `motionPreference`, `colorScheme`, `typography`, `links`, `sections`, `meta`.
- **`SectionSchema`** — discriminated union of 28 section kinds, each with a `kind` literal and a fixed shape.
- **Enums** — `ThemePreferenceSchema` (`light | dark | bright | black | system`), `MotionPreferenceSchema` (`respect-os | reduce | full`).
- **`ALL_SECTION_KINDS`** — exported tuple used by the audit script and variant manifests.

The schema is the only source of truth. If a doc disagrees, the schema wins.

### `@portfolio/kit`

Things every variant needs but shouldn't reimplement:

- **`ThemeProvider`** + **`useTheme`** — hydration-safe theme provider with `resolveTheme(preference, supported, systemMatch)` for variant-aware fallback (`bright→light`, `black→dark` when not supported).
- **`fetchGitHubData`** — server-side GitHub fetcher. Unauthenticated REST by default, which is what public pages get; GraphQL (with the contribution calendar) only for a caller that passes a token. Returns pinned repos, recently-active repos, language breakdown, total stars.
- **`format.ts`** — `formatDate`, `formatPeriod`, `formatDuration`, `formatRelativeTime`, `formatCompactNumber`, `formatList`, `slugify`, etc.
- **`SectionFrame`** + **`FallbackSection`** — primitives variants compose to render unfamiliar sections.
- **`buildStructuredData`** — JSON-LD generation for SEO from the portfolio.
- **`tokens.ts`** — CSS custom property names exposed by ThemeProvider.
- **Pretext / spatial / spatial-r3f / markdown** — opt-in submodules for variants that need them.

### `packages/variant-*`

A variant is an isolated package shipping:

- **`manifest.ts`** — `VariantManifest` with `slug`, `themes`, `colorSchemes`, `typographyPresets`, `supportedKinds`, `aesthetic`, `motion`, `density`, `capabilities`.
- **`variant.tsx`** — the default-exported React component that receives `{ portfolio, colorScheme?, typography? }`.
- **`section.tsx`** — dispatches each `Section` to a renderer based on `kind`.
- **`renderers/<kind>.tsx`** — one per supported kind (or routed through `FallbackSection`).
- **`styles.css`** — scoped via `[data-variant='<slug>']` and overridden via `[data-color-scheme='<id>']`, `[data-typography='<id>']`, `[data-theme='<value>']`.

Variants must NOT reach into other variants. They communicate with the host only via the manifest contract.

### `apps/web`

The Next.js host. Responsibilities:

- **Startup** — `src/instrumentation.ts` validates the deployment settings (`src/server/config.ts`, the only code that reads them) and builds the catalog reader before the server takes a request. Any fatal finding logs a `config.fatal` line and stops the process.
- **`getLive()`** — `src/server/catalog.ts`, the one way pages and metadata routes read the portfolio: the frozen revision the documents adapter loaded from `PORTFOLIO_SOURCE_DIR` at startup.
- **Capabilities** — `src/server/capabilities.ts` is the profile matrix: what `owner`, `demo`, and `read-only` may do, as data. `CapabilityPolicy` (`server/policy.ts`) answers from it and builds the server-side navigation.
- **Route table** — `server/routes.ts` maps every route file to a capability. Pages and metadata routes call `requireServed()` with their own pattern, and route handlers return `notServed()`'s 404; `pnpm test` fails on a route file without an entry or its guard, and on any `'use server'` module. `src/proxy.ts` answers 404 early for routes the profile doesn't serve and gives each request a fresh `x-request-id`.
- **Operations** — Studio queries and commands are entries in `server/operations.ts`, run only through `/api/studio/[name]`. Its dispatcher checks the profile, the session, the origin, the capability, the input, and the version, in that order. `config.status` is the one operation so far.
- **Composition** — `server/composition.ts` builds what the profile needs and runs the named startup requirements later issues implement. It's the only module that imports `server/owner/`, through `import()`, and `pnpm check:deps` fails any other.
- **Variant registry** — `scripts/build-registry.mjs` scans `packages/variant-*` at build time and generates `src/lib/registry.generated.ts` mapping slug → component.
- **Routing** — `app/page.tsx` renders the active variant. `app/not-found.tsx`, `app/error.tsx`, and `app/global-error.tsx` show generic pages that never print error details.
- **`layout.tsx`** — wraps everything in `<ThemeProvider supportedThemes={editorialManifest.themes}>` and injects the pre-hydration theme init script.
- **SEO** — generates metadata, JSON-LD, OG image, robots.txt, sitemap.xml, and the feed from the portfolio per request, with every absolute URL on `PORTFOLIO_ORIGIN`.

## Theme resolution

`ThemePreferenceSchema` has 5 values. Only 4 are concrete render targets; `system` is a resolver:

| Preference | Variant declared it? | `data-theme` attribute                       |
| ---------- | -------------------- | -------------------------------------------- |
| `light`    | always (mandatory)   | `light`                                      |
| `dark`     | always (mandatory)   | `dark`                                       |
| `bright`   | yes                  | `bright`                                     |
| `bright`   | no                   | `light` (fallback)                           |
| `black`    | yes                  | `black`                                      |
| `black`    | no                   | `dark` (fallback)                            |
| `system`   | n/a                  | `light` or `dark` per `prefers-color-scheme` |

The `THEME_INIT_SCRIPT` runs before React hydration to set `data-theme` on `<html>`. Bright/black are conservatively painted as light/dark pre-hydration, then swapped in if the variant supports them.

## Drift gates

Three scripts under `skills/scripts/` and `skills/<skill>/scripts/` enforce parity:

- **`skills/scripts/sync-checks.mjs`** — checks `section-kinds.md` matches `ALL_SECTION_KINDS`, `kit-catalog.md` mentions every kit export, `schema.md` mentions every section kind, both SKILL.md frontmatters parse and stay under length caps.
- **`skills/portfolio-author/scripts/validate.mjs`** — Zod-parses any `portfolio.yml` and reports YAML line/col on failure.
- **`skills/variant-developer/scripts/audit.mjs`** — checks variant manifests against the schema (every required kind handled), warns on suspicious patterns (only one color scheme, themes claimed without CSS).

Run them with `pnpm check:skills` and the per-script test suites listed in [CONTRIBUTING.md](../CONTRIBUTING.md#drift-gates).

## Skills

Two AI-agent skills under `skills/`:

- **`portfolio-author`** — guides an agent to build `portfolio.yml` from any source (resume PDF, LinkedIn export, GitHub username, conversation). The agent loads references on demand: schema, curation principles, quality rules, section-kinds catalog, examples.
- **`variant-developer`** — guides an agent to build a new variant from concept to ship. Walks through DESIGN.md → manifest → renderers → CSS → audit, with a visual companion (HTTP server + file watcher in mockup mode, Playwright matrix screenshots in preview mode).

Both skills enforce drift parity through the gates above. See [skills/](../skills/) for the SKILL.md and references.

## Why this shape

- **YAML-driven** — content authors don't touch code. Code authors don't touch content.
- **Discriminated union for sections** — adding a new section kind is one schema entry plus a renderer per variant. The compiler enforces every variant handles every kind.
- **Variants are packages, not configs** — encourages real visual diversity; lets variants pull in heavy dependencies (Three.js, R3F) without polluting the base.
- **Kit, not framework** — variants opt into utilities they need. The kit grows when patterns repeat across variants, not preemptively.
- **Drift gates over conventions** — automated checks beat documentation-as-instructions for keeping the schema, refs, and skills aligned.
