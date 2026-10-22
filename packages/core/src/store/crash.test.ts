// The crash criterion (#3, Slice 1, and Verification required): every write,
// sync, and rename of a publish, a rollback, a draft save, and an asset put
// has a named crash point. Each is hit twice, as a failed call in this
// process and as a SIGKILL of a child process, and then one fresh process
// repairs and checks every resulting data directory: the live revision is
// the old or the new one, it validates, nothing staged remains, and no
// acknowledged draft is lost. These are process crashes, not power loss.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import type { DraftId, RevisionId } from './layout';
import { openStore, type Store } from './store';
import { checkUnit, sha256, type UnitInput } from './unit';
import type { CheckReport, ChildTask, Step } from './test-support/child';
import { crashingFs, recordingFs, type PointHit } from './test-support/crash-fs';
import {
  contentVariant,
  newStore,
  owned,
  pairInput,
  publishInput,
  testChecks,
} from './test-support/fixtures';
import { runChild, runChildren } from './test-support/spawn';

interface Seeded {
  readonly template: string;
  readonly liveBefore: RevisionId | null;
  readonly seqBefore: number;
  readonly draftId?: DraftId;
  readonly draftText?: string;
  readonly target?: RevisionId;
  readonly newHash?: string;
  readonly newText?: string;
  readonly bytes?: Buffer;
}

interface Scenario {
  readonly name: string;
  seed(t: TestContext): Promise<Seeded>;
  step(seeded: Seeded): Step;
  run(store: Store, seeded: Seeded): Promise<unknown>;
  /** Asserts the crash criterion on what a fresh process found. Returns which side it landed on. */
  verify(report: CheckReport, seeded: Seeded, label: string): 'old' | 'new';
  /** Points the operation must pass, by name. */
  readonly required: readonly string[];
}

const range = (to: number) => Array.from({ length: to }, (_, index) => index + 1);
const unitHash = (input: UnitInput) => {
  const checked = checkUnit(input, testChecks());
  assert.ok(checked.ok);
  return checked.unit.unitHash;
};

