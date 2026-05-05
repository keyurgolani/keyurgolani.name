---
name: variant-developer
description: >
  Build a new visual variant for the keyurgolani.name self-hostable portfolio platform.
  Use when a user wants to create, design, or scaffold a new variant package
  (packages/variant-<slug>) — committing to a coherent visual metaphor, supporting every
  section kind the schema defines, and using @portfolio/kit utilities (or hoisting new
  ones) instead of reinventing helpers. Trigger when the user mentions creating a variant,
  cloning the variant template, designing a new portfolio look, or extending the platform
  with a new aesthetic. Do NOT trigger for editing portfolio data (use portfolio-author),
  for editing existing variants without intending a redesign, or for general React/CSS
  work outside this monorepo.
license: MIT
compatibility: >
  Designed for the keyurgolani/portfolio monorepo. Requires write access to packages/,
  pnpm, Node 22+. Visual companion mockup-mode requires a browser; preview-mode requires
  the apps/web dev server running.
metadata:
  version: "1.1.0"
---

## 1. What this platform is + the variant model

The keyurgolani/portfolio platform is a self-hostable, YAML-driven portfolio site. A single `portfolio.yml` at the repo root is rendered by one of many pluggable visual variants. Variants are the look; the YAML is the content. Picking a different variant changes everything visual without touching the data.

A variant is a React component package living under `packages/variant-<slug>`. The contract is small:

- The package's entry point exports a `manifest` object (typed `VariantManifest`) — declares slug, themes, color schemes, typography presets, supported section kinds, capabilities, and screenshots.
- The package's entry point exports a `default` React component (typed `(props: VariantProps) => JSX.Element`) — receives the validated portfolio config and renders it.
- The host (`apps/web`) auto-discovers variants via the workspace registry. `apps/web/scripts/build-registry.mjs` scans every workspace package whose `package.json` has `portfolio.variant: true` and writes `apps/web/src/lib/registry.generated.ts`. No manual import; the registry is regenerated on install.

Reference packages:

- **`packages/variant-editorial`** — the reference variant. Read it for shape, conventions, and tone before scaffolding your own. Its DESIGN.md is the worked example.
- **`packages/variant-template`** — the clone-source. The scaffolder copies this directory; do not edit it as part of building a new variant.
- **`packages/kit`** — shared utilities (theme provider, navigation derivation, layout primitives, R3F bindings, hooks). Use it. If you find yourself rewriting a helper that could live here, hoist it.

## 2. The pipeline (4 phases when porting, 3 when greenfield)

Every variant goes through these phases in order. Skipping or reordering produces incoherent output.

- **Phase 0 — Reference inventory** (when porting from an archive variant, another platform, a Figma, or "make it look like X"). Read the reference end-to-end, list every component and signature interaction, diff the data shape against the schema, decide what's portable vs not. Output drives DESIGN.md. **Skip only when greenfield** (no existing reference).
- **Phase 1 — Design contract.** Pick a metaphor. Write `packages/variant-<slug>/DESIGN.md`. Get the user to approve it. No code yet.
- **Phase 2 — Implementation in waves.** Wave 1 is foundation (scaffold + manifest + tokens + base styles, every section rendering via `FallbackSection`). Wave 1.5 is kit hoists (extract reusable patterns identified in Phase 0 *before* Wave 2 consumes them). Wave 2 is bespoke renderers, one cluster at a time. Wave 3 is polish (navigation, screenshots, print stylesheet, performance tier honesty check).
- **Phase 3 — Pre-merge audit.** Run scripted gates (`audit.mjs`, typecheck, lint, build, kit-dedup) AND visual gates (matrix sweep, contrast, reduced-motion, print, /variants listing, fidelity vs reference, real-data, mobile). See `references/audit-checklist.md` and `references/quality-gates.md`.

**Do not skip Phase 1.** The whole point of a variant is committing to a single visual metaphor and translating it consistently into tokens, typography, layout, motion, and copy. You cannot do that by writing CSS first and explaining it later. Coherence comes from the contract.

