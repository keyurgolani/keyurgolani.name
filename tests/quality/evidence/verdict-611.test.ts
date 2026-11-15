// Evidence only, never merged: verdict-611-evidence.yml against release.yml's and inventory.yml's
// own steps, each mode's artifact count, and its verdict checks at 20 shards.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { COUNT, GAP, RANGES, workflowText } from '../../../ci/evidence/verdict-611-workflow.mjs';
import { packRange } from '../../../ci/evidence/verdict-611.mjs';
import { unpackShards } from '../../../ci/release/shard-verdict.mjs';
import type { MergedVerdict } from '../lib/shards';
import { mergedMatrix } from '../release';
import { judge, planOutputs, unpackedVerdicts } from './verdict-611';

interface Step {
  readonly name?: string;
  readonly id?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: string;
  readonly env?: Record<string, string>;
  readonly with?: Record<string, string | number | boolean>;
  readonly 'continue-on-error'?: boolean;
}
interface Job {
  readonly steps: readonly Step[];
  readonly container?: unknown;
  readonly permissions?: unknown;
}
interface Workflow {
  readonly on: unknown;
  readonly permissions: unknown;
  readonly jobs: Record<string, Job>;
}

const FILE = '.github/workflows/verdict-611-evidence.yml';
const TEXT = readFileSync(FILE, 'utf8');
const EVIDENCE = parse(TEXT) as Workflow;
const workflow = (name: string) =>
  parse(readFileSync(`.github/workflows/${name}`, 'utf8')) as Workflow;
const RELEASE = workflow('release.yml');
const INVENTORY = workflow('inventory.yml');
const isUpload = (step: Step) => (step.uses ?? '').startsWith('actions/upload-artifact@');
const MODES = ['whole', 'gap', 'inventory'] as const;

/** Whether an upload step's `if` holds in `mode`: the generator writes env.MODE comparisons, or-ed. */
function runsIn(step: Step, mode: string): boolean {
  if (step.if === undefined) return true;
  const body = /^\$\{\{ (.*) \}\}$/.exec(step.if)?.[1];
  assert.ok(body, step.if);
  return body.split(' || ').some((term) => {
    const match = /^env\.MODE (==|!=) '([a-z]+)'$/.exec(term);
    assert.ok(match, term);
    return match[1] === '==' ? mode === match[2] : mode !== match[2];
  });
}

/** `steps` but for the unpack's and the merge's id and continue-on-error. */
const withoutOwn = (steps: readonly Step[]) =>
  steps.map((step) => {
    if (step.id !== 'unpack' && step.id !== 'merge') return step;
    assert.equal(step['continue-on-error'], true, step.name);
    const { id: _id, 'continue-on-error': _continue, ...rest } = step;
    void _id;
    void _continue;
    return rest;
  });

const upToMerge = (steps: readonly Step[], merge: string) =>
  steps.slice(0, steps.findIndex((step) => step.name === merge) + 1);

test("the evidence workflow is its generator's, under GitHub's 500 KB, on a push of its branches alone, contents: read, one token, the inventory run's download's", () => {
  assert.equal(TEXT, workflowText());
  assert.ok(Buffer.byteLength(TEXT) < 500 * 1024, `${Buffer.byteLength(TEXT)} bytes`);
  assert.deepEqual(EVIDENCE.on, { push: { branches: ['kgn-a/verdict-611-evidence-*'] } });
  assert.deepEqual(EVIDENCE.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(EVIDENCE.jobs), [
    'rc-quality-plan',
    'verdict-611-upload-1',
    'verdict-611-upload-2',
    'verdict-611-upload-3',
    'verdict-611-release',
    'inventory-plan',
    'verdict-611-inventory',
  ]);
  for (const [id, job] of Object.entries(EVIDENCE.jobs)) {
    assert.deepEqual(
      job.permissions,
      id === 'verdict-611-inventory' ? { actions: 'read', contents: 'read' } : undefined,
      id,
    );
  }
  assert.doesNotMatch(TEXT, /secrets\.|GITHUB_TOKEN|GH_TOKEN|actions\/cache/);
  assert.equal(TEXT.split('${{ github.token }}').length - 1, 1);
  const setups = Object.values(EVIDENCE.jobs).flatMap((job) =>
    job.steps.filter((step) => (step.uses ?? '').startsWith('actions/setup-node@')),
  );
  assert.ok(setups.every((step) => step.with?.['package-manager-cache'] === false));
});

