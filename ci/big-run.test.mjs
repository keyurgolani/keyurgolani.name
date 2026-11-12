// The nightly's pause (ci/big-run.mjs, row 151): which runs in flight skip the night's quality
// matrix, and what the job summary says.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import * as bigRun from './big-run.mjs';

const run = (fields) => ({
  id: 1,
  status: 'in_progress',
  event: 'push',
  path: '.github/workflows/release.yml',
  head_branch: 'v1.0.0-rc.4',
  ...fields,
});

test('a release-tag run in flight, a candidate or a final, pauses the night', () => {
  for (const status of ['queued', 'waiting', 'pending', 'requested', 'in_progress']) {
    assert.equal(bigRun.isBigRun(run({ status })), true, status);
  }
  assert.equal(bigRun.isBigRun(run({ head_branch: 'v1.0.0' })), true);
  const decision = bigRun.bigRunDecision([run({ id: 42 })]);
  assert.equal(decision.busy, true);
  assert.deepEqual(decision.runs, [42]);
  assert.match(
    decision.summary,
    /^The nightly quality matrix is skipped tonight: the release run 42 for v1\.0\.0-rc\.4 \(in_progress\) is in flight/,
  );
});

test("release.yml's PR dry run, a finished release run, and a branch push don't pause it", () => {
  assert.equal(bigRun.isBigRun(run({ event: 'pull_request', head_branch: 'feature' })), false);
  assert.equal(bigRun.isBigRun(run({ status: 'completed' })), false);
  assert.equal(bigRun.isBigRun(run({ head_branch: 'main' })), false);
  assert.equal(bigRun.isBigRun(run({ head_branch: 'v1.0' })), false);
  assert.equal(bigRun.isBigRun(run({ path: '.github/workflows/ci.yml' })), false);
  assert.equal(bigRun.isBigRun(run({ path: '.github/workflows/scheduled.yml' })), false);
  const decision = bigRun.bigRunDecision([run({ status: 'completed' }), null]);
  assert.deepEqual(decision, {
    busy: false,
    summary: 'No release or inventory run is in flight, so the nightly quality matrix runs.',
    runs: [],
  });
  assert.equal(bigRun.bigRunDecision([]).busy, false);
  assert.equal(bigRun.bigRunDecision(undefined).busy, false);
});

test('an inventory evidence run, any run of inventory.yml on any branch or event, pauses it', () => {
  assert.equal(bigRun.INVENTORY_WORKFLOW, '.github/workflows/inventory.yml');
  // The inventory run is that file, under that name, so a run of it is found.
  const inventoryFile = parse(
    readFileSync(new URL(`../${bigRun.INVENTORY_WORKFLOW}`, import.meta.url), 'utf8'),
  );
  assert.equal(inventoryFile.name, 'inventory');
  const inventory = run({
    id: 7,
    path: bigRun.INVENTORY_WORKFLOW,
    event: 'workflow_dispatch',
    head_branch: 'kgn/evidence-inventory',
    status: 'queued',
  });
  assert.equal(bigRun.isBigRun(inventory), true);
  assert.equal(bigRun.isBigRun({ ...inventory, event: 'push' }), true);
  // Listed once per status it was read under, it's named once; both kinds are named, by id.
  const decision = bigRun.bigRunDecision([run({ id: 9 }), inventory, inventory]);
  assert.deepEqual(decision.runs, [7, 9]);
  assert.match(
    decision.summary,
    /the inventory run 7 \(kgn\/evidence-inventory, queued\), and the release run 9 for v1\.0\.0-rc\.4 \(in_progress\) are in flight/,
  );
});

test("scheduled.yml's big-run gates quality-full and quality-verdict, holds contents and actions: read alone, and report expects their skip", () => {
  const workflow = parse(
    readFileSync(new URL('../.github/workflows/scheduled.yml', import.meta.url), 'utf8'),
  );
  const { jobs } = workflow;
  const job = jobs['big-run'];
  assert.deepEqual(job.permissions, { contents: 'read', actions: 'read' });
  assert.deepEqual(job.outputs, { busy: '${{ steps.check.outputs.busy }}' });
  const check = job.steps.find((step) => step.id === 'check');
  assert.equal(check.run, 'node ci/big-run.mjs');
  // Its local command, which report names on a failure.
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(scripts['ci:big-run'], 'node ci/big-run.mjs');
  assert.equal(check.env.GITHUB_TOKEN, '${{ github.token }}');
  assert.ok(jobs['quality-full'].needs.includes('big-run'));
  assert.equal(jobs['quality-full'].if, "${{ needs.big-run.outputs.busy == 'false' }}");
  assert.ok(jobs['quality-verdict'].needs.includes('big-run'));
  assert.equal(
    jobs['quality-verdict'].if,
    "${{ always() && needs.big-run.outputs.busy == 'false' }}",
  );
  assert.ok(jobs.report.needs.includes('big-run'));
  const reported = jobs.report.steps.find((step) => step.env?.EXPECTED_SKIPS);
  assert.match(
    reported.env.EXPECTED_SKIPS,
    /needs\.big-run\.outputs\.busy == 'true' && 'quality-full quality-verdict'/,
  );
  // Its sparse checkout holds what it imports, and it imports nothing else.
  const checkout = job.steps.find((step) => (step.uses ?? '').startsWith('actions/checkout@'));
  assert.equal(checkout.with['persist-credentials'], false);
  const source = readFileSync(new URL('./big-run.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(
    imports.filter((spec) => !spec.startsWith('node:')),
    ['./release/github.mjs'],
  );
  assert.deepEqual(checkout.with['sparse-checkout'].trim().split('\n'), [
    'ci/big-run.mjs',
    'ci/release/github.mjs',
  ]);
});
