import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { AuditType } from '../audit/record.mjs';
import type { AuditSink } from '../audit/sink';
import { enterCommitPoint, isSessionHeld, type SessionHold } from '../auth/sessions';
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
  checkedInput,
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
  isSha256,
  newRevisionId,
  type DraftId,
  type RevisionId,
  type Sha256,
  type StorePaths,
} from './layout';
import {
  placeLog,
  reconcileEvents,
  writeLive,
  writeLiveEvent,
  writeRevision,
  type Reconciled,
} from './commit';
import { healthCache, type HealthVerdict } from './health-cache';
import { LOCK_STALE_MS, LockLostError, type PublicationLock } from './lock';
import {
  DamagedPointerError,
  hasHistory,
  isIdempotencyKey,
  readEvent,
  readEvents,
  readLive,
  type EventType,
  type LivePointer,
  type PublicationEvent,
} from './pointer';
import {
  ADAPTER_SNAPSHOT_KINDS,
  githubRecordsFor,
  parseSnapshot,
  parseSource,
  type ParsedPair,
  type Publication,
} from '@portfolio/schema';
import { asDraftDerived } from './derived';
import { manifestFor, readManifest, readRevision, revisionIds, type Manifest } from './revisions';
import {
  checkUnit,
  DOCUMENT_NAMES,
  type DocumentName,
  type Unit,
  type UnitChecks,
  type UnitDiagnostic,
  type UnitInput,
} from '../catalog/unit';

// The PublicationService (#3, items 11 to 14 and 24): the only code that
// moves the published pointer. Publish, rollback, recover, and import each
// run under the publication lock and commit by renaming a new live.json over
// the old one.
//
// Publish: (1) read live.json, making the log agree with it, and check the
// idempotency key and the caller's expectations; (2) validate the draft; (3)
// write the revision through its staging directory; (4) move the pointer,
// the commit point; (5) write the event file, append the audit line, delete
// the draft, and tell the process. Rollback and recover run step 1, check
// the target, then steps 4 and 5 without the draft delete. Import runs all
// five on the mounted documents, without a draft, and where step 2 would
// find nothing to publish it skips step 3 and moves the pointer to the live
// revision again, so only the seq and the event change. Nothing after the
// commit undoes it: a failure there is logged, and startup repair finishes
// the step. For the owner, the pointer move alone runs inside #2's
// commitWithSession(), through the holdSession() the caller passes, so a
// session that ended first never moves the pointer, and a logout waits only
// for the move. The hold is checked once more just before the rename
// (enterCommitPoint()), so a move whose hold ran out of time renames
// nothing, and one past that check finishes before a logout lands. What the
// move did decides the outcome, not what holdSession() answers, and a
// publish whose move never ran, or ran out of time before its commit point,
// removes the revision it wrote. A key names one request: on another
// request's event it is idempotency_conflict.

recordOwnerModule('core/store/publication');

/**
 * A backup's or a restore's publication log (#3, item 26), written under
 * `staged`, a directory in `root` whose name starts with a dot, and put in
 * place as `root`'s publication/ in one rename, through commit.ts, the one
 * module that moves the pointer's paths. `root` is a backup's own
 * directory, or the empty one a restore fills, never a store a server runs
 * on: only the service's own operations move a store's pointer.
 */
export function placeCopiedLog(
  fs: FsPort,
  staged: string,
  root: string,
  operation: 'backup' | 'restore',
): Promise<void> {
  return placeLog(fs, staged, root, operation);
}

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
  /**
   * The owner's session ended before the pointer could move; nothing did,
   * and a publish's new revision is gone again.
   */
  | 'session_ended'
  /**
   * The idempotency key is on one of the last IDEMPOTENCY_WINDOW events, one
   * another request made; this one did nothing. 422: a retry won't help.
   */
  | 'idempotency_conflict'
  /**
   * The publication lock was broken and retaken while this operation held
   * it, as after a stall past 2 minutes; the pointer didn't move. A retry is
   * safe: 503 with Retry-After, as lock_timeout.
   */
  | 'lock_lost'
  /**
   * The live revision is damaged for good, and no earlier revision is
   * healthy (#10): the publish has nothing to check its derived changes
   * against, so it refuses rather than publish unchecked. `verify` says
   * what's wrong; `recover`, `restore`, or `import` repairs it.
   */
  | 'live_unreadable';

