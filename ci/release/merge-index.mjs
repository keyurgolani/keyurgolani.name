#!/usr/bin/env node
// Merges the per-platform indexes the build legs pushed into one multi-arch
// index, and pushes it by digest with no tag (docs/releasing.md).
//
//   node ci/release/merge-index.mjs <image> <sha256:amd64-index> <sha256:arm64-index>
//   node ci/release/merge-index.mjs --unattested --purpose sha-publish <image> <sha256:amd64> <sha256:arm64>
//   node ci/release/merge-index.mjs --load <image> <sha256:index> oci-layout://<dir>@<sha256:index>
//
// --load is the dry run's: it pushes one leg's OCI layout to the runner's
// registry by digest, as rc-build pushes each leg to GHCR.
//
// --unattested is for ci.yml's publish-merge alone. Its sha-<short> legs
// build with provenance off and no SBOM, so the merged index must hold
// exactly one image per platform and nothing else. It needs --purpose
// sha-publish with it, and logs that it ran unattested. In Actions it runs
// only for a push to main in this repository's ci.yml, as
// GITHUB_WORKFLOW_REF names it exactly, and refuses to run when that's
// unset. Without it the merge is the release merge, with every attestation
// check. ci/workflows.test.mjs fails if any workflow job but publish-merge,
// any package.json script, or any file under ci/ but this one and its test
// names it.
//
// `docker buildx imagetools create` does the merge, and copies every
// manifest from both indexes, each platform's attestation manifest included.
// It pushes only to a --tag, so the dry run's output gives the merged
// index's digest first, and the push targets <image>@<that digest>, which
// the registry stores by digest alone. The merged index must then resolve
// to that digest. It prints the digest, and writes digest=<it> to
// $GITHUB_OUTPUT when that is set.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORMS } from './attestations.mjs';
import { manifestDigest, retagProblems } from './retag.mjs';

const REFERENCE_TYPE = 'vnd.docker.reference.type';
const REFERENCE_DIGEST = 'vnd.docker.reference.digest';

const isAttestation = (m) => m.annotations?.[REFERENCE_TYPE] === 'attestation-manifest';
const platformOf = (m) => `${m.platform?.os}/${m.platform?.architecture}`;

/** The media types an image manifest has, OCI's and Docker's v2. */
export const IMAGE_MANIFEST_TYPES = [
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
];

/**
 * Why the merged index falls short, one line each, or none. It must hold
 * exactly one image for each of `platforms` and none for any other, and
 * exactly one attestation manifest for each image, and nothing else: an
 * attestation that names no image of the index is refused too.
 */
export function indexProblems(index, platforms = PLATFORMS) {
  const manifests = Array.isArray(index?.manifests) ? index.manifests : [];
  const images = manifests.filter((m) => !isAttestation(m));
  const problems = [];
  for (const image of images) {
    if (!platforms.includes(platformOf(image))) {
      problems.push(`the merged index has a ${platformOf(image)} image, which no leg builds`);
    }
  }
  for (const platform of platforms) {
    const matching = images.filter((m) => platformOf(m) === platform);
    if (matching.length !== 1) {
      problems.push(`the merged index has ${matching.length} ${platform} images, not 1`);
      continue;
    }
    const attestations = manifests.filter(
      (m) => isAttestation(m) && m.annotations?.[REFERENCE_DIGEST] === matching[0].digest,
    );
    if (attestations.length === 0) {
      problems.push(`the merged index has no attestation manifest for ${platform}`);
    } else if (attestations.length !== 1) {
      problems.push(
        `the merged index has ${attestations.length} attestation manifests for ${platform}, not 1`,
      );
    }
  }
  const imageDigests = new Set(images.map((m) => m.digest));
  const orphans = manifests.filter(
    (m) => isAttestation(m) && !imageDigests.has(m.annotations?.[REFERENCE_DIGEST]),
  );
  if (orphans.length > 0) {
    problems.push(
      `the merged index has ${orphans.length} attestation manifests for no image of its own`,
    );
  }
  return problems;
}

/**
 * Why an unattested merge falls short: each platform needs exactly one
 * image, each an image manifest, and the index may hold nothing but those
 * images: no attestation manifest, whatever platform it claims.
 */
export function plainIndexProblems(index, platforms = PLATFORMS) {
  const manifests = Array.isArray(index?.manifests) ? index.manifests : [];
  const problems = [];
  const attestations = manifests.filter(isAttestation).length;
  if (attestations > 0) {
    problems.push(`the unattested index has ${attestations} attestation manifests`);
  }
  for (const m of manifests) {
    if (!isAttestation(m) && !IMAGE_MANIFEST_TYPES.includes(m.mediaType)) {
      problems.push(`the unattested index has a ${m.mediaType ?? 'typeless'} entry, not an image`);
    }
  }
  const images = [];
  for (const platform of platforms) {
    const [os, architecture] = platform.split('/');
    const matches = manifests.filter(
      (m) =>
        !isAttestation(m) && m.platform?.os === os && m.platform?.architecture === architecture,
    );
    if (matches.length !== 1) {
      problems.push(`the merged index has ${matches.length} ${platform} images, not 1`);
    }
    images.push(...matches);
  }
  const others = manifests.length - images.length;
  if (others > 0) problems.push(`the unattested index has ${others} other manifests`);
  return problems;
}

const docker = (args) => execFileSync('docker', args, { encoding: 'utf8' });

/** The one reason a merge may skip attestations: ci.yml's sha-<short> images. */
export const UNATTESTED_PURPOSES = ['sha-publish'];

