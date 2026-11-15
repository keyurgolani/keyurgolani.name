// Evidence only, never merged: writes .github/workflows/verdict-611-evidence.yml, one upload step an
// artifact, since an upload-artifact step uploads one artifact (tests/quality/evidence/
// verdict-611.test.ts holds the file to this and to release.yml's and inventory.yml's own steps).
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
/**
 * The shards planted unclean in the whole and gap runs: their reports upload as an unclean release
 * shard's would. In the inventory run every shard is unclean, and none uploads its reports.
 * @param {number} shard
 */
export const unclean = (shard) => shard % 15 === 0;
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

const upload = (name, dir, condition) =>
  [
    `      - uses: ${UPLOAD}`,
    ...(condition ? [`        if: \${{ ${condition} }}`] : []),
    '        with:',
    `          name: ${name}`,
    `          path: \${{ runner.temp }}/${dir}/`,
    '          if-no-files-found: ignore',
    '          retention-days: 7',
  ].join('\n');

/**
 * When shard `shard`'s reports upload: an unclean one's in the whole and gap runs, 307's in the gap
 * run, as a shard whose pack never ran; in the inventory run, none. Null: they never do.
 */
function reportsWhen(shard) {
  if (unclean(shard)) return "env.MODE != 'inventory'";
  if (shard === GAP) return "env.MODE == 'gap'";
  return null;
}