export interface PublicationRejection extends Rejection<PublicationRejectionCode> {
  /** For revision_incompatible: why, such as `schema.version` or `damaged:hash_mismatch`. */
  readonly reason?: string;
  /** For revision_incompatible: the CLI command that can take the store there. */
  readonly command?: string;
}

export type PublicationOutcome =
  | {
      readonly kind: 'committed';
      readonly revisionId: RevisionId;
      readonly seq: number;
      /** For an import: what it left out and why, such as a snapshot this build's schema refuses. */
      readonly warnings?: readonly UnitDiagnostic[];
    }
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

/** A page of a list: `limit` items from `offset`, 0 first. Without one, the whole list. */
export interface ListPage {
  readonly offset?: number;
  readonly limit?: number;
}

export interface RecoverInput {
  /** Defaults to the last known good. */
  readonly targetRevisionId?: RevisionId;
  readonly expectedLiveRevisionId: RevisionId | null;
  readonly idempotencyKey?: string;
  readonly reason?: string;
}

export interface ImportInput {
  /** The mounted documents, as read: the pair, and #10's media document once it has one. */
  readonly documents: UnitInput;
  /** What was mounted: the hash over each file's name and the hash of its bytes (item 6). */
  readonly sourceHash: Sha256;
  /** The revision the importer read live when it started, or null for an empty store. */
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
  /**
   * `import` (item 24): publishes the mounted documents with an `import`
   * event carrying their sourceHash. When they are live's already, by
   * unitHash and every document's sourceHash, it writes no revision and
   * moves the pointer to the live revision again: only the seq and the
   * event change.
   */
  importSource(
    input: ImportInput,
    actor: StoreActor,
    context?: PublicationContext,
  ): Promise<PublicationOutcome>;
  status(): Promise<LiveStatus>;
  /**
   * Every event, in seq order. A page reads only its own events: seq
   * offset + 1 on, up to `limit` of them.
   */
  history(page?: ListPage): Promise<readonly PublicationEvent[]>;
  /**
   * Every revision, the most recently live first. A page checks only its
   * own revisions' health, after ordering them all by what their events and
   * manifests say.
   */
  revisions(page?: ListPage): Promise<readonly RevisionSummary[]>;
  revision(revisionId: RevisionId): Promise<RevisionDetail | null>;
  /** The most recently live revision this build can serve, or null. */
  lastKnownGood(): Promise<RevisionId | null>;
  /**
   * Whether the store is empty: no live.json, and no history, which is an
   * event, a moved-aside one, or a tombstone (hasHistory()). A revision
   * alone was never live, as a first publish that crashed leaves one. Only
   * an empty store takes owner's first-start import, and the reader serves
   * nothing from it.
   */
  isEmpty(): Promise<boolean>;
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

/** A page's bounds, checked: a whole offset, and a limit of 1 or more. */
function pageOf(page: ListPage): { readonly offset: number; readonly limit: number } {
  const offset = page.offset ?? 0;
  const limit = page.limit ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError('A page is a whole offset from 0 and a limit of 1 or more.');
  }
  return { offset, limit };
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
  const health = healthCache({ fs, paths, checks, hasBlob });

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
   * moved aside first, while the lock is still this operation's.
   */
  async function livePointer(operation: string): Promise<LivePointer | null> {
    const pointer = await readPointer();
    if (!pointer) return null;
    const reconciled = await reconcileEvents(fs, paths, pointer, `${operation}.repair`, () =>
      lock.fence(),
    );
    logReconciled(pointer, reconciled);
    return pointer;
  }

  /**
   * The committed outcome a key already had, among the last
   * IDEMPOTENCY_WINDOW events, when `same` finds the event it's on was for
   * this very request, and idempotency_conflict when it was for another.
   */
  async function seenKey(
    pointer: LivePointer | null,
    key: string | undefined,
    same: (event: PublicationEvent) => Promise<boolean>,
  ): Promise<PublicationOutcome | null> {
    if (!pointer || key === undefined) return null;
    const oldest = Math.max(1, pointer.seq - IDEMPOTENCY_WINDOW + 1);
    for (let seq = pointer.seq; seq >= oldest; seq--) {
      const event = seq === pointer.seq ? pointer.event : await readEvent(fs, paths, seq);
      if (event?.idempotencyKey === key) {
        if (!(await same(event))) return rejected('idempotency_conflict');
        return { kind: 'committed', revisionId: event.revisionId, seq: event.seq };
      }
    }
    return null;
  }

