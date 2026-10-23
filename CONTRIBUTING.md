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

This is a pnpm workspace monorepo. One app and six packages:

| Package                         | What it is                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `apps/web`                      | Next.js 16 host: startup checks, the document pair, the variant registry, routes, SEO                          |
| `packages/schema`               | The portfolio and site schemas, validation, extensions, and the migration. Source of truth for both documents. |
| `packages/variant-contract`     | The variant contract: the manifest, the render input, controls, routes, the registry reader, and the audit     |
| `packages/appearance`           | The appearance axes (#19): the token contract, pack manifests, the registry, and the resolver                  |
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
pnpm build && PORTFOLIO_VARIANTS_ONLY=my-id pnpm test:variants
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
pnpm test              # package suites plus the ci/, skills/, test harness, and tests/quality tests
pnpm check:skills      # parity between schema, kit, skill refs, frontmatter
pnpm check:registry    # the variant registry builds the same twice, and nothing generated is committed
pnpm check:variants    # the source audit over every registered variant
pnpm check:appearance  # the contrast gate over every registered appearance combination
pnpm quality:exceptions # quality/exceptions.yml and runtime-budgets.json's exceptions block, on the run's UTC date
pnpm quality:meta      # each quality gate fails its known-bad inputs for the reasons they name and passes its known-good ones
pnpm build             # production build of apps/web
pnpm check:source-maps # that build shipped no browser source map
pnpm check:standalone  # that build's standalone output holds the bundled sample and nothing the image scan refuses
pnpm ci:browser        # Playwright smoke against that build
pnpm test:routes       # route specs against a fixture host with test-only variants
pnpm test:appearance   # the shared primitives on /_fixtures/appearance, against a fixture host built with APPEARANCE_FIXTURES=1
pnpm test:variants     # every registered variant on every contract fixture, in six modes, against that build
pnpm test:external-variant  # the reference third-party variant, installed in a temporary worktree and removed
pnpm test:trace        # the runtime trace against that build: requests, bytes, long tasks, idle work
```

`quality/thresholds.json` (#11) holds every limit the quality gates and #19's contrast gate use, validated by `quality/thresholds.ts`. `pnpm check:appearance` takes its targets from it, and a test holds `@portfolio/appearance`'s browser default, `GATE_TARGETS`, to it. `pnpm quality:exceptions` validates `quality/exceptions.yml`, which starts empty, and `runtime-budgets.json`'s `exceptions` block. An exception names its owner, rationale, affected users, fallback, tracking issue, and a scope of exactly the fields its gate varies on, expires at most 90 days after it's created, and can't waive a WCAG A or AA failure on essential content. `pnpm quality:meta` runs each gate's known-bad and known-good inputs from `tests/quality/fixtures/` through the real gate: the static workflow check, which fails a `pull_request_target` trigger and any job a pull request can run with more than `contents: read` and `actions: read` or with a secret; the exceptions validator; `pnpm check:appearance` over the tier fixture packs and the known-bad scheme; and the fixture gate's leak check. `pnpm test` runs both.

`pnpm test:trace` (#6) boots the build once per registered variant on the `complete` contract fixture and traces `/` at 1440x900 and 390x844, in Chromium: every request with its bytes, redirect hops and WebSockets among them, long tasks with the CPU throttled 4x, CSP violations, frame loops, recurring timers, canvas contexts, running infinite animations, two seconds of idle main-thread work, and what it ran under. It sends nothing but GET and HEAD, aborts every request outside the app it routes, and Chromium resolves no name but 127.0.0.1 and localhost and uses no proxy, so a redirect hop it never routes reaches no host either. Every request outside the app fails the case. A self-test on loopback proves that policy before any trace runs. After `PORTFOLIO_ANALYZE=1 pnpm build`, which alone ships source maps, it also splits each downloaded chunk's bytes by package. The report is `reports/trace/trace-report.json`, and `node tests/trace/calibrate.mjs` writes an entry of `runtime-budgets.json`'s calibration block from one, named by its base commit and the tree ids of `apps/` and `packages/`, from a clean checkout and a trace that passed.

`--base-url <origin>` traces a server on this machine that the trace didn't start. That server has to bind 127.0.0.1 and run with its own egress blocked, since the trace can only keep the browser in: start it the way `pnpm test:trace:baseline` does. `--allow-third-party`, for the baseline calibration only, records the third-party requests rather than failing on them, and still fails on any that got an answer. `pnpm test:trace:baseline` runs the baseline calibration end to end: a detached worktree of `62a0f06`, a frozen install, the build and `next start -H 127.0.0.1` on a free port with server egress sent to a refusing trap and `offline-fetch.mjs` preloaded, telemetry off, the trace, and teardown. It writes the trace report and `reports/trace/baseline-evidence.json`, which shows what was refused and every socket the build, the server, and the browser held.

Run `pnpm exec playwright install chromium` once before the browser smoke. `pnpm test:routes` builds a host of its own, a copy of the workspace outside the checkout with the variants in `tests/fixtures/variants/` installed offline from the pnpm store, so it needs `pnpm install` but no `pnpm build`. `pnpm test:appearance` builds its own the same way, with `APPEARANCE_FIXTURES=1`, so the fixture packs register and `/_fixtures/appearance` serves the keyboard, focus, and plate checks. `pnpm test:external-variant` does the same in a temporary `git worktree` of HEAD, so commit before you run it; its add and remove may read package metadata from the registry. [docs/variants.md](docs/variants.md#testing-a-variant) says what both variant suites check. Registry generation leaves the test fixture packages out unless their flag is set: with `APPEARANCE_FIXTURES=1`, `pnpm build` and `pnpm dev` also register the appearance fixture packs in `packages/appearance-fixtures-*`, and a build without it fails if any of their ids reach the registry. `QUALITY_FIXTURES=1` registers #11's nine tier fixture packs, a Stable, an Extended, and an Experimental pack on each axis in `packages/quality-fixtures-{languages,schemes,typography}`, which `pnpm check:appearance` gates as it gates shipping packs. `QUALITY_FIXTURES=meta` adds the known-bad scheme in `packages/quality-fixtures-schemes-meta`, which it must fail. `pnpm ci:image` builds and checks the container image with Docker (`CONTAINER_CLI=finch` for Finch).

Two more check the deployment profiles. `pnpm --filter @portfolio/web test:profiles` builds once with no profile set and runs the route matrix and the canary scan against the built server under `read-only`, `demo`, and `owner`, with a password made for the run, and checks that `owner` refuses to start without a password hash and a data directory. `pnpm smoke:profiles` builds the image and runs it under every profile and every startup row, those that refuse to start and those that start with a warning, with the same `CONTAINER_CLI` choice.

Two run the owner security suite (#2): sign-in, sessions, CSRF, origin checks, expiry, revocation, and a canary scan of every response, the server's output, and its data directory. `pnpm --filter @portfolio/web test:security` builds and runs it straight against the server over http, with no trusted proxy hop. `pnpm --filter @portfolio/web test:security:proxy` runs it against the image behind the HTTPS proxy fixture, with one trusted hop: build the image first with `pnpm ci:image`, and point `PORTFOLIO_IMAGE` at it if you gave it another tag. In CI the browser job runs the first one's spec with the rest of the browser suite, and the image job runs the second as `pnpm ci:security-proxy`.

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
