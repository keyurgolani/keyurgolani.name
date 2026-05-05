# Pre-merge audit checklist

> Run before declaring a variant complete. Failures are not warnings.
> Loaded at the start of Phase 3 (audit). Used as the sign-off contract
> with the user before merging.
>
> The checklist is split into **scripted gates** (cheap, automatable, run
> frequently) and **visual gates** (more expensive, run at sign-off — see
> `references/quality-gates.md` for the recipes).

## Scripted gates

Run frequently during Wave 2/3, and once final at Phase 3 entry.

- [ ] `node skills/variant-developer/scripts/audit.mjs packages/variant-<slug>` exits 0.
- [ ] `pnpm typecheck` passes for the variant package and the rest of the monorepo.
- [ ] `pnpm --filter @portfolio/variant-<slug> lint` passes (full `pnpm lint` may fail on host-level scripting bugs unrelated to your variant — file an issue if so).
- [ ] `pnpm --filter @portfolio/web build` succeeds.
- [ ] `pnpm --filter @portfolio/web build:registry` lists the new variant in `registry.generated.ts` AND adds an import to `registry.styles.generated.ts`.
- [ ] `node skills/variant-developer/scripts/kit-dedup.mjs packages/variant-<slug>` candidates are all resolved (hoisted or marked `// LOCAL: <reason>`).
- [ ] If you hoisted to `@portfolio/kit`: `pnpm --filter @portfolio/kit test` passes (≥ 80% branch coverage on pure utilities).
- [ ] `node skills/scripts/sync-checks.mjs` passes — every kit export appears by name in `references/kit-catalog.md`.

## Coverage

- [ ] `supportedKinds` contains every kind in `ALL_SECTION_KINDS`.
- [ ] Every kind in `supportedKinds` has either a bespoke renderer or explicit `FallbackSection` routing in section dispatch.

## Themes & schemes

- [ ] `themes` contains both `'light'` and `'dark'`.
- [ ] DESIGN.md justifies the count of color schemes and typography presets.
- [ ] Each declared color scheme has both a light and dark CSS block in styles.css. If you declare `'bright'` or `'black'`, those blocks exist too.
- [ ] Each typography preset is testable on the live `/preview/<slug>?typography=<id>` URL.

## Visual gates (see `references/quality-gates.md`)

- [ ] **Gate A — Visual sanity.** `/preview/<slug>` renders with your variant's tokens applied (paper color, font family, theme toggle visible). NOT plain user-agent default.
- [ ] **Gate B — Theme × scheme × typography matrix.** ≥ 9 screenshots captured across the meaningful combinations. No contrast bugs surface.
- [ ] **Gate C — Reduced-motion programmatic verification.**
  - [ ] Canvas pixel-sample stable across 300ms with reduce-motion ON.
  - [ ] Floater transform string-equal across 400px scroll.
  - [ ] Typing animation textContent stable across 500ms.
- [ ] **Gate D — Print preview.** Backgrounds white, ink black, decorative chrome hidden, gradient text solid, no theme bleed. Or `capabilities.print = false` and DESIGN.md says so.
- [ ] **Gate E — `/variants` listing entry.** Card displays correctly with name, version, chips, screenshots, activate/preview buttons.
- [ ] **Gate F — Screenshots.** PNGs exist on disk at every path declared in `manifest.screenshots`.
- [ ] **Gate G — Fidelity comparison vs reference** (port-only). Every box in DESIGN.md's `## Fidelity targets` is checked or has a documented intentional drop.
- [ ] **Gate H — Real-data testing.** Tested against the user's actual `portfolio.yml`, not just `portfolio.example.yml`. Long names, missing optional fields, non-ASCII characters all render correctly.
- [ ] **Gate I — Mobile breakpoint sweep.** 375×667 and 430×932 viewports — no horizontal overflow, decorative floaters hidden, nav collapsed, hit targets ≥ 44×44px.

## Accessibility

- [ ] Focus order matches reading order on the default scheme.
- [ ] All imagery has `alt` text or `aria-hidden`.
- [ ] Default scheme passes 4.5:1 contrast on body text and 3:1 on large headings (verified via DevTools color picker or computed styles).
- [ ] `prefers-reduced-motion` reduces or removes all motion (Gate C above is the rigorous check).
- [ ] Keyboard navigation reaches every interactive element. Hit-target sizing meets 44×44px minimum.
- [ ] Skip link is the first focusable element and reaches `<main id="main">`.

## Hand-off

Once all gates pass:

- [ ] Push DESIGN.md and the variant package on the same branch as the PR.
- [ ] In the PR description, paste:
  - Audit script output (the "audit clean" line).
  - Kit-catalog updates (delta from `git diff` on the catalog).
  - Matrix sweep screenshot folder reference.
  - Fidelity targets table from DESIGN.md (port-only) with each box's status.
  - Reduced-motion verification snippets and their results.
- [ ] Tag the user's `portfolio.yml` `variant: <slug>` to demonstrate live rendering during review.

## Warnings

- **WARN: themes declares 'bright'/'black' without [data-theme] CSS block** — your manifest claims a theme the visitor can pick, but the CSS doesn't have a block for it. Add the block (see `references/styling-conventions.md`) or drop the claim from `themes`.

## Common failure modes

- **Audit fails on missing kind** — the schema added a new kind since you started. Update `supportedKinds` (and add a renderer or FallbackSection route).
- **Typecheck fails on missing renderer** — section.tsx has a `case 'X':` but no imported renderer. Add the import or route through FallbackSection.
- **Build fails on registry** — variant didn't land in `apps/web/node_modules/@portfolio/`. Run `pnpm install` to symlink the workspace.
- **Variant renders as plain HTML** — the `registry.styles.generated.ts` file doesn't include your variant. Run `pnpm --filter @portfolio/web build:registry` and verify the new import landed.
- **Buttons render with wrong text color** — the global anchor rule is overriding component classes. Restrict it with `:not([class])` (see `references/common-bugs.md` §2).
- **Hero squeezed to 80px wide** — a CSS rule is targeting `[id='top']` and matching the hero `<section id="top">` (because `ensureSectionId` falls back to `'top'`). Don't use single-word reserved IDs (`references/common-bugs.md` §4).
- **SVG branches/gradients invisible** — gradient IDs contain spaces. Slugify (`references/common-bugs.md` §3).
- **Reduced-motion still animating** — the rAF loop or framer-motion hook isn't gated. CSS alone isn't enough (`references/common-bugs.md` §8).
- **Print preview renders dark cards** — theme tokens leaking into print. Reset every `--kc-*` variable inside `@media print` (`references/common-bugs.md` §5).
- **Visual regression** — your variant's CSS leaked into another variant on `/variants`. Verify every selector starts with `[data-variant='your-slug']`.
