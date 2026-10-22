// The crash criterion (#3, Slice 1, and Verification required): every write,
// sync, and rename of a publish, a rollback, a draft save, and an asset put
// has a named crash point, and so does each step of breaking a stale lock
// and clearing a dead breaker's marker, of moving aside event files
// live.json disagrees with, of removing a revision that never went live,
// and of repair. Each is hit twice, as a failed call in this process and as
// a SIGKILL of a child process, and then one fresh process repairs and
// checks every resulting data directory: the live revision is the old or
// the new one, it validates, nothing staged remains, and no acknowledged
// draft is lost. These are process crashes, not power loss. A crash point
// stops before its call, never inside it, so the write discipline is
// checked on its own: no file the store keeps is ever written in place, so
// a torn write is only ever a temporary file's.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { newRevisionId, storePaths, type DraftId, type RevisionId } from './layout';
import { thisProcess } from './lock';
import { openStore, type Store } from './store';
import { checkUnit, sha256, type UnitInput } from './unit';
import type { CheckReport, ChildTask, Step } from './test-support/child';
import { crashingFs, recordingFs, type FsCall, type PointHit } from './test-support/crash-fs';
import {
  contentVariant,
  newStore,
  owned,
  ownerSession,
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
  /** The sides its crashes land on: both, unless it never moves the pointer. */
  readonly sides?: readonly ('old' | 'new')[];
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

/** tempBeside()'s names, and the names event files are moved aside to. */
const TEMP = /^\..+\.[0-9a-f]{12}\.tmp$/;
const ASIDE = /^[1-9][0-9]*\.aside-[0-9a-f]{12}\.json$/;

/**
 * The write discipline, which crash points can't see: writeFile() only ever
 * makes a temporary file, or a file in a revision's staging directory, and
 * a file the store keeps, such as live.json, a draft, an event, or a blob,
 * only ever appears whole, by a rename or a link from one of those.
 */
function assertWritesWhole(calls: readonly FsCall[], root: string, label: string) {
  const paths = storePaths(root);
  const shown = (file: string) => path.relative(root, file);
  const made = (file: string) =>
    TEMP.test(path.basename(file)) ||
    path.relative(paths.revisions, file).split(path.sep)[0]!.startsWith('.staging-');
  for (const call of calls) {
    if (call.op === 'writeFile') {
      assert.ok(made(call.target), `${label}: ${call.point} writes ${shown(call.target)} in place`);
    }
    if (call.op !== 'rename' && call.op !== 'link') continue;
    // Moving a file out of the way, to a name nothing reads, keeps nothing.
    if (TEMP.test(path.basename(call.target)) || ASIDE.test(path.basename(call.target))) continue;
    assert.ok(
      made(call.from!),
      `${label}: ${call.point} puts ${shown(call.target)} in place from ${shown(call.from!)}`,
    );
  }
}

/**
 * A lock, or a break marker, that this test's process took before a
 * restart: stale to every process on this host.
 */
const stale = (holder: string) =>
  JSON.stringify({
    ...thisProcess(),
    startTime: 'an earlier start',
    holder,
    at: new Date().toISOString(),
    nonce: `stale-${holder}`,
  });

/**
 * Event files live.json disagrees with, as a second holder of the lock
 * leaves them: another event at the live seq 1, and one past it.
 */
function strayEvents(root: string, live: RevisionId) {
  const paths = storePaths(root);
  const event = (seq: number, type: string) =>
    JSON.stringify({
      seq,
      type,
      revisionId: live,
      previousRevisionId: live,
      actor: 'operator',
      at: new Date().toISOString(),
    });
  writeFileSync(paths.event(1), event(1, 'recover'));
  writeFileSync(paths.event(2), event(2, 'rollback'));
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

const leftScenario: Scenario = {
  ...publishScenario,
  name: 'a publish over stale lock files and stray event files',
  required: [
    'lock.break.write',
    'lock.break.link',
    'lock.break.clear',
    'lock.break.clear.remove',
    'lock.break.rename',
    'lock.break.remove',
    'lock.break.release',
    'publish.repair.event.aside',
    'publish.repair.event.aside.fsync',
    'publish.repair.event.link',
    'publish.live.rename',
    'publish.event.link',
  ],
  async seed(t) {
    const seeded = await publishScenario.seed(t);
    // A stale lock, and the marker of a breaker that died breaking it.
    const paths = storePaths(seeded.template);
    writeFileSync(paths.lock, stale('cli:backup'));
    writeFileSync(paths.lockBreak, stale('break'));
    strayEvents(seeded.template, seeded.liveBefore!);
    return seeded;
  },
};

const endedScenario: Scenario = {
  ...publishScenario,
  name: 'a publish whose session ended',
  required: ['publish.revision.rename', 'publish.unpublished.remove', 'publish.unpublished.fsync'],
  sides: ['old'],
  step: (seeded) => ({
    op: 'publishEnded',
    input: { draftId: seeded.draftId!, draftVersion: 1, expectedLiveRevisionId: seeded.liveBefore },
  }),
  async run(store, seeded) {
    const ended = await ownerSession();
    await ended.sessions.end(ended.digest, 'logout');
    return store.publication.publish(
      { draftId: seeded.draftId!, draftVersion: 1, expectedLiveRevisionId: seeded.liveBefore },
      'owner',
      { holdSession: ended.holdSession },
    );
  },
};

const repairScenario: Scenario = {
  name: 'a repair',
  required: [
    'repair.staging.remove',
    'repair.revisions.fsync',
    'repair.temp.remove',
    'repair.event.aside',
    'repair.event.aside.fsync',
    'repair.event.link',
    'repair.events.fsync',
  ],
  sides: ['old'],
  async seed(t) {
    const store = await newStore(t);
    const liveBefore = await publishInput(store, pairInput('engineering'));
    // What a crash and a second holder of the lock leave behind.
    mkdirSync(path.join(store.paths.staging(newRevisionId()), 'documents'), { recursive: true });
    writeFileSync(path.join(store.paths.drafts, '.drf.json.0123456789ab.tmp'), '{"draft');
    strayEvents(store.paths.root, liveBefore);
    return { template: store.paths.root, liveBefore, seqBefore: 1 };
  },
  step: () => ({ op: 'repair' }),
  run: (store) => store.publication.repair(),
  verify(report, seeded, label) {
    verifyCommon(report, label);
    assert.equal(report.live!.revisionId, seeded.liveBefore, `${label}: repair moves no pointer`);
    assert.equal(report.live!.seq, 1, label);
    return 'old';
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

  // The points the operation passes, in order, and the calls it makes there.
  const recording = recordingFs();
  const recorded = copy();
  await scenario.run(
    openStore({ dataDir: recorded, checks: testChecks(), fs: recording.fs }),
    seeded,
  );
  const hits = recording.hits;
  const names = new Set(hits.map((hit) => hit.point));
  for (const point of scenario.required)
    assert.ok(names.has(point), `${scenario.name} passes ${point}`);
  assertWritesWhole(recording.calls, recorded, scenario.name);

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
  assert.deepEqual([...sides].sort(), [...(scenario.sides ?? ['new', 'old'])].sort());
  return hits.length;
}

for (const scenario of [
  publishScenario,
  rollbackScenario,
  saveScenario,
  putScenario,
  leftScenario,
  endedScenario,
  repairScenario,
]) {
  test(`${scenario.name} that crashes at any point leaves the old state or the new one`, async (t) => {
    const count = await crashEveryPoint(t, scenario);
    t.diagnostic(`${scenario.name}: ${count} crash points, each thrown and killed`);
  });
}
