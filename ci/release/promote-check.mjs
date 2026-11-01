#!/usr/bin/env node
// Promotion's first check: a final tag vX.Y.Z promotes only the newest
// release candidate for X.Y.Z, only when that candidate is on the same
// commit, and only when its release run passed its scan and its quality
// gate and tagged its digest (docs/releasing.md).
//
//   GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo TAG=v1.2.0 SHA=<commit> \
//     node ci/release/promote-check.mjs
//
// It reads the tags from the checkout (fetch-depth: 0) and the release runs
// from the API, and writes rc-tag (the candidate's image tag), source-ref
// (its git ref, which its attestation names), and targets (the image tags
// promotion moves, comma-separated) to $GITHUB_OUTPUT.
//
// Pure Node with no dependencies, so the job that runs it needs no install.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubGet, repository } from './github.mjs';
import { parseReleaseTag, promotionTargets, rcImageTag } from './tags.mjs';

export const RELEASE_WORKFLOW = '.github/workflows/release.yml';
/** The candidate's jobs that must have succeeded: its scan, its quality gate, and the image tag it got after. */
export const REQUIRED_RC_JOBS = ['rc-scan', 'rc-quality-verdict', 'rc-tag'];
export const TAG_REF_FORMAT = '%(refname:strip=2) %(objectname) %(*objectname)';
const SHA = /^[0-9a-f]{40}$/;

/**
 * `git for-each-ref refs/tags --format=TAG_REF_FORMAT` as [{ tag, commit }].
 * An annotated tag's commit is its peeled object; a lightweight tag's is the
 * object itself.
 */
export function parseTagRefs(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[0] && SHA.test(parts[1] ?? ''))
    .map(([tag, object, peeled]) => ({ tag, commit: SHA.test(peeled ?? '') ? peeled : object }));
}

/** The release candidates for `version`, newest first. */
export function candidatesFor(version, tagRefs) {
  return tagRefs
    .map((ref) => ({ ...ref, release: parseReleaseTag(ref.tag) }))
    .filter(({ release }) => release?.kind === 'rc' && release.version === version)
    .sort((a, b) => b.release.rc - a.release.rc);
}

/** The candidate's release runs that passed: release.yml, pushed, on its tag and commit. */
export function passedRuns(rcTag, sha, runs, jobsByRun) {
  return (runs ?? []).filter((run) => {
    if (
      run?.path !== RELEASE_WORKFLOW ||
      run.event !== 'push' ||
      run.head_branch !== rcTag ||
      run.head_sha !== sha ||
      run.status !== 'completed' ||
      run.conclusion !== 'success'
    ) {
      return false;
    }
    const jobs = jobsByRun?.[String(run.id)] ?? [];
    return REQUIRED_RC_JOBS.every((name) =>
      jobs.some((job) => job?.name === name && job.conclusion === 'success'),
    );
  });
}

/**
 * The verdict for a final tag: { ok, reasons, candidate, targets }.
 *
 * @param {{ tag: string, sha: string, tagRefs: {tag: string, commit: string}[], runs: object[], jobsByRun: Record<string, object[]> }} input
 */
export function evaluatePromotion({ tag, sha, tagRefs, runs, jobsByRun }) {
  const release = parseReleaseTag(tag);
  if (!release || release.kind !== 'final') {
    return { ok: false, reasons: [`${tag} is not a vX.Y.Z tag`], candidate: null, targets: [] };
  }
  const [newest] = candidatesFor(release.version, tagRefs);
  if (!newest) {
    return {
      ok: false,
      reasons: [
        `no release candidate exists for ${release.version}. Push v${release.version}-rc.1 first`,
      ],
      candidate: null,
      targets: [],
    };
  }
  const reasons = [];
  if (newest.commit !== sha) {
    reasons.push(
      `the newest candidate, ${newest.tag}, is on ${newest.commit}, not on ${sha}. Tag the newest candidate's commit`,
    );
  } else if (passedRuns(newest.tag, sha, runs, jobsByRun).length === 0) {
    reasons.push(
      `${newest.tag} has no passed release run on ${sha}: its scan and its image tag (${REQUIRED_RC_JOBS.join(', ')}) must have succeeded`,
    );
  }
  const finals = tagRefs.map((ref) => ref.tag);
  return {
    ok: reasons.length === 0,
    reasons,
    candidate: newest.tag,
    targets: reasons.length === 0 ? promotionTargets(tag, finals) : [],
  };
}

async function main() {
  const tag = process.env.TAG ?? '';
  const sha = process.env.SHA ?? '';
  if (!SHA.test(sha)) throw new Error(`SHA ${sha} is not a full commit SHA`);
  const tagRefs = parseTagRefs(
    execFileSync('git', ['for-each-ref', 'refs/tags', `--format=${TAG_REF_FORMAT}`], {
      encoding: 'utf8',
    }),
  );
  const [owner, repo] = repository();
  const base = `/repos/${owner}/${repo}`;
  const listed = await githubGet(
    `${base}/actions/workflows/release.yml/runs?event=push&head_sha=${sha}&status=completed&per_page=100`,
  );
  const runs = listed.workflow_runs ?? [];
  const jobsByRun = {};
  for (const run of runs.filter((r) => r.conclusion === 'success')) {
    const jobs = await githubGet(`${base}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
    jobsByRun[String(run.id)] = jobs.jobs ?? [];
  }
  const verdict = evaluatePromotion({ tag, sha, tagRefs, runs, jobsByRun });
  const summary = verdict.ok
    ? `### ${tag}: promotes ${verdict.candidate}\n\nMoves ${verdict.targets.map((t) => `\`${t}\``).join(', ')}.\n`
    : `### ${tag}: refused\n\n${verdict.reasons.map((reason) => `- ${reason}.`).join('\n')}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  for (const reason of verdict.reasons) console.log(`::error title=promotion::${reason}`);
  if (!verdict.ok) return 1;
  const outputs = [
    `rc-tag=${rcImageTag(verdict.candidate)}`,
    `source-ref=refs/tags/${verdict.candidate}`,
    `targets=${verdict.targets.join(',')}`,
  ];
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `${outputs.join('\n')}\n`);
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.log(`::error title=promotion::${error.message}`);
      process.exit(1);
    },
  );
}
