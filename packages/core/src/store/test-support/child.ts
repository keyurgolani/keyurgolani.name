// A child process for the store's crash and concurrency tests. It takes one
// task as JSON in argv[2] and prints one JSON line: what each step returned,
// what a fresh process finds in a data directory, or what a reader saw.
//
//   node --import tsx child.ts '{"kind":"run","dataDir":"...","steps":[...]}'
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { recordOwnerModule } from '../../load-trace';
import { nodeFs } from '../fs-port';
import { readDraft, draftIds, type CreateDraftInput } from '../drafts';
import type { DraftId } from '../layout';
import { readEvents, readLive } from '../pointer';
import type { PublishInput, RecoverInput, RollbackInput } from '../publication';
import { readRevision } from '../revisions';
import { claimServer } from '../server-claim';
import { openStore } from '../store';
import { sha256, type UnitInput } from '../unit';
import { crashingFs, type PointHit } from './crash-fs';
import { ownerSession, testChecks } from './fixtures';

export type Step =
  | { readonly op: 'publish'; readonly input: PublishInput }
  /** A publish whose owner session ended before it began. */
  | { readonly op: 'publishEnded'; readonly input: PublishInput }
  | { readonly op: 'repair' }
  | { readonly op: 'rollback'; readonly input: RollbackInput }
  | { readonly op: 'recover'; readonly input: RecoverInput }
  | { readonly op: 'create'; readonly input: CreateDraftInput }
  | {
      readonly op: 'save';
      readonly input: { draftId: DraftId; expectedVersion: number; documents: UnitInput };
    }
  | { readonly op: 'put'; readonly base64: string; readonly mediaType: string }
  /** Claims the data directory as a server would, holds it `holdMs`, and lets it go. */
  | { readonly op: 'claim'; readonly holdMs: number }
  /** Saves each of `documents` in turn on the draft until it's gone, tracking its version. */
  | {
      readonly op: 'saveLoop';
      readonly draftId: DraftId;
      readonly expectedVersion: number;
      readonly documents: readonly UnitInput[];
    };

export type ChildTask =
  | {
      readonly kind: 'run';
      readonly dataDir: string;
      /** Where to die, by SIGKILL. */
      readonly crash?: PointHit;
      /** Writes <dir>/<id>.ready, then waits for <dir>/go, so two children start together. */
      readonly barrier?: { readonly dir: string; readonly id: string };
      readonly steps: readonly Step[];
    }
  | { readonly kind: 'check'; readonly dataDirs: readonly string[] }
  | {
      readonly kind: 'read-loop';
      readonly dataDir: string;
      readonly readyFile: string;
      readonly stopFile: string;
    };

export type StepResult =
  | { readonly ok: true; readonly outcome: unknown }
  | { readonly ok: false; readonly error: string; readonly message: string };

export interface CheckReport {
  readonly dataDir: string;
  readonly repair: unknown;
  readonly live: { seq: number; revisionId: string; unitHash: string } | null;
  /** The live revision reads, every hash checks out, and its unitHash is the pointer's. */
  readonly liveReads: boolean;
  readonly liveHealth: string | null;
  readonly staging: readonly string[];
  readonly drafts: readonly { draftId: string; version: number; portfolio: string }[];
  readonly eventSeqs: readonly number[];
  /** Whether events/<live seq>.json holds the pointer's event. */
  readonly liveEventRecorded: boolean;
  readonly lockHeld: boolean;
  /** Each file under assets/sha256/ by name, and whether its bytes hash to it. */
  readonly blobs: readonly { name: string; intact: boolean }[];
}

recordOwnerModule('core/store/test-support/child');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(file: string, limitMs = 30_000) {
  const deadline = Date.now() + limitMs;
  while (!existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`gave up waiting for ${path.basename(file)}`);
    await sleep(2);
  }
}

async function run(task: Extract<ChildTask, { kind: 'run' }>): Promise<StepResult[]> {
  const fs = task.crash ? crashingFs(task.crash, 'kill') : nodeFs;
  const store = openStore({ dataDir: task.dataDir, checks: testChecks(), fs });
  // The owner's pointer moves hold a session, as Studio's do.
  const owner = await ownerSession();
  if (task.barrier) {
    writeFileSync(path.join(task.barrier.dir, `${task.barrier.id}.ready`), '');
    await waitFor(path.join(task.barrier.dir, 'go'));
  }
  const results: StepResult[] = [];
  for (const step of task.steps) {
    try {
      let outcome: unknown;
      switch (step.op) {
        case 'publish':
          outcome = await store.publication.publish(step.input, 'owner', {
            holdSession: owner.holdSession,
          });
          break;
        case 'publishEnded': {
          const ended = await ownerSession();
          await ended.sessions.end(ended.digest, 'logout');
          outcome = await store.publication.publish(step.input, 'owner', {
            holdSession: ended.holdSession,
          });
          break;
        }
        case 'repair':
          outcome = await store.publication.repair();
          break;
        case 'rollback':
          outcome = await store.publication.rollback(step.input, 'owner', {
            holdSession: owner.holdSession,
          });
          break;
        case 'recover':
          outcome = await store.publication.recover(step.input, 'operator');
          break;
        case 'create':
          outcome = await store.drafts.create(step.input, 'owner');
          break;
        case 'save':
          outcome = await store.drafts.save(step.input, 'owner');
          break;
        case 'put':
          outcome = await store.assets.put(Buffer.from(step.base64, 'base64'), step.mediaType);
          break;
        case 'claim': {
          const claimed = await claimServer({ fs, paths: store.paths, lock: store.lock });
          if (claimed.ok) {
            await sleep(step.holdMs);
            await claimed.claim.release();
          }
          outcome = claimed.ok ? { ok: true } : { ok: false, code: claimed.code };
          break;
        }
        case 'saveLoop': {
          const acknowledged: number[] = [];
          let version = step.expectedVersion;
          let ended = 'done';
          for (const documents of step.documents) {
            const saved = await store.drafts.save(
              { draftId: step.draftId, expectedVersion: version, documents },
              'owner',
            );
            if (saved.kind === 'saved') {
              version = saved.draft.version;
              acknowledged.push(version);
            } else {
              ended = saved.code;
              break;
            }
          }
          outcome = { acknowledged, ended };
          break;
        }
      }
      results.push({ ok: true, outcome });
    } catch (error) {
      results.push({
        ok: false,
        error: String((error as { code?: unknown }).code ?? (error as Error).name),
        message: (error as Error).message,
      });
    }
  }
  return results;
}

