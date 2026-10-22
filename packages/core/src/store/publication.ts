import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { AuditType } from '../audit/record.mjs';
import type { AuditSink } from '../audit/sink';
import { isSessionHeld, type SessionHold } from '../auth/sessions';
import { recordOwnerModule } from '../load-trace';
import type { AssetStore } from './assets';
import {
  emitStoreEvent,
  storageError,
  StoreError,
  type StoreActor,
  type StoreEventName,
  type StoreLog,
} from './common';
import {
  draftInput,
  readDraft,
  removeDraft,
  type DraftConflict,
  type LiveConflict,
  type Rejection,
} from './drafts';
import type { FsPort } from './fs-port';
import {
  isRevisionId,
  newRevisionId,
  type DraftId,
  type RevisionId,
  type Sha256,
  type StorePaths,
} from './layout';
import { LOCK_STALE_MS, LockLostError, type PublicationLock } from './lock';
import {
  DamagedPointerError,
  isIdempotencyKey,
  readEvent,
  readEvents,
  readLive,
  reconcileEvents,
  writeLive,
  writeLiveEvent,
  type EventType,
  type LivePointer,
  type PublicationEvent,
  type Reconciled,
} from './pointer';
import {
  manifestFor,
  readManifest,
  readRevision,
  revisionHealth,
  revisionIds,
  writeRevision,
  type Manifest,
  type RevisionHealth,
} from './revisions';
import {
  checkUnit,
  DOCUMENT_NAMES,
  type DocumentName,
  type Unit,
  type UnitChecks,
  type UnitDiagnostic,
} from './unit';

// The PublicationService (#3, items 11 to 14): the only code that moves the
// published pointer. Publish, rollback, and recover each run under the
// publication lock and commit by renaming a new live.json over the old one.
//
// Publish: (1) read live.json, writing its event's own file if a crash left
// it out, and check the caller's expectations; (2) validate the draft; (3)
// write the revision through its staging directory; (4) move the pointer, the
// commit point; (5) write the event file, append the audit line, delete the
// draft, and tell the process. Rollback and recover run step 1, check the
// target, then steps 4 and 5 without the draft delete. Nothing after the
// commit undoes it: a failure there is logged, and startup repair finishes
// the step. For the owner, the pointer move alone runs inside #2's
// commitWithSession(), through the holdSession() the caller passes, so a
// session that ended first never moves the pointer and a logout waits only
// for the move.

recordOwnerModule('core/store/publication');

/** How many recent events an idempotency key is looked up in. */
export const IDEMPOTENCY_WINDOW = 100;
const REASON_MAX = 500;
/** live.json's temporary files, tempBeside()'s names for it, which only lock holders write. */
const LIVE_TEMP = /^\.live\.json\.[0-9a-f]+\.tmp$/;

export type PublicationRejectionCode =
  | 'validation_failed'
  | 'asset_missing'
  | 'nothing_to_publish'
  | 'revision_incompatible'
  | 'not_found'
  /** The owner's session ended before the pointer could move; nothing did. */
  | 'session_ended'
  /**
   * The publication lock was broken and retaken while this operation held
   * it, as after a stall past 2 minutes; the pointer didn't move. A retry is
   * safe: 503 with Retry-After, as lock_timeout.
   */
  | 'lock_lost';

export interface PublicationRejection extends Rejection<PublicationRejectionCode> {
  /** For revision_incompatible: why, such as `schema.version` or `damaged:hash_mismatch`. */
  readonly reason?: string;
  /** For revision_incompatible: the CLI command that can take the store there. */
  readonly command?: string;
}

export type PublicationOutcome =
  | { readonly kind: 'committed'; readonly revisionId: RevisionId; readonly seq: number }
  | PublicationRejection
  | LiveConflict
  | DraftConflict;

/** What visitors get: the live revision, the last known good in its place, or nothing. */
export type ServingState = 'live' | 'degraded' | 'incompatible' | 'empty';

