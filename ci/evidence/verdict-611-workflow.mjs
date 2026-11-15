// Evidence only, never merged: writes .github/workflows/verdict-611-evidence.yml, one upload step an
// artifact, since an upload-artifact step uploads one artifact and the run must hold a release's
// count of them (tests/quality/evidence/verdict-611.test.ts holds the file to this and to
// release.yml's own steps).
//
//   node ci/evidence/verdict-611-workflow.mjs > .github/workflows/verdict-611-evidence.yml

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const COUNT = 611;
/**
 * releaseSlices(611): rc-quality-1 to -3's shares of the release's 611 shards.
 * @type {readonly (readonly [number, number])[]}
 */
export const RANGES = [
  [1, 230],
  [231, 421],
  [422, 611],
];
export const GAP = 307;
const UPLOAD = 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2';
const DOWNLOAD = 'actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2';
const CHECKOUT = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1';
const SETUP_NODE = 'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0';
const IMAGE =
  'mcr.microsoft.com/playwright:v1.58.2-noble@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d';

const setup = (install) =>
  [
    `      - uses: ${CHECKOUT}`,
    '        with:',
    '          persist-credentials: false',
    `      - uses: ${SETUP_NODE}`,
    '        with:',
    '          node-version: ${{ env.NODE_VERSION }}',
    '          package-manager-cache: false',
    ...(install
      ? [
          '      - name: Install, with no cache',
          '        run: corepack enable && pnpm install --frozen-lockfile',
        ]
      : []),
  ].join('\n');

const upload = (name, dir) =>
  [
    `      - uses: ${UPLOAD}`,
    '        with:',
    `          name: ${name}`,
    `          path: \${{ runner.temp }}/${dir}/`,
    '          if-no-files-found: ignore',
    '          retention-days: 7',
  ].join('\n');

function uploadJob(k, [from, to]) {
  const steps = [];
  for (let shard = from; shard <= to; shard += 1) {
    steps.push(upload(`reports-quality-release-${shard}`, `reports-${shard}`));
    steps.push(upload(`verdict-quality-release-${shard}`, `verdict-${shard}`));
  }
  return `  verdict-611-upload-${k}:
    name: verdict-611-upload (shards ${from} to ${to})
    needs: [rc-quality-plan]
    runs-on: ubuntu-24.04
    timeout-minutes: 60
    container:
      image: ${IMAGE}
      options: --user 1001 --ipc=host --init
    steps:
${setup(false)}
      - name: Write and pack shards ${from} to ${to}
        env:
          COUNT: \${{ needs.rc-quality-plan.outputs.count }}
        run: node ci/evidence/verdict-611.mjs pack-range ${from} ${to} "$COUNT" "$RUNNER_TEMP"
${steps.join('\n')}
`;
}

function verdictJob(id, expect, gap) {
  return `  ${id}:
    name: ${id}
    needs: [rc-quality-plan, verdict-611-upload-1, verdict-611-upload-2, verdict-611-upload-3]
    if: \${{ !cancelled() && needs.rc-quality-plan.result == 'success' && needs.verdict-611-upload-1.result == 'success' && needs.verdict-611-upload-2.result == 'success' && needs.verdict-611-upload-3.result == 'success' }}
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
${setup(true)}
      # rc-quality-verdict's steps from here, as they are, but for the merge's id and continue-on-error.
      # Only the shards' verdict files, packed apart from their reports, which at 611 shards
      # would be tens of GB on this runner. The unpack writes each shard's directory as the
      # merge reads it, the plan the shards share written once and linked into each.
      - name: Download the shards' verdict files
        uses: ${DOWNLOAD}
        with:
          pattern: verdict-quality-release-*
          path: \${{ runner.temp }}/verdicts
${
  gap
    ? `      # The gap: shard ${GAP}'s scrub failed, so its verdict files never uploaded.
      - name: Shard ${GAP} uploaded no verdict files
        run: mv "$RUNNER_TEMP/verdicts/verdict-quality-release-${GAP}" "$RUNNER_TEMP/scrubbed-${GAP}"
`
    : ''
}      - name: Unpack the shards' verdict files
        run: node ci/release/shard-verdict.mjs unpack "$RUNNER_TEMP/verdicts" "$RUNNER_TEMP/quality-shards"
      - name: pnpm ci:quality-release --merged
        id: merge
        continue-on-error: true
        env:
          SHARDS: \${{ runner.temp }}/quality-shards
          SHARD_COUNT: \${{ needs.rc-quality-plan.outputs.count }}
          QUALITY_RELEASE_SCOPE: quality/release/scope.json
        run: pnpm ci:quality-release --merged "$SHARDS" --shards "$SHARD_COUNT"
      # The evidence's own: the merged verdict the merge wrote, read for its count and read rules.
      - name: The merged verdict, ${expect === 'whole' ? 'every shard read and none missing' : `refusing shard ${GAP} by name`}
        env:
          MERGE_OUTCOME: \${{ steps.merge.outcome }}
          SHARD_COUNT: \${{ needs.rc-quality-plan.outputs.count }}
        run: pnpm exec tsx tests/quality/evidence/verdict-611.ts judge reports/quality/merged-verdict.json --shards "$SHARD_COUNT" --expect ${expect}
      - name: What the download and unpack took on disk
        if: \${{ always() }}
        run: |
          find "$RUNNER_TEMP/verdicts" -mindepth 1 -maxdepth 1 -type d | wc -l
          du -sh "$RUNNER_TEMP/verdicts" "$RUNNER_TEMP/quality-shards"
          df -h "$RUNNER_TEMP"
`;
}

