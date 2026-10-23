#!/usr/bin/env node
// Release tags (docs/releasing.md). A release candidate is vX.Y.Z-rc.N and a
// final release is vX.Y.Z; nothing else is a release tag, so the release
// workflow refuses it.
//
//   TAG=v1.2.0-rc.1 REPOSITORY=owner/repo node ci/release/tags.mjs
//
// writes kind (rc or final), version, rc-tag (the image tag an RC gets), and
// image (ghcr.io/<owner>/<repo>, lowercased) to $GITHUB_OUTPUT.
//
// Pure Node with no dependencies, so the job that runs it needs no install.
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NUMBER = '(0|[1-9]\\d*)';
const RELEASE_TAG = new RegExp(`^v${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-rc\\.([1-9]\\d*))?$`);

/**
 * What a tag names: { kind, version, major, minor, patch, rc }, or null when
 * it isn't a release tag. `rc` is the candidate number, or null for a final
 * release.
 */
export function parseReleaseTag(tag) {
  const match = RELEASE_TAG.exec(String(tag ?? ''));
  if (!match) return null;
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  const rc = match[4] === undefined ? null : Number(match[4]);
  return {
    kind: rc === null ? 'final' : 'rc',
    version: `${major}.${minor}.${patch}`,
    major,
    minor,
    patch,
    rc,
  };
}

/** The image tag an RC's digest gets: the tag without its v. */
export const rcImageTag = (tag) => String(tag).replace(/^v/, '');

/** Orders versions { major, minor, patch } ascending. */
export function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * The image tags a promotion moves. X.Y.Z always; X.Y, X, and latest only
 * when no final release already out is newer within that line, so promoting
 * a patch to an older line never moves them backwards.
 *
 * @param {string} tag the final tag being promoted
 * @param {string[]} finalTags every final release tag, this one included or not
 */
export function promotionTargets(tag, finalTags) {
  const release = parseReleaseTag(tag);
  if (!release || release.kind !== 'final') throw new Error(`${tag} is not a final release tag`);
  const others = finalTags
    .map(parseReleaseTag)
    .filter((other) => other && other.kind === 'final' && other.version !== release.version);
  const newer = (inLine) =>
    others.some((other) => inLine(other) && compareVersions(other, release) > 0);
  const targets = [release.version];
  if (!newer((o) => o.major === release.major && o.minor === release.minor)) {
    targets.push(`${release.major}.${release.minor}`);
  }
  if (!newer((o) => o.major === release.major)) targets.push(`${release.major}`);
  if (!newer(() => true)) targets.push('latest');
  return targets;
}

/** ghcr.io/<owner>/<repo>, lowercased, since registry names are lowercase. */
export function ghcrImage(repository) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repository ?? ''))) {
    throw new Error(`${repository} is not an owner/repo name`);
  }
  return `ghcr.io/${repository.toLowerCase()}`;
}

function main() {
  const tag = process.env.TAG ?? '';
  const release = parseReleaseTag(tag);
  if (!release) {
    console.log(
      `::error title=release::${tag} is not a release tag. Push vX.Y.Z-rc.N for a release candidate or vX.Y.Z to promote one (docs/releasing.md).`,
    );
    return 1;
  }
  const outputs = {
    kind: release.kind,
    version: release.version,
    'rc-tag': release.kind === 'rc' ? rcImageTag(tag) : '',
    image: ghcrImage(process.env.REPOSITORY),
  };
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
