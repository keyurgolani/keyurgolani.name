# Features

What the platform can do today.

## Content model

- **Two documents.** `config/portfolio.yml` holds the content, and `config/site.yml` how it looks and which sections show. Deployment settings and secrets stay in the environment. You never touch code to change either document. [configuration.md](configuration.md) is the reference.
- **YAML or JSON.** Each document can be either, and both parse to the same typed model.
- **28 profession-neutral section kinds** spanning narrative, dated entries, lists, media, voice, accents, personal notes, external work, and contact. See [authoring.md](authoring.md#section-kind-quick-reference).
- **Content extensions.** A profession package adds namespaced fields and section kinds of its own. Data from a package the build doesn't register is kept as written, warned about, and never shown to visitors.
- **Stable section ids.** Every section has an `id`, its anchor and its key in the site document.
- **Hidden sections.** The site document hides a section without deleting it from the portfolio.
- **Strict validation.** Unknown keys fail with a did-you-mean hint, URLs are checked against an allowlist, and secret-shaped strings are refused. Each problem is a record with a code, the file, the line and column, and how to fix it, from `pnpm config:validate`, the `validate.mjs` script, or the server at startup. A `source.*` record is about the file itself, so it has no line or column.
- **Cross-document checks.** Broken anchors and references, duplicate ids, contradictory or repeated metrics, links to sample or stale origins, a variant this build doesn't register, and control values the variant doesn't declare.
- **One-time migration.** `pnpm config:migrate` converts the old one-file format into the pair, with a dry run and a diff before it writes anything.
- **Loose date strings.** `period: { start: "Jan 2024", end: "present" }` is fine, since people read this output, not parsers. ISO dates work too.
- **Markdown in prose fields.** `lede.body`, `experience.items[].highlights[]`, and others honor a curated subset of Markdown.
- **External assets via `apps/web/public/`.** Resume PDFs, avatar images, and gallery photos reference `/path`, which resolves to `apps/web/public/path`.

## Variants and appearance

- **Variants are compositions.** A variant decides how the sections are arranged, navigated, and revealed. Color, type, materials, and motion timing belong to the appearance system (#19), so any composition can pair with any appearance.
- **Installing a variant is a dependency.** `pnpm --filter @portfolio/web add <package>`, and the build registers it. A package the build can't register stops the build with a diagnostic that names the package, the file, the pointer, and the fix.
- **The fallback composition.** When the site's variant isn't installed, every section renders in content order, in one column, in its place. The page answers 200, the owner gets a `variant.unavailable` warning at startup and in `config.status`, readiness says `degraded`, and visitors see no label. It's the one composition this build registers; #13 to #17 add the approved five.
- **Views.** A variant can declare path views below `/` and below `/work/<slug>`, such as `/chapters/<chapter>`. Each renders from the server, so it works without JavaScript, links back to its parent route as canonical, and stays out of the sitemap. After a switch, a view only the old variant declares redirects to its parent route.
- **Shared section renderers.** Every core section kind has an accessible renderer in the kit, which a variant uses for each kind it doesn't render bespoke, so no section's content goes missing.
- **Owner controls.** A variant can declare composition controls, such as a hero layout or a featured project, stored per variant in the site document and checked against its manifest. When a variant raises its controls version, `pnpm variants:migrate-controls` steps the stored values through its migrations, with a dry run first.
- **Compatibility report.** How the portfolio renders in the selected composition: each kind's renderer, how full each content slot is, which of the previous variant's views it drops, and every finding, saying what renders instead and whether publishing is blocked. Startup and `pnpm config:validate` print its findings, and it runs in the browser too.
- **Appearance in the site document.** The variant, and the design language, color scheme, typography, and display mode that #19 resolves. Today the display mode sets the theme a visit starts in (`system` follows the visitor's `prefers-color-scheme`; `light` and `dark` pin one), painted before hydration so there's no flash of the wrong theme, and the other three are recorded.
- **Per-axis visitor controls.** `visitorControls` marks each appearance field `locked` or `selectable`. This release checks the policy without applying it; #19's visitor control, in each variant's slot for it, applies it.
- **Motion policy.** `respect-os` follows each visitor's `prefers-reduced-motion`, and `reduce` reduces motion for everyone: no entrance animation, nothing that repeats, no animation frame loop, and section links jump instead of scrolling. A browser test holds every registered composition to it, at load, after a jump, and as each part of the page scrolls into view.
- **Right to left.** A portfolio's `direction` sets `<html dir>`, and a variant that declares `rtl` lays out with logical properties only.

## GitHub sections

- **A link to the profile.** The shared renderer names the account and links it.
- **Repository data comes with #10.** Pinned and recent repositories, the language breakdown, and the contribution calendar reach variants through the render input's derived data, so no variant fetches anything. The kit's server-side fetcher stays for host code, unauthenticated unless a caller passes a token.

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
- **`variant-developer`** guides an AI agent through the full composition build: design contract, manifest, renderers, layout CSS, and `pnpm check:variants`. It includes a visual companion (an HTTP server for sketches, and the dev server on the bundled sample), the kit catalog, the manifest contract reference, styling conventions, coherence rules, and an audit checklist.

Both skills work in any harness that supports skills (Claude Code, Copilot CLI, Cursor, Codex, and others).

## Drift gates

These keep the system honest:

- **`pnpm check:skills`** verifies that `section-kinds.md` matches the schema's `ALL_SECTION_KINDS`, that `kit-catalog.md` mentions every export from `@portfolio/kit`, that `schema.md` mentions every section kind, and that both SKILL.md frontmatters parse and stay under their length caps.
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
- Work pages, once #10 resolves slugs.
- CI/CD workflow templates.

If you want a feature that isn't shipped, open an issue.