export function workflowText() {
  return `# Evidence only, never merged (the release verdict at 611 shards): every shard's verdict files,
# packed apart from its reports, uploaded with release.yml's upload-artifact, then
# rc-quality-verdict's own download, unpack and merge over them, in its 15 minutes. Generated by
# ci/evidence/verdict-611-workflow.mjs.
#
# rc-quality-plan prints the release's split of 611 shards (fullOutputs, releaseSlices) and hands on
# the count, as its namesake does. verdict-611-upload-1 to -3 take rc-quality-1 to -3's shares (230,
# 191 and 190) in the release's pinned Playwright image: each writes and packs its shards' synthetic
# reports (ci/evidence/verdict-611.mjs: a release-sized plan of 91,224 tests, the same in every
# shard, its share of them passed, a green verdict, a screenshot and a failure record the verdict
# never reads) with the release's packShard, then uploads each shard's verdict files as
# verdict-quality-release-<n> and a tiny stand-in for its reports as reports-quality-release-<n>, one
# upload step each: ${COUNT * 2} artifacts in the run, a release's count, and at most ${2 * Math.max(...RANGES.map(([from, to]) => to - from + 1))} a job,
# under upload-artifact's 500 a job.
#
# verdict-611-whole runs rc-quality-verdict's download, unpack and merge steps as they are, and
# passes when the merged verdict read every one of the ${COUNT} shards and none is missing.
# verdict-611-gap runs them over ${COUNT - 1}: shard ${GAP}'s artifact moved aside after the download, as a
# shard whose scrub failed uploads none. It passes only when the merge refused, with missing-shard
# for shard ${GAP} alone. The synthetic shards' other failures (the scope's records, which the
# synthetic plan doesn't hold, and the timing gate) are printed, not judged.
#
# Runs on a push of a kgn-a/verdict-611-evidence-* branch alone, holds contents: read and no
# secret, and reads no cache. 6 jobs.
name: verdict-611-evidence

on:
  push:
    branches: ['kgn-a/verdict-611-evidence-*']

permissions:
  contents: read

concurrency:
  group: verdict-611-evidence
  cancel-in-progress: false

env:
  NODE_VERSION: 22.23.4
  TZ: UTC

jobs:
  rc-quality-plan:
    name: rc-quality-plan
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    outputs:
      count: \${{ steps.count.outputs.count }}
    steps:
${setup(true)}
      - name: Split the shards as rc-quality-plan does
        id: count
        run: pnpm exec tsx tests/quality/evidence/verdict-611.ts plan ${COUNT}

${RANGES.map((range, at) => uploadJob(at + 1, range)).join('\n')}
${verdictJob('verdict-611-whole', 'whole', false)}
${verdictJob('verdict-611-gap', `gap:${GAP}`, true)}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(workflowText());
}
