# Releasing

A release is two tags on one commit of `main`: a release candidate, `vX.Y.Z-rc.N`, which builds, attests, and scans the image, and a final tag, `vX.Y.Z`, which promotes that same image with no rebuild. Both run in [`.github/workflows/release.yml`](../.github/workflows/release.yml). Nothing else publishes a release, and the workflow has no manual trigger. [`rc-preflight.yml`](../.github/workflows/rc-preflight.yml) runs a candidate's quality gate on demand with no tag, builds no image, and publishes nothing ([A preflight](#a-preflight)).

Pushes to `main` keep publishing `sha-<short>` images after `gate` (the `publish` jobs in [`ci.yml`](../.github/workflows/ci.yml)). They build each platform natively, as `rc-build` does, merge the two with the same helper as `rc-merge`, smoke-test both platforms from the merged digest, and tag only that digest. Those are builds, not releases: they never move a version tag or `latest`, and they carry no provenance or SBOM. The merge says so with `--unattested --purpose sha-publish`, which only `ci.yml`'s run for a push to `main` of this repository may pass, by its exact `GITHUB_WORKFLOW_REF`, and the merged index must hold one image manifest for each platform and nothing else.

## Before the first release candidate

A candidate tagged before the quality gate joined this workflow has no `rc-quality-verdict`, so promote-verify refuses to promote it: cut a new candidate on the same commit, `vX.Y.Z-rc.<N+1>`.

`rc-tag` waits on the quality gate, and its visual cells fail until `tests/quality/container/fonts.txt` holds the pinned image's fonts. That's the owner's step, once `scheduled.yml` is on `main` and its first nightly has run:

1. Download one nightly shard's reports into a new, empty directory: `gh run download <run id> -n reports-quality-full-1 -D "$(mktemp -d)"`.
2. `pnpm quality:fonts -- <that directory>/quality/fonts.observed.txt --write`, and commit `fonts.txt` ([CONTRIBUTING.md](../CONTRIBUTING.md#the-quality-cells) has the check it makes first).

## A release candidate

Pushing `vX.Y.Z-rc.N` runs these jobs in order (the quality gate and the rehearsal beside the build), and each one stops the release when it fails:

1. **classify** reads the tag. Anything but `vX.Y.Z-rc.N` or `vX.Y.Z` fails here.
2. **rc-verify** refuses the tag unless its commit is on `main` and has a green complete `ci` run: a `ci.yml` run for the push to `main` on exactly that commit, where `gate` passed and the run concluded success. `gate` passes only on a complete run, so a draft PR's selected run never counts, and a PR's run doesn't either, since its `gate` checked a merge commit. It reads both through the API with `contents: read` and `actions: read` ([`ci/release/verify-rc.mjs`](../ci/release/verify-rc.mjs)). A red push run counts in its place only when quality-pr is its one red: every other job `gate` needs succeeded, every shard of each, and the run's `reports-quality-pr-verdict` artifact, read with the same `actions: read` and parsed as untrusted, shows quality-pr's verdict failing on failed cell tests alone, every failure record of each one the candidate's records list names, by the matcher `rc-quality` uses ([The quality scope](#the-quality-scope)), and no listed record that ran and no longer fails. Anything missing or malformed refuses the tag, and so does an empty list, as a final release's is. `ci.yml`'s own `gate` stays strict. It refuses, too, a tag whose quality scope file, [`quality/release/scope.json`](../quality/release/scope.json), names another release ([`ci/release/verify-scope.mjs`](../ci/release/verify-scope.mjs)), so each candidate is judged against its own scope and records list.
3. **rc-quality-plan** counts #11's release plan's shards, the fewest, up to 256, that fit the release ceiling ([`tests/quality/full-plan.ts`](../tests/quality/full-plan.ts)), and **rc-quality** runs the plan on the commit while the image builds: the quality matrix in the candidate's scope ([The quality scope](#the-quality-scope)), as `pnpm ci:quality-full --shard=<n>/<count>`, 10 at a time, so in waves, in the pinned Playwright image, with a fresh install and no cache. The shards are sized by the release's own measured weights, each key at its p90 over a candidate's shards, so each shard's estimate is its p90 total, and `rc-quality-plan` prints each one. The shards' 120-minute timeout is the 4,800 s ceiling with a 1.5x margin, and each fails before any test when the plan leaves a shard over its budget, naming the heaviest group ([`tests/quality/lib/full-shards.ts`](../tests/quality/lib/full-shards.ts)). **rc-quality-verdict** runs only when every shard passed, and judges them all whole with the release gates, `pnpm ci:quality-release --merged "$SHARDS" --shards "$SHARD_COUNT"` ([CONTRIBUTING.md](../CONTRIBUTING.md#the-quality-cells)). All three hold `contents: read` and no secret, and their reports keep one day. A candidate holds 10 of the account's 20 job slots, so PR CI gets the other 10 while it runs. The release's shard count and its runner-minutes are worked out per run, from the plan, and printed in the run's summary by `rc-quality-plan`. A plan past 256 fails in `rc-quality-plan`. Tagged during the nightly (from 06:23 UTC), its 10 beside the nightly's eight leave PR CI two slots until the nightly finishes.
4. **rc-build** builds `linux/amd64` on `ubuntu-24.04` and `linux/arm64` on `ubuntu-24.04-arm`, once each and natively, with BuildKit's SLSA provenance at `mode=max` and an SPDX SBOM. Each leg pushes its platform's index to `ghcr.io/<owner>/<repo>` by digest, with no tag.
5. **rc-merge** merges the two indexes into one with `docker buildx imagetools create`, which keeps each platform's attestation manifest, and pushes it by digest, with no tag ([`ci/release/merge-index.mjs`](../ci/release/merge-index.mjs)). The merged index must hold one image and one attestation manifest for each platform, and no attestation for an image it doesn't hold. It checks that both platforms carry the provenance and an SBOM ([`ci/release/attestations.mjs`](../ci/release/attestations.mjs)), and attests the merged digest with `actions/attest-build-provenance`, which signs the provenance through Sigstore and stores it with GitHub and on GHCR. The check runs after the push, so when it fails the digests are already on GHCR, untagged and never promoted: delete those package versions in the package settings.
6. **rc-scan** runs Grype on the merged digest, once per platform, and on the production dependencies ([Scans](#scans)).
7. **rc-rehearsal** runs beside the build, after `rc-verify`: the upgrade rehearsal ([The rehearsal](#the-rehearsal)), on an image of the tagged commit it builds itself with no cache and never pushes, so nothing comes from GHCR.
8. **rc-tag** tags the scanned digest `X.Y.Z-rc.N` on GHCR once `rc-scan`, `rc-quality-verdict`, and `rc-rehearsal` all passed, and checks the tag resolves to it.
9. **rc-release** creates the GitHub pre-release, with notes that name the pull source by digest and the two SBOMs attached.

## The quality scope

[`quality/release/scope.json`](../quality/release/scope.json) says which release the candidate's quality gate is for (`release`), what it runs (`scope`), what that leaves out (`unswept`), and its records list ([`quality/release/records.json`](../quality/release/records.json)), and [`tests/quality/lib/release-scope.ts`](../tests/quality/lib/release-scope.ts) validates both. `full` runs every cell of #11's full plan; `default-packs` runs every composition and surface, in every state, display mode, width, row and engine, on its own default packs alone, the ones its `quality-pr` sentinel renders, with no other pack, tier pack or fixture pack. `rc-quality-plan`, `rc-quality` and `rc-quality-verdict` name the file in `QUALITY_RELEASE_SCOPE`.

The records list names the failure records the candidate ships with, one entry each, one rule failing on one element in one cell test: the test's `cell`, `viewport`, `row` and `engine`, as the run's summary names them, the record's `check`, `rule` and `target` (the element's page selector, `aria:<role>|<name>|<slot>` for one in a frame or a shadow root, or null for a record with no element), its `owner`, the lane or person who fixes it, `routed`, the row that does, as `row <n>`, and an optional `note`. The key is those seven fields, from the record's own fields ([`ci/release/release-records.mjs`](../ci/release/release-records.mjs)), so a measurement that moves from run to run never moves it. The verdict fails on a failure record the list doesn't name, and on a failing cell test with no record (`unlisted-failure`), printing an entry ready to paste with placeholders for its owner and row, which the list refuses until they're filled; on a listed record whose test ran and no longer has it (`listed-passed`), since a fixed record leaves the list; and on a listed test the plan doesn't have (`listed-unplanned`). A final release keeps the full matrix clean: promotion refuses a candidate whose scope isn't `full` or whose list isn't empty.

## A preflight

[`rc-preflight.yml`](../.github/workflows/rc-preflight.yml) runs a candidate's quality gate on a commit of `main` with no tag, so the candidate's quality-gate verdict on that commit is known before it costs a candidate number. A release tag can't be moved or deleted, so a candidate that `rc-verify` refuses, say while `main`'s `gate` is red, is gone, and the next one is `rc.<N+1>`. A green preflight is that verdict alone. It doesn't cover `rc-verify`'s green `ci` push run on exactly that commit, the image build and attestation, both scans, the rehearsal, or promotion's empty baseline-pending list, and the candidate measures timing again. So preflight `main`'s tip, or a commit `main` was pushed at whose `ci` push run is green. Dispatch it from `main` with the commit's full id:

```sh
gh workflow run rc-preflight.yml -f sha=<sha>
```

The run's title is `rc-preflight of <sha>`. Find a preflight by its title or its summary, never by `--commit`: its checks sit on `main`'s tip at dispatch, not on the commit it tests.

1. **preflight-verify** refuses anything but a full 40-character lowercase commit id (`git rev-parse <commit>`), a dispatch from anywhere but `main`, an id that names a tag object or anything else but a commit, a commit that isn't on `main` (it checks out `main`'s whole history and runs `git merge-base --is-ancestor` against it), and a commit whose own `release.yml` differs from the one at the run's commit, `$GITHUB_SHA`, which the summary names. It doesn't ask for a green `ci` run, as `rc-verify` does; that's what the preflight is for.
2. **preflight-plan**, **preflight-quality**, and **preflight-verdict** are `rc-quality-plan`, `rc-quality`, and `rc-quality-verdict`, step for step, and [`ci/workflows.test.mjs`](../ci/workflows.test.mjs) holds them to `release.yml`'s: the same shard count from the plan, 10 at a time in the pinned Playwright image, the same scope file, the same timeouts, and the same verdict, `pnpm ci:quality-release --merged "$SHARDS" --shards "$SHARD_COUNT"`. A dispatch reads `rc-preflight.yml` at `main`'s tip and checks out the commit, so the preflight runs `main`'s current gate on the commit's code, and refuses when the commit's own `release.yml` differs, since a tag on it would get that one instead. The reports upload as `reports-quality-preflight-*`, kept for one day.

Dispatch one preflight at a time, and not while a candidate runs: each takes 10 of the account's 20 job slots. One preflight runs at a time whatever its commit; a second dispatch waits, the running one is never cancelled, and a third replaces the one waiting, as GitHub's concurrency groups do. A failed shard can't be re-run to green, since the timing gate counts only a first attempt, so dispatch again. It holds `contents: read` and no secret, reads no cache, and never tags, builds an image, or publishes. Its verdict never counts for promotion: promote-verify reads only the tag's own `release.yml` run, so a commit that passed its preflight still needs a candidate whose run passes. Dispatch it outside the nightly too.

## Promotion

Pushing `vX.Y.Z` on the newest candidate's commit runs:

1. **classify**, as above.
2. **promote-verify** refuses unless a candidate for `X.Y.Z` exists, the newest one (the highest `N`) is on this commit, and its release run passed `rc-scan`, `rc-quality-verdict`, and `rc-tag`, and [`tests/variants/baseline-pending.json`](../tests/variants/baseline-pending.json) on that commit lists no composition, so every first-party composition's screenshots have baselines, and its quality scope is `full` with an empty records list, so the candidate passed the whole matrix clean ([`ci/release/promote-check.mjs`](../ci/release/promote-check.mjs)). An older candidate never promotes. Cut a new one on the commit you want instead.
3. **promote-scan** resolves the candidate's GHCR tag to its digest, then verifies that digest's provenance attestation: signed by this repository's `release.yml`, on a GitHub-hosted runner, for the candidate's tag and this commit. Whatever the GHCR tag says, only the digest that run built gets through. It checks the provenance and SBOMs again and scans the image again, with that day's vulnerability database.
4. **promote** points `X.Y.Z` at the digest with `docker buildx imagetools create`, which copies the index by reference and builds nothing. It moves `X.Y`, `X`, and `latest` too, unless a final release already out is newer in that line, so a patch to an older line never moves them backwards ([`ci/release/tags.mjs`](../ci/release/tags.mjs)). It reads the tags again right before it moves anything, and runs one at a time across every final tag (the `release-promote` concurrency group), so two promotions never race for `latest`. GitHub keeps one waiting job per group, so a third final pushed while one promotion runs and another waits cancels the waiting one. Re-run that run's failed jobs, within GitHub's 30-day window. It's the only job that moves `latest`.
5. **promote-release** creates the GitHub Release with the same notes.

## Reproducibility

Image builds aren't byte-for-byte reproducible. The runtime stage runs `apk upgrade`, so a rebuild of the same commit picks up that day's Alpine packages and gets another digest. The digest a candidate built, attested, and scanned is the artifact of record, and promotion re-tags it rather than building again.

## Permissions

The workflow's token is `contents: read`. Each job that writes gets only what it writes, and only on a tag push:

| Job               | Writes                                 |
| ----------------- | -------------------------------------- |
| `rc-build`        | `packages`                             |
| `rc-merge`        | `packages`, `id-token`, `attestations` |
| `rc-tag`          | `packages`                             |
| `rc-release`      | `contents`, for the pre-release        |
| `promote`         | `packages`                             |
| `promote-release` | `contents`, for the release            |

`rc-verify` and `promote-verify` add `actions: read`, `rc-scan` and `promote-scan` add `packages: read` to pull the private package, and `promote-scan` adds `attestations: read`. No job reads or writes a cache: the installs are fresh, setup-node and setup-buildx run with their caches off, and no build names `cache-from`. No job uses a repository secret.

## The dry run

A pull request into `next` or `main` that changes `release.yml`, `ci/release/`, the `Dockerfile`, `.dockerignore`, `.grype.yaml`, or `pnpm-lock.yaml` runs the dry run. `dry-run-build` builds each platform natively on the same runners as `rc-build`, with the same provenance and SBOM settings, into an OCI layout it keeps as a one-day artifact. `dry-run` pushes both layouts by digest into a `registry:2` container on its runner, published on its loopback only, merges them there with the same helper as `rc-merge`, checks the attestations on the merged index, runs both scans, tags the digest `0.0.0-rc.1` and then promotes it to `0.0.0`, `0.0`, `0`, and `latest` in that registry, and renders the notes into the job summary. It holds `contents: read` and no secret, never logs in to GHCR, and attests nothing, since signing needs `id-token: write`.

Grype downloads its vulnerability database on the runner. The dry run is not a required check: `gate` is the only one.

## The rehearsal

`pnpm rehearse` ([`ci/rehearsal.mjs`](../ci/rehearsal.mjs)) rehearses an upgrade from a clean data directory, each row on what the one before it left:

1. **Old configs.** Frozen copies of `62a0f06`'s one-file portfolio, as YAML and JSON, and one in TOML ([`ci/fixtures/rehearsal/baseline/`](../ci/fixtures/rehearsal/baseline/)), are each refused by `portfolio-store import` with `legacy.document`, and nothing is written: the data directory stays empty, and `status` says `empty`.
2. **Migration.** `pnpm config:migrate` writes the new pair from the YAML and the JSON one. A second run over the new pair says there's nothing to migrate and writes nothing, and migrating the old file again writes the same bytes. The TOML one writes nothing at all.
3. **Import, publish, rollback.** `import --expect empty` makes the migrated pair revision 1, an edited pair becomes revision 2, and `rollback --to` makes revision 1 live again.
4. **A backup during a publish.** A publish from another process is held just before its pointer moves, holding the publication lock. `backup` started then gives up with `lock_timeout` and leaves nothing behind. The publish is killed with SIGKILL: revision 1 is still live, and `verify` passes on the store it died in. `backup` then succeeds, and `restore` into a clean directory serves the same live revision with its media, and passes `verify`.
5. **Last known good.** In clean restores, the newest revision is damaged three ways: a missing file, a bad hash, and a revision the build's validator rejects. `status` serves the last known good, `degraded`, with the reason, and `recover` makes it live.
6. **The image.** These rows need Docker and an image, `REHEARSAL_IMAGE`, so they run in CI, on an internal network, hardened as the Compose examples are, never pulling. A container there reaches no public address. Under `owner`, on an empty data volume, and under `read-only`, the image exits non-zero on the frozen YAML config with `legacy.document`, and owner's volume holds a valid empty store and nothing more: `store.json`, the server's claim, and the store's directories as the store's own layout names them, no revision, publication, or draft, and `status` naming no live revision. The server opens its store before it reads the source, where `portfolio-store` reads the source first (#130), and the next start's first-start import takes that empty store over (#3, item 3). The image's own `portfolio-store` imports the migrated pair and publishes revision 2, and `owner` reaches ready on it. Its name, canonical link, `og:url`, Open Graph image, sitemap, robots host, feed, and JSON-LD follow revision 2's identity and the origin, and never name the bundled sample, `example.com`, the build host, or a container path ([`ci/lib/identity.mjs`](../ci/lib/identity.mjs)). The owner signs in and rolls back to revision 1 in the app. With revision 1's files damaged, `owner` restarts on the last known good, `/api/ready` `degraded`, and logs `store.catalog.degraded`.
7. **The previous image.** The previous release's image (the PR base's on a pull request), built in the job from `REHEARSAL_PREVIOUS_REF`, imports the old site and backs it up. The new image publishes on that store, as an upgrade would. Then the previous image, with the pre-upgrade backup restored into a new volume, serves the old site.
8. **Identity under read-only and demo.** `read-only` on revision 2's pair publishes the same identity on its origin. `demo` shows the bundled sample alone, on the demo origin: the sample's name, no JSON-LD, an empty sitemap, no feed, `noindex`, and no fixture's name anywhere on the page.

Every row runs on the default composition, `editorial-evidence`, which the run first proves registered by importing the bundled sample pair with the build's own `portfolio-store`. No row is pending. One that has to wait on something again is declared with what it waits on, and the run fails once that lands while it still waits.

Every command runs with an empty `HOME`, its own `TMPDIR`, `TZ=UTC`, no token, and the test harness's egress guard, which fails a row on any request outside the machine; the containers run on an internal network, hardened as the Compose examples are. A per-run canary in every command's environment, another in revision 2's content, and the owner password and hash the image's `hash-password --stdin` makes for the run never appear in any output or report. The reports go to `reports/rehearsal/`.

CI's `rehearsal` job runs it on a pull request whose changes select it (the rehearsal, the store, its command line and what it runs on, the migration, and every complete run), on the image the `image` job built, with the base tip as the previous release. `rc-rehearsal` runs the same script and rows on every release candidate, and differs only in where the images come from: an image of the tagged commit it builds itself, and the previous release from [`ci/release/previous-release.mjs`](../ci/release/previous-release.mjs): the newest final release in the commit's history that ships the revision store, or the commit's parent until one does. It fails when such releases exist but none is in the history.

## Scans

[`ci/release/scan-gate.mjs`](../ci/release/scan-gate.mjs) reads Grype's JSON and decides. Grype itself is pinned by version and SHA-256 ([`ci/release/install-grype.mjs`](../ci/release/install-grype.mjs)), and [`.grype.yaml`](../.grype.yaml) refuses a database more than five days old.

- **The image** fails on a Critical or High finding that has a fix, on either platform. A finding with no fix yet is counted in the summary and doesn't fail.
- **Production dependencies** are apps/web's run-time tree, read from `pnpm-lock.yaml` ([`ci/release/prod-deps.mjs`](../ci/release/prod-deps.mjs)): its dependencies, the workspace packages it links and theirs, and none of anyone's devDependencies. The scan fails on a High or Critical finding there that the baseline doesn't have, fixable or not. The baseline is the PR's base on a dry run. On a candidate it's the newest `vX.Y.Z` tag before the commit that has a published GitHub Release ([`ci/release/baseline.mjs`](../ci/release/baseline.mjs)), so a stray tag such as `v2.0.0-beta.1` never becomes one.

The image scan never uses a baseline: it always fails on a fixable Critical or High finding, unless an unexpired exception covers it.

**The first candidate.** Before the first final release the dependency scan has no baseline, so every High or Critical finding in the production dependencies counts as new. The runtime-refresh PR has to land before the first `v1.0.0-rc.1`.

Exceptions live in one place. `.grype.yaml` sets the app-update and database checks and nothing else, and `scan-gate` refuses a report in which Grype ignored a match by its own rules.

### What the logs show

Run logs, job summaries, and annotations are public, on tag runs too. They show pass or fail and a count per category (failing, let through by an exception, no fix yet, already in the baseline) and per severity, never a finding's id, package, version, or fix. The full report, with Grype's JSON, goes to the run's `reports-release-*` artifact, kept for one day. To see the findings after that, run Grype against the digest with your own Grype install, logged in to GHCR while the package is private:

```sh
grype ghcr.io/<owner>/<repo>@sha256:<digest> --platform linux/amd64
grype ghcr.io/<owner>/<repo>@sha256:<digest> --platform linux/arm64
```

### Scan exceptions

[`ci/release/scan-exceptions.yml`](../ci/release/scan-exceptions.yml) lets a finding through for a while:

```yaml
exceptions:
  - id: CVE-2026-12345
    package: openssl
    reason: Only the server's outbound TLS uses it, and the fixed apk isn't in the base image yet.
    owner: keyurgolani
    expires: 2026-12-31
```

An entry matches a finding by its id, or one of the aliases Grype lists, in the named package. It needs all five fields, and `expires` is a date no more than 90 days out. Once that date passes, the entry fails every scan, and the unit tests too, whether or not the finding is still there, so an exception is renewed with a reason or removed. It never quietly outlives its reason.

## Owner steps

- **Preflight, if you want the quality gate's verdict first.** `gh workflow run rc-preflight.yml -f sha=<sha>` on the commit you mean to tag, `main`'s tip or a commit `main` was pushed at whose `ci` push run is green ([A preflight](#a-preflight)). A green preflight is the candidate's quality-gate verdict alone, not the release's.

- **Push the tags.** From an up-to-date `main`, once its `ci` run has passed:

  ```sh
  git tag -a v1.0.0-rc.1 -m "v1.0.0-rc.1" <commit>
  git push origin v1.0.0-rc.1
  ```

  After the candidate's release run passes, tag the same commit `v1.0.0` and push that.

- **Apply the two tag rulesets.** [`release-tags.json`](../.github/rulesets/release-tags.json) keeps release tags (`v[0-9]*`) from moving or being deleted, with no bypass. [`release-tag-creation.json`](../.github/rulesets/release-tag-creation.json) lets only a repository admin create one. They're separate so the admin bypass on creation never reaches the other rules.

- **Decide GHCR visibility.** The package is private, so every pull, the notes' included, needs `docker login ghcr.io` with a token that has `read:packages`. Making it public in the package's settings lets anyone pull by digest.
- **Environments.** The release jobs don't use one. To require an approval before an image is published, add a `release` environment with required reviewers and name it on `rc-build`, `rc-merge`, and `promote`.

## Pull by digest

Pull the digest the notes name, so what runs is what was built and scanned:

```sh
docker login ghcr.io   # while the package is private
docker pull ghcr.io/<owner>/<repo>@sha256:<digest>
```

In Compose, put the same `image: ghcr.io/<owner>/<repo>@sha256:<digest>` in the service. A version tag such as `1.2.0` resolves to the same digest, and a later patch can move `1.2`, `1`, and `latest`.

## Verify an image

The signed provenance, with the GitHub CLI:

```sh
gh attestation verify oci://ghcr.io/<owner>/<repo>@sha256:<digest> \
  --repo <owner>/<repo> \
  --signer-workflow <owner>/<repo>/.github/workflows/release.yml
```

Add `--source-ref refs/tags/vX.Y.Z-rc.N` to pin the candidate it came from. BuildKit's provenance and SBOMs travel in the index:

```sh
docker buildx imagetools inspect ghcr.io/<owner>/<repo>@sha256:<digest> --format '{{ json .Provenance }}'
docker buildx imagetools inspect ghcr.io/<owner>/<repo>@sha256:<digest> --format '{{ json .SBOM }}'
```

## Not here yet

Release versioning (the tag matching `package.json`, and a `release.json` on each release), native arm64 runners, a freshness gate on the scheduled workflow, and the gate for the first final release are in the backlog. So are the profile container checks against the candidate's digest, and the rehearsal's store migration and blue-green cutover.
