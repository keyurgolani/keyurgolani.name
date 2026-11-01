#!/usr/bin/env node
// The release candidate's dependency baseline: the newest final release
// before it (docs/releasing.md).
//
//   GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo node ci/release/baseline.mjs
//
// It lists the tags merged into HEAD (the checkout needs fetch-depth: 0),
// keeps only those parseReleaseTag reads as final, vX.Y.Z, and takes the
// highest version that also has a published GitHub Release, neither a
// draft nor a pre-release. A stray tag, such as a v1.0.0-beta.1 or a
// v9-anything, is never the baseline, so it can't hide new findings: tags
// can't be deleted once the ruleset applies. It writes tag=<tag>, or tag=
// for none, to $GITHUB_OUTPUT.
//
// Pure Node with no dependencies, so the job that runs it needs no install.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubGet, repository } from './github.mjs';
import { compareVersions, parseReleaseTag } from './tags.mjs';

/** The final release tags in `tags`, newest version first. */
export function finalTagsNewestFirst(tags) {
  return tags
    .map((tag) => ({ tag, release: parseReleaseTag(tag) }))
    .filter(({ release }) => release?.kind === 'final')
    .sort((a, b) => compareVersions(b.release, a.release))
    .map(({ tag }) => tag);
}

/** Whether a GET releases/tags/{tag} answer (null for a 404) is a published final release. */
export function isPublishedRelease(release, tag) {
  return Boolean(
    release && release.tag_name === tag && release.draft === false && release.prerelease === false,
  );
}

/**
 * The baseline tag, or null: the newest final tag that `hasRelease` (async,
 * tag => boolean) confirms.
 */
export async function pickBaseline(tags, hasRelease) {
  for (const tag of finalTagsNewestFirst(tags)) {
    if (await hasRelease(tag)) return tag;
  }
  return null;
}

async function main() {
  const tags = execFileSync('git', ['tag', '--merged', 'HEAD'], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const [owner, repo] = repository();
  const tag = await pickBaseline(tags, async (candidate) =>
    isPublishedRelease(
      await githubGet(`/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(candidate)}`, {
        missing: null,
      }),
      candidate,
    ),
  );
  console.log(
    tag
      ? `Baseline: ${tag}, the newest final release before this commit.`
      : 'No final release before this commit, so every High or Critical finding is new.',
  );
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag ?? ''}\n`);
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.log(`::error title=dependency baseline::${error.message}`);
      process.exit(1);
    },
  );
}
