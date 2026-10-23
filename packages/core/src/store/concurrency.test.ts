// Concurrency across processes (#3, Verification required): each side runs
// in its own Node process against one data directory, and both start
// together at a barrier, so only the publication lock orders them.
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { nodeFs } from './fs-port';
import type { RevisionId } from './layout';
import { readLive } from './pointer';
import { readManifest } from './revisions';
import type { Store } from './store';
import { checkUnit } from '../catalog/unit';
import type { ChildTask, Step, StepResult } from './test-support/child';
import {
  contentVariant,
  newStore,
  pairInput,
  publishInput,
  tempDir,
  testChecks,
} from './test-support/fixtures';
import { startChild, type ChildHandle } from './test-support/spawn';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs each side's steps in its own process, all released at once. */
async function together(
  t: TestContext,
  dataDir: string,
  sides: readonly (readonly Step[])[],
): Promise<StepResult[][]> {
  const barrier = tempDir(t, 'store-barrier-');
  const children: ChildHandle[] = sides.map((steps, index) =>
    startChild({
      kind: 'run',
      dataDir,
      barrier: { dir: barrier, id: String(index) },
      steps,
    } satisfies ChildTask),
  );
  const deadline = Date.now() + 30_000;
  while (!sides.every((_, index) => existsSync(path.join(barrier, `${index}.ready`)))) {
    if (Date.now() > deadline) assert.fail('the children never got ready');
    await sleep(5);
  }
  writeFileSync(path.join(barrier, 'go'), '');
  const runs = await Promise.all(children.map((child) => child.done));
  return runs.map((run) => {
    assert.equal(run.code, 0, run.stderr.slice(-600));
    return (run.result as { results: StepResult[] }).results;
  });
}

const outcome = (result: StepResult | undefined) => {
  assert.ok(result?.ok, result && !result.ok ? `${result.error}: ${result.message}` : 'no result');
  return result.outcome as {
    kind: string;
    code?: string;
    revisionId?: string;
    liveRevisionId?: string;
  };
};

async function workingDraft(store: Store, marker: string) {
  const working = await store.drafts.getWorking();
  const created = await store.drafts.create(
    {
      documents: contentVariant(pairInput('engineering'), marker),
      ...(working ? { expectedVersion: working.version } : {}),
    },
    'owner',
  );
  assert.equal(created.kind, 'saved');
  return created.kind === 'saved' ? created.draft : assert.fail();
}

test('of two publishes with the same expectation, from two processes, exactly one commits and the other gets live_conflict naming the live revision', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  for (let round = 0; round < 3; round++) {
    const live = (await readLive(nodeFs, store.paths))!.revisionId;
    const draft = await workingDraft(store, `round ${round}`);
    const step: Step = {
      op: 'publish',
      input: { draftId: draft.draftId, draftVersion: draft.version, expectedLiveRevisionId: live },
    };
    const [a, b] = await together(t, store.paths.root, [[step], [step]]);
    const outcomes = [outcome(a![0]), outcome(b![0])];
    const committed = outcomes.filter((entry) => entry.kind === 'committed');
    const lost = outcomes.filter((entry) => entry.kind !== 'committed');
    assert.equal(committed.length, 1, JSON.stringify(outcomes));
    assert.deepEqual(
      lost.map((entry) => [entry.kind, entry.code, entry.liveRevisionId]),
      [['conflict', 'live_conflict', committed[0]!.revisionId]],
    );
    assert.equal((await readLive(nodeFs, store.paths))?.revisionId, committed[0]!.revisionId);
  }
  assert.notEqual((await readLive(nodeFs, store.paths))?.revisionId, first);
});