  /**
   * The live revision's adapter snapshots an import keeps (#10): each that
   * checks against this build's schema, with only the GitHub records whose
   * section the imported portfolio has, for the account it names. A
   * snapshot that no longer checks, after a build tightens its schema, is
   * left out with a warning, so the import doesn't block on what the
   * operator's files don't hold.
   */
  function carriedSnapshots(
    documents: UnitInput,
    adapterSnapshots: Readonly<Record<string, unknown>>,
  ): { snapshots: Record<string, unknown>; warnings: UnitDiagnostic[] } {
    const parsed = parseSource(documents.portfolio.sourceText, documents.portfolio.format);
    const portfolio = parsed.ok ? parsed.data : null;
    const snapshots: Record<string, unknown> = {};
    const warnings: UnitDiagnostic[] = [];
    for (const [kind, value] of Object.entries(adapterSnapshots)) {
      if (!parseSnapshot(kind, value).ok) {
        warnings.push({
          code: 'snapshot.dropped',
          severity: 'warning',
          document: 'snapshots',
          pointer: '',
          message: `The live revision's ${kind} snapshot doesn't check against this build's schema, so the import left it out.`,
          remediation:
            'Nothing to do for the import. Refresh a draft from its sources, with portfolio-store sources refresh or in Studio, to fetch it again.',
        });
        continue;
      }
      snapshots[kind] = kind === 'github' ? githubRecordsFor(portfolio, value) : value;
    }
    return { snapshots, warnings };
  }

  /**
   * The live revision as the publish validators read it (#10): its pair,
   * media document, and snapshots, or null for an empty store. A live
   * revision damaged for good reads as the last known good, what visitors
   * get in its place and what a draft based on it compared against, so the
   * gate still holds what no one accepted. With no last known good, it's
   * `unreadable`: a publish refuses, and an import, one of the repairs, goes
   * on with nothing to compare.
   */
  async function liveContext(pointer: LivePointer | null): Promise<
    | {
        readonly context: Publication['live'];
        readonly adapterSnapshots: Readonly<Record<string, unknown>>;
      }
    | 'unreadable'
  > {
    const live = pointer?.revisionId ?? null;
    if (live === null) return { context: null, adapterSnapshots: {} };
    let read = await readRevision(fs, paths, live);
    // A read that may work next time stops the publish, so the checks
    // never pass for want of a moment's I/O.
    const transient = () =>
      new StoreError('storage_unavailable', "The live revision can't be read just now.");
    if (!read.ok) {
      if (read.transient) throw transient();
      const good = await walkLastKnownGood(pointer);
      log({
        level: 'warn',
        event: 'store.publish.live_unread',
        code: read.damage,
        ...(good ? { servingRevisionId: good } : {}),
      });
      if (!good || good === live) return 'unreadable';
      read = await readRevision(fs, paths, good);
      if (!read.ok) {
        if (read.transient) throw transient();
        return 'unreadable';
      }
    }
    const { unit } = read.revision;
    const adapterSnapshots = Object.fromEntries(
      Object.entries(unit.snapshots).filter(([kind]) =>
        (ADAPTER_SNAPSHOT_KINDS as readonly string[]).includes(kind),
      ),
    );
    return {
      context: {
        pair: { portfolio: unit.portfolio.model, site: unit.site.model } as ParsedPair,
        ...(unit.media ? { media: unit.media.model } : {}),
        snapshots: unit.snapshots,
      },
      adapterSnapshots,
    };
  }

  async function hashOf(id: RevisionId | null): Promise<Sha256 | null> {
    return id === null ? null : ((await readManifest(fs, paths, id))?.unitHash ?? null);
  }

  /** Whether `unit` is the live revision's: its unitHash and every document's sourceHash. */
  async function matchesLive(live: RevisionId | null, unit: Unit): Promise<boolean> {
    if (live === null) return false;
    const current = await readManifest(fs, paths, live);
    return (
      current?.unitHash === unit.unitHash &&
      DOCUMENT_NAMES.every((name) => current.documents[name]?.sourceHash === unit[name]?.sourceHash)
    );
  }