**Do not skip Phase 0 when porting.** The single biggest source of post-implementation rework is treating "the metaphor" as new design freedom while the user is treating it as a fidelity requirement. Front-load the inventory.

The variant package is not a free-form React project. It is a render of a fixed, schema-validated content model under a metaphor you committed to. Phase 0 sets fidelity expectations, Phase 1 fixes the metaphor, Phase 2 implements it, Phase 3 verifies it.

## 2.5 Phase 0 — Reference inventory (port-only)

When the user says "port variant X", "make it look like archive page0", "match this Figma", run Phase 0 *before* Phase 1.

The work:

1. Read the reference end-to-end. Every section file, every UI primitive, every helper. Note line counts — a 5,000-line reference and a planned 1,200-line port means you're dropping ~75% of the visual richness; decide if that's intentional.
2. Build a **component inventory** (table: primitive → what it does → hoist-worthy? → plan).
3. Build a **signature interactions inventory** (parallax dispersal, 3D tilt, expand-on-click, brand-aware cards, typing animation, animated counters, etc.) — the things that define the *feel*.
4. Build a **data-shape diff** vs `@portfolio/schema`. For every Lost field, decide: inferable (heuristic), multi-section composition (pull from multiple kinds), or not portable (drop with documented reason).
5. Author `## Component inventory`, `## Signature interactions`, and `## Fidelity targets` sections in DESIGN.md. The fidelity targets become Phase 3 sign-off boxes.

Load `references/fidelity-comparison.md` for the recipe. Output is a fidelity contract the user approves; the contract drives Wave 2's scope.

## 3. Phase 1 — Design contract

The work:

1. Pick a metaphor. One sentence. Specific (e.g. *"printed editorial monograph spread"*, *"terminal session log"*, *"museum wall caption next to the work"*) — not vague (*"modern and clean"*, *"professional"*). The metaphor is what every later choice — type, color, motion, copy — points back to. If you cannot say what the variant *is* in one sentence, you do not have a metaphor yet.
2. Copy `assets/DESIGN.template.md` into `packages/variant-<slug>/DESIGN.md`. Fill out all 11 sections. Do not leave placeholders. If a section doesn't apply, write *"N/A — <reason>"* explicitly.
3. Get the user to approve `DESIGN.md` before touching any code. The approval is the gate from Phase 1 to Phase 2.

Load when:

- `references/design-contract.md` — at the start of Phase 1, to know what each section of DESIGN.md must contain. Reload it whenever the metaphor drifts mid-implementation.
- `references/coherence.md` — when translating metaphor → tokens → typography → motion. The hardest part of Phase 1 is making each layer reinforce the metaphor instead of fighting it.
- `references/manifest-contract.md` — when filling out DESIGN.md's manifest summary and capabilities sections. The manifest is part of the design, not an afterthought.

Color schemes count and typography presets count are encouraged-not-gated. A variant with one of each is allowed; the audit warns but does not fail. Document the count's reasoning in DESIGN.md — *"the metaphor is monochrome, so a second scheme would be theatrical"* is a valid justification; *"didn't get to it"* is not.

Phase 1 is when the visual companion (mockup-mode) is most useful — it lets the user *see* the metaphor before approving the contract. If you're going to offer it, see section 6.

## 4. Phase 2 — Implementation in waves

Implement in three waves. Do not jump around; finish each wave before starting the next.

### Wave 1 — Foundation

Scaffold and stand up a renderable variant that uses `FallbackSection` for every kind. The goal is "every page route renders without crashing", not "looks good".

- Scaffold: `node docs/skills/variant-developer/scripts/new-variant.mjs <slug>`. Wraps the root scaffold, copies `packages/variant-template`, and reminds you to fill out DESIGN.md.
- Edit `packages/variant-<slug>/src/manifest.ts` to match DESIGN.md:
  - `supportedKinds`: `ALL_SECTION_KINDS` — or an explicit list matching it.
  - `themes: ['light', 'dark']` — both are required by the platform.
  - Color schemes per DESIGN.md.
  - Typography presets per DESIGN.md.
  - `capabilities` — `print`, `motion`, `interactive3d`, etc., honest to what you actually implement.
  - `performanceTier` — `light` | `medium` | `heavy`. Stay honest; the audit cross-checks against your imports.
