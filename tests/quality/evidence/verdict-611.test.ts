// Evidence only, never merged: verdict-611-evidence.yml against release.yml's own steps, the
// release's split and artifact count, and its verdict checks at 20 shards.
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
import { judge, planOutputs } from './verdict-611';

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
}
interface Workflow {
  readonly on: unknown;
  readonly permissions: unknown;
  readonly jobs: Record<string, Job>;
}

const FILE = '.github/workflows/verdict-611-evidence.yml';
const TEXT = readFileSync(FILE, 'utf8');
const EVIDENCE = parse(TEXT) as Workflow;
const RELEASE = parse(readFileSync('.github/workflows/release.yml', 'utf8')) as Workflow;
const uploads = (job: Job) =>
  job.steps.filter((step) => (step.uses ?? '').startsWith('actions/upload-artifact@'));

test("the evidence workflow is its generator's, under GitHub's 500 KB, six jobs on a push of its branch alone, contents: read and no secret", () => {
  assert.equal(TEXT, workflowText());
  assert.ok(Buffer.byteLength(TEXT) < 500 * 1024, `${Buffer.byteLength(TEXT)} bytes`);
  assert.deepEqual(EVIDENCE.on, { push: { branches: ['kgn-a/verdict-611-evidence-*'] } });
  assert.deepEqual(EVIDENCE.permissions, { contents: 'read' });
  assert.doesNotMatch(TEXT, /secrets\.|github\.token|GITHUB_TOKEN|GH_TOKEN|actions\/cache/);
  // No cache: every setup-node runs with its package-manager cache off.
  const setups = Object.values(EVIDENCE.jobs).flatMap((job) =>
    job.steps.filter((step) => (step.uses ?? '').startsWith('actions/setup-node@')),
  );
  assert.equal(setups.length, 6);
  assert.ok(setups.every((step) => step.with?.['package-manager-cache'] === false));
  assert.deepEqual(Object.keys(EVIDENCE.jobs), [
    'rc-quality-plan',
    'verdict-611-upload-1',
    'verdict-611-upload-2',
    'verdict-611-upload-3',
    'verdict-611-whole',
    'verdict-611-gap',
  ]);
});

test("the upload jobs take rc-quality-1 to -3's shares of 611 and hold a release's 1,222 artifacts, named as the release names them, with its upload-artifact, at most 500 a job", () => {
  const outputs = planOutputs(COUNT);
  assert.deepEqual(
    [outputs.shards1, outputs.shards2, outputs.shards3].map((each) => {
      const list = JSON.parse(each!) as number[];
      return [list[0], list.at(-1)];
    }),
    RANGES,
  );
  const releaseUpload = RELEASE.jobs['rc-quality-1']!.steps.find(
    (step) => step.name === 'Upload the verdict files',
  )!;
  const names: string[] = [];
  for (const [at, [from, to]] of RANGES.entries()) {
    const job = EVIDENCE.jobs[`verdict-611-upload-${at + 1}`]!;
    assert.deepEqual(job.container, RELEASE.jobs['rc-quality-1']!.container);
    const steps = uploads(job);
    assert.ok(steps.length <= 500, `${steps.length} artifacts in upload job ${at + 1}`);
    assert.equal(steps.length, 2 * (to - from + 1));
    for (const step of steps) {
      assert.equal(step.uses, releaseUpload.uses);
      assert.equal(step.with?.['retention-days'], releaseUpload.with?.['retention-days']);
      assert.equal(step.with?.['if-no-files-found'], releaseUpload.with?.['if-no-files-found']);
      names.push(String(step.with?.name));
    }
  }
  const expected = Array.from({ length: COUNT }, (_, at) => [
    `reports-quality-release-${at + 1}`,
    `verdict-quality-release-${at + 1}`,
  ]).flat();
  assert.deepEqual(names, expected);
  assert.equal(names.length, 1_222);
});

test("both verdict jobs run rc-quality-verdict's setup, download, unpack and merge steps as they are, the merge with an id and continue-on-error alone", () => {
  const release = RELEASE.jobs['rc-quality-verdict']!.steps;
  const at = (name: string) => release.findIndex((step) => step.name === name);
  const real = release.slice(0, at('pnpm ci:quality-release --merged') + 1);
  for (const id of ['verdict-611-whole', 'verdict-611-gap']) {
    const steps = EVIDENCE.jobs[id]!.steps.filter(
      (step) => step.name !== `Shard ${GAP} uploaded no verdict files`,
    );
    const own = steps.slice(0, real.length).map((step) => {
      if (step.id !== 'merge') return step;
      assert.equal(step['continue-on-error'], true);
      const { id: _id, 'continue-on-error': _continue, ...rest } = step;
      void _id;
      void _continue;
      return rest;
    });
    assert.deepEqual(own, real, id);
  }
  const gap = EVIDENCE.jobs['verdict-611-gap']!.steps.map((step) => step.name);
  assert.ok(
    gap.indexOf(`Shard ${GAP} uploaded no verdict files`) ===
      gap.indexOf("Download the shards' verdict files") + 1,
  );
});

test('20 synthetic shards merge with none missing, and with one moved aside to missing-shard for it alone', (t) => {
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
  unpackShards(downloaded, path.join(root, 'whole'));
  const whole = mergedMatrix(path.join(root, 'whole'), count) as MergedVerdict;
  assert.equal(whole.ok, true, JSON.stringify(whole.failures.slice(0, 3)));
  assert.equal(judge(whole, count, 'whole', 'success').ok, true);
  assert.equal(judge(whole, count, 'gap:7', 'success').ok, false);
  renameSync(path.join(downloaded, 'verdict-quality-release-7'), path.join(root, 'scrubbed-7'));
  unpackShards(downloaded, path.join(root, 'gap'));
  const gapped = mergedMatrix(path.join(root, 'gap'), count) as MergedVerdict;
  assert.equal(gapped.shards.length, count - 1);
  const result = judge(gapped, count, 'gap:7', 'failure');
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.equal(judge(gapped, count, 'gap:7', 'success').ok, false, 'the merge step must fail');
  assert.equal(judge(gapped, count, 'gap:8', 'failure').ok, false);
  assert.equal(judge(gapped, count, 'whole', 'failure').ok, false);
});