/** The only workflow run that may merge unattested: ci.yml, for a push to main, in `repository`. */
export const unattestedWorkflowRef = (repository) =>
  `${repository}/.github/workflows/ci.yml@refs/heads/main`;

const UNATTESTED_FLAGS = ['--unattested', '--purpose'];

/**
 * Splits the merge arguments. `--unattested --purpose <purpose>` must lead,
 * and the purpose must be one of UNATTESTED_PURPOSES. In Actions
 * (GITHUB_ACTIONS=true), or wherever GITHUB_WORKFLOW_REF is set, the run
 * must be a push, and the ref exactly this repository's ci.yml on main; an
 * Actions run with no ref fails closed. Without the flag, the arguments are
 * the release merge's, unchanged.
 */
export function parseMergeArgs(argv, env = process.env) {
  if (argv[0] !== '--unattested') {
    if (argv.some((a) => UNATTESTED_FLAGS.includes(a))) {
      throw new Error('--unattested --purpose <purpose> must come first');
    }
    const [image, ...digests] = argv;
    return { image, digests };
  }
  const [, flag, purpose, image, ...digests] = argv;
  if (flag !== '--purpose' || !UNATTESTED_PURPOSES.includes(purpose)) {
    throw new Error(`--unattested needs --purpose ${UNATTESTED_PURPOSES.join(' or ')}`);
  }
  if ([image, ...digests].some((a) => UNATTESTED_FLAGS.includes(a))) {
    throw new Error('--unattested --purpose <purpose> is given once');
  }
  const ref = env.GITHUB_WORKFLOW_REF;
  if (ref === undefined && env.GITHUB_ACTIONS === 'true') {
    throw new Error('--unattested in Actions needs GITHUB_WORKFLOW_REF, and it is unset');
  }
  if (ref !== undefined) {
    const repository = env.GITHUB_REPOSITORY;
    if (!repository || ref !== unattestedWorkflowRef(repository)) {
      throw new Error(`--unattested runs only in ci.yml on main, not ${ref}`);
    }
    if (env.GITHUB_EVENT_NAME !== 'push') {
      throw new Error(`--unattested runs only for a push, not ${env.GITHUB_EVENT_NAME}`);
    }
  }
  return { image, digests, unattested: purpose };
}

/**
 * Merges `image@digest` for each leg and pushes the result by digest.
 * `run` is the docker CLI, replaced in tests. `unattested`, one of
 * UNATTESTED_PURPOSES, checks the index with plainIndexProblems in place of
 * indexProblems, and says so through `log`.
 */
export function mergeIndex(image, digests, run = docker, { unattested, log = console.log } = {}) {
  const problems = digests.flatMap((digest) => retagProblems(image, digest, ['merge']));
  if (unattested !== undefined && !UNATTESTED_PURPOSES.includes(unattested)) {
    problems.push(`${unattested} is not a reason to merge without attestations`);
  }
  if (digests.length !== PLATFORMS.length) {
    problems.push(`${digests.length} digests for ${PLATFORMS.length} platforms`);
  }
  if (problems.length) throw new Error(problems.join('; '));
  const sources = digests.map((digest) => `${image}@${digest}`);
  // buildx prints the index it would push, then a newline.
  const text = run(['buildx', 'imagetools', 'create', '--dry-run', ...sources]).replace(/\n$/, '');
  const merged =
    unattested === undefined
      ? indexProblems(JSON.parse(text))
      : plainIndexProblems(JSON.parse(text));
  if (merged.length) throw new Error(merged.join('; '));
  const digest = `sha256:${createHash('sha256').update(text).digest('hex')}`;
  run(['buildx', 'imagetools', 'create', '--tag', `${image}@${digest}`, ...sources]);
  const resolved = manifestDigest(
    run([
      'buildx',
      'imagetools',
      'inspect',
      `${image}@${digest}`,
      '--format',
      '{{json .Manifest}}',
    ]),
  );
  if (resolved !== digest) throw new Error(`${image}@${digest} resolves to ${resolved}`);
  if (unattested !== undefined) {
    log(
      `::warning title=merge::merged ${image}@${digest} unattested (--purpose ${unattested}): no provenance or SBOM was checked`,
    );
  }
  return digest;
}

/**
 * Pushes one leg's index from `source` (the dry run's OCI layout) to
 * `image@digest`, by digest with no tag, as the leg would have pushed it.
 */
export function loadIndex(image, digest, source, run = docker) {
  const problems = retagProblems(image, digest, ['load']);
  if (!/^oci-layout:\/\/\S+@sha256:[0-9a-f]{64}$/.test(String(source ?? ''))) {
    problems.push(`${source} is not an oci-layout:// source with a digest`);
  }
  if (problems.length) throw new Error(problems.join('; '));
  run(['buildx', 'imagetools', 'create', '--tag', `${image}@${digest}`, source]);
  const resolved = manifestDigest(
    run([
      'buildx',
      'imagetools',
      'inspect',
      `${image}@${digest}`,
      '--format',
      '{{json .Manifest}}',
    ]),
  );
  if (resolved !== digest) throw new Error(`${image}@${digest} resolves to ${resolved}`);
  return digest;
}

function main(argv) {
  if (argv[0] === '--load') {
    const [, image, digest, source] = argv;
    console.log(`${image}@${loadIndex(image, digest, source)}`);
    return 0;
  }
  const { image, digests, unattested } = parseMergeArgs(argv);
  const digest = mergeIndex(image, digests, docker, { unattested });
  console.log(`${image}@${digest}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `digest=${digest}\n`);
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.log(`::error title=merge::${error.message}`);
    process.exit(1);
  }
}
