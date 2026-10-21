# Contributing

Thanks for considering a contribution. This document covers development setup, the conventions we follow, and the [checks](#checks) that must stay green.

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

This is a pnpm workspace monorepo. One app and five packages:

| Package                         | What it is                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `apps/web`                      | Next.js 16 host: startup checks, the document pair, the variant registry, routes, SEO                          |
| `packages/schema`               | The portfolio and site schemas, validation, extensions, and the migration. Source of truth for both documents. |
| `packages/variant-contract`     | The variant contract: the manifest, the render input, controls, routes, the registry reader, and the audit     |
| `packages/kit`                  | Shared variant-author utilities: the shared section renderers, enhancements, motion, format helpers, SEO       |
| `packages/core`                 | Server-only owner code: the auth provider                                                                      |
| `packages/fallback-composition` | The composition that renders when the site's variant isn't registered, and the one `pnpm new-variant` copies   |

`legacy/` holds the retired v1 Editorial and Kinetic Cosmos variants, outside the workspace, for #13 and #14 to rebuild. Nothing installs, builds, lints, or tests it.

All packages are workspace-linked via `workspace:*` in their dependencies.

## Workflows

### Edit a portfolio (no code)

Copy `portfolio.example.yml` to `config/portfolio.yml` and `site.example.yml` to `config/site.yml`, and edit them. `pnpm dev` picks up each save on the next page load. Validate the pair with:

```sh
node skills/portfolio-author/scripts/validate.mjs config
```

### Add a new variant

```sh
pnpm new-variant my-id
```

It copies the fallback composition to `packages/variant-my-id/` and adds it to `@portfolio/web`. Then implement the manifest, renderers, and layout CSS there, and check your work with:

```sh
pnpm check:variants --package @portfolio/variant-my-id
```

A variant is composition only: color, type, and display modes are the appearance system's (#19). See [docs/variants.md](docs/variants.md) for the full walkthrough.

### Modify the schema

If you add or change a section kind in `packages/schema/src/kinds/`, you must also:

1. Update `skills/portfolio-author/references/section-kinds.md` and `skills/variant-developer/references/section-kinds.md` (kept byte-identical by `sync-checks.mjs`).
2. Update `skills/portfolio-author/references/schema.md`.
3. Add a shared renderer for it to `@portfolio/kit/sections`, so every variant renders it. A variant that renders it bespoke lists it in its manifest's `renderedKinds`.

The [checks](#checks) below catch most of these. A change to either document's fields also updates [docs/configuration.md](docs/configuration.md), and a change an existing document wouldn't pass bumps `schemaVersion` with a migration step in `packages/schema/src/migrate/`. A field for one profession belongs in a content extension instead.

## Checks

CI runs these on every pull request. Each CI step runs the matching `pnpm ci:<job>` script, so a failure prints the command that reproduces it.

```sh
pnpm format:check      # Prettier; pnpm format fixes it
pnpm lint              # ESLint; warnings fail too
pnpm typecheck         # tsc across the workspace and the test harness
pnpm test              # package suites plus the ci/, skills/, and test harness script tests
pnpm check:skills      # parity between schema, kit, skill refs, frontmatter
pnpm check:registry    # the variant registry builds the same twice, and check:variants passes
pnpm build             # production build of apps/web
pnpm ci:browser        # Playwright smoke against that build
```

Run `pnpm exec playwright install chromium` once before the browser smoke. `pnpm ci:image` builds and checks the container image with Docker (`CONTAINER_CLI=finch` for Finch).

Two more check the deployment profiles. `pnpm --filter @portfolio/web test:profiles` builds once with no profile set and runs the route matrix and the canary scan against the built server under `read-only` and `demo`. `pnpm smoke:profiles` builds the image and runs it under every profile and every startup row, those that refuse to start and those that start with a warning, with the same `CONTAINER_CLI` choice.

Tests use Node's built-in `node:test`, through `tsx` for TypeScript. A single file runs directly, for example `pnpm exec tsx --test packages/kit/src/format.test.ts`. In `apps/web`, `*.test.ts` files cover server modules and run with `--conditions=react-server`; `*.test.tsx` files render pages with `react-dom/server`, which needs the default conditions, so they run without it.

## Conventions

- **Commit messages** follow Conventional Commits (`feat`, `fix`, `docs`, `chore`, `ci`, `refactor`, `test`).
- **Branches** are short-lived. PRs land after the `gate` check passes.
- **TDD** for kit helpers, schema and contract validators, and check scripts: write the test first, watch it fail, implement, watch it pass.
- **No emojis in code or files** unless explicitly authored by the user. Use Lucide icons in UI.
- **Stay focused.** Don't restructure unrelated code as part of a feature change.
- **Threats.** A change that adds an entry point, an asset, or a security control adds or updates its row in `docs/threat-model.md`, naming the test that proves it. `pnpm test` fails when a row cites a test file or title that doesn't exist.
- **Routes** in `apps/web/src/app` need an entry in `apps/web/src/server/routes.ts`, and their guard wraps what they export, with their own pattern: `export default servedPage('<pattern>', render)` in pages and metadata routes, `export const GET = served('<pattern>', handler)` for each route handler method. Server Functions (`'use server'`) aren't allowed; add an operation to `server/operations.ts` instead. `pnpm test` fails on either.

## Code review

PRs get reviewed against the spec they implement. The review focuses on:

- Spec compliance: does the code do what was asked, nothing more, nothing less?
- Code quality: naming, file decomposition, test depth, drift surface area.
- Drift gate health: did this PR keep `pnpm check:skills` green?

For larger changes, write a spec under `docs/superpowers/specs/` and a plan under `docs/superpowers/plans/` first. The two skills (`portfolio-author`, `variant-developer`) and the brainstorming/writing-plans/subagent-driven-development workflows are designed to scaffold this.

## Questions

Open an issue. Tag it `question` if it's not a bug or feature request.