test('a publish and a rollback with the same expectation, from two processes: exactly one commits, the other gets live_conflict', async (t) => {
  const store = await newStore(t);
  await publishInput(store, pairInput('engineering'));
  await publishInput(store, contentVariant(pairInput('engineering'), 'second'));
  for (let round = 0; round < 3; round++) {
    const live = (await readLive(nodeFs, store.paths))!.revisionId;
    const other = (await store.publication.revisions()).find((entry) => entry.revisionId !== live)!;
    const draft = await workingDraft(store, `forward ${round}`);
    const [a, b] = await together(t, store.paths.root, [
      [
        {
          op: 'publish',
          input: {
            draftId: draft.draftId,
            draftVersion: draft.version,
            expectedLiveRevisionId: live,
          },
        },
      ],
      [
        {
          op: 'rollback',
          input: { targetRevisionId: other.revisionId, expectedLiveRevisionId: live },
        },
      ],
    ]);
    const outcomes = [outcome(a![0]), outcome(b![0])];
    const committed = outcomes.filter((entry) => entry.kind === 'committed');
    assert.equal(committed.length, 1, JSON.stringify(outcomes));
    const [lost] = outcomes.filter((entry) => entry.kind !== 'committed');
    assert.equal(lost?.code, 'live_conflict');
    assert.equal(lost?.liveRevisionId, committed[0]!.revisionId);
    assert.equal((await readLive(nodeFs, store.paths))?.revisionId, committed[0]!.revisionId);
    t.diagnostic(
      `round ${round}: the ${outcomes[0]!.kind === 'committed' ? 'publish' : 'rollback'} committed`,
    );
  }
});

test('a save during a publish, from two processes, never loses a save it acknowledged', async (t) => {
  const store = await newStore(t);
  await publishInput(store, pairInput('engineering'));
  const wins = { publish: 0, save: 0 };
  for (let round = 0; round < 4; round++) {
    const live = (await readLive(nodeFs, store.paths))!.revisionId;
    const draft = await workingDraft(store, `round ${round} start`);
    const saves = Array.from({ length: 6 }, (_, index) =>
      contentVariant(pairInput('engineering'), `round ${round} save ${index}`),
    );
    const [saver, publisher] = await together(t, store.paths.root, [
      [
        {
          op: 'saveLoop',
          draftId: draft.draftId,
          expectedVersion: draft.version,
          documents: saves,
        },
      ],
      [
        {
          op: 'publish',
          input: {
            draftId: draft.draftId,
            draftVersion: draft.version,
            expectedLiveRevisionId: live,
          },
        },
      ],
    ]);
    const { acknowledged } = outcome(saver![0]) as unknown as { acknowledged: number[] };
    const published = outcome(publisher![0]);
    const working = await store.drafts.getWorking();
    if (published.kind === 'committed') {
      // It published the version it named, so no save came before it, and
      // none after it found the draft.
      assert.deepEqual(acknowledged, [], `round ${round}`);
      assert.equal(working, null);
      const manifest = await readManifest(nodeFs, store.paths, published.revisionId as RevisionId);
      assert.equal(
        manifest?.source.kind === 'draft' && manifest.source.draftVersion,
        draft.version,
      );
      wins.publish += 1;
    } else {
      // A save came first, so the publish stopped, and every save is in the draft.
      assert.equal(published.code, 'draft_conflict', `round ${round}`);
      assert.ok(acknowledged.length > 0);
      assert.equal(working?.version, acknowledged.at(-1));
      assert.equal(
        working?.documents.portfolio.sourceText,
        saves[acknowledged.length - 1]!.portfolio.sourceText,
      );
      await store.drafts.discard({ draftId: working!.draftId }, 'owner');
      wins.save += 1;
    }
  }
  t.diagnostic(`the publish went first in ${wins.publish} rounds, a save in ${wins.save}`);
});

test('of two rollbacks with the same expectation, from two processes, exactly one commits and the other gets live_conflict', async (t) => {
  const store = await newStore(t);
  const revisions = [
    await publishInput(store, pairInput('engineering')),
    await publishInput(store, contentVariant(pairInput('engineering'), 'two')),
    await publishInput(store, contentVariant(pairInput('engineering'), 'three')),
  ];
  for (let round = 0; round < 3; round++) {
    const live = (await readLive(nodeFs, store.paths))!.revisionId;
    const [left, right] = revisions.filter((id) => id !== live);
    const [a, b] = await together(t, store.paths.root, [
      [{ op: 'rollback', input: { targetRevisionId: left!, expectedLiveRevisionId: live } }],
      [{ op: 'rollback', input: { targetRevisionId: right!, expectedLiveRevisionId: live } }],
    ]);
    const outcomes = [outcome(a![0]), outcome(b![0])];
    const committed = outcomes.filter((entry) => entry.kind === 'committed');
    assert.equal(committed.length, 1, JSON.stringify(outcomes));
    const [lost] = outcomes.filter((entry) => entry.kind !== 'committed');
    assert.equal(lost?.code, 'live_conflict');
    assert.equal(lost?.liveRevisionId, committed[0]!.revisionId);
  }
});