function scratch(t: TestContext): () => string {
  const root = mkdtempSync(path.join(tmpdir(), 'store-crash-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let count = 0;
  return () => path.join(root, `d${count++}`);
}

/** What holds for any data directory once a fresh process repaired it. */
function verifyCommon(report: CheckReport, label: string) {
  assert.equal((report.repair as { error?: string }).error, undefined, `${label}: repair`);
  assert.ok(report.live, `${label}: live`);
  assert.ok(report.liveReads, `${label}: the live revision reads and its hashes match`);
  assert.equal(report.liveHealth, 'ok', `${label}: the live revision validates`);
  assert.deepEqual(report.staging, [], `${label}: no staging directory remains`);
  assert.ok(report.liveEventRecorded, `${label}: the live event has its file`);
  assert.deepEqual(report.eventSeqs, range(report.live.seq), `${label}: events`);
  assert.equal(report.lockHeld, false, `${label}: lock`);
}

const publishScenario: Scenario = {
  name: 'a publish',
  required: [
    'publish.staging.manifest.write',
    'publish.staging.dir.fsync',
    'publish.revision.rename',
    'publish.revisions.fsync',
    'publish.live.write',
    'publish.live.fsync',
    'publish.live.rename',
    'publish.publication.fsync',
    'publish.event.write',
    'publish.events.fsync',
    'publish.draft.remove',
  ],
  async seed(t) {
    const store = await newStore(t);
    const liveBefore = await publishInput(store, pairInput('engineering'));
    const next = contentVariant(pairInput('engineering'), 'two');
    const created = await store.drafts.create({ documents: next }, 'owner');
    assert.equal(created.kind, 'saved');
    return {
      template: store.paths.root,
      liveBefore,
      seqBefore: 1,
      draftId: created.kind === 'saved' ? created.draft.draftId : undefined,
      newHash: unitHash(next),
    };
  },
  step: (seeded) => ({
    op: 'publish',
    input: { draftId: seeded.draftId!, draftVersion: 1, expectedLiveRevisionId: seeded.liveBefore },
  }),
  run: (store, seeded) =>
    owned(store).publish(
      { draftId: seeded.draftId!, draftVersion: 1, expectedLiveRevisionId: seeded.liveBefore },
      'owner',
    ),
  verify(report, seeded, label) {
    verifyCommon(report, label);
    if (report.live!.revisionId === seeded.liveBefore) {
      assert.equal(report.live!.seq, 1, label);
      assert.deepEqual(
        report.drafts.map((draft) => [draft.draftId, draft.version]),
        [[seeded.draftId, 1]],
        `${label}: the draft is still there`,
      );
      return 'old';
    }
    assert.equal(report.live!.unitHash, seeded.newHash, `${label}: the new revision`);
    assert.equal(report.live!.seq, 2, label);
    assert.deepEqual(report.drafts, [], `${label}: the published draft is closed`);
    return 'new';
  },
};

const rollbackScenario: Scenario = {
  name: 'a rollback',
  required: ['rollback.live.write', 'rollback.live.rename', 'rollback.event.write'],
  async seed(t) {
    const store = await newStore(t);
    const target = await publishInput(store, pairInput('engineering'));
    const liveBefore = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
    const created = await store.drafts.create(
      { documents: contentVariant(pairInput('engineering'), 'draft') },
      'owner',
    );
    assert.equal(created.kind, 'saved');
    const draftText = created.kind === 'saved' ? created.draft.documents.portfolio.sourceText : '';
    return {
      template: store.paths.root,
      liveBefore,
      seqBefore: 2,
      target,
      draftId: created.kind === 'saved' ? created.draft.draftId : undefined,
      draftText,
    };
  },
  step: (seeded) => ({
    op: 'rollback',
    input: { targetRevisionId: seeded.target!, expectedLiveRevisionId: seeded.liveBefore },
  }),
  run: (store, seeded) =>
    owned(store).rollback(
      { targetRevisionId: seeded.target!, expectedLiveRevisionId: seeded.liveBefore },
      'owner',
    ),
  verify(report, seeded, label) {
    verifyCommon(report, label);
    assert.deepEqual(
      report.drafts.map((draft) => [draft.draftId, draft.version, draft.portfolio]),
      [[seeded.draftId, 1, seeded.draftText]],
      `${label}: drafts unchanged`,
    );
    if (report.live!.revisionId === seeded.liveBefore) {
      assert.equal(report.live!.seq, 2, label);
      return 'old';
    }
    assert.equal(report.live!.revisionId, seeded.target, label);
    assert.equal(report.live!.seq, 3, label);
    return 'new';
  },
};

const saveScenario: Scenario = {
  name: 'a draft save',
  required: [
    'draft.save.write',
    'draft.save.fsync',
    'draft.save.prev.write',
    'draft.save.prev.rename',
    'draft.save.rename',
    'draft.save.dir.fsync',
  ],
  async seed(t) {
    const store = await newStore(t);
    const liveBefore = await publishInput(store, pairInput('engineering'));
    const created = await store.drafts.create(
      { documents: contentVariant(pairInput('engineering'), 'one') },
      'owner',
    );
    assert.equal(created.kind, 'saved');
    return {
      template: store.paths.root,
      liveBefore,
      seqBefore: 1,
      draftId: created.kind === 'saved' ? created.draft.draftId : undefined,
      draftText: created.kind === 'saved' ? created.draft.documents.portfolio.sourceText : '',
      newText: contentVariant(pairInput('engineering'), 'two').portfolio.sourceText,
    };
  },
  step: (seeded) => ({
    op: 'save',
    input: {
      draftId: seeded.draftId!,
      expectedVersion: 1,
      documents: contentVariant(pairInput('engineering'), 'two'),
    },
  }),
  run: (store, seeded) =>
    store.drafts.save(
      {
        draftId: seeded.draftId!,
        expectedVersion: 1,
        documents: contentVariant(pairInput('engineering'), 'two'),
      },
      'owner',
    ),
  verify(report, seeded, label) {
    verifyCommon(report, label);
    assert.equal(report.live!.revisionId, seeded.liveBefore, `${label}: a save never moves live`);
    assert.equal(report.live!.seq, 1, label);
    assert.equal(report.drafts.length, 1, `${label}: one draft`);
    const [draft] = report.drafts;
    if (draft!.version === 1) {
      assert.equal(draft!.portfolio, seeded.draftText, label);
      return 'old';
    }
    assert.equal(draft!.version, 2, label);
    assert.equal(draft!.portfolio, seeded.newText, label);
    return 'new';
  },
};

const putScenario: Scenario = {
  name: 'an asset put',
  required: ['asset.write', 'asset.fsync', 'asset.rename', 'asset.dir.fsync'],
  async seed(t) {
    const store = await newStore(t);
    const liveBefore = await publishInput(store, pairInput('engineering'));
    return {
      template: store.paths.root,
      liveBefore,
      seqBefore: 1,
      bytes: Buffer.from('the bytes of a photograph, more or less'),
    };
  },
  step: (seeded) => ({
    op: 'put',
    base64: seeded.bytes!.toString('base64'),
    mediaType: 'image/jpeg',
  }),
  run: (store, seeded) => store.assets.put(seeded.bytes!, 'image/jpeg'),
  verify(report, seeded, label) {
    verifyCommon(report, label);
    const name = sha256(seeded.bytes!).slice('sha256:'.length);
    if (report.blobs.length === 0) return 'old';
    assert.deepEqual(report.blobs, [{ name, intact: true }], `${label}: a blob is whole or absent`);
    return 'new';
  },
};

async function crashEveryPoint(t: TestContext, scenario: Scenario) {
  const seeded = await scenario.seed(t);
  const next = scratch(t);
  const copy = () => {
    const dir = next();
    cpSync(seeded.template, dir, { recursive: true });
    return dir;
  };

  // The points the operation passes, in order.
  const recording = recordingFs();
  await scenario.run(
    openStore({ dataDir: copy(), checks: testChecks(), fs: recording.fs }),
    seeded,
  );
  const hits = recording.hits;
  const names = new Set(hits.map((hit) => hit.point));
  for (const point of scenario.required)
    assert.ok(names.has(point), `${scenario.name} passes ${point}`);

  const checked: { dataDir: string; label: string }[] = [];
  const label = (hit: PointHit, mode: string) =>
    `${scenario.name} ${mode} at ${hit.point} #${hit.nth}`;

  // A failed call: the operation gives up there, and the process goes on.
  for (const hit of hits) {
    const dataDir = copy();
    const fs = crashingFs(hit, 'throw');
    await scenario.run(openStore({ dataDir, checks: testChecks(), fs }), seeded).catch(() => {});
    assert.ok(fs.crashed(), `${label(hit, 'throw')} was reached`);
    // The next start in this process repairs what the failure left.
    await openStore({ dataDir, checks: testChecks() }).publication.repair();
    checked.push({ dataDir, label: label(hit, 'throw') });
  }

  // A SIGKILL: the child dies just before the call.
  const tasks: ChildTask[] = hits.map((hit) => ({
    kind: 'run',
    dataDir: copy(),
    crash: hit,
    steps: [scenario.step(seeded)],
  }));
  const runs = await runChildren(tasks, 3);
  runs.forEach((run, index) => {
    const hit = hits[index]!;
    assert.equal(run.signal, 'SIGKILL', `${label(hit, 'kill')}: ${run.stderr.slice(-400)}`);
    assert.equal(run.result, null);
    checked.push({
      dataDir: (tasks[index] as { dataDir: string }).dataDir,
      label: label(hit, 'kill'),
    });
  });

  // One fresh process repairs and checks them all.
  const check = await runChild(
    { kind: 'check', dataDirs: checked.map((entry) => entry.dataDir) },
    { timeoutMs: 120_000 },
  );
  assert.equal(check.code, 0, check.stderr.slice(-800));
  const { reports } = check.result as { reports: CheckReport[] };
  const sides = new Set<string>();
  reports.forEach((report, index) => {
    sides.add(scenario.verify(report, seeded, checked[index]!.label));
  });
  // Points before the commit leave the old state, and points after it the new.
  assert.deepEqual([...sides].sort(), ['new', 'old']);
  return hits.length;
}

for (const scenario of [publishScenario, rollbackScenario, saveScenario, putScenario]) {
  test(`${scenario.name} that crashes at any point leaves the old state or the new one`, async (t) => {
    const count = await crashEveryPoint(t, scenario);
    t.diagnostic(`${scenario.name}: ${count} crash points, each thrown and killed`);
  });
}