- Write `src/styles.css`:
  - `@import` for fonts (Google Fonts via URL, or self-hosted under `apps/web/public/fonts/`).
  - `[data-variant='your-slug'] { … tokens … }` for the default scheme. Tokens are CSS custom properties: colors, font stacks, scale, radii, spacing.
  - `[data-variant='your-slug'][data-color-scheme='id'] { … overrides … }` for each non-default scheme.
  - `[data-variant='your-slug'][data-typography='id'] { … overrides … }` for each non-default typography preset.
  - `[data-theme='dark'] [data-variant='your-slug'] { … }` for dark theme overrides. Add `[data-theme='bright']` and `[data-theme='black']` blocks too if your manifest declares those themes (audit warns if you claim them without CSS).
  - `@media (prefers-reduced-motion: reduce) { [data-variant='your-slug'] * { animation: none !important; transition: none !important; } }` at the bottom.
  - **`scroll-margin-top` rule** on every scroll-target section if you have a fixed nav (`scroll-margin-top: 5rem` on `.kc-section, .kc-hero, .kc-timeline`). Without this, anchor-link clicks bury headings under the nav.
  - **Anchor scoping** — write the global anchor-style rule as `[data-variant='your-slug'] a:not([class])` so component-classed buttons can override the color via class-only selectors. Without `:not([class])`, every `.kc-action--primary` and similar inherits the global accent color and renders unreadable on gradient backgrounds. (See `references/common-bugs.md` §2.)
  - Load `references/styling-conventions.md` while writing this — class naming, scope discipline, scheme/preset cascade order, and dark-theme conventions are codified there.
  - Load `references/common-bugs.md` while writing this — distilled list of bugs that escape compile/audit and only show up at visual-validation time.
- Wire theme toggle: import `useTheme` from `@portfolio/kit` and build your own toggle component in `src/primitives/theme-toggle.tsx`. Filter the rendered buttons against your `manifest.themes` so users only see modes your variant supports; always render the `system` button (it resolves to mandatory light/dark). Editorial's toggle in `packages/variant-editorial/src/primitives/theme-toggle.tsx` is the reference implementation.
- Run `pnpm --filter @portfolio/web build:registry` to regenerate the registry **and** the per-variant CSS imports (`registry.styles.generated.ts`). The host's `apps/web/src/app/layout.tsx` imports the styles entry; without regenerating it, your variant's CSS is orphaned and the page renders as user-agent default. **This is the most common reason a freshly-scaffolded variant looks like plain HTML.**
- Verify (Gate A from `quality-gates.md`): `pnpm dev`, visit `/preview/<slug>`. Every section should render via `FallbackSection` *with your variant's tokens applied* (paper color, font family, theme toggle visible). If you see plain black-on-white text, the styles entry didn't pick up — check `registry.styles.generated.ts`.

### Wave 1.5 — Kit hoists (when porting from a reference)

Before writing renderers, hoist the reusable patterns identified in Phase 0's component inventory. Doing this first means Wave 2 consumes the kit primitives instead of re-inventing them, and `kit-dedup` runs clean as you go.

The decision matrix:

| Pattern | Hoist when |
|---|---|
| Pure data utilities (lane assignment, classifiers, projections, path builders) | Always. They're testable, generic, and likely reused. |
| Motion hooks (scroll-tied effects, mouse tilt, viewport-center predicates) | When at least one is broadly useful across kinetic variants. Put them under `@portfolio/kit/motion-fx` so still-tier variants don't bundle framer-motion. |
| Generic React components (typing animation, animated counter, lightbox) | When the component composes data + behavior the same way every variant would. |
| Brand/data registries (social platform colors, language-color lookups, etc.) | When the lookup is data-driven, not visual style. |
| Visual chrome (specific card vocabularies, composition-level JSX) | Stays variant-local. Different metaphors will style differently. |

