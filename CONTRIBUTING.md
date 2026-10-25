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

The compositions are packages too: `packages/variant-editorial-evidence` is the platform default (#13), and `packages/variant-kinetic-cosmos` (#14), `packages/variant-obsidian-atelier` (#15), and `packages/variant-spatial-bento` (#16) are ones a site can select. The retired v1 variants are gone; their history is in git.

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

CI runs these on pull requests, as [CI](#ci) describes. Each CI step runs the matching `pnpm ci:<job>` script, or a shard of one, so a failure prints the command that reproduces it. `pnpm check:docs` checks every relative link, anchor, and `pnpm` script the Markdown names.

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
pnpm quality:meta      # each quality gate fails its known-bad inputs for the reasons they name and passes its known-good ones, and the manual-run records validate
pnpm quality:pr        # the quality cells' PR set, plus the cells your changes direct, against a QUALITY_FIXTURES=1 build
pnpm quality:full -- --shard=1/8 --night=2026-10-24  # one of that night's eight shards of the complete quality matrix; pnpm quality:merge judges the shards whole
pnpm quality:full -- --night=2026-10-24  # that night's slice of the complete quality matrix, the one the nightly ran, on this machine
pnpm quality:release   # the complete quality matrix, unsharded, and the release-only gates
pnpm quality:checklist -- login  # the manual checklist for a registered surface or composition; --record prints a record to fill in
pnpm build             # production build of apps/web
pnpm check:source-maps # that build shipped no browser source map
pnpm check:standalone  # that build's standalone output holds the bundled sample and nothing the image scan refuses
pnpm ci:browser        # Playwright smoke against that build
pnpm test:routes       # route specs against a fixture host with test-only variants
pnpm test:appearance   # the shared primitives on /_fixtures/appearance, against a fixture host built with APPEARANCE_FIXTURES=1
pnpm test:preview-fixtures  # the preview's fixture renders and AC8, against a fixture host built with PREVIEW_FIXTURES=1
pnpm test:variants     # every registered variant on every contract fixture, in six modes, against that build
pnpm test:external-variant  # the reference third-party variant, installed in a temporary worktree and removed
pnpm test:trace        # the runtime trace and the purity assertion against a PORTFOLIO_ANALYZE=1 build
pnpm check:budgets     # every unit against its runtime budgets, from the build, ASSET_MANIFEST, and the trace
pnpm stills            # shoots each registered variant's catalog stills from that build, into its package
```

`quality/thresholds.json` (#11) holds every limit the quality gates and #19's contrast gate use, validated by `quality/thresholds.ts`. `pnpm check:appearance` takes its targets from it, and a test holds `@portfolio/appearance`'s browser default, `GATE_TARGETS`, to it. `pnpm quality:exceptions` validates `quality/exceptions.yml`, which starts empty, and `runtime-budgets.json`'s `exceptions` block. An exception names its owner, rationale, affected users, fallback, tracking issue, and a scope of exactly the fields its gate varies on, expires at most 90 days after it's created, and can't waive a WCAG A or AA failure on essential content. `pnpm quality:meta` runs each gate's known-bad and known-good inputs from `tests/quality/fixtures/` through the real gate: the static workflow check, which fails any `%YAML` directive, any `pull_request_target`, `workflow_run`, or `issue_comment` trigger, and any job a pull request or review can run with more than `contents: read` and `actions: read` or with a secret; the exceptions validator; `pnpm check:appearance` over the tier fixture packs and the known-bad scheme; the fixture gate's leak check; the quality runner's fail-closed rules and the accessibility suites; the merged verdict over a sharded run's shards; the release gates; and the manual-run records. `pnpm test` runs both.

### The quality cells

`pnpm quality:pr` and `pnpm quality:full` (#11) build a host with `QUALITY_FIXTURES=1` in a copy of the workspace, start a standalone server per cell on 127.0.0.1 with egress refused, and run the cells in Chromium: every registered composition and surface, in each viewport and preference row the plan gives it, through axe at WCAG 2.2 AA and the keyboard, focus, occlusion, overlay, hover, reflow, content, enhancement, motion, transparency, and contrast checks. `tests/quality/run.ts` judges the run fail-closed, scrubs every artifact under `reports/`, and fails when the planted canary is still in one. Run `pnpm exec playwright install chromium` once first.

A PR runs the sentinels: each composition's published default appearance, each tier pack on the fallback composition, each state fixture, and each surface's default state. It adds the owner's [37] change-directed cells: a change under a registered variant's package runs that variant against every stable design language, at every viewport in the default row and in every row at 1440x900, and a change to a pack, on any axis, runs it against every registered variant in the pack sweep (`tests/quality/lib/sweep.ts`). The sweep starts one server per variant and applies each changed pack through the visitor's preference cookie, one test per pack in a fresh browser context, which loads the page again for each row on the same page, in the [37] rule's five checks at 1440x900: axe on the contrast and target-size rules with the incomplete contrast resampled, focus in the default and forced-colors rows, motion under reduced motion, and transparency under reduced transparency. A page that doesn't render the pack it was given fails `sweep-pack`, and a test whose context held another cookie, or whose first load found localStorage in use, fails `sweep-isolation`. The sweep leaves the primitives page, occlusion, overlays, hover, the reload conditions, and the other viewports and rows to the nightly `quality:full`, which plans every pack and variant pair in all of them. CI's `quality-pr` job takes the changed paths from the merge commit (`QUALITY_CHANGED_BASE=HEAD^1`); locally, `QUALITY_CHANGED_BASE=origin/next pnpm quality:pr` does the same for your branch, diffing `origin/next...HEAD` from the merge base, so commits `next` gained since you branched direct nothing. A rename counts as both its paths. CI runs the PR set in as many shards as `quality-pr-plan` counts, `pnpm quality:pr -- --shard=<n>/<count>`, each running the test groups `tests/quality/lib/pr-shards.ts` gives it by measured duration (`tests/quality/shard-durations.json`), and `quality-pr-verdict` judges exactly that many whole with `pnpm quality:merge`, as the nightly matrix's verdict does. The count is computed for each PR: `tests/quality/pr-count.ts` plans the PR's cells and picks the fewest shards, at most 12, that keep each within 300 s, splitting any group too heavy for one worker first, by cell, or by test for a cell too heavy on its own, and placing a split group's parts on different shards. Needing more than 12 fails `quality-pr-plan`, naming the heaviest group. A PR with a pack sweep may take 12 plus the shards the sweep's groups alone need, up to 16, and the log names both; everything outside the sweep must still fit 12 on its own. Only #20's catalog PRs, which change dozens of packs, go past 12. Its install adds about 1 to 2 minutes before the shards start on a PR that selects `quality-pr`. To see the count for your branch: `QUALITY_FIXTURES=1 APPEARANCE_FIXTURES=1 BUDGET_FIXTURES=1 pnpm --filter @portfolio/web build:registry --modules-only`, then `QUALITY_CHANGED_BASE=origin/next pnpm exec tsx tests/quality/pr-count.ts`, and run `pnpm --filter @portfolio/web build:registry --modules-only` again after to drop the fixture packs. A change-directed cell's failure records name the changed `axis`, and `pack` for a language, and its test's message names the tokens each page's presentation boundary resolved, with the file that keeps every one: the cell's `resolved-tokens.json` and `primitives-resolved-tokens.json`.

`pnpm quality:full` plans every cell in every viewport and row, every pair the [37] rule could direct, and the visual cells, which run only in the pinned Playwright image. `-- --external-variant` runs it against a worktree with the reference variant installed, as the nightly and release runs do. `-- --shard=<n>/<m>` runs one of `m` shards of the whole plan, the test groups `tests/quality/lib/full-shards.ts` gives it by the same measured weights as the PR shards. `-- --night=<YYYY-MM-DD>` runs that night's slice instead (the nightly quality matrix, below), on this machine, or one of its shards with `--shard` too. A sharded or nightly run prints its slice, the cycle's length, its cells, and its groups, and fails before any test when the plan is over its budget, naming the heaviest group. A shard judges only what it holds; `pnpm quality:merge -- <dir> --shards <m>` reads every shard's reports under `<dir>` and judges the run whole: zero tests, the plan's coverage (a night's, its slice's), the perf cells' coverage, empty projects, the canary probe, and registered targets with no result, across every shard, and a missing, unjudged, or mismatched shard. It writes the shards' summaries joined into one as `reports/quality/summary.json`, which a sharded release's timing gate reads.

`pnpm quality:release` is the gate #12's release-candidate pipeline runs, as `pnpm ci:quality-release`: `quality:full -- --external-variant` whole, then each release gate in `RELEASE_GATES` (`tests/quality/release.ts`) over its verdict. The matrix is the first gate, then 11-3's timing gate, which fails a perf cell's median past its ceiling's release tolerance. `-- --merged <dir> --shards <m>` judges a sharded run's reports instead of running the matrix, and fails a night's slice: a release needs the whole plan. On a release candidate tag, `release.yml`'s `rc-quality-plan` counts the release plan's shards, the fewest of 32, 64, 128, and 256 that keep each shard within `RELEASE_CEILING` (4,800 s, the 120-minute timeout with a 1.5x margin): it installs the reference variant, generates its registry with the quality flags, and plans, as each shard does (`tests/quality/full-plan.ts`), and a plan past 256, the most jobs a GitHub matrix makes, fails there, naming its heaviest group. #20's whole catalog takes 128, so 256 is a step of headroom that costs nothing until a plan needs it. `rc-quality` then runs every cell as `pnpm ci:quality-full --shard=<n>/<count>`, eight at a time, so in waves. Each shard fails before any test, and before the host's build, when the plan leaves it over the ceiling. `rc-quality-verdict` runs only when every shard passed, as `pnpm ci:quality-release --merged "$SHARDS" --shards "$SHARD_COUNT"` over every shard's reports, so a shard that fails or times out stops the release, and `rc-tag` waits on it. Today a candidate runs 32 shards of about 28 minutes, the slowest about 3,500 s, about 15 runner-hours, and holds eight job slots for about 2 hours. With #20's whole catalog (694,784 s of tests, measured from the registry of `kgn/20-3-generated` at `6b403c60` with `next`'s variants at `a56358cd`) it runs 128 shards of about 54 minutes, the slowest 3,465 s, 1,335 s (28%) under the ceiling (the unit tests' model, 694,853 s, gives 128 shards too), about 6,960 runner-minutes (116 runner-hours), and holds eight slots for about 14.5 hours; at the timeout, 128 shards could take 15,360 runner-minutes (256 runner-hours) and 32 hours. 128 shards hold about 54% more work (about 375,000 s) before the count steps up to 256, which would run about 8,190 runner-minutes and 17.5 hours of eight slots (30,720 runner-minutes and 64 hours at the timeout). All of it runs beside `rc-build`. A candidate tagged while the nightly runs (from 06:23 UTC for about an hour and a half) holds eight slots beside the nightly's eight, so PR CI gets four until one finishes: tag outside that window when you can.

### Manual runs

What automation can't prove gets a manual pass, kept as a record. `pnpm quality:checklist -- <surface or composition>` prints the checklist, every item with an id; `-- <id> --record` prints the record to fill in. `quality/manual-runs/templates/` holds one per registered surface and composition, set up for VoiceOver with Safari on macOS. Copy one to `quality/manual-runs/<id>-<date>-<browser>-<assistive technology>.yml` and replace every `todo`: the commit tested, the date, the tester, the browser, assistive technology, and OS with their versions, the viewport, the run's result, and each item's result (pass, fail, or not-applicable, with a note for fail and not-applicable). List any `quality/exceptions.yml` id the run links. `pnpm quality:meta` validates every record against its surface's current checklist (`tests/quality/lib/manual-runs.ts`).

The first pass is the owner's: VoiceOver with Safari on macOS, over `login` and `fallback`, recorded before #11 closes.

`pnpm test:trace` (#6) boots the build once per registered variant on the `complete` contract fixture, under `read-only` and under `owner` (`--profile` picks one), and traces `/` at 1440x900 and 390x844, in Chromium: every request with its bytes, redirect hops and WebSockets among them, long tasks with the CPU throttled 4x, CSP violations, frame loops, recurring timers, canvas contexts, running infinite animations, two seconds of idle main-thread work, and what it ran under. It sends nothing but GET and HEAD, aborts every request outside the app it routes, and Chromium resolves no name but 127.0.0.1 and localhost and uses no proxy, so a redirect hop it never routes reaches no host either. Every request outside the app fails the case. A self-test on loopback proves that policy before any trace runs. After `PORTFOLIO_ANALYZE=1 pnpm build`, which alone ships source maps, it also splits each downloaded chunk's bytes by package. Each traced page, and each page `/` links to and a 404 page, must pass the purity assertion (#6, Slice 2): nothing downloaded or named in its HTML and RSC payload but `app/experience-base.css` and the units it renders, no module the `forbidden` block in `runtime-budgets.json` names, no third-party request, and no link to `/studio` or `/admin`. It matches modules through the source maps, so it fails a page from a build without them: trace a `PORTFOLIO_ANALYZE=1` build. With `BUDGET_FIXTURES=1` on the build and the trace, the fixture variants `fixture-variant-light` and `fixture-variant-medium` register and get traced too, each holding the other's code off its pages, on a site that publishes the typography profile `fixture-type-font`, which ships a font, and `fixture-variant-medium`'s owner project signs in and traces the catalog fixture, `/studio/_catalog-fixture` (`tests/trace/catalog.spec.ts`): stills first, live frames only on request or near the screen, two at most, an offscreen request `hidden`, and each frame downloading its own variant's files alone; `BUDGET_FIXTURES=over` registers `fixture-over-budget` alone, for the budget check. `pnpm check:budgets` (#6) then holds every registered variant and appearance pack to the budgets its manifest declares, and the ceilings in `runtime-budgets.json`'s `budgets` block for the kinds it doesn't, and writes `reports/budgets/budget-report.json` and a failure record per breach; CI's `trace` job (`pnpm ci:budgets`) runs both builds, and `fixture-over-budget` has to fail. Raising a ceiling is a reviewed edit to that block, with its basis. The report is `reports/trace/trace-report.json`, and `node tests/trace/calibrate.mjs` writes an entry of `runtime-budgets.json`'s calibration block from one, named by its base commit and the tree ids of `apps/` and `packages/`, from a clean checkout and a trace that passed of one selection under one profile.

`--base-url <origin>` traces a server on this machine that the trace didn't start. That server has to bind 127.0.0.1 and run with its own egress blocked, since the trace can only keep the browser in: start it the way `pnpm test:trace:baseline` does. `--allow-third-party`, for the baseline calibration only, records the third-party requests rather than failing on them, and still fails on any that got an answer. `pnpm test:trace:baseline` runs the baseline calibration end to end: a detached worktree of `62a0f06`, a frozen install, the build and `next start -H 127.0.0.1` on a free port with server egress sent to a refusing trap and `offline-fetch.mjs` preloaded, telemetry off, the trace, and teardown. It writes the trace report and `reports/trace/baseline-evidence.json`, which shows what was refused and every socket the build, the server, and the browser held.

Run `pnpm exec playwright install chromium` once before the browser smoke. `pnpm test:routes` builds a host of its own, a copy of the workspace outside the checkout with the variants in `tests/fixtures/variants/` installed offline from the pnpm store, so it needs `pnpm install` but no `pnpm build`. `pnpm test:appearance` builds its own the same way, with `APPEARANCE_FIXTURES=1`, so the fixture packs register and `/_fixtures/appearance` serves the keyboard, focus, and plate checks. `pnpm test:external-variant` does the same in a temporary `git worktree` of HEAD, so commit before you run it; its add and remove may read package metadata from the registry. [docs/variants.md](docs/variants.md#testing-a-variant) says what both variant suites check. Registry generation leaves the test fixture packages out unless their flag is set: with `APPEARANCE_FIXTURES=1`, `pnpm build` and `pnpm dev` also register the appearance fixture packs in `packages/appearance-fixtures-*`, and a build without the flag fails if any of their ids reach the registry. `PREVIEW_FIXTURES=1` does the same for `packages/preview-fixtures`, whose `fixture-environment` composition styles against nothing but a preview's environment. `pnpm test:preview-fixtures` builds a host with it, renders the fallback composition and `fixture-environment` in `/studio/preview` at each width and under each environment, and keeps every screenshot in `reports/preview-fixtures/screenshots`. `QUALITY_FIXTURES=1` registers #11's nine tier fixture packs, a Stable, an Extended, and an Experimental pack on each axis in `packages/quality-fixtures-{languages,schemes,typography}`, which `pnpm check:appearance` gates as it gates shipping packs. `QUALITY_FIXTURES=meta` adds the known-bad scheme in `packages/quality-fixtures-schemes-meta`, which it must fail. With `BUDGET_FIXTURES=1` they register the budget fixture variants `fixture-variant-light` and `fixture-variant-medium` and the typography profile `fixture-type-font` in `packages/budget-fixtures/`, and with `BUDGET_FIXTURES=over` `fixture-over-budget` alone. Each registered variant gets a route of its own, so after a build with `BUDGET_FIXTURES`, `pnpm typecheck` fails on the route types that build left in `apps/web/.next/types` until the next build without it. `pnpm ci:image` builds and checks the container image with Docker (`CONTAINER_CLI=finch` for Finch).

Two more check the deployment profiles. `pnpm --filter @portfolio/web test:profiles` builds once with no profile set and runs the route matrix and the canary scan against the built server under `read-only`, `demo`, and `owner`, with a password made for the run, and checks that `owner` refuses to start without a password hash and a data directory. `pnpm smoke:profiles` builds the image and runs it under every profile and every startup row, those that refuse to start and those that start with a warning, with the same `CONTAINER_CLI` choice. Every server container runs as the Compose examples do, read-only with `--cap-drop=ALL` and `no-new-privileges`, on an internal network, and the smoke checks what that enforces: uid 1001, no capability, nothing writable but the cache tmpfs and `owner`'s data directory, and an image with no personal document, `.env*`, `.git`, or holding pen in it (threat rows deploy-2 and deploy-3 in [docs/threat-model.md](docs/threat-model.md)). It also checks graceful shutdown and restart, `owner`'s data volume under a new container, spoofed forwarded headers at 0 and 1 trusted hops, `owner`'s refusals of a bad hash file, the sample identity, and a missing or unreadable source directory, and that no per-run canary reaches a response, a log, or the reports. `SMOKE_PROFILES=owner` (or `read-only`, `demo`, `rows`, comma-separated) runs one part, as each failure record's command does. CI's `profiles` job runs it as `pnpm ci:profiles`, on the image the `image` job built. It needs a container runtime: CI has Docker, and a local run needs one you run yourself.

Two run the owner security suite (#2): sign-in, sessions, CSRF, origin checks, expiry, revocation, and a canary scan of every response, the server's output, and its data directory. `pnpm --filter @portfolio/web test:security` builds and runs it straight against the server over http, with no trusted proxy hop. `pnpm --filter @portfolio/web test:security:proxy` runs it against the image behind the HTTPS proxy fixture, with one trusted hop: build the image first with `pnpm ci:image`, and point `PORTFOLIO_IMAGE` at it if you gave it another tag. In CI the browser job runs the first one's spec with the rest of the browser suite, and the image job runs the second as `pnpm ci:security-proxy`.

Tests use Node's built-in `node:test`, through `tsx` for TypeScript. A single file runs directly, for example `pnpm exec tsx --test packages/kit/src/format.test.ts`. In `apps/web`, `*.test.ts` files cover server modules and run with `--conditions=react-server`; `*.test.tsx` files render pages with `react-dom/server`, which needs the default conditions, so they run without it.

## CI

`.github/workflows/ci.yml` runs on every PR into `main` or `next` and every push to `main`. `gate` is the one required check.

**Selection.** The first job, `changes`, runs `ci/select-jobs.mjs` and picks the check jobs a run needs from the paths the PR changes. A draft PR runs only those, for fast feedback, and the `selected` check says whether they passed. A PR that's ready for review, a PR into `main`, and a push run the complete product on every head. So does any change to a workflow or action file, the lockfile, a root config, the `Dockerfile` or `.dockerignore`, the selector, gate, or shard scripts, a CI script outside the container and docs ones, a deleted or moved package, or any path no rule maps. The step summary of `changes` lists each path's change class and each selected job's local command.

**gate.** `gate` passes only on a complete run in which every job it needs succeeded, so path selection can't merge anything: a draft's run always fails `gate`, GitHub won't merge a draft, and marking it ready runs everything on the same head. A skipped, cancelled, or timed-out job fails `gate` too. A new job joins by adding `changes` to its `needs`, an `if:` on `contains(fromJSON(needs.changes.outputs.jobs), '<job>')`, and its id to `gate`'s and `selected`'s `needs` and to `CHECK_JOBS` and the rules in `ci/select-jobs.mjs`. `pnpm test` fails until it's mapped.

**Check names.** `changes`, `static`, `unit (1/3)` to `unit (3/3)`, `build`, `browser (1/2)` and `browser (2/2)`, `routes`, `appearance-browser`, `check-variants`, `variants (1/2)` and `variants (2/2)`, `external-variant`, `image`, `profiles`, `docs`, `selected`, `gate`, and on `main` only, `publish`.

**Shards.** `unit`, `browser`, and `variants` split by measured duration (`ci/shards.mjs`): by workspace package and root test script, by spec file, and by Playwright project. Items are read from the tree when the shard runs, so a new one is never left out, and `pnpm test:shard <suite> <i>/<n>` runs one shard locally. `ci/shard-durations.json` holds the durations, and its `source` says where they came from; refresh it with `node ci/shards.mjs measure <suite> <log>...` from `gh run view --job <id> --log` output, which updates the items those logs measured and keeps the rest.

**Caches.** Each check job installs through `.github/actions/install`, which restores and saves the pnpm store under the lockfile's hash. `build` also caches `apps/web/.next/cache` under the lockfile and a hash of the build inputs, and `browser` and `variants` restore it without writing it. Nothing caches `node_modules` or a generated registry, and `publish` installs without either cache.

**The narrowest check.** `pnpm select-jobs` prints what a draft PR of your branch against `origin/next` would select, with each job's local command (`--base <ref>` for another base). Run those, or the single command for what you touched: `pnpm check:docs` for docs, `pnpm test` or one file with `node --test <file>` or `pnpm exec tsx --test <file>` for scripts and packages, `pnpm build && pnpm ci:browser <spec>` for one browser spec, `pnpm test:shard <suite> <i>/<n>` for one shard.

**Scheduled checks.** `.github/workflows/scheduled.yml` runs every night at 06:23 UTC. Every night it runs #11's quality matrix, below. On Mondays it also runs `pnpm check:docs`, then `pnpm check:links`, which requests each external link once and never a local, reserved, or live-site host; on the other nights `links` skips, and `report` expects that skip (`EXPECTED_SKIPS`). When a job doesn't succeed, including a timeout or any skip it doesn't expect, the `report` job opens or comments on one rolling issue with the failed jobs, their local commands, and their failure records, and the first passing run in which every job ran, a Monday's, closes it. Only `report` holds `issues: write`, and every job sets `timeout-minutes`. GitHub runs schedules only from the default branch, so it starts once it's on `main`, and it disables them after 60 days without activity in a public repository. Test the reporter with `node --test ci/report-issue.test.mjs`. Cross-product jobs, such as #11's appearance validation and #20's catalog provenance refresh, join it as the workflow's header describes.

**The nightly quality matrix.** The complete matrix is more than one night of CI can run, so the nightly runs it over a cycle of nights (`tests/quality/lib/full-shards.ts`). `quality-night` takes the night's UTC date once. `quality-full` then runs `pnpm ci:quality-full --shard=<n>/8 --night=<date>` in eight shards, the cap (`FULL_SHARDS`), and never more than eight at once, so PR CI keeps the rest of the account's job slots. `catalog-full` waits for it, so the night holds about eight slots at its peak. Each shard runs in the pinned Playwright image: `quality:full -- --external-variant`, against the reference variant's worktree.

- **The cycle.** It's N nights, the fewest of 7, 14, 28, and 56 (`NIGHT_COUNTS`) whose every night fits the budget at eight shards. Each shard works N out from the plan, the same way, and prints it, and the rotation report records it. N is always 7·2^k, so nights nest: as the plan grows or shrinks across a step, a test's night n becomes n or n + N, or two nights merge into one, and any other count would draw every night again. A test waits at most the largest N in effect between runs. The night of a date is its day number (days since 1970-01-01) modulo N. Today N is 7. With #20's whole catalog it's 28: about 695,000 s of tests, measured from the registry of `kgn/20-3-generated` at `6b403c60` with `next`'s variants at `a56358cd` (694,784 s; the unit tests' model of it, from its pack counts, plans 694,853 s, 0.01% more). 14 nights leave the heaviest night's slowest shard at about 4,000 s, over the ceiling, and 28 at about 2,300 s, 1,300 s (36%) under it, with the heaviest night about 30,000 s of tests. 28 nights hold about 70% more work before N steps up to 56. The unit tests hold the checkout's own plan to the fewest nights and shards that fit, whatever its registry ships, and pin the figures only on the model. So after #20 each cell gets nightly evidence once every 28 nights; in between, a PR that changes a variant or a pack runs its own cells, and the directed sweep over every changed pack, before it merges. A plan that needs more than 56 nights fails every run before any test, naming its heaviest night; that's a decision for more nightly shards or a longer night.
- **The slice.** The harness and every perf cell run every night. A server's cell tests are split into four buckets (`BUCKETS`) by a hash of each test, and each bucket's night is a hash of the server and bucket modulo N; the server's visual tests go with its bucket 0, and a bucket split into parts keeps its night. So N nights in a row run every test of every cell once, a cell's tests on up to four nights, and adding a test, a composition, or a pack, or a weight changing, moves no other test to another night. Each shard prints the night, its cells, and its groups.
- **The budget.** Every night must keep each shard's estimate within 3,600 s, the 90-minute timeout with a 1.5x margin. Today the slowest shard is about 1,700 s. Over 50 draws of the hash on #20's catalog model, as its real pack ids draw the nights again, the heaviest night runs about 1.14 times the mean at the median, and N is 28 on every draw. When the plan grows past a cycle, N doubles on its own, and halves when it shrinks; either way a test waits at most the larger N between runs.
- **The verdict.** Each shard's reports are scrubbed however it ended and upload as `reports-quality-full-<n>` only when the scrub succeeds. `quality-verdict` downloads every shard's reports into a directory of its own and runs `pnpm ci:quality-verdict "$SHARDS" --shards 8 --mode full`, `pnpm quality:merge`, which judges them whole against the night's slice. Its `reports-quality-verdict` artifact holds `quality/rotation.json`, also in the job summary: which night of the cycle ran, the plan's fingerprint (`planFingerprint`, so two nights' reports show whether they're of one plan), and for each cell its nights of the cycle, the result of its tests that ran tonight, the night it last passed, and `scheduledLast` and `scheduledNext`, the nights the rotation scheduled it last and schedules it next. Only a cell whose every test ran tonight has a known last pass. For the others, it would come from an earlier night's artifact, and reading another run's artifact needs `actions: read`, which the job doesn't hold. `scheduledLast` is the last night the rotation scheduled a cell, not proof that it ran or passed then.
- **Locally.** `pnpm quality:full -- --external-variant --night=<date>` runs a night's slice on one machine, and `--shard=<n>/8` with it runs one of that night's shards, as CI did. Each failure record's `CI_REPRO_COMMAND` names the shard and the night it ran.

The schedule only runs from the default branch, so the nightly matrix starts once this reaches `main`.

The visual cells compare the image's fonts with `tests/quality/container/fonts.txt`, which starts as its header alone, so they fail on the first nightly run. Every run in the pinned image writes the fonts it found to `quality/fonts.observed.txt` whatever tests it runs, so every nightly shard's reports hold the list. Bootstrap it from the first nightly run, before the first release candidate, since `rc-tag` waits on the visual cells too:

1. Download one shard's reports into a new, empty directory: `gh run download <run id> -n reports-quality-full-1 -D "$(mktemp -d)"`. Any of `reports-quality-full-1` to `reports-quality-full-8` holds the same list.
2. Check it: `pnpm quality:fonts -- <that directory>/quality/fonts.observed.txt`. It must be fonts.txt's header, then `fc-list : file family style` lines, sorted, each once. It prints how the list differs from the committed one.
3. Commit it byte for byte: `pnpm quality:fonts -- <that file> --write` copies it over `fonts.txt`, and nothing else changes.

**Fork-safe PR check.** #11 closes only after the owner checks artifact retention and diagnostics from a pull request the repository's secrets and write token can't reach:

1. From a second GitHub account with no access to this repository, fork it, branch from `next`, and change a line under `tests/quality/`, which selects `unit`, `quality-pr`, `quality-pr-verdict`, and `quality-meta`. In a second commit, break one cell on purpose: set the `not-found` state fixture's `status` in `tests/quality/lib/state-fixtures.ts` to 200.
2. Open the PR into `next` as a draft, approve its workflow run from the owner account when GitHub asks, then mark it ready for review, which runs everything.
3. In any job's log, "GITHUB_TOKEN Permissions" lists `Contents: read` and `Metadata: read` alone. `static` and `quality-meta` pass, so `pnpm check:workflows` and the static workflow check hold on every workflow.
4. The `quality-pr` shard that ran the broken cell fails, for that cell only, and `quality-pr-verdict` fails with it. Each shard's "Scrub reports" step succeeded, and the run lists `reports-quality-pr-shard-<n>` for each shard, `reports-quality-pr-verdict`, and `reports-quality-meta` with 14 days' retention.
5. Download the failing shard's `reports-quality-pr-shard-<n>` into a new, empty directory. It holds `quality/plan.json`, `quality/summary.json`, `quality/verdict.json`, and each cell's `axe.json`, `vitals.json`, and `resolved-tokens.json` under `quality/results/`. Its `failures/` hold the broken cell's records, naming the gate, the rule, the route, the viewport, the input mode, the preference mode, the tuple, and the command that reproduces it, and the job's failure summary shows the same. No file holds a cookie, `Authorization`, or CSRF value but `[scrubbed]`, and the verdict has no `canary-leaked`.
6. Close the PR unmerged, delete the fork's branch, and note the run's URL on #11.

**Timings.** `ci/baseline.json` is CI's wall, queue, job, and step times before selection, caches, and shards, from 30 finished PR runs. `node ci/timings.mjs --limit 30` reads the same numbers, and the cache hit rate, from recent runs.

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
