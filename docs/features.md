# Features

What the platform can do today.

## Content model

- **Two documents.** `config/portfolio.yml` holds the content, and `config/site.yml` how it looks and which sections show. Deployment settings and secrets stay in the environment. You never touch code to change either document. [configuration.md](configuration.md) is the reference.
- **YAML or JSON.** Each document can be either, and both parse to the same typed model.
- **A body of work, not a CV (version 3).** Works, evidence, chronology entries, and media assets are records with ids, which sections list in the order the owner reads them, beside one practice (a thesis, and grouped skills, tools, and services) and one contact record. `signature`, `featured`, `proof`, and `archive` curate the works and evidence a composition leads with. Fourteen section kinds place them: `works`, `evidence`, `chronology`, `practice`, `contact`, `custom`, and the eight carried from version 2, `hero`, `lede`, `now`, `quote`, `focus`, `fun-facts`, `cta`, and `github`. Nothing assumes a profession: a work's `medium` and an evidence entry's `type` say what it is. See [configuration.md](configuration.md) and [authoring.md](authoring.md).
- **Private records.** A work, evidence entry, chronology entry, or media asset with `visibility: private` stays in the document and never reaches a visitor, and neither does a record that only hidden sections reach.
- **Content extensions.** A profession package adds namespaced fields and section kinds of its own. Data from a package the build doesn't register is kept as written, warned about, and never shown to visitors.
- **Stable ids.** Every section, record, and media asset has an `id`, never derived when the document loads. A section's id is its anchor and its key in the site document; a record's id is its anchor on the first section that lists it, its feed GUID, and its JSON-LD `@id`. `pnpm config:ids-fix` mints the missing ones.
- **Hidden sections.** The site document hides a section without deleting it from the portfolio.
- **Strict validation.** Unknown keys fail with a did-you-mean hint, URLs are checked against an allowlist, and secret-shaped strings are refused. Each problem is a record with a code, the file, the line and column, and how to fix it, from `pnpm config:validate`, the `validate.mjs` script, or the server at startup. A `source.*` record is about the file itself, so it has no line or column.
- **Cross-document checks.** Broken anchors and references, duplicate ids, contradictory or repeated metrics, links to sample or stale origins, a variant this build doesn't register, and control values the variant doesn't declare.
- **One-time migration.** `pnpm config:migrate` converts the old one-file format, or a version 2 portfolio document, to version 3 in one run, with a dry run and a diff before it writes anything.
- **Loose date strings.** `period: { start: "Jan 2024", end: "present" }` is fine, since people read this output, not parsers. ISO dates work too.
- **Markdown in prose fields.** `lede.body`, `experience.items[].highlights[]`, and others honor a curated subset of Markdown.
- **Media by id.** An image is a media asset, with its alt text, credit, and focal point, which a placement names and may override. Its renditions are derived data, served from `/media`: until they derive, or when the source is gone, an image renders as `Image unavailable`, keeping its box, caption, and credit, and a decorative one renders nothing.
- **Snapshots, not fetches.** Data from outside the documents, such as a GitHub profile, is a snapshot in `snapshots/<kind>.json` beside the two documents, frozen when it's taken. Nothing a visitor requests reaches a source.

## Variants and appearance