The work:

1. List candidates in DESIGN.md's `## Component inventory` "Hoist plan" column.
2. Implement each as a kit module under the appropriate sub-path (`@portfolio/kit/<topic>` or main barrel).
3. Add tests for pure utilities (`tsx --test`). Aim for ≥ 80% branch coverage on lane assignment, density projection, classifiers — they're load-bearing.
4. Update `references/kit-catalog.md` with the new exports. The `sync-checks.mjs` script enforces this — every export must appear by name in the catalog.
5. Run `node docs/skills/scripts/sync-checks.mjs` to verify catalog parity.
6. Run `pnpm typecheck` and the kit's tests.

After Wave 1.5, the kit knows the primitives. Wave 2 is composition.

### Wave 2 — Renderers

Implement bespoke renderers one cluster at a time. The schema groups section kinds into clusters that share data shapes and visual idiom; render them together so the metaphor stays consistent within a cluster.

For each cluster:

1. Load `references/kit-catalog.md` and prefer kit helpers (layout primitives, list renderers, link normalizers, period formatters, image components) over re-inventing.
2. Load `references/section-kinds.md` for the data each kind actually carries — what's required, what's optional, what shapes nest.
3. Implement renderers in `src/renderers/<kind>.tsx` (or whatever file structure your variant uses; consistency matters more than the path).
4. Update `src/section.tsx` (the section dispatch) to route the new renderers; remove the cluster's kinds from the `FallbackSection` fallback path.
5. Before closing the cluster, run `node docs/skills/variant-developer/scripts/kit-dedup.mjs packages/variant-<slug>`. Resolve every candidate either by **hoisting** the helper to `packages/kit/src/<topic>.ts` and importing it back, or by leaving a `// LOCAL: <reason>` comment justifying the local copy.
6. **Visual checkpoint at end of cluster.** Run `/preview/<slug>` against `portfolio.example.yml` AND the user's actual `portfolio.yml` (real-data testing surfaces bugs that example data hides — long org names, missing optional fields, non-ASCII characters). Verify each cluster's renderers display correctly. *Don't trust HTTP 200 as proof the cluster is done.*

Renderer quality reminders (from real-session bugs):

- **Defensive destructuring is mandatory.** Every renderer must handle `items: []`, optional fields = `undefined`, and missing nested objects. Crashes in production are usually here.
- **Slugify any synthesized SVG ID.** Anything you'll reference via `url(#id)` — gradient defs, filters, masks, clip paths — must be slugified. Spaces or special characters break the lookup silently. Use `slugify` from `@portfolio/kit`. (See `references/common-bugs.md` §3.)
- **Don't reuse short single-word IDs** (`top`, `main`, `home`) for layout tricks like fixed-position scroll anchors. `ensureSectionId(section.id, 'top')` will collide with anything CSS-targets via `[id='top']`. (See `references/common-bugs.md` §4.)
- **Gate JS-driven motion on `useMotionPreference()`.** CSS `@media (prefers-reduced-motion)` doesn't stop `requestAnimationFrame` loops or framer-motion `useTransform` outputs. Each animation entry point needs an explicit `if (reduceMotion) return;` short-circuit. (See `references/common-bugs.md` §8.)

The clusters:

- **Identity** — `hero`, `lede`, `now`, `contact`, `cta`. User-facing voice; the variant's first impression.
- **Career** — `experience`, `education`, `tenure`, `focus`. Time-anchored chronology.
- **Body of work** — `projects`, `writings`, `publications`, `talks`, `awards`, `episodes`, `patents`, `gallery`, `discography`. List-dense outputs; the bulk of most portfolios.
- **Voice** — `testimonials`, `press`, `quote`. Social proof.
- **Skills** — `skills`, `stack`, `services`, `fun-facts`, `stats`. Tag/list-dense identity adjacent.
- **External** — `external-portfolios`, `github`. Off-platform identity surfaces.

