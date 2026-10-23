#!/usr/bin/env node
// The GitHub Release's notes for a candidate or a promotion
// (docs/releasing.md). They name the pull source by digest, say how to
// verify it, and carry the upgrade and rollback steps.
//
//   TAG=v1.2.0-rc.1 IMAGE=ghcr.io/owner/repo DIGEST=sha256:... SHA=<commit> \
//     REPOSITORY=owner/repo RUN_URL=<this run> [CANDIDATE=v1.2.0-rc.1] [TARGETS=1.2.0,1.2,1,latest] \
//     node ci/release/notes.mjs > notes.md
//
// Pure Node with no dependencies.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReleaseTag } from './tags.mjs';

const DIGEST = /^sha256:[0-9a-f]{64}$/;

/**
 * The notes as Markdown.
 *
 * @param {{ tag: string, image: string, digest: string, sha: string, repository: string,
 *   runUrl?: string, candidate?: string, targets?: string[], dryRun?: boolean }} input
 */
export function renderNotes({ tag, image, digest, sha, repository, runUrl, candidate, targets, dryRun }) {
  const release = parseReleaseTag(tag);
  if (!release) throw new Error(`${tag} is not a release tag`);
  if (!DIGEST.test(String(digest ?? ''))) throw new Error(`${digest} is not a sha256 digest`);
  const source = `${image}@${digest}`;
  const final = release.kind === 'final';
  const lines = [
    ...(dryRun
      ? [
          '> Dry run: this image went to a registry on the CI runner and nowhere else. Nothing was published or attested.',
          '',
        ]
      : []),
    final
      ? `Promotes ${candidate} to ${release.version}, with no rebuild: the same digest, scanned again and with its attestation verified first.`
      : `Release candidate ${release.rc} for ${release.version}, built once from ${sha} on main after its ci run passed gate.`,
    '',
    '## Pull',
    '',
    'Pull by digest, so what you run is what was built and scanned:',
    '',
    '```sh',
    `docker pull ${source}`,
    '```',
    '',
    final
      ? `The tags ${(targets ?? []).map((t) => `\`${t}\``).join(', ')} point at the same digest.`
      : `The tag \`${release.version}-rc.${release.rc}\` points at the same digest. \`latest\` doesn't move until a final release.`,
    '',
    'The package on GHCR is private for now, so pulling needs a login first: `docker login ghcr.io` with a token that has `read:packages`.',
    '',
    '## Verify',
    '',
    'The build provenance is signed by this repository\'s release workflow:',
    '',
    '```sh',
    `gh attestation verify oci://${source} --repo ${repository}`,
    '```',
    '',
    'The image index also carries BuildKit\'s SLSA provenance (mode=max) and an SPDX SBOM for each platform:',
    '',
    '```sh',
    `docker buildx imagetools inspect ${source} --format '{{ json .Provenance }}'`,
    `docker buildx imagetools inspect ${source} --format '{{ json .SBOM }}'`,
    '```',
    '',
    'Grype scanned the image for linux/amd64 and linux/arm64, and the production dependencies, under ci/release/scan-exceptions.yml.',
    '',
    '## Upgrade',
    '',
    `1. Under \`owner\`, back up the data directory with the image you run now (\`portfolio-store backup --out <dir>\`, [Backups](https://github.com/${repository}/blob/${tag}/docs/deployment.md#backups)), and keep the backup with that image's digest.`,
    `2. Point your deployment at \`${source}\` and restart.`,
    '3. Check `/api/ready` and the site before you drop the old container.',
    '',
    '## Roll back',
    '',
    'Point the deployment back at the previous digest, from its release notes, and restore the backup you took with it if the new release changed the store.',
    ...(runUrl ? ['', `Built and checked in ${runUrl}.`] : []),
    '',
  ];
  return lines.join('\n');
}

function main() {
  const env = process.env;
  process.stdout.write(
    renderNotes({
      tag: env.TAG,
      image: env.IMAGE,
      digest: env.DIGEST,
      sha: env.SHA,
      repository: env.REPOSITORY,
      runUrl: env.RUN_URL,
      candidate: env.CANDIDATE,
      targets: env.TARGETS ? env.TARGETS.split(',') : undefined,
      dryRun: env.DRY_RUN === '1',
    }),
  );
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main());
  } catch (error) {
    console.log(`::error title=release notes::${error.message}`);
    process.exit(1);
  }
}
