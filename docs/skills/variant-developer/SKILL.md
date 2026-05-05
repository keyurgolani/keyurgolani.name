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
  version: "1.0.0"
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

## 2. The 3-phase pipeline

Every variant goes through three phases in order. Skipping or reordering produces incoherent output.

- **Phase 1 — Design contract.** Pick a metaphor. Write `packages/variant-<slug>/DESIGN.md`. Get the user to approve it. No code yet.
- **Phase 2 — Implementation in waves.** Wave 1 is foundation (scaffold + manifest + tokens + base styles, every section rendering via `FallbackSection`). Wave 2 is bespoke renderers, one cluster at a time. Wave 3 is polish (navigation, screenshots, print stylesheet, performance tier honesty check).
- **Phase 3 — Pre-merge audit.** Run the gates in `references/audit-checklist.md`. They are not warnings — every failure blocks merge.

**Do not skip Phase 1.** The whole point of a variant is committing to a single visual metaphor and translating it consistently into tokens, typography, layout, motion, and copy. You cannot do that by writing CSS first and explaining it later. Coherence comes from the contract.

The variant package is not a free-form React project. It is a render of a fixed, schema-validated content model under a metaphor you committed to. Phase 1 fixes the metaphor, Phase 2 implements it, Phase 3 verifies it.

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
  - Load `references/styling-conventions.md` while writing this — class naming, scope discipline, scheme/preset cascade order, and dark-theme conventions are codified there.
- Wire theme toggle: import `useTheme` from `@portfolio/kit` and build your own toggle component in `src/primitives/theme-toggle.tsx`. Filter the rendered buttons against your `manifest.themes` so users only see modes your variant supports; always render the `system` button (it resolves to mandatory light/dark). Editorial's toggle in `packages/variant-editorial/src/primitives/theme-toggle.tsx` is the reference implementation.
- Run `pnpm --filter @portfolio/web build:registry` to regenerate the registry so the host picks up the new variant.
- Verify: `pnpm dev`, visit `/preview/<slug>`. Every section should render via `FallbackSection`. Schemes and typography presets should switch via the variant settings UI without crashing.

### Wave 2 — Renderers

Implement bespoke renderers one cluster at a time. The schema groups section kinds into clusters that share data shapes and visual idiom; render them together so the metaphor stays consistent within a cluster.

For each cluster:

1. Load `references/kit-catalog.md` and prefer kit helpers (layout primitives, list renderers, link normalizers, period formatters, image components) over re-inventing.
2. Load `references/section-kinds.md` for the data each kind actually carries — what's required, what's optional, what shapes nest.
3. Implement renderers in `src/renderers/<kind>.tsx` (or whatever file structure your variant uses; consistency matters more than the path).
4. Update `src/section.tsx` (the section dispatch) to route the new renderers; remove the cluster's kinds from the `FallbackSection` fallback path.
5. Before closing the cluster, run `node docs/skills/variant-developer/scripts/kit-dedup.mjs packages/variant-<slug>`. Resolve every candidate either by **hoisting** the helper to `packages/kit/src/<topic>.ts` and importing it back, or by leaving a `// LOCAL: <reason>` comment justifying the local copy.
6. Run `/preview/<slug>` and `/<slug>` against `portfolio.example.yml` and verify each cluster's renderers display correctly with real data.

The clusters:

- **Identity** — `hero`, `lede`, `now`, `contact`, `cta`. User-facing voice; the variant's first impression.
- **Career** — `experience`, `education`, `tenure`, `focus`. Time-anchored chronology.
- **Body of work** — `projects`, `writings`, `publications`, `talks`, `awards`, `episodes`, `patents`, `gallery`, `discography`. List-dense outputs; the bulk of most portfolios.
- **Voice** — `testimonials`, `press`, `quote`. Social proof.
- **Skills** — `skills`, `stack`, `services`, `fun-facts`, `stats`. Tag/list-dense identity adjacent.
- **External** — `external-portfolios`, `github`. Off-platform identity surfaces.

### Wave 3 — Polish

