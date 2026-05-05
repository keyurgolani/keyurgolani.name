# Pre-merge audit checklist

> Run before declaring a variant complete. Failures are not warnings.
> Loaded at the start of Phase 3 (audit). Used as the sign-off contract
> with the user before merging.

## Hard gates

These must all pass. Failure means the variant is not ready.

- [ ] `node docs/skills/variant-developer/scripts/audit.mjs packages/variant-<slug>` exits 0.
- [ ] `pnpm typecheck` passes for the variant package and the rest of the monorepo.
- [ ] `pnpm lint` passes for the variant package.
- [ ] `pnpm --filter @portfolio/web build` succeeds.
- [ ] `pnpm --filter @portfolio/web build:registry` lists the new variant in registry.generated.ts.

## Coverage

- [ ] `supportedKinds` contains every kind in `ALL_SECTION_KINDS`.
- [ ] Every kind in `supportedKinds` has either a bespoke renderer or explicit `FallbackSection` routing in section dispatch.

## Themes & schemes

- [ ] `themes` contains both `'light'` and `'dark'`.
- [ ] DESIGN.md justifies the count of color schemes and typography presets.
- [ ] Each declared color scheme has both a light and dark variant in styles.css.
- [ ] Each typography preset is testable on the live `/preview/<slug>?typography=<id>` URL.

## Kit dedup

- [ ] `node docs/skills/variant-developer/scripts/kit-dedup.mjs packages/variant-<slug>` candidates are all resolved (hoisted or marked `// LOCAL:`).
- [ ] Any helper hoisted to `@portfolio/kit` has been added to `docs/skills/variant-developer/references/kit-catalog.md`.

## Accessibility

- [ ] Focus order matches reading order on the default scheme.
- [ ] All imagery has `alt` text or `aria-hidden`.
- [ ] Default scheme passes 4.5:1 contrast on body text and 3:1 on large headings.
- [ ] `prefers-reduced-motion` reduces or removes all motion.
- [ ] Keyboard navigation reaches every interactive element.

## Visual

- [ ] `manifest.screenshots` covers each color scheme + typography preset combination at minimum 1 screenshot each.
- [ ] Screenshots are committed as static assets under `apps/web/public/variants/<slug>/`.

## Print

- [ ] If `capabilities.print = true`: the print stylesheet has been verified in Chrome's print preview AND on a real-data portfolio.

## Hand-off

Once all gates pass:

- [ ] Push DESIGN.md and the variant package on the same branch as the PR.
- [ ] In the PR description, paste the audit output and the kit-catalog updates.
- [ ] Tag the user's portfolio.yml `variant: <slug>` to demonstrate live rendering during review.

## Warnings

- **WARN: themes declares 'bright'/'black' without [data-theme] CSS block** — your manifest claims a theme the visitor can pick, but the CSS doesn't have a block for it. Add the block (see styling-conventions.md) or drop the claim from `themes`.

## Common failure modes

- **Audit fails on missing kind** — the schema added a new kind since you started. Update `supportedKinds` (and add a renderer or FallbackSection route).
- **Typecheck fails on missing renderer** — section.tsx has a `case 'X':` but no imported renderer. Add the import or route through FallbackSection.
- **Build fails on registry** — variant didn't land in `apps/web/node_modules/@portfolio/`. Run `pnpm install` to symlink the workspace.
- **Visual regression** — your variant's CSS leaked into another variant on `/variants`. Verify every selector starts with `[data-variant='your-slug']`.
