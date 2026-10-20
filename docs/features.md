# Features

What the platform can do today.

## Content model

- **Two documents.** `config/portfolio.yml` holds the content, and `config/site.yml` how it looks and which sections show. Deployment settings and secrets stay in the environment. You never touch code to change either document. [configuration.md](configuration.md) is the reference.
- **YAML or JSON.** Each document can be either, and both parse to the same typed model.
- **28 profession-neutral section kinds** spanning narrative, dated entries, lists, media, voice, accents, personal notes, external work, and contact. See [authoring.md](authoring.md#section-kind-quick-reference).
- **Content extensions.** A profession package adds namespaced fields and section kinds of its own. Data from a package the build doesn't register is kept as written, warned about, and never shown to visitors.
- **Stable section ids.** Every section has an `id`, its anchor and its key in the site document.
- **Hidden sections.** The site document hides a section without deleting it from the portfolio.
- **Strict validation.** Unknown keys fail with a did-you-mean hint, URLs are checked against an allowlist, and secret-shaped strings are refused. Each problem is a record with a code, the file, the line and column, and how to fix it, from `pnpm config:validate`, the `validate.mjs` script, or the server at startup.
- **Cross-document checks.** Broken anchors and references, duplicate ids, contradictory or repeated metrics, links to sample or stale origins, and appearance ids this build doesn't register.
- **One-time migration.** `pnpm config:migrate` converts the old one-file format into the pair, with a dry run and a diff before it writes anything.
- **Loose date strings.** `period: { start: "Jan 2024", end: "present" }` is fine, since people read this output, not parsers. ISO dates work too.
- **Markdown in prose fields.** `lede.body`, `experience.items[].highlights[]`, and others honor a curated subset of Markdown.
- **External assets via `apps/web/public/`.** Resume PDFs, avatar images, and gallery photos reference `/path`, which resolves to `apps/web/public/path`.

## Visual system

- **Independent appearance axes.** The site document picks the variant (the composition), the design language, the color scheme, and the typography preset, plus the display mode a visit starts in.
- **Per-axis visitor controls.** `visitorControls` marks each appearance field `locked` or `selectable`. This release checks the policy; the visitor pickers come later.
- **Pluggable variants.** Each variant is a workspace package. Editorial and Kinetic Cosmos ship today.
- **Variant registry built at install and build time.** New variants are discovered on their own.
- **Per-variant color schemes.** Editorial ships 3 (warm, noir, ink-and-paper), and Kinetic Cosmos 3 (nebula, aurora, solar).
- **Per-variant typography presets.** Editorial ships 2 (classic, modernist), and Kinetic Cosmos 2 (geometric, humanist).
- **Display mode.** `system` follows the visitor's `prefers-color-scheme`; `light` and `dark` pin one. The page paints it before hydration, so there's no flash of the wrong theme.
- **Visitor theme toggle.** Both variants offer the kit's five themes:
  - `light`: standard light mode.
  - `dark`: standard dark mode.
  - `bright`: paper-white, with intensified accent saturation and sharp contrast.
  - `black`: AMOLED-friendly, with minimal mid-tones.
  - `system`: follows the OS `prefers-color-scheme`, resolving to `light` or `dark`.
- **Variant-aware fallback.** A visitor's `bright` on a variant that doesn't declare it falls back to `light`, and `black` to `dark`.
- **Motion policy.** `respect-os` follows each visitor's `prefers-reduced-motion`, and `reduce` reduces motion for everyone: no entrance animation, nothing that repeats, and section links jump instead of scrolling.

## GitHub integration

- **Live data fetched server-side.** No client-side API calls.
- **Unauthenticated REST.** Public pages never send a token, so requests count against GitHub's 60 an hour per server address.
- **Pinned repositories.** Up to 6 of your top-starred repos (REST has no pinned list), with descriptions, stars, forks, and primary language.
- **Recently active repositories.** A configurable list (1 to 20, default 10) sorted by last push, excluding forks. It renders below the pinned list with relative timestamps ("3d ago").
- **Contribution heatmap.** A 53-week calendar with per-day contribution counts. It needs GraphQL and a token, so public pages don't show it.
- **Language breakdown.** An optional bar and legend showing the language share across repos.
- **Featured repos.** Pin specific repos by name even if they're not GitHub-pinned.
- **Excluded repos.** Suppress specific repos from all GitHub-section views.
- **Per-request memoization and 1-hour revalidation.** Multiple sections that read GitHub share one fetch.

## Editorial variant (the first variant)

- **3 color schemes:** Warm Sienna (default), Noir (high-contrast monochrome with electric blue), Ink & Paper (cool gray, deep teal).
- **2 typography presets:** Editorial Classic (Fraunces and Source Serif 4), Modernist (Inter Display and Source Serif 4).
- **4 theme modes** (light, dark, bright, black) plus system.
- **Print stylesheet.** `Cmd/Ctrl + P` produces a resume-ready printable page.
- **Sticky table of contents** when a portfolio has 2 or more sections.
- **Skip-to-content link** for keyboard navigation.
- **Server-rendered reading time** on long-form sections.

## SEO

- **Metadata** generated from `identity` and `meta` (title, description, Open Graph, Twitter Card).
- **Open Graph image** generated per request from the identity's name and tagline.
- **Structured data (JSON-LD)** for Person and ProfilePage.
- **Feed** at `/feed.xml`, listing writings, publications, and episodes newest first, with the portfolio's `locale` as its language. `features.feed: false` in the site document turns it off.
- **`/robots.txt` and `/sitemap.xml`** generated server-side, per request.
- **Absolute URLs** (Open Graph, sitemap, robots.txt, feed, JSON-LD) on `PORTFOLIO_ORIGIN`, the deployment's canonical origin.
- **`<html lang dir>`** from the portfolio's `locale` and `direction`.
- **Hidden content stays hidden.** Hidden sections and unregistered extension data never reach the page, its JSON-LD, the feed, or the Open Graph image.

## Skills (AI-assisted authoring and development)

Two skills under [skills/](../skills/):

- **`portfolio-author`** guides an AI agent to extract details from any source (a resume PDF, a LinkedIn export, a GitHub username, a conversation) and produce a valid portfolio and site document. It includes references for the schema, curation, quality rules, section kinds, and three real-world examples (an engineer, a photographer, a writer).
- **`variant-developer`** guides an AI agent through the full variant build: design contract, manifest, renderers, CSS, and audit. It includes a visual companion (an HTTP server and Playwright matrix screenshots), the kit catalog, the manifest contract reference, styling conventions, coherence rules, and an audit checklist.

Both skills work in any harness that supports skills (Claude Code, Copilot CLI, Cursor, Codex, and others).

## Drift gates

Three scripts keep the system honest:

- **`pnpm check:skills`** verifies that `section-kinds.md` matches the schema's `ALL_SECTION_KINDS`, that `kit-catalog.md` mentions every export from `@portfolio/kit`, that `schema.md` mentions every section kind, and that both SKILL.md frontmatters parse and stay under their length caps.
- **`validate.mjs`** validates a directory's portfolio and site documents together and reports each problem's file, line, and column.
- **`audit.mjs`** checks variant manifests against the schema (every required kind handled) and warns on suspicious patterns (a single color scheme, themes claimed without CSS).

## Developer ergonomics

- **TDD-friendly.** The schema, kit helpers, and audit scripts all have `node:test` suites. Run them with `tsx --test`.
- **Type-safe.** Discriminated unions on `kind` mean adding a section kind is one schema entry plus a renderer per variant. The compiler enforces that every variant handles every kind.
- **Small kit, focused submodules.** `@portfolio/kit/github`, `@portfolio/kit/seo`, and the rest, so variants only pull in what they need.
- **Visual companion in two modes.** Mockup mode (no Next.js needed) for fast prototyping, and preview mode (Playwright) for matrix screenshots.

## Roadmap (deferred, not yet shipped)

- Visitor pickers for each appearance axis, applying `visitorControls`.
- Shared registries for the design language, color schemes, and typography, so those ids no longer depend on the variant.
- Variants that render content extension sections.
- More variants.
- CI/CD workflow templates.

If you want a feature that isn't shipped, open an issue. Small additions ship fast.