export interface LiveStatus {
  readonly state: ServingState;
  /** What the pointer names. */
  readonly liveRevisionId: RevisionId | null;
  /** What's served: the live revision, or the last known good when it can't be. */
  readonly servingRevisionId: RevisionId | null;
  readonly seq: number | null;
  /** The pointer's unitHash. */
  readonly unitHash: Sha256 | null;
  /** Why the live revision isn't served, when it isn't. */
  readonly reason?: string;
}

export interface RevisionSummary {
  readonly revisionId: RevisionId;
  /** The seq of the latest event that made it live, if one did. */
  readonly seq?: number;
  /** Null when its manifest can't be read. */
  readonly createdAt: string | null;
  readonly createdBy: StoreActor | null;
  /** Whether this build can make it live: it reads, validates, and has its blobs. */
  readonly compatible: boolean;
  readonly reason?: string;
}

export interface RevisionDocument {
  readonly format: Unit['portfolio']['format'];
  readonly sourceText: string;
  readonly model: unknown;
}

export interface RevisionDetail extends RevisionSummary {
  readonly manifest: Manifest;
  readonly documents: Readonly<Partial<Record<DocumentName, RevisionDocument>>>;
}

export interface RepairReport {
  /** Staging directories a publish in progress left. */
  readonly stagingRemoved: number;
  /** Temporary files a write in progress left. */
  readonly tempsRemoved: number;
  /** Whether the live event's own file was missing or unreadable, and is written now. */
  readonly eventWritten: boolean;
  /** Event files that disagreed with live.json, above its seq or at it, moved aside. */
  readonly eventsAside: number;
  /** Whether the draft the live revision was published from was still there, and is gone now. */
  readonly draftRemoved: boolean;
}

/** What holdSession() did with the pointer move: ran it, or found the session ended first. */
export type HeldMove<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

/** About the request an operation serves. */
export interface PublicationContext {
  readonly requestId?: string;
  /**
   * Runs `move` holding the owner's session, as #2's commitWithSession()
   * does, or answers `{ ok: false }` when the session no longer counts. The
   * owner's publish, rollback, and recover need it, and call it once, with
   * the pointer move and nothing else. The operator's CLI has no session.
   */
  readonly holdSession?: <T>(move: (hold: SessionHold) => Promise<T>) => Promise<HeldMove<T>>;
}

export interface PublishInput {
  readonly draftId: DraftId;
  readonly draftVersion: number;
  /** The revision the caller saw live, or null for an empty store. */
  readonly expectedLiveRevisionId: RevisionId | null;
  readonly idempotencyKey?: string;
}

export interface RollbackInput {
  readonly targetRevisionId: RevisionId;
  readonly expectedLiveRevisionId: RevisionId | null;
  readonly idempotencyKey?: string;
  readonly reason?: string;
}

export interface RecoverInput {
  /** Defaults to the last known good. */
  readonly targetRevisionId?: RevisionId;
  readonly expectedLiveRevisionId: RevisionId | null;
  readonly idempotencyKey?: string;
  readonly reason?: string;
}

export interface PublicationService {
  publish(
    input: PublishInput,
    actor: StoreActor,
    context?: PublicationContext,
  ): Promise<PublicationOutcome>;
  /** Points live at an existing compatible revision. Drafts stay as they are. */
  rollback(
    input: RollbackInput,
    actor: StoreActor,
    context?: PublicationContext,
  ): Promise<PublicationOutcome>;
  /** Points live at a chosen revision, by default the last known good, with a `recover` event. */
  recover(
    input: RecoverInput,
    actor: StoreActor,
    context?: PublicationContext,
  ): Promise<PublicationOutcome>;
  status(): Promise<LiveStatus>;
  /** Every event, in seq order. */
  history(): Promise<readonly PublicationEvent[]>;
  /** Every revision, the most recently live first. */
  revisions(): Promise<readonly RevisionSummary[]>;
  revision(revisionId: RevisionId): Promise<RevisionDetail | null>;
  /** The most recently live revision this build can serve, or null. */
  lastKnownGood(): Promise<RevisionId | null>;
  /** Startup repair, under the lock: what a crash left behind. */
  repair(): Promise<RepairReport>;
}