### Wave 3 — Polish

- **Navigation.** Pick the affordance that matches the metaphor. Examples: TOC for editorial, hamburger overlay for single-page kinetic, sidebar for dense bento, marginalia for long-form. Use `deriveNavItems` from `@portfolio/kit` to build the nav model from the rendered sections — do not hand-author it.
  - Add `scroll-margin-top` to every section if the nav is fixed (Wave 1 should already have this, but verify after wiring nav).
  - Brand-link "scroll to top" — use `window.scrollTo(0, 0)` via JS, not an `href="#top"` anchor. Single-word IDs collide with `ensureSectionId` fallbacks.
- **Screenshots.** Add `manifest.screenshots` entries. Capture static PNGs and place them under `apps/web/public/variants/<slug>/`. Cover at least one screenshot per scheme + preset combination so the gallery thumbnails reflect the variant's range. See `references/quality-gates.md` Gate F for the capture recipe (manual + automated).
- **Print.** If `capabilities.print = true`, write the print stylesheet inside `styles.css` (`@media print { [data-variant='your-slug'] { … } }`) and verify in Chrome's print preview using `references/quality-gates.md` Gate D. The print rule MUST reset every theme-dependent token (`--kc-paper`, `--kc-card-bg`, `--kc-primary`, etc.) inside the print block — otherwise the active theme bleeds through and cards render unreadable. Gradient text needs both `color` and `-webkit-text-fill-color` reset to black. (See `references/common-bugs.md` §5 and §7.) If you cannot make print look reasonable, set `capabilities.print = false` instead of shipping a broken stylesheet.
- **Performance tier honesty.** If you claimed `medium` or `heavy`, mobile-test it on a real device or throttled emulator. The audit does not catch a lying tier; the user does, on launch.
- **Reduced-motion verification.** Don't trust "I checked the toggle once". Run the programmatic checks in `references/quality-gates.md` Gate C — pixel-sample the canvas, transform-diff a floater across scroll, text-diff the typing animation. Each must come back stable.
- **Mobile breakpoint sweep.** 375×667 and 430×932 viewports. Decorative floaters hidden, hero CTAs stacked, nav collapsed to hamburger, no horizontal overflow. See `references/quality-gates.md` Gate I.

## 5. Phase 3 — Pre-merge audit

Run `references/audit-checklist.md` for the scripted gates and `references/quality-gates.md` for the visual gates. Both are required.

### Scripted gates (cheap, run frequently)

1. `node docs/skills/variant-developer/scripts/audit.mjs packages/variant-<slug>` — exits 0. Catches manifest schema breaks, missing `light`/`dark` themes, unsupported kinds, missing screenshots referenced by the manifest.
2. `pnpm typecheck` — passes for the whole workspace, not just your package.
3. `pnpm lint` — passes for the variant package (`pnpm --filter @portfolio/variant-<slug> lint`).
4. `pnpm --filter @portfolio/web build` — succeeds. The host build is the integration test.
5. `node docs/skills/variant-developer/scripts/kit-dedup.mjs packages/variant-<slug>` — every candidate hoisted or marked `// LOCAL: <reason>`.
6. `pnpm --filter @portfolio/kit test` — kit tests pass (relevant if you hoisted in Wave 1.5).
7. `node docs/skills/scripts/sync-checks.mjs` — `kit-catalog.md` parity, `schema.md` parity.

### Visual gates (expensive, run at sign-off)

These are the gates that *catch what compiles fine but looks broken*. Each one corresponds to a real bug class that escaped a previous build:

- **Gate A — Visual sanity.** `pnpm dev`, open `/preview/<slug>`, confirm CSS reaches the page. Catches "host CSS injection" failures.
- **Gate B — Theme × scheme × typography matrix.** ≥ 9 screenshots across the meaningful combinations. Catches contrast bugs that only surface in non-default schemes/themes.
- **Gate C — Reduced-motion programmatic verification.** Pixel-sample, transform-diff, text-diff. Catches motion that wasn't actually disabled.
- **Gate D — Print preview.** Verify the print stylesheet against the new sections. Catches theme-token leaks into print.
- **Gate E — `/variants` listing entry.** Verify the variant card displays correctly.
- **Gate F — Screenshot capture.** PNGs exist on disk where the manifest claims.
- **Gate G — Fidelity comparison vs reference** (port-only). Every box in DESIGN.md's `## Fidelity targets` is checked or has an inline justification for being intentionally dropped.
- **Gate H — Real-data testing.** Test against the user's actual `portfolio.yml`, not just `portfolio.example.yml`. Long names, missing optional fields, non-ASCII characters.
- **Gate I — Mobile breakpoint sweep.** 375×667 and 430×932 viewports.

See `references/quality-gates.md` for the full recipes. Each gate has explicit pass/fail criteria and (where applicable) DevTools console snippets.

**Failures are not warnings. Address every one before declaring done.** A variant that ships with a failing audit is broken, not "shipped with caveats". The audit is the contract that lets the host treat all variants as interchangeable.

## 6. Visual companion

The visual companion is a browser-based tool for showing the user palette boards, type pairings, and section sketches during Phase 1, then live screenshot grids during Phases 2–3. **It is OFF by default.** It is also token-intensive — each board is HTML written into the conversation by the agent. Don't launch it without explicit user consent.

### The offer (own message, no other content)

When you decide the work ahead would benefit from visual discussion (typically when transitioning from one-line metaphor to actual color/type/section choices), send the following as **its own message**, with no other content alongside:

> Some of this work might be easier to discuss visually. I can spin up a local browser companion — palette boards and section sketches now (mockup-mode), live screenshots later (preview-mode). The companion is token-intensive, so I won't launch it without your OK. Want to use it?

Wait for the user's explicit yes before launching. If they say no or stay quiet, work entirely in the terminal — the skill works fully without the companion.

### After consent, decide per question

Even after the user opts in, decide each question separately. The test: **would the user understand this better by seeing it than reading it?**

- Palette comparisons, type pairings, section sketches → use the browser.
- Conceptual choices, tradeoff discussions, requirements questions → stay in the terminal.

### Modes

- **Mockup-mode** (Phase 1, before code exists). Server: `scripts/visual-companion/server.cjs`, launcher: `scripts/visual-companion/start.sh --mode mockup --project-dir <repo-root>`. Agent writes HTML fragments to the watched dir; user clicks options; clicks land in `state_dir/events`.
- **Preview-mode** (Phases 2–3, code exists). Launcher: `scripts/visual-companion/start.sh --mode preview --variant <slug>`. Starts `pnpm --filter @portfolio/web dev`. The user watches HMR live in `/preview/<slug>`. With `--matrix`, also runs `preview-matrix.mjs` to capture screenshots across `theme × scheme × typography` (requires Playwright; fails gracefully otherwise).

See `references/visual-companion.md` for the full guide — class hooks, file naming, events file format, session lifecycle.

## 7. Gotchas

Environment-specific facts that bite agents who skip the references. For the full bug catalog with reproductions and fixes, load `references/common-bugs.md`.

### Build / registry

- The variant registry is **auto-generated**. If `/variants` doesn't show your variant after install, run `pnpm --filter @portfolio/web build:registry` — the registry isn't re-run on every dev reload.
- The build script also generates `apps/web/src/lib/registry.styles.generated.ts` — a side-effect import file that pulls every variant's `styles.css`. The host layout imports the generated file. **If your variant's styles don't render, regenerate this file first.**

### Manifest

- `manifest.themes` MUST include `'light'` and `'dark'`. The platform's `ThemePreference` is `light|dark|system`; `system` resolves to one of the two. A variant missing either theme fails the audit.
- New section kinds added to the schema will **fail your audit** if you don't update `supportedKinds`. If a kind doesn't fit your metaphor, route it to `FallbackSection` explicitly rather than omitting — manifest still claims coverage and the user gets the data, just without bespoke styling.

