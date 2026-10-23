#!/usr/bin/env node
// Merges the per-platform indexes the build legs pushed into one multi-arch
// index, and pushes it by digest with no tag (docs/releasing.md).
//
//   node ci/release/merge-index.mjs <image> <sha256:amd64-index> <sha256:arm64-index>
//   node ci/release/merge-index.mjs --load <image> <sha256:index> oci-layout://<dir>@<sha256:index>
//
// --load is the dry run's: it pushes one leg's OCI layout to the runner's
// registry by digest, as rc-build pushes each leg to GHCR.
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

/** Why the merged index falls short, one line each, or none. */
export function indexProblems(index, platforms = PLATFORMS) {
  const manifests = Array.isArray(index?.manifests) ? index.manifests : [];
  const problems = [];
  for (const platform of platforms) {
    const [os, architecture] = platform.split('/');
    const images = manifests.filter(
      (m) => m.platform?.os === os && m.platform?.architecture === architecture,
    );
    if (images.length !== 1) {
      problems.push(`the merged index has ${images.length} ${platform} images, not 1`);
      continue;
    }
    const attested = manifests.some(
      (m) =>
        m.annotations?.[REFERENCE_TYPE] === 'attestation-manifest' &&
        m.annotations?.[REFERENCE_DIGEST] === images[0].digest,
    );
    if (!attested) problems.push(`the merged index has no attestation manifest for ${platform}`);
  }
  return problems;
}

const docker = (args) => execFileSync('docker', args, { encoding: 'utf8' });

/**
 * Merges `image@digest` for each leg and pushes the result by digest.
 * `run` is the docker CLI, replaced in tests.
 */
export function mergeIndex(image, digests, run = docker) {
  const problems = digests.flatMap((digest) => retagProblems(image, digest, ['merge']));
  if (digests.length !== PLATFORMS.length) {
    problems.push(`${digests.length} digests for ${PLATFORMS.length} platforms`);
  }
  if (problems.length) throw new Error(problems.join('; '));
  const sources = digests.map((digest) => `${image}@${digest}`);
  // buildx prints the index it would push, then a newline.
  const text = run(['buildx', 'imagetools', 'create', '--dry-run', ...sources]).replace(/\n$/, '');
  const merged = indexProblems(JSON.parse(text));
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
  const [image, ...digests] = argv;
  const digest = mergeIndex(image, digests);
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