test("the upload jobs take rc-quality-1 to -3's shares, each shard's verdict and reports by the release's names and upload-artifact, under 500 a job: 651 artifacts whole and gap, 1,222 in the inventory run", () => {
  const outputs = planOutputs(COUNT);
  assert.deepEqual(
    [outputs.shards1, outputs.shards2, outputs.shards3].map((each) => {
      const list = JSON.parse(each!) as number[];
      return [list[0], list.at(-1)];
    }),
    RANGES,
  );
  const real = RELEASE.jobs['rc-quality-1']!.steps.find(
    (step) => step.name === 'Upload the verdict files',
  )!;
  const steps = RANGES.flatMap((_, at) => {
    const job = EVIDENCE.jobs[`verdict-611-upload-${at + 1}`]!;
    assert.deepEqual(job.container, RELEASE.jobs['rc-quality-1']!.container);
    const uploads = job.steps.filter(isUpload);
    assert.ok(uploads.length <= 500, `${uploads.length} artifacts in upload job ${at + 1}`);
    return uploads;
  });
  assert.deepEqual(
    steps.map((step) => step.with?.name),
    Array.from({ length: COUNT }, (_, at) => [
      `verdict-quality-release-${at + 1}`,
      `reports-quality-release-${at + 1}`,
    ]).flat(),
  );
  for (const step of steps) {
    assert.equal(step.uses, real.uses);
    assert.equal(step.with?.['retention-days'], real.with?.['retention-days']);
    assert.equal(step.with?.['if-no-files-found'], real.with?.['if-no-files-found']);
  }
  const count = (mode: string) => steps.filter((step) => runsIn(step, mode)).length;
  assert.deepEqual(
    MODES.map((mode) => [mode, count(mode)]),
    [
      ['whole', 651],
      ['gap', 651],
      ['inventory', 1222],
    ],
  );
  // The gap: shard 307 uploads its reports and no verdict.
  assert.equal(GAP, 307);
  assert.deepEqual(
    steps
      .filter((step) => /-307$/.test(String(step.with?.name)))
      .map((step) => [step.with?.name, MODES.map((mode) => runsIn(step, mode))]),
    [
      ['verdict-quality-release-307', [true, false, true]],
      ['reports-quality-release-307', [false, true, true]],
    ],
  );
});

test("the release run's verdict takes rc-quality-verdict's steps as they are, and the inventory run's inventory-summary's, but for their outcomes' ids and the artifacts' names", () => {
  assert.deepEqual(
    withoutOwn(
      upToMerge(EVIDENCE.jobs['verdict-611-release']!.steps, 'pnpm ci:quality-release --merged'),
    ),
    upToMerge(RELEASE.jobs['rc-quality-verdict']!.steps, 'pnpm ci:quality-release --merged'),
  );
  // inventory-summary's, its artifact pattern this run's: the release's names.
  const summary = INVENTORY.jobs['inventory-summary']!.steps.map((step) =>
    step.with?.pattern === 'verdict-inventory-*'
      ? { ...step, with: { ...step.with, pattern: 'verdict-quality-release-*' } }
      : step,
  );
  assert.deepEqual(
    withoutOwn(
      upToMerge(EVIDENCE.jobs['verdict-611-inventory']!.steps, 'pnpm ci:inventory-summary'),
    ),
    upToMerge(summary, 'pnpm ci:inventory-summary'),
  );
  assert.deepEqual(
    EVIDENCE.jobs['verdict-611-inventory']!.permissions,
    INVENTORY.jobs['inventory-summary']!.permissions,
  );
});

test('20 synthetic shards, each mode: whole reads every one, gap refuses its missing shard on the count and by name, inventory unpacks every verdict', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'verdict-611-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const count = 20;
  const out = path.join(root, 'out');
  assert.equal(packRange(1, count, count, out, 600), count);
  // As download-artifact leaves them: each artifact in a directory of its name.
  const downloaded = path.join(root, 'verdicts');
  mkdirSync(downloaded);
  for (let shard = 1; shard <= count; shard += 1) {
    renameSync(
      path.join(out, `verdict-${shard}`),
      path.join(downloaded, `verdict-quality-release-${shard}`),
    );
  }
  const whole = path.join(root, 'whole');
  unpackShards(downloaded, whole, { expected: count });
  const verdict = mergedMatrix(whole, count) as MergedVerdict;
  assert.equal(verdict.ok, true, JSON.stringify(verdict.failures.slice(0, 3)));
  const run = {
    count,
    unpackOutcome: 'success',
    mergeOutcome: 'success',
    verdict,
    unpacked: unpackedVerdicts(whole),
    gap: 7,
  };
  assert.equal(judge('whole', run).ok, true, judge('whole', run).lines.join('\n'));
  assert.equal(judge('inventory', run).ok, true);
  assert.equal(judge('gap', run).ok, false);
  // Shard 7 never uploaded: the unpack refuses on the count, then the merge by name.
  renameSync(
    path.join(downloaded, 'verdict-quality-release-7'),
    path.join(root, 'never-uploaded-7'),
  );
  const short = path.join(root, 'short');
  assert.throws(
    () => unpackShards(downloaded, short, { expected: count }),
    /19 verdicts of 20 planned shards, missing 7: the artifact listing hit the 1,000 cap/,
  );
  const gapRun = {
    count,
    unpackOutcome: 'failure',
    mergeOutcome: 'failure',
    verdict: mergedMatrix(short, count) as MergedVerdict,
    unpacked: unpackedVerdicts(short),
    gap: 7,
  };
  assert.equal(gapRun.unpacked, count - 1);
  assert.equal(judge('gap', gapRun).ok, true, judge('gap', gapRun).lines.join('\n'));
  assert.equal(judge('gap', { ...gapRun, gap: 8 }).ok, false);
  assert.equal(judge('gap', { ...gapRun, unpackOutcome: 'success' }).ok, false);
  assert.equal(judge('whole', gapRun).ok, false);
  assert.equal(judge('inventory', gapRun).ok, false);
});
