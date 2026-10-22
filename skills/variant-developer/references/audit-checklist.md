# Pre-merge audit checklist

> Run before declaring a variant complete. Failures are not warnings.
> Loaded at the start of Phase 3, and used as the sign-off contract with
> the user before merging.
>
> The checklist splits into **scripted gates** (cheap, run often) and
> **visual gates** (run at sign-off; `references/quality-gates.md` has the
> recipes).

## Scripted gates

Run often in Waves 2 and 3, and once more at Phase 3.

- [ ] `pnpm check:variants --package @portfolio/variant-<id>` exits 0: the registry registers the package and the source audit finds nothing. Then `pnpm check:variants` with no flag, which also checks every other registered variant. Both check the kit modules the variants reach and the kit's shared stylesheet.
- [ ] `pnpm typecheck` passes for the whole workspace.
- [ ] `pnpm exec eslint packages/variant-<id>` passes.
- [ ] `pnpm build` succeeds.
- [ ] `pnpm exec playwright test tests/e2e/motion-contract.spec.ts` passes for your composition, after `pnpm build`.
- [ ] `node skills/variant-developer/scripts/kit-dedup.mjs packages/variant-<id>`: every candidate hoisted or marked `// LOCAL: <reason>`.
- [ ] If you hoisted to `@portfolio/kit`: `pnpm --filter @portfolio/kit test` passes.
- [ ] `node skills/scripts/sync-checks.mjs` passes: every kit export appears by name in `references/kit-catalog.md`.
- [ ] `PORTFOLIO_VARIANTS_ONLY=<id> pnpm test:variants` passes, after `pnpm build`: every contract fixture and the bundled sample in six modes, the hidden canary, and render parity.

## The manifest

- [ ] `promise` is DESIGN.md's composition idea, in one sentence.
- [ ] `renderedKinds` lists exactly the kinds with a bespoke renderer, and the renderer map passed to `renderSection` has exactly those.
- [ ] Every kind in `unsupportedKinds` has a reason in DESIGN.md. Every other kind renders through the shared renderer.
- [ ] No control chooses appearance: no palette, color, type, material, shape, display mode, or motion timing.
- [ ] `textDirection` includes `rtl` only when the styles are logical throughout and an Arabic pair reads correctly.
- [ ] `provenance` names each source and its disposition, with a note for every retired one.

## The page

- [ ] Exactly one `<main id={input.ids.main}>` and exactly one `<VisitorControlSlot />`.
- [ ] Every id the variant renders starts with `input.ids.prefix`.
- [ ] Navigation links only sections that render.
- [ ] The page reads completely with every enhancement missing (`globalThis.__portfolioFailEnhancements = true`), and each enhancement's space is reserved.

## Visual gates (see `references/quality-gates.md`)

- [ ] **Gate A: Visual sanity.** `/sample?variant=<id>` renders your structure (`scripts/visual-companion/start.sh --mode preview --variant <id>`).
- [ ] **Gate B: Content matrix.** The sample, a sparse pair, and a dense pair: the structure holds in each.
- [ ] **Gate C: Reduced motion.** The motion contract passes, and anything it can't see (a canvas, a typing animation) is stable under the programmatic checks.
- [ ] **Gate D: Print preview.** Navigation and decoration hidden, content in reading order.
- [ ] **Gate G: Fidelity against the reference** (port-only). Every box in DESIGN.md's `## Fidelity targets` is checked or dropped with a reason.
- [ ] **Gate H: Real data.** The user's own pair: long names, missing optional fields, non-ASCII text, and a right-to-left pair.
- [ ] **Gate I: Mobile sweep.** 375×667 and 430×932: no horizontal overflow, decoration hidden, navigation collapsed, hit targets at least 44×44px.

## Accessibility

- [ ] Focus order matches reading order.
- [ ] Every image has alt text, or is marked decorative where adjacent text names it.
- [ ] Keyboard navigation reaches every interactive element, and focus is visible.
- [ ] The host's skip link reaches your `<main>`, which takes focus (`tabIndex={-1}`).
- [ ] Headings descend in order: the page's one `h1`, then `h2` per section.

## Hand-off

- [ ] DESIGN.md and the package are on the same branch as the PR.
- [ ] The PR description has the `check:variants` output, the kit-catalog delta, the motion contract result, the fidelity targets table (port-only), and where the screenshots are.
- [ ] A live render during review: `scripts/visual-companion/start.sh --mode preview --variant <id>`, at `/sample?variant=<id>`.

## Common failure modes

- **`/sample?variant=<id>` is a 404**: the build doesn't register the id. `pnpm check:variants --package @portfolio/variant-<id>` says why: the package isn't a dependency of `@portfolio/web`, an export is missing, or the manifest has an error.
- **`renderSection` throws about `renderedKinds`**: the manifest and the renderer map disagree. Add the kind to both or neither.
- **The page renders unstyled structure**: the `./styles.css` export is missing or points at the wrong file, or a selector isn't under `[data-variant='<id>']`.
- **`audit.client-input`**: a `'use client'` module takes the whole input or portfolio. Pass it only the fields it renders.
- **`audit.clock` or `audit.random`**: use `input.env.now` and `seededRandom(input.env.seed)`.
- **`audit.global-access`**: the audit can't follow how the code reaches a global, through a computed key or the global object passed around. Reach it by name.
- **`audit.css-appearance`**: a raw color, font, radius, or shadow. Leave it to #19's tokens, or read one with `var(--...)`.
- **Hero squeezed to 80px wide**: a rule targets `[id='top']`, which is often the hero's id. (`references/common-bugs.md` §4)
- **SVG gradients invisible**: a gradient id has spaces. Slugify it. (`references/common-bugs.md` §3)
- **Reduced motion still animating**: a script loop or framer-motion hook isn't gated. (`references/common-bugs.md` §8)
- **Another variant changed**: your CSS leaked. Every selector starts with `[data-variant='<id>']`.