  /** The referenced blobs the AssetStore doesn't hold, as asset_missing, or null. */
  async function missingBlobs(manifest: Manifest): Promise<PublicationRejection | null> {
    const missing: Sha256[] = [];
    for (const blob of manifest.blobs) if (!(await assets.has(blob))) missing.push(blob);
    return missing.length > 0 ? rejected('asset_missing', [], { blobs: missing }) : null;
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

  /**
   * Removes the revision a publish wrote for a pointer move that never ran:
   * it was never live. Only while the lock is still this publish's.
   */
  async function dropUnpublished(id: RevisionId): Promise<void> {
    try {
      await lock.fence();
      await fs.remove(paths.revision(id), 'publish.unpublished.remove');
      await fs.fsync(paths.revisions, 'publish.unpublished.fsync');
    } catch {
      log({ level: 'warn', event: 'store.publish.unpublished_left', revisionId: id });
    }
  }

  /**
   * Steps 4 and 5: the commit point, then what follows it. A publish passes
   * its draft, and its event names the revision it wrote just now.
   */
  async function commit(
    operation: string,
    event: PublicationEvent,
    unitHash: Sha256,
    context: PublicationContext,
    draft?: { readonly draftId: DraftId; readonly version: number },
  ): Promise<PublicationOutcome> {
    // What the move did decides the outcome, whatever holdSession() answers:
    // whether it ran, and then whether it moved the pointer or found the
    // lock someone else's. The lock must still be this operation's as the
    // pointer moves, and for the owner, the session's hold too.
    let ran = false;
    let moved = false;
    // The hold ran out of time before the commit point: the rename never started.
    let missed = false;
    const move = async (beforeCommit?: () => void) => {
      ran = true;
      try {
        await writeLive(
          fs,
          paths,
          { seq: event.seq, revisionId: event.revisionId, unitHash, event },
          operation,
          () => lock.fence(),
          beforeCommit,
        );
        moved = true;
      } catch (error) {
        if (!(error instanceof LockLostError)) throw error;
      }
    };
    if (event.actor === 'operator') {
      await move();
    } else {
      // The owner's session holds through the move and nothing else, and is
      // checked once more just before the rename: a hold whose time ran out
      // meanwhile moves nothing, and one that passes keeps the session's
      // lock until the rename is done.
      requireHold(event.actor, context);
      // What failed inside the hold stands, even where holdSession() swallowed it.
      const thrown: unknown[] = [];
      let held: HeldMove<void>;
      try {
        held = await context.holdSession!(async (hold) => {
          try {
            if (!isSessionHeld(hold)) {
              throw new TypeError("The owner's session isn't held through the pointer move.");
            }
            await move(() => {
              if (!enterCommitPoint(hold)) {
                missed = true;
                throw new StoreError(
                  'storage_unavailable',
                  'The pointer move ran out of time before its commit point, so nothing moved.',
                );
              }
            });
          } catch (error) {
            thrown.push(error);
            throw error;
          }
        });
      } finally {
        // No move ran, or none got to its rename, so the revision a publish
        // wrote for it never went live.
        if ((!ran || missed) && draft) await dropUnpublished(event.revisionId);
      }
      if (thrown.length > 0) throw thrown[0];
      if (!ran) {
        // An ok for a move that never ran is a wiring error, and nothing more is written.
        if (held.ok) {
          throw new TypeError('holdSession() answered ok without running the pointer move.');
        }
        return rejected('session_ended');
      }
    }
    if (!moved) {
      // The move ran and found the lock someone else's.
      log({ level: 'error', event: 'store.lock.lost', seq: event.seq, code: 'lock_lost' });
      return rejected('lock_lost');
    }
    // The pointer moved, so this is committed, whatever holdSession()
    // answered. What follows finishes the step, and repair does what a
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
    operation: 'publish' | 'rollback' | 'recover' | 'import',
    body: (stage: (name: string) => void) => Promise<PublicationOutcome>,
  ): Promise<PublicationOutcome> {
    const started = performance.now();
    let stage = 'lock';
    const durationMs = () => Math.round(performance.now() - started);
    try {
      const outcome = await lock.withLock(operation, async () => {
        stage = 'check';
        try {
          return await body((name) => {
            stage = name;
          });
        } catch (error) {
          if (!(error instanceof LockLostError)) throw error;
          // Broken and retaken before this moved anything, as step 1 found.
          log({ level: 'error', event: 'store.lock.lost', stage, code: 'lock_lost' });
          return rejected('lock_lost');
        }
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
  function targetProblem(id: RevisionId, found: HealthVerdict): PublicationRejection | null {
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
      // The key's event is this request's when it was this operation, to
      // this target, from the revision this request expects.
      const seen = await seenKey(
        pointer,
        input.idempotencyKey,
        async (event) =>
          event.type === operation &&
          event.previousRevisionId === expected &&
          (input.targetRevisionId === undefined || event.revisionId === input.targetRevisionId),
      );
      if (seen) return seen;
      if ((pointer?.revisionId ?? null) !== expected) return liveConflict(pointer, expected);
      stage('target');
      const target = input.targetRevisionId ?? (await walkLastKnownGood(pointer));
      if (!target || !(await fs.stat(paths.revision(target)))) return rejected('not_found');
      if (target === pointer?.revisionId) return rejected('nothing_to_publish');
      const found = await health(target, 'publish');
      const problem = targetProblem(target, found);
      if (problem) return problem;
      const unitHash = found.state === 'ok' ? found.unitHash : null;
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

  /**
   * The most recently live revisions first, each once: the pointer's, then
   * by seq. The walk for the last known good passes over an event file it
   * can't read, as the reader's does; every other read of the log fails on
   * one, as history does.
   */
  async function liveOrder(pointer: LivePointer | null): Promise<RevisionId[]> {
    const order: RevisionId[] = [];
    const add = (id: RevisionId) => {
      if (!order.includes(id)) order.push(id);
    };
    if (pointer) add(pointer.revisionId);
    const events = await readEvents(fs, paths, { unreadable: () => {} });
    for (let index = events.length - 1; index >= 0; index--) add(events[index]!.revisionId);
    return order;
  }

  async function walkLastKnownGood(pointer: LivePointer | null): Promise<RevisionId | null> {
    for (const id of await liveOrder(pointer)) {
      if ((await health(id, 'serve')).state === 'ok') return id;
    }
    return null;
  }

  async function summary(id: RevisionId, seqs: ReadonlyMap<RevisionId, number>) {
    const manifest = await readManifest(fs, paths, id);
    const found = await health(id, 'publish');
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
        // The key's event is this request's when it published this draft
        // version, from the revision this request expects.
        const seen = await seenKey(pointer, input.idempotencyKey, async (event) => {
          if (event.type !== 'publish' || event.previousRevisionId !== expected) return false;
          const source = (await readManifest(fs, paths, event.revisionId))?.source;
          return (
            source?.kind === 'draft' &&
            source.draftId === input.draftId &&
            source.draftVersion === input.draftVersion
          );
        });
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
        // What the draft's refreshes froze goes live with it, and the
        // publish checks see the live revision and the draft's derived
        // block: an id the live revision gives another type, and a derived
        // change no one accepted, block it (#10). A draft with no derived
        // block has no decision either, so every change it carries is held.
        const derived = asDraftDerived(draft.derived);
        const against = await liveContext(pointer);
        if (against === 'unreadable') return rejected('live_unreadable');
        const { context: liveRevision } = against;
        const publication: Publication = {
          live: liveRevision,
          derived: derived ?? { changes: [] },
          draft: {
            media: draft.documents.media?.model,
            ...(derived?.snapshots ? { snapshots: derived.snapshots } : {}),
          },
        };
        const checked = checkUnit(
          { ...draftInput(draft), ...(derived?.snapshots ? { snapshots: derived.snapshots } : {}) },
          checks,
          publication,
        );
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
        const missing = await missingBlobs(manifest);
        if (missing) return missing;
        if (await matchesLive(live, unit)) return rejected('nothing_to_publish');

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

    importSource(input, actor, context = {}) {
      requireHold(actor, context);
      checkOptional(input);
      const expected = expectation(input.expectedLiveRevisionId);
      if (!isSha256(input.sourceHash)) throw new TypeError('Not a source hash.');
      const documents = checkedInput(input.documents);
      return run('import', async (stage) => {
        const pointer = await livePointer('import');
        // The key's event is this request's when it imported these very
        // files, from the revision this request expects.
        const seen = await seenKey(
          pointer,
          input.idempotencyKey,
          async (event) =>
            event.type === 'import' &&
            event.previousRevisionId === expected &&
            event.sourceHash === input.sourceHash,
        );
        if (seen) return seen;
        const live = pointer?.revisionId ?? null;
        // The live revision the importer read when it started: one another
        // process moved since then is a race this import lost.
        if (expected !== live) return liveConflict(pointer, expected);

        stage('validate');
        // An import checks against the live revision too (#10), with no
        // derived block: what it brings counts as accepted, as an operator's
        // files are. It keeps what the live revision's refreshes froze, so an
        // import never drops the GitHub data the owner published.
        const against = await liveContext(pointer);
        const { context: liveRevision, adapterSnapshots } =
          against === 'unreadable' ? { context: null, adapterSnapshots: {} } : against;
        const { snapshots: carried, warnings } = carriedSnapshots(documents, adapterSnapshots);
        const checked = checkUnit(
          {
            ...documents,
            ...(Object.keys(carried).length > 0 ? { snapshots: carried } : {}),
          },
          checks,
          { live: liveRevision },
        );
        if (!checked.ok) return rejected('validation_failed', checked.diagnostics);
        const { unit, rendering } = checked;
        const manifest = manifestFor(
          unit,
          {
            revisionId: newRevisionId(),
            parentRevisionId: live,
            createdAt: stamp(),
            createdBy: actor,
            source: { kind: 'import', sourceHash: input.sourceHash },
          },
          checks,
          rendering,
        );
        const missing = await missingBlobs(manifest);
        if (missing) return missing;

        // Where publish finds nothing to publish, the import still records
        // itself: the pointer moves to the live revision again.
        let revisionId = manifest.revisionId;
        if (live !== null && (await matchesLive(live, unit))) {
          revisionId = live;
        } else {
          stage('stage');
          try {
            await writeRevision(fs, paths, { manifest, unit }, 'import');
          } catch (error) {
            await fs
              .remove(paths.staging(manifest.revisionId), 'import.staging.remove')
              .catch(() => {});
            throw error;
          }
        }

        stage('commit');
        const event: PublicationEvent = {
          seq: (pointer?.seq ?? 0) + 1,
          type: 'import',
          revisionId,
          previousRevisionId: live,
          actor,
          at: stamp(),
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
          sourceHash: input.sourceHash,
        };
        const committed = await commit('import', event, unit.unitHash, context);
        return committed.kind === 'committed' && warnings.length > 0
          ? { ...committed, warnings }
          : committed;
      });
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
        const found = await health(pointer.revisionId, 'serve');
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

    async history(page) {
      const bounds = page ? pageOf(page) : undefined;
      try {
        const pointer = await readPointer();
        if (bounds) {
          // Seqs run from 1 to the pointer's, so a page reads its own range.
          const { offset, limit } = bounds;
          const last = Math.min(pointer?.seq ?? 0, offset + limit);
          const events: PublicationEvent[] = [];
          for (let seq = offset + 1; seq <= last; seq++) {
            const event = seq === pointer?.seq ? pointer.event : await readEvent(fs, paths, seq);
            if (event) events.push(event);
          }
          return events;
        }
        const events = await readEvents(fs, paths);
        if (pointer && !events.some((event) => event.seq === pointer.seq)) {
          events.push(pointer.event);
        }
        return events.sort((a, b) => a.seq - b.seq);
      } catch (error) {
        throw storageError(error);
      }
    },

    async revisions(page) {
      const { offset, limit } = pageOf(page ?? {});
      try {
        const seqs = await latestSeqs();
        const ids = await revisionIds(fs, paths);
        const created = new Map<RevisionId, string>();
        for (const id of ids) created.set(id, (await readManifest(fs, paths, id))?.createdAt ?? '');
        ids.sort(
          (a, b) =>
            (seqs.get(b) ?? 0) - (seqs.get(a) ?? 0) ||
            created.get(b)!.localeCompare(created.get(a)!) ||
            a.localeCompare(b),
        );
        const list: RevisionSummary[] = [];
        for (const id of ids.slice(offset, page ? offset + limit : undefined)) {
          list.push((await summary(id, seqs)).result);
        }
        return list;
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

    async isEmpty() {
      try {
        try {
          if (await readLive(fs, paths)) return false;
        } catch (error) {
          // There, and unreadable: a damaged pointer, never an empty store.
          if (error instanceof DamagedPointerError) return false;
          throw error;
        }
        return !(await hasHistory(fs, paths));
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
            ? await reconcileEvents(fs, paths, pointer, 'repair', () => lock.fence())
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
          // Repair removes no revision. With no pointer and no history, one
          // may be a first publish's that failed before its pointer, or all
          // a store has left after its log was lost; the store is empty
          // either way, and each stays as it is.
          return { stagingRemoved, tempsRemoved, eventWritten, eventsAside, draftRemoved };
        } catch (error) {
          if (error instanceof LockLostError) {
            // Another holder took the lock: the log is theirs to make agree now.
            log({ level: 'error', event: 'store.lock.lost', stage: 'repair', code: 'lock_lost' });
            throw new StoreError(
              'storage_unavailable',
              'Another holder took the publication lock during repair, so it stopped.',
              { cause: error },
            );
          }
          throw storageError(error);
        }
      });
    },
  };
}