async function check(dataDir: string): Promise<CheckReport> {
  const store = openStore({ dataDir, checks: testChecks() });
  let repair: unknown;
  try {
    repair = await store.publication.repair();
  } catch (error) {
    repair = { error: String((error as { code?: unknown }).code ?? (error as Error).name) };
  }
  const pointer = await readLive(nodeFs, store.paths);
  let liveReads = false;
  let liveHealth: string | null = null;
  if (pointer) {
    const read = await readRevision(nodeFs, store.paths, pointer.revisionId);
    liveReads = read.ok && read.revision.unit.unitHash === pointer.unitHash;
    liveHealth = (await store.revisions.health(pointer.revisionId)).state;
  }
  const drafts = [];
  for (const id of await draftIds(nodeFs, store.paths)) {
    const found = await readDraft(nodeFs, store.paths, id);
    if (found) {
      drafts.push({
        draftId: found.draft.draftId,
        version: found.draft.version,
        portfolio: found.draft.documents.portfolio.sourceText,
      });
    }
  }
  const events = await readEvents(nodeFs, store.paths);
  const liveEvent = pointer ? events.find((event) => event.seq === pointer.seq) : undefined;
  return {
    dataDir,
    repair,
    live: pointer
      ? { seq: pointer.seq, revisionId: pointer.revisionId, unitHash: pointer.unitHash }
      : null,
    liveReads,
    liveHealth,
    staging: (await nodeFs.readdir(store.paths.revisions)).filter((name) =>
      name.startsWith('.staging-'),
    ),
    drafts,
    eventSeqs: events.map((event) => event.seq),
    liveEventRecorded:
      pointer !== null &&
      liveEvent !== undefined &&
      JSON.stringify(liveEvent) === JSON.stringify(pointer.event),
    lockHeld: (await store.lock.holder()) !== null,
    blobs: await blobsIn(store.paths.assets),
  };
}

async function blobsIn(assets: string) {
  const blobs: { name: string; intact: boolean }[] = [];
  for (const shard of await nodeFs.readdir(assets)) {
    for (const name of await nodeFs.readdir(path.join(assets, shard))) {
      if (name.startsWith('.')) continue;
      const bytes = await nodeFs.readFile(path.join(assets, shard, name));
      blobs.push({ name, intact: sha256(bytes) === `sha256:${name}` && name.startsWith(shard) });
    }
  }
  return blobs;
}

/** Reads live.json and its revision until told to stop, counting what it sees. */
async function readLoop(task: Extract<ChildTask, { kind: 'read-loop' }>) {
  const store = openStore({ dataDir: task.dataDir, checks: testChecks() });
  const seen = new Map<string, number>();
  let reads = 0;
  for (;;) {
    const pointer = await readLive(nodeFs, store.paths);
    if (pointer) {
      const read = await readRevision(nodeFs, store.paths, pointer.revisionId);
      const key = JSON.stringify({
        seq: pointer.seq,
        pointerHash: pointer.unitHash,
        revisionHash: read.ok ? read.revision.unit.unitHash : null,
        damage: read.ok ? null : read.damage,
      });
      seen.set(key, (seen.get(key) ?? 0) + 1);
      reads += 1;
      if (reads === 1) writeFileSync(task.readyFile, '');
    }
    if (existsSync(task.stopFile)) break;
  }
  return { reads, observations: [...seen].map(([key, count]) => ({ ...JSON.parse(key), count })) };
}

function main(task: ChildTask): Promise<unknown> {
  if (task.kind === 'run') return run(task).then((results) => ({ results }));
  if (task.kind === 'check') {
    return (async () => {
      const reports: CheckReport[] = [];
      for (const dataDir of task.dataDirs) reports.push(await check(dataDir));
      return { reports };
    })();
  }
  return readLoop(task);
}

// Only as the process's own script: importing it, as the load trace test
// does, runs nothing.
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(JSON.parse(process.argv[2] ?? '{}') as ChildTask).then(
    (result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    },
    (error: unknown) => {
      process.stdout.write(
        `${JSON.stringify({ fatal: String((error as Error).stack ?? error) })}\n`,
      );
      process.exitCode = 1;
    },
  );
}