- **Variants are compositions.** A variant decides how the sections are arranged, navigated, and revealed. Color, type, materials, and motion timing belong to the appearance system (#19), so any composition can pair with any appearance.
- **Installing a variant is a dependency.** `pnpm --filter @portfolio/web add <package>`, and the build registers it. A package the build can't register stops the build with a diagnostic that names the package, the file, the pointer, and the fix.
- **The fallback composition.** When the site's variant isn't installed, every section renders in content order, in one column, in its place. The page answers 200, the owner gets a `variant.unavailable` warning at startup and in `config.status`, readiness says `degraded`, and visitors see no label. It stands in for a selection; the compositions a site selects are Editorial Evidence, the platform default (#13), and Kinetic Cosmos (#14), and #15 to #17 add the rest of the approved five.
- **Views.** A variant can declare path views below `/` and below `/work/<slug>`, such as `/chapters/<chapter>`. Each renders from the server, so it works without JavaScript, links back to its parent route as canonical, and stays out of the sitemap. After a switch, a view only the old variant declares redirects to its parent route while the old variant stays installed, and is a 404 once it's removed.
- **Shared section renderers.** Every core section kind has an accessible renderer in the kit, which a variant uses for each kind it doesn't render bespoke, so no section's content goes missing. They render only what the owner wrote, formatted, a snapshot's values with their date, and a short list of fixed labels (`Archive`, `As of`, the case-study headings, `Image unavailable`, and GitHub's three figures): no default heading, link label, or alt text, and no decoration around a number. A section with nothing public leaves the page and the navigation.
- **Owner controls.** A variant can declare composition controls, such as a hero layout or a featured project, stored per variant in the site document and checked against its manifest. When a variant raises its controls version, `pnpm variants:migrate-controls` steps the stored values through its migrations, with a dry run first.
- **Compatibility report.** How the portfolio renders in the selected composition: each kind's renderer, how full each content slot is, which of the previous variant's views it drops, and every finding, saying what renders instead and whether publishing is blocked. Startup and `pnpm config:validate` print its findings, and it needs nothing from Node, so #9 can run it in the browser.
- **Appearance in the site document.** The variant, and the design language, color scheme, typography, and display mode that #19 resolves. Every page renders in them from the server, so the first paint is the page's appearance with no script to set it (`system` follows the visitor's `prefers-color-scheme` in CSS; `light`, `dark`, and `high-contrast` pin one).
- **Per-axis visitor controls.** `visitorControls` marks each appearance field `locked` or `selectable`. The visitor control, in each variant's slot for it, offers each selectable field but the variant, and keeps the choice in a cookie that holds the ids alone. It works without JavaScript too.
- **Motion policy.** `respect-os` follows each visitor's `prefers-reduced-motion`, and `reduce` reduces motion for everyone: no entrance animation, nothing that repeats, no animation frame loop, and section links jump instead of scrolling. A browser test holds every registered composition to it, at load, after a jump, and as each part of the page scrolls into view.
- **Right to left.** A portfolio's `direction` sets `<html dir>`, and a variant that declares `rtl` lays out with logical properties only.

## GitHub sections

- **The snapshot, never a fetch.** With a snapshot in `snapshots/github.json`, the shared renderer shows its repositories, stars received, and contributions in the last year, its pinned repositories, and the date it was taken. Without one, it shows the profile link alone, labeled with the username. Variants get the snapshot through the render input's `derived`, so none fetches anything.
- **Refreshing comes later.** #10's third slice takes snapshots; the bundled sample ships a fictional one. The kit's server-side fetcher stays for host code until then, unused by any render.

## SEO

- **Metadata** generated from `identity` and `meta` (title, description, Open Graph, Twitter Card).
- **Open Graph image** generated per request from the identity's name and tagline.
- **Structured data (JSON-LD)** for Person, ProfilePage, and WebSite, from the published view: the current role and organization from the chronology, the practice's skills, and the signature and featured works, each with an `@id` from its record id.
- **Feed** at `/feed.xml`, listing writing and audio and video works and publications newest first, each GUID made from its record id, with the portfolio's `locale` as its language. `features.feed: false` in the site document turns it off.
- **`/robots.txt` and `/sitemap.xml`** generated server-side, per request.
- **Absolute URLs** (Open Graph, sitemap, robots.txt, feed, JSON-LD) on `PORTFOLIO_ORIGIN`, the deployment's canonical origin.
- **`<html lang dir>`** from the portfolio's `locale` and `direction`.
- **Hidden content stays hidden.** Hidden sections, private records, what only they reach, and unregistered extension data never reach the page, its client payload, its JSON-LD, the feed, or the Open Graph image.

## Skills (AI-assisted authoring and development)

Two skills under [skills/](../skills/):

- **`portfolio-author`** guides an AI agent to extract details from any source (a resume PDF, a LinkedIn export, a GitHub username, a conversation) and produce a valid portfolio and site document. It includes references for the schema, curation, quality rules, section kinds, and three real-world examples (an engineer, a photographer, a writer).
- **`variant-developer`** guides an AI agent through the full composition build: design contract, manifest, renderers, layout CSS, and `pnpm check:variants`. It includes a visual companion (an HTTP server for sketches, and the dev server on the bundled sample), the kit catalog, the manifest contract reference, styling conventions, coherence rules, and an audit checklist.

Both skills work in any harness that supports skills (Claude Code, Copilot CLI, Cursor, Codex, and others).

## Drift gates

These keep the system honest:

- **`pnpm check:skills`** verifies that `section-kinds.md` matches the schema's `CORE_SECTION_KINDS`, that `kit-catalog.md` mentions every export from `@portfolio/kit`, that `schema.md` mentions every section kind, and that both SKILL.md frontmatters parse and stay under their length caps.
- **`validate.mjs`** validates a directory's portfolio and site documents together and reports each problem's file, line, and column.
- **`pnpm check:variants`** generates the registry and lints every registered variant, code the host trusts at build time, so a lint and not a sandbox: no network, storage, clock, randomness, environment, or code from text, reached directly or through an alias, a destructuring, or a string key; no `async` component, server module, or `<style>`, `<link>`, or `<script>`; markdown only through `RichText`; every style scoped to the variant, with keyframes named after it, nothing loaded from another host or package, color, type, radius, and shadow only through #19's tokens, and logical properties when it declares right to left.
- **`pnpm test:variants`** renders every registered variant on every contract fixture and on the bundled sample, offline, in six modes (desktop, mobile, no JavaScript, print, failed enhancement, reduced motion), checks that hidden content never reaches a visitor, and that the server, a standalone `react-dom/server` render, and a browser render match. CI compares the platform's own variants' screenshots in a pinned Playwright image.
- **`pnpm test:external-variant`** installs a reference third-party variant from its tarball in a temporary worktree, runs the same checks plus its view, control, and lazy-loaded enhancement, and removes it, proving neither step edits the host.

## Developer ergonomics

- **TDD-friendly.** The schema, the variant contract, kit helpers, and check scripts all have `node:test` suites. Run them with `tsx --test`.
- **Type-safe.** Discriminated unions on `kind` mean adding a section kind is one schema entry plus a shared renderer in the kit, which every variant then renders.
- **Small kit, focused submodules.** `@portfolio/kit/github`, `@portfolio/kit/seo`, and the rest, so variants only pull in what they need.
- **Visual companion in two modes.** Mockup mode (no Next.js needed) for fast prototyping, and preview mode for the bundled sample in a live dev server. `pnpm test:variants` takes the screenshots.

## Roadmap (deferred, not yet shipped)

- The appearance axes, and a visitor control for each, applying `visitorControls` (#19).
- The five approved compositions, starting with Editorial Evidence and Kinetic Cosmos (#13 to #17).
- Work pages at `/work/<slug>`, with redirects for a changed slug (#10). The kit's case-study renderer is ready for them.
- Media ingestion and renditions (#10, slice 2), and snapshot refresh (#10, slice 3).
- CI/CD workflow templates.

If you want a feature that isn't shipped, open an issue.