test('of two saves of one version, from two processes, one saves and the other gets draft_conflict', async (t) => {
  const store = await newStore(t);
  await publishInput(store, pairInput('engineering'));
  const draft = await workingDraft(store, 'one');
  const save = (marker: string): Step => ({
    op: 'save',
    input: {
      draftId: draft.draftId,
      expectedVersion: draft.version,
      documents: contentVariant(pairInput('engineering'), marker),
    },
  });
  const [a, b] = await together(t, store.paths.root, [[save('left')], [save('right')]]);
  const outcomes = [outcome(a![0]), outcome(b![0])] as {
    kind: string;
    code?: string;
    version?: number;
    draft?: { version: number };
  }[];
  assert.deepEqual(outcomes.map((entry) => entry.kind).sort(), ['conflict', 'saved']);
  const conflict = outcomes.find((entry) => entry.kind === 'conflict');
  assert.equal(conflict?.code, 'draft_conflict');
  assert.equal(conflict?.version, draft.version + 1);
  assert.equal((await store.drafts.getWorking())?.version, draft.version + 1);
});

test('of two servers starting at once on one data directory, from two processes, exactly one claims it', async (t) => {
  // Before the claim took the publication lock, both claimed it every time.
  for (let round = 0; round < 3; round++) {
    const store = await newStore(t);
    const claim: Step = { op: 'claim', holdMs: 500 };
    const [a, b] = await together(t, store.paths.root, [[claim], [claim]]);
    const claims = [outcome(a![0]), outcome(b![0])] as unknown as { ok: boolean; code?: string }[];
    assert.deepEqual(claims.map((entry) => entry.ok).sort(), [false, true], `round ${round}`);
    assert.equal(claims.find((entry) => !entry.ok)?.code, 'data_dir_in_use');
  }
});

test('a reader in another process sees only the old or the new unitHash while publishes run, and every revision it reads is whole', async (t) => {
  const store = await newStore(t);
  const published = new Set<string>();
  const hashOf = (marker: string) => {
    const checked = checkUnit(contentVariant(pairInput('engineering'), marker), testChecks());
    assert.ok(checked.ok);
    return checked.unit.unitHash;
  };
  await publishInput(store, contentVariant(pairInput('engineering'), 'start'));
  published.add(hashOf('start'));
  const signals = tempDir(t, 'store-reader-');
  const ready = path.join(signals, 'ready');
  const stop = path.join(signals, 'stop');
  const reader = startChild({
    kind: 'read-loop',
    dataDir: store.paths.root,
    readyFile: ready,
    stopFile: stop,
  });
  const deadline = Date.now() + 30_000;
  while (!existsSync(ready)) {
    if (Date.now() > deadline) assert.fail('the reader never read');
    await sleep(5);
  }
  for (let index = 0; index < 8; index++) {
    const marker = `publish ${index}`;
    await publishInput(store, contentVariant(pairInput('engineering'), marker));
    published.add(hashOf(marker));
  }
  writeFileSync(stop, '');
  const run = await reader.done;
  assert.equal(run.code, 0, run.stderr.slice(-600));
  const { reads, observations } = run.result as {
    reads: number;
    observations: {
      seq: number;
      pointerHash: string;
      revisionHash: string | null;
      damage: string | null;
      count: number;
    }[];
  };
  assert.ok(reads > 0);
  for (const seen of observations) {
    assert.equal(seen.damage, null, JSON.stringify(seen));
    assert.equal(seen.revisionHash, seen.pointerHash, JSON.stringify(seen));
    assert.ok(published.has(seen.pointerHash), JSON.stringify(seen));
  }
  // It read while the pointer moved, not only before or after.
  assert.ok(
    new Set(observations.map((seen) => seen.pointerHash)).size >= 2,
    JSON.stringify(observations),
  );
});