### CSS scoping

- The `data-variant` attribute scopes ALL your CSS. Forget it on a selector and styles bleed into every other variant on the `/variants` gallery page. Every selector in `src/styles.css` must start with `[data-variant='your-slug']`.
- Color-scheme overrides go on `[data-variant='X'][data-color-scheme='id'] { ... }`. Without the variant scope, schemes leak globally — every variant on `/variants` flips when the user changes one variant's scheme.
- The global anchor rule must be scoped with `:not([class])` so component-classed buttons can override the color via class-only selectors. Without this guard, every primary button inherits the global accent color and renders unreadable on gradient backgrounds. (`common-bugs.md` §2)
- Variants use **plain CSS with BEM-style class names** (e.g. `editorial-project__title`), not Tailwind. Convention: `<variant-slug>-<block>__<element>`. Tailwind is reserved for `apps/web` chrome; the variant package owns its own stylesheet.

### IDs

- **Don't use single-word reserved IDs** (`top`, `main`, `home`) for layout tricks. `ensureSectionId(section.id, 'top')` returns `'top'` when the hero has no explicit id; CSS rules targeting `[id='top']` will then collide with the hero `<section>`. Use class-based selectors or namespaced IDs (`kc-page-top`). (`common-bugs.md` §4)
- **Slugify any synthesized SVG ID** referenced via `url(#id)` (gradient defs, filters, masks, clip paths). Spaces or special characters break the lookup silently. Use `slugify` from `@portfolio/kit`. (`common-bugs.md` §3)

### Print

- Print stylesheets must reset *every* theme-dependent token (`--kc-paper`, `--kc-card-bg`, `--kc-primary`, `--kc-accent`, etc.) inside the `@media print` block. Without this the active theme bleeds through and cards render unreadable. (`common-bugs.md` §5)
- Gradient text needs both `color` and `-webkit-text-fill-color` reset to black in print. Either alone won't work in Chrome. (`common-bugs.md` §7)

### Motion

- Section data may be missing. **Every renderer must handle `items: []`, `groups: []`, optional fields = undefined.** The host does not filter empty sections — your renderer must render gracefully or return `null`. Defensive destructuring is not optional.
- CSS `@media (prefers-reduced-motion)` only stops CSS animations. JS-driven motion (canvas, framer-motion `useTransform`) needs explicit `useMotionPreference()` gating. (`common-bugs.md` §8)
- Validate reduced-motion programmatically. Pixel-sample the canvas, transform-diff the floater, text-diff the typing animation. Eyeballing isn't sufficient. (`quality-gates.md` Gate C)

### Performance

- `@portfolio/kit/spatial-r3f` (react-three-fiber) is heavy — only import if `manifest.performanceTier` is `medium` or `heavy` AND your variant intentionally uses WebGL. The audit cross-checks; pulling R3F into a `light` variant fails.
- `@portfolio/kit/motion-fx` requires `framer-motion` as an *optional* peer dependency. Variants that import the sub-path must list `framer-motion` in their own dependencies. Variants that don't use motion-fx don't pull it in.
- `next.config.ts` has `reactStrictMode: false` because R3F survives WebGL context loss only without strict double-mount. **Don't change this from a variant package.** If you need strict mode for your own component, wrap that subtree in `<StrictMode>` locally.

### Layout

- Add `scroll-margin-top: 5rem` (or your nav height) to every section if the variant has a fixed nav. Without this, programmatic `scrollIntoView({ block: 'start' })` puts headings *behind* the nav. (`common-bugs.md` §6)
- Floating decorative elements should `display: none` at mobile breakpoints, not just shrink — they cause horizontal overflow on phones. (`common-bugs.md` §9)

## 8. Hand-off

When all gates pass:

- Push `DESIGN.md` and the variant package on the same branch as the PR. The contract and the implementation must travel together.
- Tell the user how to set their `portfolio.yml`'s `variant: <slug>` field to test the variant against their real data, not just `portfolio.example.yml`.
- Ask whether they want the variant added to the `/variants` gallery (workspace listing). Some variants are personal-use only; don't assume gallery inclusion.
- Don't run `pnpm dev` for them unless they ask. Their dev environment is theirs to control.

That's the skill. Design, implement in waves, audit, hand off, stop.

## 9. Reference docs — reading order

Load in order as you progress through phases:

| Phase | Reference | Why |
|---|---|---|
| Phase 0 (port-only) | `references/fidelity-comparison.md` | Inventory recipe before opening DESIGN.md. |
| Phase 1 | `references/design-contract.md` | What each section of DESIGN.md must contain. |
| Phase 1 | `references/coherence.md` | Metaphor → tokens → typography → motion translation. |
| Phase 1 | `references/manifest-contract.md` | Every manifest field, valid values, examples. |
| Phase 2 Wave 1 | `references/styling-conventions.md` | CSS scoping discipline, BEM naming, theme cascade. |
| Phase 2 Wave 1 | `references/common-bugs.md` | Bug catalog. Read once before writing styles.css. |
| Phase 2 Wave 1.5 | `references/kit-catalog.md` | What's already in the kit. Don't reinvent. |
| Phase 2 Wave 2 | `references/section-kinds.md` | Per-kind data shape, edge cases, ideal data. |
| Phase 2 Wave 2 | `references/kit-catalog.md` | Kit helpers per cluster. |
| Phase 2 Wave 3 | `references/quality-gates.md` | Visual validation recipes. |
| Phase 3 | `references/audit-checklist.md` | Sign-off contract. |
| Phase 3 | `references/quality-gates.md` | Visual gates A–I. |
| Visual companion | `references/visual-companion.md` | Mockup-mode + preview-mode guide. |

## 10. Session learnings — what makes a one-shot port land

Distilled from real builds. Each item exists because skipping it cost an iteration:

1. **Phase 0 inventory before DESIGN.md when porting.** A scaffold that compiles isn't a port. Without the inventory, DESIGN.md commits to a metaphor sentence while the user is committing to a fidelity expectation. Three rounds of "but the original had…" is the typical cost.

2. **Wave 1.5 hoist before Wave 2 renderers.** Hoisting after-the-fact via `kit-dedup` works but requires retrofitting renderers. Hoisting *first* means renderers consume kit primitives directly. Test the pure utilities — they're load-bearing.

3. **Visual sanity check before any other Wave 1 declaration.** "HTTP 200 + typecheck pass" is not "the page renders correctly". Look at it. The host CSS injection bug, the global anchor specificity bug, the SVG-ID-with-spaces bug — all of these compile clean.

4. **Visual matrix at end of Wave 2, not Phase 3.** Catching a contrast bug in matrix sweep means fixing one variable. Catching it in Phase 3 means re-running every Phase 3 gate after the fix.

5. **Real-data testing parallel to example-data testing.** The example portfolio has curated, well-formed data. Real users have long org names that break timeline IDs, missing optional fields that crash renderers, non-ASCII characters that fonts don't render. Test both at the end of each cluster.

6. **Programmatic reduced-motion verification.** "I checked the OS toggle once" doesn't generalize. Pixel-sample, transform-diff, text-diff. Each must come back stable. The recipe is in `quality-gates.md` Gate C.

7. **Print preview at Wave 3 gate, not as polish.** Theme-token leaks into print are invisible until you actually preview. The recipe (CSSMediaRule rewrite trick) lets you skim print layout from the browser viewport in seconds.

8. **`/variants` listing entry as an explicit gate.** Easy to miss; user-facing. Verify card metadata, screenshot thumbnails, activate/preview links.

9. **Defensive renderer destructuring is mandatory, not optional.** Every renderer handles `items: []`, optional fields = `undefined`, missing nested objects. The host doesn't filter empty sections.

10. **Sign off the variant against the user's `portfolio.yml`, not the example.** This is what the user sees on launch. Every other dataset is a dress rehearsal.