export interface PublicationOptions {
  readonly fs: FsPort;
  readonly paths: StorePaths;
  readonly lock: PublicationLock;
  readonly checks: UnitChecks;
  readonly assets: AssetStore;
  readonly audit?: AuditSink;
  readonly now?: () => number;
  readonly log?: StoreLog;
}

const AUDIT_TYPE: Readonly<Record<EventType, AuditType>> = Object.freeze({
  import: 'imported',
  publish: 'published',
  rollback: 'rolled_back',
  recover: 'recovered',
  'schema-migration': 'schema_migrated',
});

const NO_AUDIT: AuditSink = Object.freeze({
  async record() {},
  async flush() {},
});

function rejected(
  code: PublicationRejectionCode,
  diagnostics: readonly UnitDiagnostic[] = [],
  extra: Omit<PublicationRejection, 'kind' | 'code' | 'diagnostics'> = {},
): PublicationRejection {
  return { kind: 'rejected', code, diagnostics, ...extra };
}

/** Throws unless an owner's operation can hold its session for the pointer move. */
function requireHold(actor: StoreActor, context: PublicationContext): void {
  if (actor !== 'operator' && typeof context.holdSession !== 'function') {
    throw new TypeError("The owner's pointer move needs the session held (commitWithSession).");
  }
}

function checkOptional(input: { readonly idempotencyKey?: string; readonly reason?: string }) {
  if (input.idempotencyKey !== undefined && !isIdempotencyKey(input.idempotencyKey)) {
    throw new TypeError('Not an idempotency key.');
  }
  if (
    input.reason !== undefined &&
    (typeof input.reason !== 'string' || input.reason.length > REASON_MAX)
  ) {
    throw new TypeError(`A reason is text of at most ${REASON_MAX} characters.`);
  }
}

const expectation = (value: unknown): RevisionId | null => {
  if (value === null || isRevisionId(value)) return value;
  throw new TypeError('The expected live revision is a revision ID or null.');
};

