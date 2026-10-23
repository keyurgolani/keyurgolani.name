# Releasing

A release is two tags on one commit of `main`: a release candidate, `vX.Y.Z-rc.N`, which builds, attests, and scans the image, and a final tag, `vX.Y.Z`, which promotes that same image with no rebuild. Both run in [`.github/workflows/release.yml`](../.github/workflows/release.yml). Nothing else publishes a release, and the workflow has no manual trigger.

Pushes to `main` keep publishing `sha-<short>` images after `gate` (`publish` in [`ci.yml`](../.github/workflows/ci.yml)). Those are builds, not releases: they never move a version tag or `latest`.

## A release candidate

Pushing `vX.Y.Z-rc.N` runs these jobs in order, and each one stops the release when it fails:

1. **classify** reads the tag. Anything but `vX.Y.Z-rc.N` or `vX.Y.Z` fails here.
2. **rc-verify** refuses the tag unless its commit is on `main` and has a green complete `ci` run: a `ci.yml` run for the push to `main` on exactly that commit, where `gate` passed and the run concluded success. `gate` passes only on a complete run, so a draft PR's selected run never counts, and a PR's run doesn't either, since its `gate` checked a merge commit. It reads both through the API with `contents: read` and `actions: read` ([`ci/release/verify-rc.mjs`](../ci/release/verify-rc.mjs)).
3. **rc-build** builds `linux/amd64` and `linux/arm64` once, arm64 under QEMU, with BuildKit's SLSA provenance at `mode=max` and an SPDX SBOM for each platform in the index. It pushes the index to `ghcr.io/<owner>/<repo>` by digest, with no tag, checks that both platforms carry the provenance and an SBOM ([`ci/release/attestations.mjs`](../ci/release/attestations.mjs)), and attests the digest with `actions/attest-build-provenance`, which signs the provenance through Sigstore and stores it with GitHub and on GHCR.
4. **rc-scan** runs Grype on that digest, once per platform, and on the production dependencies ([Scans](#scans)).
5. **rc-tag** tags the scanned digest `X.Y.Z-rc.N` on GHCR, and checks the tag resolves to it.
6. **rc-release** creates the GitHub pre-release, with notes that name the pull source by digest and the two SBOMs attached.

## Promotion

Pushing `vX.Y.Z` on the newest candidate's commit runs:

1. **classify**, as above.
2. **promote-verify** refuses unless a candidate for `X.Y.Z` exists, the newest one (the highest `N`) is on this commit, and its release run passed `rc-scan` and `rc-tag` ([`ci/release/promote-check.mjs`](../ci/release/promote-check.mjs)). An older candidate never promotes. Cut a new one on the commit you want instead.
3. **promote-scan** resolves the candidate's GHCR tag to its digest, then verifies that digest's provenance attestation: signed by this repository's `release.yml`, on a GitHub-hosted runner, for the candidate's tag and this commit. Whatever the GHCR tag says, only the digest that run built gets through. It checks the provenance and SBOMs again and scans the image again, with that day's vulnerability database.
4. **promote** points `X.Y.Z` at the digest with `docker buildx imagetools create`, which copies the index by reference and builds nothing. It moves `X.Y`, `X`, and `latest` too, unless a final release already out is newer in that line, so a patch to an older line never moves them backwards ([`ci/release/tags.mjs`](../ci/release/tags.mjs)). It reads the tags again right before it moves anything, and runs one at a time across every final tag (the `release-promote` concurrency group), so two promotions never race for `latest`. GitHub keeps one waiting job per group, so a third final pushed while one promotion runs and another waits cancels the waiting one. Re-run that run's failed jobs, within GitHub's 30-day window. It's the only job that moves `latest`.
5. **promote-release** creates the GitHub Release with the same notes.

## Reproducibility

Image builds aren't byte-for-byte reproducible. The runtime stage runs `apk upgrade`, so a rebuild of the same commit picks up that day's Alpine packages and gets another digest. The digest a candidate built, attested, and scanned is the artifact of record, and promotion re-tags it rather than building again.

## Permissions

The workflow's token is `contents: read`. Each job that writes gets only what it writes, and only on a tag push:

| Job               | Writes                                 |
| ----------------- | -------------------------------------- |
| `rc-build`        | `packages`, `id-token`, `attestations` |
| `rc-tag`          | `packages`                             |
| `rc-release`      | `contents`, for the pre-release        |
| `promote`         | `packages`                             |
| `promote-release` | `contents`, for the release            |

`rc-verify` and `promote-verify` add `actions: read`, `rc-scan` and `promote-scan` add `packages: read` to pull the private package, and `promote-scan` adds `attestations: read`. No job reads or writes a cache: the installs are fresh, setup-node, setup-buildx, and setup-qemu run with their caches off, and no build names `cache-from`. No job uses a repository secret.

## The dry run

A pull request into `next` or `main` that changes `release.yml`, `ci/release/`, the `Dockerfile`, `.dockerignore`, `.grype.yaml`, or `pnpm-lock.yaml` runs the `dry-run` job. It builds both platforms with the same provenance and SBOM settings into a `registry:2` container on the runner, published on its loopback only, checks the attestations there, runs both scans, tags the digest `0.0.0-rc.1` and then promotes it to `0.0.0`, `0.0`, `0`, and `latest` in that registry, and renders the notes into the job summary. It holds `contents: read` and no secret, never logs in to GHCR, and attests nothing, since signing needs `id-token: write`.

Grype downloads its vulnerability database on the runner. The dry run is not a required check: `gate` is the only one.

## Scans

[`ci/release/scan-gate.mjs`](../ci/release/scan-gate.mjs) reads Grype's JSON and decides. Grype itself is pinned by version and SHA-256 ([`ci/release/install-grype.mjs`](../ci/release/install-grype.mjs)), and [`.grype.yaml`](../.grype.yaml) refuses a database more than five days old.

- **The image** fails on a Critical or High finding that has a fix, on either platform. A finding with no fix yet is counted in the summary and doesn't fail.
- **Production dependencies** are apps/web's run-time tree, read from `pnpm-lock.yaml` ([`ci/release/prod-deps.mjs`](../ci/release/prod-deps.mjs)): its dependencies, the workspace packages it links and theirs, and none of anyone's devDependencies. The scan fails on a High or Critical finding there that the baseline doesn't have, fixable or not. The baseline is the PR's base on a dry run. On a candidate it's the newest `vX.Y.Z` tag before the commit that has a published GitHub Release ([`ci/release/baseline.mjs`](../ci/release/baseline.mjs)), so a stray tag such as `v2.0.0-beta.1` never becomes one.

The image scan never uses a baseline: it always fails on a fixable Critical or High finding.

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

- **Push the tags.** From an up-to-date `main`, once its `ci` run has passed:

  ```sh
  git tag -a v1.0.0-rc.1 -m "v1.0.0-rc.1" <commit>
  git push origin v1.0.0-rc.1
  ```

  After the candidate's release run passes, tag the same commit `v1.0.0` and push that.

- **Apply the two tag rulesets.** [`release-tags.json`](../.github/rulesets/release-tags.json) keeps release tags (`v[0-9]*`) from moving or being deleted, with no bypass. [`release-tag-creation.json`](../.github/rulesets/release-tag-creation.json) lets only a repository admin create one. They're separate so the admin bypass on creation never reaches the other rules.

- **Decide GHCR visibility.** The package is private, so every pull, the notes' included, needs `docker login ghcr.io` with a token that has `read:packages`. Making it public in the package's settings lets anyone pull by digest.
- **Environments.** The release jobs don't use one. To require an approval before an image is published, add a `release` environment with required reviewers and name it on `rc-build` and `promote`.

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

Release versioning (the tag matching `package.json`, and a `release.json` on each release), native arm64 runners, a freshness gate on the scheduled workflow, and the gate for the first final release are in the backlog. So are the release-candidate rehearsal of migration, backup, restore, and rollback (#12's last PR) and the profile container checks against the candidate's digest.
