# Architecture

How the pieces fit together.

## One-paragraph overview

A single `portfolio.yml` at the repo root drives everything. The Next.js host in `apps/web` reads that file at request time, validates it against the Zod schema in `@portfolio/schema`, and renders it through the active variant from `packages/variant-*`. Variants are independent React packages that consume `@portfolio/kit` for shared utilities (theming, GitHub fetcher, formatters) and decide everything visual on their own.

## Data flow

```
┌───────────────────┐
│  portfolio.yml    │  Author's content
└─────────┬─────────┘
          │ loadPortfolio()
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
- **`fetchGitHubData`** — server-side GitHub fetcher with GraphQL primary + REST fallback. Returns pinned repos, recently-active repos, contribution calendar, language breakdown, total stars.
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

- **`loadPortfolio()`** — reads `portfolio.yml`, validates, returns the typed `Portfolio`.
- **Variant registry** — `scripts/build-registry.mjs` scans `packages/variant-*` at build time and generates `src/lib/registry.generated.ts` mapping slug → component.
- **Routing** — `app/page.tsx` renders the active variant, `app/[variant]/page.tsx` is the variant picker preview.
- **`layout.tsx`** — wraps everything in `<ThemeProvider supportedThemes={editorialManifest.themes}>` and injects the pre-hydration theme init script.
- **SEO** — generates metadata, JSON-LD, OG image, robots.txt, sitemap.xml from the portfolio.

## Theme resolution

`ThemePreferenceSchema` has 5 values. Only 4 are concrete render targets; `system` is a resolver:

| Preference | Variant declared it? | `data-theme` attribute |
|---|---|---|
| `light` | always (mandatory) | `light` |
| `dark` | always (mandatory) | `dark` |
| `bright` | yes | `bright` |
| `bright` | no | `light` (fallback) |
| `black` | yes | `black` |
| `black` | no | `dark` (fallback) |
| `system` | n/a | `light` or `dark` per `prefers-color-scheme` |

The `THEME_INIT_SCRIPT` runs before React hydration to set `data-theme` on `<html>`. Bright/black are conservatively painted as light/dark pre-hydration, then swapped in if the variant supports them.

## Drift gates

Three scripts under `docs/skills/scripts/` and `docs/skills/<skill>/scripts/` enforce parity:

- **`docs/skills/scripts/sync-checks.mjs`** — checks `section-kinds.md` matches `ALL_SECTION_KINDS`, `kit-catalog.md` mentions every kit export, `schema.md` mentions every section kind, both SKILL.md frontmatters parse and stay under length caps.
- **`docs/skills/portfolio-author/scripts/validate.mjs`** — Zod-parses any `portfolio.yml` and reports YAML line/col on failure.
- **`docs/skills/variant-developer/scripts/audit.mjs`** — checks variant manifests against the schema (every required kind handled), warns on suspicious patterns (only one color scheme, themes claimed without CSS).

Run them with `pnpm check:skills` and the per-script test suites listed in [CONTRIBUTING.md](../CONTRIBUTING.md#drift-gates).

## Skills

Two AI-agent skills under `docs/skills/`:

- **`portfolio-author`** — guides an agent to build `portfolio.yml` from any source (resume PDF, LinkedIn export, GitHub username, conversation). The agent loads references on demand: schema, curation principles, quality rules, section-kinds catalog, examples.
- **`variant-developer`** — guides an agent to build a new variant from concept to ship. Walks through DESIGN.md → manifest → renderers → CSS → audit, with a visual companion (HTTP server + file watcher in mockup mode, Playwright matrix screenshots in preview mode).

Both skills enforce drift parity through the gates above. See [docs/skills/](skills/) for the SKILL.md and references.

## Why this shape

- **YAML-driven** — content authors don't touch code. Code authors don't touch content.
- **Discriminated union for sections** — adding a new section kind is one schema entry plus a renderer per variant. The compiler enforces every variant handles every kind.
- **Variants are packages, not configs** — encourages real visual diversity; lets variants pull in heavy dependencies (Three.js, R3F) without polluting the base.
- **Kit, not framework** — variants opt into utilities they need. The kit grows when patterns repeat across variants, not preemptively.
- **Drift gates over conventions** — automated checks beat documentation-as-instructions for keeping the schema, refs, and skills aligned.
