#!/usr/bin/env node
// Points image tags at one digest with no rebuild, then confirms each tag
// resolves to exactly that digest (docs/releasing.md).
//
//   node ci/release/retag.mjs <image> <sha256:digest> <tag>[,<tag>...]
//
// It runs `docker buildx imagetools create`, which copies the index, its
// attestations included, by reference. The release candidate's job tags its
// scanned digest X.Y.Z-rc.N, and only the promotion job passes latest.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const IMAGE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::\d+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+$/;
const TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

/** Why the arguments can't be retagged, one line each, or none. */
export function retagProblems(image, digest, tags) {
  const problems = [];
  if (!IMAGE.test(String(image ?? ''))) problems.push(`${image} is not an image name`);
  if (!DIGEST.test(String(digest ?? ''))) problems.push(`${digest} is not a sha256 digest`);
  if (!Array.isArray(tags) || tags.length === 0) problems.push('no tags to move');
  for (const tag of tags ?? []) if (!TAG.test(tag)) problems.push(`${tag} is not an image tag`);
  return problems;
}

/** The index digest `imagetools inspect --format '{{json .Manifest}}'` reports. */
export function manifestDigest(json) {
  const digest = JSON.parse(json)?.digest;
  if (!DIGEST.test(String(digest ?? ''))) throw new Error('imagetools reported no digest');
  return digest;
}

const docker = (args) => execFileSync('docker', args, { encoding: 'utf8' });

/**
 * Tags `image@digest` as each tag and checks every one resolves to it.
 * `run` is the docker CLI, replaced in tests.
 */
export function retag(image, digest, tags, run = docker) {
  const problems = retagProblems(image, digest, tags);
  if (problems.length) throw new Error(problems.join('; '));
  const moved = [];
  for (const tag of tags) {
    const target = `${image}:${tag}`;
    run(['buildx', 'imagetools', 'create', '--tag', target, `${image}@${digest}`]);
    const resolved = manifestDigest(
      run(['buildx', 'imagetools', 'inspect', target, '--format', '{{json .Manifest}}']),
    );
    if (resolved !== digest) throw new Error(`${target} resolves to ${resolved}, not ${digest}`);
    moved.push(target);
  }
  return moved;
}

function main(argv) {
  const [image, digest, list] = argv;
  const tags = String(list ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  for (const target of retag(image, digest, tags)) console.log(`${target} -> ${digest}`);
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.log(`::error title=retag::${error.message}`);
    process.exit(1);
  }
}
