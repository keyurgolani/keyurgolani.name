#!/usr/bin/env node
// The previous release rc-rehearsal's previous-digest row builds
// (ci/rehearsal.mjs, docs/releasing.md): the newest final release, vX.Y.Z,
// merged into the candidate's parent, that ships the revision store the
// row backs up and restores (apps/web/scripts/portfolio-store.ts).
//
//   node ci/release/previous-release.mjs
//
// The checkout needs fetch-depth: 0. Before the first final release with
// the store there is none, and the candidate's parent stands in: an older
// release, such as v0.1.1, has no store to back up, and going back across
// that cutover is #18's. When such releases exist but none is merged into
// the parent, the candidate's history doesn't hold the release it upgrades
// from, so it fails rather than rehearse against the wrong one. It prints
// the ref it chose and why, and writes REHEARSAL_PREVIOUS_REF=<ref> to
// $GITHUB_ENV.
//
// Pure Node with no dependencies.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { finalTagsNewestFirst } from './baseline.mjs';

/** The file a release ships when it has the revision store. */
export const STORE_CLI = 'apps/web/scripts/portfolio-store.ts';

/**
 * The previous release: { ref, why }, or { error }.
 *
 * @param {{ allTags: string[], mergedTags: string[], parent: string, hasStore: (tag: string) => boolean }} input
 *   every tag, the tags merged into the candidate's parent, the parent's
 *   SHA, and whether a tag's tree ships the store
 */
export function previousRelease({ allTags, mergedTags, parent, hasStore }) {
  const finals = finalTagsNewestFirst(allTags).filter(hasStore);
  if (finals.length === 0) {
    return {
      ref: parent,
      why: 'no final release ships the revision store yet, so the candidate parent stands in',
    };
  }
  const [newest] = finalTagsNewestFirst(mergedTags).filter(hasStore);
  if (!newest) {
    return {
      error: `final releases with the revision store exist (${finals.slice(0, 3).join(', ')}), but none is in the candidate's history`,
    };
  }
  return { ref: newest, why: 'the newest final release in the candidate history' };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function main() {
  const lines = (text) => text.split('\n').filter(Boolean);
  const chosen = previousRelease({
    allTags: lines(git(['tag', '--list', 'v[0-9]*'])),
    mergedTags: lines(git(['tag', '--list', 'v[0-9]*', '--merged', 'HEAD^'])),
    parent: git(['rev-parse', 'HEAD^1']).trim(),
    hasStore: (tag) =>
      spawnSync('git', ['cat-file', '-e', `${tag}:${STORE_CLI}`], { stdio: 'ignore' }).status === 0,
  });
  if (chosen.error) {
    console.error(`::error title=previous release::${chosen.error}`);
    return 1;
  }
  console.log(`previous release: ${chosen.ref} (${chosen.why})`);
  if (process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `REHEARSAL_PREVIOUS_REF=${chosen.ref}\n`);
  }
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