function uploadJob(k, [from, to]) {
  const steps = [];
  for (let shard = from; shard <= to; shard += 1) {
    steps.push(
      upload(
        `verdict-quality-release-${shard}`,
        `verdict-${shard}`,
        shard === GAP ? "env.MODE != 'gap'" : null,
      ),
    );
    const when = reportsWhen(shard);
    if (when) steps.push(upload(`reports-quality-release-${shard}`, `reports-${shard}`, when));
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
        run: node ci/evidence/verdict-611.mjs pack-range ${from} ${to} "$COUNT" "$RUNNER_TEMP" "$MODE"
${steps.join('\n')}
`;
}

const UPLOADS =
  "needs.verdict-611-upload-1.result == 'success' && needs.verdict-611-upload-2.result == 'success' && needs.verdict-611-upload-3.result == 'success'";

const disk = (shards) => `      - name: What the download and unpack took on disk
        if: \${{ always() }}
        run: |
          find "$RUNNER_TEMP/verdicts" -mindepth 1 -maxdepth 1 -type d | wc -l
          du -sh "$RUNNER_TEMP/verdicts" "$RUNNER_TEMP/${shards}"
          df -h "$RUNNER_TEMP"
`;

/** The whole and gap runs' verdict: rc-quality-verdict's steps as they are, token-free. */
function releaseVerdictJob() {
  return `  verdict-611-release:
    name: verdict-611-release
    needs: [rc-quality-plan, verdict-611-upload-1, verdict-611-upload-2, verdict-611-upload-3]
    if: \${{ !cancelled() && !contains(github.ref_name, '-inventory-') && needs.rc-quality-plan.result == 'success' && ${UPLOADS} }}
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
${setup(true)}
      # rc-quality-verdict's steps from here, as they are, but for the unpack's and the merge's ids
      # and continue-on-error, so the gap run's refusals are read below.
      # Only the shards' verdict files, packed apart from their reports, which at 611 shards
      # would be tens of GB on this runner. The unpack writes each shard's directory as the
      # merge reads it, the plan the shards share written once and linked into each.
      - name: Download the shards' verdict files
        uses: ${DOWNLOAD}
        with:
          pattern: verdict-quality-release-*
          path: \${{ runner.temp }}/verdicts
      - name: Unpack the shards' verdict files
        id: unpack
        continue-on-error: true
        env:
          SHARD_COUNT: \${{ needs.rc-quality-plan.outputs.count }}
        run: node ci/release/shard-verdict.mjs unpack "$RUNNER_TEMP/verdicts" "$RUNNER_TEMP/quality-shards" --expected "$SHARD_COUNT"
      - name: pnpm ci:quality-release --merged
        id: merge
        continue-on-error: true
        env:
          SHARDS: \${{ runner.temp }}/quality-shards
          SHARD_COUNT: \${{ needs.rc-quality-plan.outputs.count }}
          QUALITY_RELEASE_SCOPE: quality/release/scope.json
        run: pnpm ci:quality-release --merged "$SHARDS" --shards "$SHARD_COUNT"
      # The evidence's own: the unpack's and the merge's outcomes, and the merged verdict the merge
      # wrote, read for its count and read rules, as this run's mode expects them.
      - name: The verdict, as this run's mode expects it
        env:
          UNPACK_OUTCOME: \${{ steps.unpack.outcome }}
          MERGE_OUTCOME: \${{ steps.merge.outcome }}
          SHARD_COUNT: \${{ needs.rc-quality-plan.outputs.count }}
        run: pnpm exec tsx tests/quality/evidence/verdict-611.ts judge "$MODE" --shards "$SHARD_COUNT" --verdict reports/quality/merged-verdict.json --unpacked "$RUNNER_TEMP/quality-shards"
${disk('quality-shards')}`;
}

/** The inventory-shaped run's summary: inventory-summary's steps as they are, token-free. */
function inventoryVerdictJob() {
  return `  inventory-plan:
    name: inventory-plan
    if: \${{ contains(github.ref_name, '-inventory-') }}
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    outputs:
      count: \${{ steps.count.outputs.count }}
    steps:
      # In inventory.yml's place for its plan: the count inventory-summary's steps read.
      - name: The inventory's shard count
        id: count
        run: echo "count=${COUNT}" >> "$GITHUB_OUTPUT"

  verdict-611-inventory:
    name: verdict-611-inventory
    needs:
      - rc-quality-plan
      - inventory-plan
      - verdict-611-upload-1
      - verdict-611-upload-2
      - verdict-611-upload-3
    if: \${{ !cancelled() && contains(github.ref_name, '-inventory-') && needs.inventory-plan.result == 'success' && ${UPLOADS} }}
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
${setup(true)}
      # inventory-summary's steps from here, as they are, but for the artifact pattern (this run's
      # are the release's names), the unpack's and the summary's ids and continue-on-error.
      - name: Download the shards' verdict files
        uses: ${DOWNLOAD}
        with:
          pattern: verdict-quality-release-*
          path: \${{ runner.temp }}/verdicts
      - name: Unpack the shards' verdict files
        id: unpack
        continue-on-error: true
        env:
          SHARD_COUNT: \${{ needs.inventory-plan.outputs.count }}
        run: node ci/release/shard-verdict.mjs unpack "$RUNNER_TEMP/verdicts" "$RUNNER_TEMP/inventory-shards" --expected "$SHARD_COUNT"
      - name: pnpm ci:inventory-summary
        id: merge
        continue-on-error: true
        env:
          SHARDS: \${{ runner.temp }}/inventory-shards
          SHARD_COUNT: \${{ needs.inventory-plan.outputs.count }}
        run: pnpm ci:inventory-summary "$SHARDS" --shards "$SHARD_COUNT"
      # The evidence's own: the outcomes, the inventory's summary, and every shard's failure record
      # read from its unpacked verdict files, with one row's evidence line printed from them.
      - name: The inventory, every shard's verdict and failure record read token-free
        env:
          UNPACK_OUTCOME: \${{ steps.unpack.outcome }}
          MERGE_OUTCOME: \${{ steps.merge.outcome }}
          SHARD_COUNT: \${{ needs.inventory-plan.outputs.count }}
        run: pnpm exec tsx tests/quality/evidence/verdict-611.ts judge inventory --shards "$SHARD_COUNT" --verdict reports/inventory/summary.json --unpacked "$RUNNER_TEMP/inventory-shards"
${disk('inventory-shards')}`;
}

export function workflowText() {
  const planted = Array.from({ length: COUNT }, (_, at) => at + 1).filter(unclean).length;
  const largest = Math.max(
    ...RANGES.map(([from, to]) => {
      let uploads = 0;
      for (let shard = from; shard <= to; shard += 1) uploads += reportsWhen(shard) ? 2 : 1;
      return uploads;
    }),
  );
  return `# Evidence only, never merged (the release verdict at 611 shards, the count route): every shard's
# verdict files uploaded with release.yml's upload-artifact, its reports only when the shard isn't
# clean, then rc-quality-verdict's own download, unpack and merge over them, or the inventory's
# summary over verdict files alone, token-free. Generated by ci/evidence/verdict-611-workflow.mjs.
#
# A push of kgn-a/verdict-611-evidence-<mode>-<sha> runs one mode, from the branch name:
# - whole: every shard's verdict artifact, and the reports of the ${planted} shards planted unclean
#   (every 15th), as a release whose every other shard is clean holds them: ${COUNT + planted} artifacts,
#   under the 1,000 the token-free listing stops at. verdict-611-release passes when the verbatim
#   steps read all ${COUNT}.
# - gap: as whole, but shard ${GAP} uploads its reports and no verdict, as a shard whose pack never
#   ran. verdict-611-release passes only when the verbatim unpack fails on the count, naming ${GAP},
#   and the merge refuses with missing-shard for shard ${GAP} alone.
# - inventory: every shard planted unclean, its first test failed on a failure record, and, as an
#   inventory shard, its verdict files alone uploaded: ${COUNT} artifacts, no reports.
#   verdict-611-inventory runs inventory-summary's verbatim steps, token-free, and passes when every
#   one of the ${COUNT} verdicts comes down, the summary counts every shard's failed test and record,
#   and every shard's failure record, its evidence text whole, reads from its unpacked verdict files.
#
# rc-quality-plan prints the release's split (fullOutputs, releaseSlices) and hands on the count, as
# its namesake does. verdict-611-upload-1 to -3 take rc-quality-1 to -3's shares (230, 191 and 190)
# in the release's pinned Playwright image: each writes and packs its shards' synthetic reports with
# the release's packShard (ci/evidence/verdict-611.mjs: a release-sized plan of 91,224 tests, the
# same in every shard, its share of them, and a failure record when it's planted unclean) and
# uploads, one step an artifact, at most ${largest} a job, under upload-artifact's 500 a job.
#
# Runs on a push of a kgn-a/verdict-611-evidence-* branch alone, holds contents: read and no secret
# or token, and reads no cache. 7 jobs, at most 6 a run.
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
  MODE: \${{ contains(github.ref_name, '-inventory-') && 'inventory' || (contains(github.ref_name, '-gap-') && 'gap' || 'whole') }}

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
${releaseVerdictJob()}
${inventoryVerdictJob()}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(workflowText());
}