export function filesystemPublicationService({
  fs,
  paths,
  lock,
  checks,
  assets,
  audit = NO_AUDIT,
  now = Date.now,
  log = () => {},
}: PublicationOptions): PublicationService {
  const stamp = () => new Date(now()).toISOString();
  const hasBlob = (hash: Sha256) => assets.has(hash);
  const health = (id: RevisionId) => revisionHealth(fs, paths, id, checks, hasBlob);

  async function readPointer(): Promise<LivePointer | null> {
    try {
      return await readLive(fs, paths);
    } catch (error) {
      if (error instanceof DamagedPointerError) {
        log({ level: 'error', event: 'store.pointer.damaged', code: 'pointer_damaged' });
        throw new StoreError('storage_unavailable', error.message, { cause: error });
      }
      throw storageError(error);
    }
  }

  /** Logs what reconcileEvents() changed: each file moved aside at error, a written one at warn. */
  function logReconciled(pointer: LivePointer, reconciled: Reconciled) {
    for (const seq of reconciled.aside) log({ level: 'error', event: 'store.event.mismatch', seq });
    if (reconciled.written) {
      log({
        level: 'warn',
        event: 'store.event.repaired',
        seq: pointer.seq,
        revisionId: pointer.revisionId,
      });
    }
  }

  /**
   * Step 1's start: the pointer, with the log made to agree with it, since
   * live.json wins. The live event's own file is written if a crash left it
   * out, and an event file that disagrees, at the live seq or above it, is
   * moved aside first.
   */
  async function livePointer(operation: string): Promise<LivePointer | null> {
    const pointer = await readPointer();
    if (!pointer) return null;
    logReconciled(pointer, await reconcileEvents(fs, paths, pointer, `${operation}.repair`));
    return pointer;
  }

  /** The committed outcome a key already had, among the last IDEMPOTENCY_WINDOW events. */
  async function seenKey(
    pointer: LivePointer | null,
    key: string | undefined,
  ): Promise<PublicationOutcome | null> {
    if (!pointer || key === undefined) return null;
    const oldest = Math.max(1, pointer.seq - IDEMPOTENCY_WINDOW + 1);
    for (let seq = pointer.seq; seq >= oldest; seq--) {
      const event = seq === pointer.seq ? pointer.event : await readEvent(fs, paths, seq);
      if (event?.idempotencyKey === key) {
        return { kind: 'committed', revisionId: event.revisionId, seq: event.seq };
      }
    }
    return null;
  }

  async function hashOf(id: RevisionId | null): Promise<Sha256 | null> {
    return id === null ? null : ((await readManifest(fs, paths, id))?.unitHash ?? null);
  }

  async function liveConflict(
    pointer: LivePointer | null,
    base: RevisionId | null,
    draftHash?: Sha256 | null,
  ): Promise<LiveConflict> {
    return {
      kind: 'conflict',
      code: 'live_conflict',
      liveRevisionId: pointer?.revisionId ?? null,
      baseHash: await hashOf(base),
      liveHash: pointer?.unitHash ?? null,
      ...(draftHash === undefined ? {} : { draftHash }),
    };
  }

  /** Steps 4 and 5: the commit point, then what follows it. */
  async function commit(
    operation: string,
    event: PublicationEvent,
    unitHash: Sha256,
    context: PublicationContext,
    draft?: { readonly draftId: DraftId; readonly version: number },
  ): Promise<PublicationOutcome> {
    // The lock must still be this operation's as the pointer moves.
    let lockLost = false;
    const move = async () => {
      try {
        await writeLive(
          fs,
          paths,
          { seq: event.seq, revisionId: event.revisionId, unitHash, event },
          operation,
          () => lock.fence(),
        );
      } catch (error) {
        if (!(error instanceof LockLostError)) throw error;
        lockLost = true;
      }
    };
    if (event.actor === 'operator') {
      await move();
    } else {
      // The owner's session holds through the move and nothing else.
      requireHold(event.actor, context);
      const held = await context.holdSession!(async (hold) => {
        if (!isSessionHeld(hold)) {
          throw new TypeError("The owner's session isn't held through the pointer move.");
        }
        await move();
      });
      if (!held.ok) return rejected('session_ended');
    }
    if (lockLost) {
      log({ level: 'error', event: 'store.lock.lost', seq: event.seq, code: 'lock_lost' });
      return rejected('lock_lost');
    }
    // Committed. What follows finishes the step, and repair does what a
    // failure here leaves undone.
    try {
      await fs.fsync(paths.publication, `${operation}.publication.fsync`);
    } catch {
      log({ level: 'warn', event: `store.${operation}.sync_failed`, seq: event.seq });
    }
    try {
      // live.json is this event's now, and wins over a file in its way.
      if (await writeLiveEvent(fs, paths, event, operation)) {
        log({ level: 'error', event: 'store.event.mismatch', seq: event.seq });
      }
    } catch {
      log({ level: 'warn', event: `store.${operation}.event_deferred`, seq: event.seq });
    }
    await audit.record({
      type: AUDIT_TYPE[event.type],
      actor: event.actor,
      outcome: 'success',
      refs: {
        seq: event.seq,
        revisionId: event.revisionId,
        ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
      },
    });
    if (draft) {
      try {
        const found = await readDraft(fs, paths, draft.draftId, log);
        if (found && found.draft.version === draft.version) {
          await removeDraft(fs, paths, draft.draftId, `${operation}.draft`);
        }
      } catch {
        log({ level: 'warn', event: `store.${operation}.draft_left`, seq: event.seq });
      }
    }
    const names: Partial<Record<EventType, StoreEventName>> = {
      publish: 'published',
      import: 'published',
      'schema-migration': 'published',
      rollback: 'rolledBack',
      recover: 'recovered',
    };
    emitStoreEvent({ name: names[event.type]!, revisionId: event.revisionId, seq: event.seq });
    return { kind: 'committed', revisionId: event.revisionId, seq: event.seq };
  }

  /** Runs an operation under the lock, logging how it ended, by stage, never with content. */
  async function run(
    operation: 'publish' | 'rollback' | 'recover',
    body: (stage: (name: string) => void) => Promise<PublicationOutcome>,
  ): Promise<PublicationOutcome> {
    const started = performance.now();
    let stage = 'lock';
    const durationMs = () => Math.round(performance.now() - started);
    try {
      const outcome = await lock.withLock(operation, () => {
        stage = 'check';
        return body((name) => {
          stage = name;
        });
      });
      if (outcome.kind === 'committed') {
        log({
          level: 'info',
          event: `store.${operation}.committed`,
          revisionId: outcome.revisionId,
          seq: outcome.seq,
          durationMs: durationMs(),
        });
      } else {
        log({
          level: 'info',
          event: `store.${operation}.failed`,
          stage,
          code: outcome.code,
          durationMs: durationMs(),
        });
      }
      return outcome;
    } catch (error) {
      if (error instanceof TypeError) throw error;
      const failure = storageError(error);
      log({
        level: 'error',
        event: `store.${operation}.failed`,
        stage,
        code: failure.code,
        durationMs: durationMs(),
      });
      throw failure;
    }
  }

  /** Whether `health` lets a rollback or recover make its revision live, and if not, why. */
  function targetProblem(id: RevisionId, found: RevisionHealth): PublicationRejection | null {
    switch (found.state) {
      case 'ok':
        return null;
      case 'removed':
        return rejected('not_found');
      case 'damaged':
        return rejected('revision_incompatible', [], { reason: `damaged:${found.reason}` });
      case 'incompatible':
        return rejected('revision_incompatible', found.diagnostics, {
          reason: found.reason,
          command: `rollback --to ${id}`,
        });
    }
  }

  /** Rollback and recover: step 1, the target's check, then steps 4 and 5 without a draft. */
  function movePointer(
    operation: 'rollback' | 'recover',
    input: RollbackInput | RecoverInput,
    actor: StoreActor,
    context: PublicationContext,
  ): Promise<PublicationOutcome> {
    requireHold(actor, context);
    checkOptional(input);
    const expected = expectation(input.expectedLiveRevisionId);
    if (input.targetRevisionId !== undefined && !isRevisionId(input.targetRevisionId)) {
      throw new TypeError('Not a revision ID.');
    }
    return run(operation, async (stage) => {
      const pointer = await livePointer(operation);
      const seen = await seenKey(pointer, input.idempotencyKey);
      if (seen) return seen;
      if ((pointer?.revisionId ?? null) !== expected) return liveConflict(pointer, expected);
      stage('target');
      const target = input.targetRevisionId ?? (await walkLastKnownGood(pointer));
      if (!target || !(await fs.stat(paths.revision(target)))) return rejected('not_found');
      if (target === pointer?.revisionId) return rejected('nothing_to_publish');
      const found = await health(target);
      const problem = targetProblem(target, found);
      if (problem) return problem;
      const unitHash = found.state === 'ok' ? found.revision.unit.unitHash : null;
      if (!unitHash) return rejected('revision_incompatible');
      stage('commit');
      const event: PublicationEvent = {
        seq: (pointer?.seq ?? 0) + 1,
        type: operation,
        revisionId: target,
        previousRevisionId: pointer?.revisionId ?? null,
        actor,
        at: stamp(),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      };
      return commit(operation, event, unitHash, context);
    });
  }

  /** The most recently live revisions first, each once: the pointer's, then by seq. */
  async function liveOrder(pointer: LivePointer | null): Promise<RevisionId[]> {
    const order: RevisionId[] = [];
    const add = (id: RevisionId) => {
      if (!order.includes(id)) order.push(id);
    };
    if (pointer) add(pointer.revisionId);
    const events = await readEvents(fs, paths);
    for (let index = events.length - 1; index >= 0; index--) add(events[index]!.revisionId);
    return order;
  }

  async function walkLastKnownGood(pointer: LivePointer | null): Promise<RevisionId | null> {
    for (const id of await liveOrder(pointer)) {
      if ((await health(id)).state === 'ok') return id;
    }
    return null;
  }

  async function summary(id: RevisionId, seqs: ReadonlyMap<RevisionId, number>) {
    const manifest = await readManifest(fs, paths, id);
    const found = await health(id);
    const seq = seqs.get(id);
    const result: RevisionSummary = {
      revisionId: id,
      ...(seq === undefined ? {} : { seq }),
      createdAt: manifest?.createdAt ?? null,
      createdBy: manifest?.createdBy ?? null,
      compatible: found.state === 'ok',
      ...(found.state === 'ok'
        ? {}
        : { reason: found.state === 'removed' ? 'removed' : `${found.state}:${found.reason}` }),
    };
    return { result, manifest };
  }

  async function latestSeqs(): Promise<Map<RevisionId, number>> {
    const seqs = new Map<RevisionId, number>();
    const pointer = await readPointer();
    const events = await readEvents(fs, paths);
    if (pointer && !events.some((event) => event.seq === pointer.seq)) events.push(pointer.event);
    for (const event of events) {
      seqs.set(event.revisionId, Math.max(seqs.get(event.revisionId) ?? 0, event.seq));
    }
    return seqs;
  }

  /**
   * Whether `dir`, and each directory between the data directory and it, is
   * a directory itself, not a link to one. Repair never goes through a link.
   */
  async function realDirectory(dir: string): Promise<boolean> {
    let current = paths.root;
    for (const part of path.relative(paths.root, dir).split(path.sep)) {
      if (part === '') continue;
      current = path.join(current, part);
      if ((await fs.lstat(current))?.isDirectory !== true) return false;
    }
    return true;
  }

  /**
   * Removes what a crash left in `dir`: temporary files, all of them or those
   * older than `olderThanMs`, and with `only`, those its pattern names. Only
   * regular files go, and nothing in a linked directory.
   */
  async function removeTemps(
    dir: string,
    olderThanMs: number | null,
    only?: RegExp,
  ): Promise<number> {
    if (!(await realDirectory(dir))) return 0;
    let removed = 0;
    for (const name of await fs.readdir(dir)) {
      if (!name.startsWith('.') || !name.endsWith('.tmp')) continue;
      if (only && !only.test(name)) continue;
      const file = path.join(dir, name);
      const found = await fs.lstat(file);
      if (!found?.isFile) continue;
      if (olderThanMs !== null && now() - found.mtimeMs < olderThanMs) continue;
      await fs.remove(file, 'repair.temp.remove');
      removed += 1;
    }
    return removed;
  }

  return {
    publish(input, actor, context = {}) {
      requireHold(actor, context);
      checkOptional(input);
      const expected = expectation(input.expectedLiveRevisionId);
      return run('publish', async (stage) => {
        const pointer = await livePointer('publish');
        const seen = await seenKey(pointer, input.idempotencyKey);
        if (seen) return seen;
        const live = pointer?.revisionId ?? null;
        const found = await readDraft(fs, paths, input.draftId, log);
        // A stale expectation answers first: the publish that moved live
        // may have closed this very draft.
        if (expected !== live || (found && found.draft.baseRevisionId !== live)) {
          const checked = found ? checkUnit(draftInput(found.draft), checks) : null;
          return liveConflict(
            pointer,
            found ? found.draft.baseRevisionId : expected,
            checked?.ok ? checked.unit.unitHash : null,
          );
        }
        if (!found) return rejected('not_found');
        const { draft } = found;
        if (draft.version !== input.draftVersion) {
          return {
            kind: 'conflict',
            code: 'draft_conflict',
            draftId: draft.draftId,
            version: draft.version,
            documents: draft.documents,
          };
        }

        stage('validate');
        const checked = checkUnit(draftInput(draft), checks);
        if (!checked.ok) return rejected('validation_failed', checked.diagnostics);
        const { unit, rendering } = checked;
        const manifestFields = {
          revisionId: newRevisionId(),
          parentRevisionId: live,
          createdAt: stamp(),
          createdBy: actor,
          source: {
            kind: 'draft' as const,
            draftId: draft.draftId,
            draftVersion: draft.version,
            ...(draft.sourceHash === undefined ? {} : { sourceHash: draft.sourceHash }),
          },
        };
        const manifest = manifestFor(unit, manifestFields, checks, rendering);
        const missing: Sha256[] = [];
        for (const blob of manifest.blobs) if (!(await assets.has(blob))) missing.push(blob);
        if (missing.length > 0) return rejected('asset_missing', [], { blobs: missing });
        if (live !== null) {
          const current = await readManifest(fs, paths, live);
          const same =
            current?.unitHash === unit.unitHash &&
            DOCUMENT_NAMES.every(
              (name) => current.documents[name]?.sourceHash === unit[name]?.sourceHash,
            );
          if (same) return rejected('nothing_to_publish');
        }

        stage('stage');
        try {
          await writeRevision(fs, paths, { manifest, unit }, 'publish');
        } catch (error) {
          await fs
            .remove(paths.staging(manifest.revisionId), 'publish.staging.remove')
            .catch(() => {});
          throw error;
        }

        stage('commit');
        const event: PublicationEvent = {
          seq: (pointer?.seq ?? 0) + 1,
          type: 'publish',
          revisionId: manifest.revisionId,
          previousRevisionId: live,
          actor,
          at: stamp(),
          ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
          ...(draft.sourceHash === undefined ? {} : { sourceHash: draft.sourceHash }),
        };
        return commit('publish', event, unit.unitHash, context, {
          draftId: draft.draftId,
          version: draft.version,
        });
      });
    },

    rollback(input, actor, context = {}) {
      if (!isRevisionId(input.targetRevisionId)) throw new TypeError('Not a revision ID.');
      return movePointer('rollback', input, actor, context);
    },

    recover(input, actor, context = {}) {
      return movePointer('recover', input, actor, context);
    },

    async status() {
      try {
        let pointer: LivePointer | null;
        try {
          pointer = await readLive(fs, paths);
        } catch (error) {
          if (!(error instanceof DamagedPointerError)) throw error;
          const lkg = await walkLastKnownGood(null);
          return {
            state: lkg ? 'degraded' : 'incompatible',
            liveRevisionId: null,
            servingRevisionId: lkg,
            seq: null,
            unitHash: null,
            reason: 'pointer_damaged',
          };
        }
        if (!pointer) {
          return {
            state: 'empty',
            liveRevisionId: null,
            servingRevisionId: null,
            seq: null,
            unitHash: null,
          };
        }
        const found = await health(pointer.revisionId);
        const base = {
          liveRevisionId: pointer.revisionId,
          seq: pointer.seq,
          unitHash: pointer.unitHash,
        };
        if (found.state === 'ok')
          return { state: 'live', servingRevisionId: pointer.revisionId, ...base };
        const reason = found.state === 'removed' ? 'removed' : `${found.state}:${found.reason}`;
        const lkg = await walkLastKnownGood(pointer);
        return lkg
          ? { state: 'degraded', servingRevisionId: lkg, reason, ...base }
          : { state: 'incompatible', servingRevisionId: null, reason, ...base };
      } catch (error) {
        throw storageError(error);
      }
    },

    async history() {
      try {
        const events = await readEvents(fs, paths);
        const pointer = await readPointer();
        if (pointer && !events.some((event) => event.seq === pointer.seq)) {
          events.push(pointer.event);
        }
        return events.sort((a, b) => a.seq - b.seq);
      } catch (error) {
        throw storageError(error);
      }
    },

    async revisions() {
      try {
        const seqs = await latestSeqs();
        const list: RevisionSummary[] = [];
        for (const id of await revisionIds(fs, paths)) list.push((await summary(id, seqs)).result);
        return list.sort(
          (a, b) =>
            (b.seq ?? 0) - (a.seq ?? 0) ||
            (b.createdAt ?? '').localeCompare(a.createdAt ?? '') ||
            a.revisionId.localeCompare(b.revisionId),
        );
      } catch (error) {
        throw storageError(error);
      }
    },

    async revision(revisionId) {
      if (!isRevisionId(revisionId)) return null;
      try {
        const read = await readRevision(fs, paths, revisionId);
        if (!read.ok) return null;
        const { result } = await summary(revisionId, await latestSeqs());
        const documents: Partial<Record<DocumentName, RevisionDocument>> = {};
        for (const name of DOCUMENT_NAMES) {
          const document = read.revision.unit[name];
          if (document) {
            documents[name] = {
              format: document.format,
              sourceText: document.sourceText,
              model: document.model,
            };
          }
        }
        return { ...result, manifest: read.revision.manifest, documents };
      } catch (error) {
        throw storageError(error);
      }
    },

    async lastKnownGood() {
      try {
        return await walkLastKnownGood(await readPointer());
      } catch (error) {
        throw storageError(error);
      }
    },

    repair() {
      return lock.withLock('repair', async () => {
        try {
          let stagingRemoved = 0;
          // A linked revisions/ isn't the store's: its .staging-* are someone else's.
          const stagings = (await realDirectory(paths.revisions))
            ? await fs.readdir(paths.revisions)
            : [];
          for (const name of stagings) {
            if (!name.startsWith('.staging-')) continue;
            // A linked .staging-* goes as a link; what it points at stays.
            await fs.remove(path.join(paths.revisions, name), 'repair.staging.remove');
            stagingRemoved += 1;
          }
          if (stagingRemoved > 0) await fs.fsync(paths.revisions, 'repair.revisions.fsync');
          // Drafts and live.json are written only under the lock this holds,
          // so any temporary file there is a crash's. The lock's, the server
          // claim's, and the AssetStore's are written without it, so only old
          // ones go.
          let tempsRemoved = await removeTemps(paths.drafts, null);
          tempsRemoved += await removeTemps(paths.publication, null, LIVE_TEMP);
          tempsRemoved += await removeTemps(paths.publication, LOCK_STALE_MS);
          tempsRemoved += await removeTemps(paths.events, null);
          const shards = (await realDirectory(paths.assets)) ? await fs.readdir(paths.assets) : [];
          for (const shard of shards) {
            if (/^[0-9a-f]{2}$/.test(shard)) {
              tempsRemoved += await removeTemps(path.join(paths.assets, shard), 24 * 60 * 60_000);
            }
          }

          // The log agrees with live.json, which wins.
          const pointer = await readPointer();
          const reconciled = pointer
            ? await reconcileEvents(fs, paths, pointer, 'repair')
            : { aside: [], written: false };
          if (pointer) logReconciled(pointer, reconciled);
          const eventWritten = reconciled.written;
          const eventsAside = reconciled.aside.length;
          let draftRemoved = false;
          const manifest = pointer ? await readManifest(fs, paths, pointer.revisionId) : null;
          if (manifest?.source.kind === 'draft') {
            const { draftId, draftVersion } = manifest.source;
            const found = await readDraft(fs, paths, draftId, log);
            if (found && found.draft.version === draftVersion) {
              await removeDraft(fs, paths, draftId, 'repair.draft');
              draftRemoved = true;
            }
          }
          return { stagingRemoved, tempsRemoved, eventWritten, eventsAside, draftRemoved };
        } catch (error) {
          throw storageError(error);
        }
      });
    },
  };
}