- **Navigation.** Pick the affordance that matches the metaphor. Examples: TOC for editorial, hamburger overlay for single-page kinetic, sidebar for dense bento, marginalia for long-form. Use `deriveNavItems` from `@portfolio/kit` to build the nav model from the rendered sections — do not hand-author it.
- **Screenshots.** Add `manifest.screenshots` entries. Capture static PNGs and place them under `apps/web/public/variants/<slug>/`. Cover at least one screenshot per scheme + preset combination so the gallery thumbnails reflect the variant's range.
- **Print.** If `capabilities.print = true`, write the print stylesheet inside `styles.css` (`@media print { [data-variant='your-slug'] { … } }`) and verify in Chrome's print preview. If you cannot make print look reasonable, set `capabilities.print = false` instead of shipping a broken stylesheet.
- **Performance tier honesty.** If you claimed `medium` or `heavy`, mobile-test it on a real device or throttled emulator. The audit does not catch a lying tier; the user does, on launch.

## 5. Phase 3 — Pre-merge audit

Run `references/audit-checklist.md`. Specifically:

1. `node docs/skills/variant-developer/scripts/audit.mjs packages/variant-<slug>` — must exit 0. Failures here include manifest schema breaks, missing `light`/`dark` themes, unsupported kinds, missing screenshots referenced by the manifest, and a few other hard contracts.
2. `pnpm typecheck` — must pass for the whole workspace, not just your package.
3. `pnpm lint` — must pass.
4. `pnpm --filter @portfolio/web build` — must succeed. The host build is the integration test.
5. `node docs/skills/variant-developer/scripts/kit-dedup.mjs packages/variant-<slug>` — every candidate is either hoisted or marked `// LOCAL: <reason>`. Unresolved candidates fail the gate.
6. Manual: focus order on tab traversal, color contrast on every scheme, reduced-motion behavior, alt text on every image, screenshots present on disk and referenced by the manifest.

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

Environment-specific facts that bite agents who skip the references:

- The variant registry is **auto-generated**. If `/variants` doesn't show your variant after install, run `pnpm --filter @portfolio/web build:registry` — the registry isn't re-run on every dev reload.
- `manifest.themes` MUST include `'light'` and `'dark'`. The platform's `ThemePreference` is `light|dark|system`; `system` resolves to one of the two. A variant missing either theme fails the audit.
- The `data-variant` attribute scopes ALL your CSS. Forget it on a selector and styles bleed into every other variant on the `/variants` gallery page. Every selector in `src/styles.css` must start with `[data-variant='your-slug']`.
- Color-scheme overrides go on `[data-variant='X'][data-color-scheme='id'] { ... }`. Without the variant scope, schemes leak globally — every variant on `/variants` flips when the user changes one variant's scheme.
- `@portfolio/kit/spatial-r3f` (react-three-fiber) is heavy — only import if `manifest.performanceTier` is `medium` or `heavy` AND your variant intentionally uses WebGL. The audit cross-checks; pulling R3F into a `light` variant fails.
- Section data may be missing. **Every renderer must handle `items: []`, `groups: []`, optional fields = undefined.** The host does not filter empty sections — your renderer must render gracefully or return `null`. Defensive destructuring is not optional.
- New section kinds added to the schema will **fail your audit** if you don't update `supportedKinds`. If a kind doesn't fit your metaphor, route it to `FallbackSection` explicitly rather than omitting — manifest still claims coverage and the user gets the data, just without bespoke styling.
- `next.config.ts` has `reactStrictMode: false` because R3F survives WebGL context loss only without strict double-mount. **Don't change this from a variant package.** If you need strict mode for your own component, wrap that subtree in `<StrictMode>` locally.
- Variants use **plain CSS with BEM-style class names** (e.g. `editorial-project__title`), not Tailwind. Convention: `<variant-slug>-<block>__<element>`. Tailwind is reserved for `apps/web` chrome; the variant package owns its own stylesheet.

## 8. Hand-off

When all gates pass:

- Push `DESIGN.md` and the variant package on the same branch as the PR. The contract and the implementation must travel together.
- Tell the user how to set their `portfolio.yml`'s `variant: <slug>` field to test the variant against their real data, not just `portfolio.example.yml`.
- Ask whether they want the variant added to the `/variants` gallery (workspace listing). Some variants are personal-use only; don't assume gallery inclusion.
- Don't run `pnpm dev` for them unless they ask. Their dev environment is theirs to control.

That's the skill. Design, implement in waves, audit, hand off, stop.
