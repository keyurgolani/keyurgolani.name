# Contributing

Thanks for considering a contribution. This document covers development setup, the conventions we follow, and the drift gates that must stay green.

## Development setup

```sh
git clone https://github.com/keyurgolani/keyurgolani.name.git
cd keyurgolani.name
pnpm install
pnpm dev
```

Requirements:

- **Node.js 22+** (see `engines.node` in `package.json`)
- **pnpm 10.33+** (the repo pins `packageManager` exactly)

## Repo shape

This is a pnpm workspace monorepo. Two apps and four packages:

| Package                      | What it is                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `apps/web`                   | Next.js 16 host: routes, portfolio loading, SEO, the variant picker                                      |
| `packages/schema`            | Zod schemas for `portfolio.yml`. Source of truth for section kinds.                                      |
| `packages/kit`               | Shared variant-author utilities: theme provider, GitHub fetcher, format helpers, SEO, spatial primitives |
| `packages/variant-editorial` | The first variant — a typographic editorial spread                                                       |
| `packages/variant-template`  | Scaffold copied by `pnpm new-variant` (`skills/variant-developer/scripts/new-variant.mjs`)               |

All packages are workspace-linked via `workspace:*` in their dependencies.

## Workflows

### Edit a portfolio (no code)

Just edit `portfolio.yml` at the repo root. `pnpm dev` hot-reloads on change. Validate with:

```sh
node skills/portfolio-author/scripts/validate.mjs portfolio.yml
```

### Add a new variant

```sh
pnpm new-variant my-slug
```

Then implement the manifest, renderers, and CSS in `packages/variant-my-slug/`. Audit your work with:

```sh
node skills/variant-developer/scripts/audit.mjs packages/variant-my-slug
```

See [docs/variants.md](docs/variants.md) for the full walkthrough.

### Modify the schema

If you add or change a section kind in `packages/schema/src/kinds/`, you must also:

1. Update `skills/portfolio-author/references/section-kinds.md` and `skills/variant-developer/references/section-kinds.md` (kept byte-identical by `sync-checks.mjs`).
2. Update `skills/portfolio-author/references/schema.md`.
3. Add the kind to every variant's `supportedKinds` (or to `ALL_SECTION_KINDS` filter).
4. Implement a renderer (or rely on `FallbackSection`).

The drift gates below catch most of these.

## Checks

CI runs these on every pull request. Each CI step runs the matching `pnpm ci:<job>` script, so a failure prints the command that reproduces it.

```sh
pnpm format:check      # Prettier; pnpm format fixes it
pnpm lint              # ESLint; warnings fail too
pnpm typecheck         # tsc across the workspace and the test harness
pnpm test              # package suites plus the ci/ and skills/ script tests
pnpm check:skills      # parity between schema, kit, skill refs, frontmatter
pnpm build             # production build of apps/web
pnpm ci:browser        # Playwright smoke against that build
```

Run `pnpm exec playwright install chromium` once before the browser smoke. `pnpm ci:image` builds and checks the container image with Docker (`CONTAINER_CLI=finch` for Finch).

Tests use Node's built-in `node:test`, through `tsx` for TypeScript. A single file runs directly, for example `pnpm exec tsx --test packages/kit/src/format.test.ts`.

## Conventions

- **Commit messages** follow Conventional Commits (`feat`, `fix`, `docs`, `chore`, `ci`, `refactor`, `test`).
- **Branches** are short-lived. PRs land after the `gate` check passes.
- **TDD** for kit helpers, schema validators, and audit scripts: write the test first, watch it fail, implement, watch it pass.
- **No emojis in code or files** unless explicitly authored by the user. Use Lucide icons in UI.
- **Stay focused.** Don't restructure unrelated code as part of a feature change.

## Code review

PRs get reviewed against the spec they implement. The review focuses on:

- Spec compliance — does the code do what was asked, nothing more, nothing less?
- Code quality — naming, file decomposition, test depth, drift surface area.
- Drift gate health — did this PR keep `pnpm check:skills` green?

For larger changes, write a spec under `docs/superpowers/specs/` and a plan under `docs/superpowers/plans/` first. The two skills (`portfolio-author`, `variant-developer`) and the brainstorming/writing-plans/subagent-driven-development workflows are designed to scaffold this.

## Questions

Open an issue. Tag it `question` if it's not a bug or feature request.
