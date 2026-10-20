# Features

What the platform can do today.

## Content model

- **YAML-driven content.** Edit `config/portfolio.yml` for the content and `config/site.yml` for how it looks and which sections show; never touch code to change either.
- **28 section kinds** spanning narrative, dated entries, lists, visual, voice, accent, personal, external, and connection categories. See [authoring.md](authoring.md#section-kind-quick-reference).
- **Schema validation.** Zod-typed source of truth. Typos in `kind` discriminants fail loudly via the `validate.mjs` script, and the server refuses to start on an invalid document, naming its file, line, and column.
- **Loose date strings.** `period: { start: "Jan 2024", end: "present" }` is fine — humans read this output, not parsers. ISO dates work too.
- **Markdown in prose fields.** `lede.body`, `experience.items[].highlights[]`, etc. honor a curated subset of Markdown.
- **External assets via `apps/web/public/`.** Resume PDFs, avatar images, gallery photos all reference `/path` and resolve to `apps/web/public/path`.

## Visual system

- **Pluggable variants.** Each variant is a workspace package. A deployment renders Editorial until the site document picks one; under the `demo` profile, `/sample?variant=<slug>` renders the bundled sample in any of them.
- **Variant registry built at install/build time.** New variants are auto-discovered.
- **Per-variant color schemes.** Editorial ships 3 (warm, noir, ink-and-paper). Variants are encouraged to ship multiple.
- **Per-variant typography presets.** Editorial ships 2 (classic, modernist). Same encouragement.
- **5 theme modes:**
  - `light` — standard light mode.
  - `dark` — standard dark mode.
  - `bright` — pushed past light: paper-white, intensified accent saturation, sharp contrast.
  - `black` — pushed past dark: AMOLED-friendly, minimal mid-tones.
  - `system` — follows the OS `prefers-color-scheme` (resolves to `light` or `dark`).
- **Variant-aware fallback.** If you set `theme: bright` on a variant that doesn't support it, the resolver falls back to `light`. Same for `black → dark`.
- **Visitor toggle.** Editorial's 5-segment toggle filters by `manifest.themes`; only modes the active variant supports render as buttons. `system` is always available.
- **Motion preferences.** `respect-os` (follow `prefers-reduced-motion`), `reduce` (always reduce), `full` (always animate). Provider injects the preference; variants honor it via media queries.

## GitHub integration

- **Live data fetched server-side.** No client-side API calls.
- **Unauthenticated REST.** Public pages never send a token, so requests count against GitHub's 60 an hour per server address.
- **Pinned repositories.** Up to 6 of your top-starred repos (REST has no pinned list), with descriptions, stars, forks, primary language.
- **Recently-active repositories.** Configurable list (1–20, default 10) sorted by last push, excluding forks. Renders below pinned with relative timestamps ("3d ago").
- **Contribution heatmap.** 53-week calendar with per-day contribution counts. Needs GraphQL and a token, so public pages don't show it.
- **Language breakdown.** Optional bar + legend showing language share across repos.
- **Featured repos.** Pin specific repos by name even if they're not GitHub-pinned.
- **Excluded repos.** Suppress specific repos from all GitHub-section views.
- **Per-request memoization + 1-hour revalidation.** Multiple sections that read GitHub share one fetch.

## Editorial variant (the first variant)

- **3 color schemes:** Warm Sienna (default), Noir (high-contrast monochrome with electric blue), Ink & Paper (cool gray, deep teal).
- **2 typography presets:** Editorial Classic (Fraunces + Source Serif 4), Modernist (Inter Display + Source Serif 4).
- **4 theme modes** (light/dark/bright/black) plus system.
- **Print stylesheet** — `Cmd/Ctrl + P` produces a resume-ready printable page.
- **RSS feed** at `/feed.xml` if writings/publications/episodes are present.
- **Sticky table of contents** when a portfolio has 2+ sections.
- **Skip-to-content link** for keyboard navigation.
- **Server-rendered reading time** on long-form sections.
- **Structured data (JSON-LD)** for Person, ProfilePage.

## SEO

- **Metadata** generated from `identity` + `meta` fields (title, description, OG, Twitter Card).
- **Open Graph image** generated dynamically from the first three sections.
- **`/robots.txt` and `/sitemap.xml`** generated server-side, per request.
- **Absolute URLs** (Open Graph, sitemap, robots.txt, feed, JSON-LD) on `PORTFOLIO_ORIGIN`, the deployment's canonical origin.
- **`<html lang="en">`** by default (override via your variant if needed).

## Skills (AI-assisted authoring + development)

Two skills under [skills/](../skills/):

- **`portfolio-author`** — guides an AI agent to extract details from any source (resume PDF, LinkedIn export, GitHub username, conversation) and produce a valid `portfolio.yml`. Includes references for schema, curation, quality rules, section kinds, and three real-world examples (engineer, photographer, writer).
- **`variant-developer`** — guides an AI agent through the full variant build: design contract → manifest → renderers → CSS → audit. Includes a visual companion (HTTP server + Playwright matrix screenshots), a 56-name kit catalog, manifest contract reference, styling conventions, coherence rules, and an audit checklist.

Both skills are usable in any harness that supports skills (Claude Code, Copilot CLI, Cursor, Codex, etc.) — they're harness-agnostic.

## Drift gates

Three scripts keep the system honest:

- **`pnpm check:skills`** — verifies `section-kinds.md` matches the schema's `ALL_SECTION_KINDS`, `kit-catalog.md` mentions every export from `@portfolio/kit`, `schema.md` mentions every section kind, and both SKILL.md frontmatters parse and stay under length caps.
- **`validate.mjs`** — validates a directory's portfolio and site documents together and reports each problem's file, line, and column.
- **`audit.mjs`** — checks variant manifests against the schema (every required kind handled), warns on suspicious patterns (single color scheme, themes claimed without CSS).

## Developer ergonomics

- **TDD-friendly.** Schema, kit helpers, and audit scripts all have `node:test` test suites. Run with `tsx --test`.
- **Type-safe.** Discriminated unions on `kind` mean adding a section kind is a single schema entry plus a renderer per variant. The compiler enforces every variant handles every kind.
- **Small kit, focused submodules.** `@portfolio/kit/github`, `@portfolio/kit/seo`, etc. so variants only pull in what they need.
- **Visual companion in two modes.** Mockup mode (no Next.js needed) for fast prototyping. Preview mode (Playwright) for matrix screenshots.

## Roadmap (deferred / not yet shipped)

- Choosing a deployment's variant, color scheme, and typography preset, and toggles for visitors (today every deployment renders Editorial's defaults).
- More variants (currently editorial is the only one).
- CI/CD workflow templates.

If you want a feature that isn't shipped, open an issue — small additions ship fast.
