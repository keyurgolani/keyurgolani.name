import 'server-only';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import type {
  CatalogReader,
  CatalogStatus,
  RenderDrift,
  Rendering,
  UnitChecks,
} from '@portfolio/core';
import {
  claimServer,
  filesystemAuditSink,
  openStore,
  preflight,
  revisionCatalogReader,
  StoreError,
  type AuditSink,
  type DiscardOutcome,
  type Draft,
  type DraftEdit,
  type DraftId,
  type DraftOutcome,
  type ListPage,
  type PreflightCode,
  type PublicationContext,
  type PublicationEvent,
  type PublicationOutcome,
  type PublishInput,
  type RecoverInput,
  type RevisionCatalogReader,
  type RevisionDetail,
  type RevisionId,
  type RevisionSummary,
  type RollbackInput,
  type ServerClaim,
  type Store,
  type StoreActor,
  type StoreErrorCode,
  type StoreLogEntry,
  type UnitInput,
} from '@portfolio/core/owner';
import type { ConfigIssue, DeploymentConfig } from '../config';
import type { WriteState } from '../operations';
import { recordOwnerModule } from '../load-trace';
import { log } from '../log';

// Owner's revision store (#3, items 19 and 21), over PORTFOLIO_DATA_DIR, and
// the reader owner's visitors are served through. Until #3's Slice 3 imports
// the mounted documents at first start, an empty store serves them, so
// production owner keeps serving what it did; once a revision is published,
// the data directory is authoritative and the reader serves it, a publish
// from another process included. The startup requirements run its checks:
// data.directory's preflight and server claim, then revision.integrity's
// repair, the live revision's hashes, render drift, and the state. Typed by
// shape, so this module doesn't import the composition root.
//
// Studio's handlers get the store only as a StudioStore, which acts as the
// owner, whose pointer moves hold the session (#2), and never as the
// operator, which skips the hold and is the CLI's alone. Each of its writes
// first makes sure this server holds the data directory's claim, and
// finishes a startup repair that didn't: while either still fails, owner
// writes stop with store.writes.stopped, and visitors are served what the
// reader can serve.
//
// Startup never stops over the publication lock. When the CLI holds it, as
// through a long backup, the claim waits past the lock's 5 s, and the
// server starts anyway, serving visitors, and claims the directory and
// finishes the repair in the background, with backoff, once the lock is
// free. Owner writes wait until then.

recordOwnerModule('server/owner/store');

const KEY = 'PORTFOLIO_DATA_DIR';
/** How often readiness may run the data directory's probe. */
export const PROBE_INTERVAL_MS = 30_000;
/** How long the background claim waits between tries: each in turn, then the last again and again. */
export const CLAIM_RETRY_MS: readonly number[] = Object.freeze([
  1_000, 2_000, 4_000, 8_000, 16_000, 30_000,
]);

export interface OwnerStoreInput {
  readonly config: DeploymentConfig;
  /** The build's checks, on the deployment's origin. */
  readonly checks: UnitChecks;
  /** What serves while nothing is published: the mounted documents, until Slice 3's first-start import. */
  readonly documents: CatalogReader;
  /** Where a live manifest's rendering differs from the build's. */
  readonly renderDrift?: (rendering: Rendering) => readonly RenderDrift[];
  /** The composition root's: whether visitor pages can render. */
  readonly setServable: (servable: boolean) => void;
  /** Where publication events join #2's audit log. Defaults to the data directory's. */
  readonly audit?: AuditSink;
  readonly now?: () => number;
  /** Tests' timings, in place of the store's: the lock's wait, the claim's refresh, and its retries. */
  readonly timing?: {
    readonly lockWaitMs?: number;
    readonly claimRefreshMs?: number;
    readonly claimRetryMs?: readonly number[];
  };
}

/** A pointer move's context: the request, and the owner's session held through the move. */
export interface OwnerMoveContext {
  readonly requestId?: string;
  readonly holdSession: NonNullable<PublicationContext['holdSession']>;
}

/** The store as Studio's handlers use it: as the owner, and only so. */
export interface StudioStore {
  /** What serves, and the pointer behind it, as the reader decided for this pointer. */
  status(): Promise<CatalogStatus>;
  history(page: ListPage): Promise<readonly PublicationEvent[]>;
  revisions(page: ListPage): Promise<readonly RevisionSummary[]>;
  revision(revisionId: RevisionId): Promise<RevisionDetail | null>;
  getWorking(): Promise<Draft | null>;
  getDraft(draftId: DraftId): Promise<Draft | null>;
  createDraft(input: {
    readonly expectedVersion?: number;
    readonly fromRevisionId?: RevisionId;
  }): Promise<DraftOutcome>;
  saveDraft(input: {
    readonly draftId: DraftId;
    readonly expectedVersion: number;
    readonly documents: UnitInput;
  }): Promise<DraftOutcome>;
  applyEdits(input: {
    readonly draftId: DraftId;
    readonly expectedVersion: number;
    readonly edits: readonly DraftEdit[];
  }): Promise<DraftOutcome>;
  rebaseDraft(input: {
    readonly draftId: DraftId;
    readonly expectedVersion: number;
    readonly documents: UnitInput;
    readonly baseRevisionId: RevisionId | null;
  }): Promise<DraftOutcome>;
  discardDraft(input: {
    readonly draftId: DraftId;
    readonly expectedVersion?: number;
  }): Promise<DiscardOutcome>;
  publish(input: PublishInput, context: OwnerMoveContext): Promise<PublicationOutcome>;
  rollback(input: RollbackInput, context: OwnerMoveContext): Promise<PublicationOutcome>;
  recover(input: RecoverInput, context: OwnerMoveContext): Promise<PublicationOutcome>;
}

export interface OwnerStore {
  readonly store: Store;
  readonly reader: RevisionCatalogReader;
  /** The store for Studio's handlers. */
  readonly studio: StudioStore;
  /** data.directory's #3 half: the preflight, then publication/server.json. */
  checkDirectory(): Promise<readonly ConfigIssue[]>;
  /** revision.integrity: startup repair, then the live revision as the reader serves it. */
  checkIntegrity(): Promise<readonly ConfigIssue[]>;
  /** Readiness's data-directory check: item 3's write, sync, and rename probe, run at most every 30 s. */
  probe(): Promise<boolean>;
  /** Whether owner writes go through now, and why not, for config.status. */
  writes(): WriteState;
  /** Lets publication/server.json go, at once, as the process exits. */
  release(): void;
}

/** What startup can find wrong with the data directory or the store in it. */
type FindingCode =
  | PreflightCode
  | 'data_dir_in_use'
  | 'data_dir_unclaimed'
  | 'store_repair_failed'
  | 'revision_damaged'
  | 'revision_unservable';

const MESSAGES: Readonly<Record<FindingCode, string>> = {
  data_dir_missing: 'PORTFOLIO_DATA_DIR names no directory. Create it, or mount a volume there.',
  data_dir_unreachable:
    "The server can't reach PORTFOLIO_DATA_DIR: a directory above it doesn't let the server's " +
    'user look in, or a link loops.',
  data_dir_not_private:
    'Another user owns PORTFOLIO_DATA_DIR, or its group or anyone may write it, so someone else ' +
    "could swap a directory in it. Make it the server's own, at 0700, as the image does for " +
    '/var/lib/portfolio.',
  data_dir_linked:
    'A store directory in PORTFOLIO_DATA_DIR, such as drafts/, is a symbolic link, and the store ' +
    'never writes through one. Put the directory itself there.',
  data_dir_not_writable:
    "The server can't write in PORTFOLIO_DATA_DIR. Give the server's user (uid 1001 in the " +
    'image) write access, as the image does for /var/lib/portfolio.',
  data_dir_rename_failed:
    "The server can't rename files in PORTFOLIO_DATA_DIR. Use a local Linux volume.",
  data_dir_in_source:
    'PORTFOLIO_DATA_DIR is inside PORTFOLIO_SOURCE_DIR, or holds it. Keep the data directory ' +
    'apart from the mounted documents.',
  store_layout_unsupported:
    'PORTFOLIO_DATA_DIR holds a store in a layout this build does not read. Run the build that ' +
    'wrote it, or restore a backup taken with this one.',
  data_dir_in_use:
    'Another owner server holds PORTFOLIO_DATA_DIR. Stop it first: one server runs per data ' +
    'directory. A claim its server stopped refreshing is free after 45 seconds.',
  data_dir_unclaimed:
    'The publication lock stayed busy, as while the CLI takes a backup, so this server has not ' +
    'claimed PORTFOLIO_DATA_DIR yet. It serves visitors, and claims the directory and finishes ' +
    'its repair once the lock is free; owner writes wait until then. The store.server.claimed ' +
    'line says when.',
  store_repair_failed:
    "The store's startup repair didn't finish, so what a crash left is still there. Visitors " +
    'are served what can be served, and owner writes stop until the repair finishes, which ' +
    'each write tries first. The store.writes.stopped line says why.',
  revision_damaged:
    "The live revision can't be served, so the last known good is served in its place. Recover " +
    'or roll back to a revision this build serves. The store.catalog.degraded line says why.',
  revision_unservable:
    'No published revision can be served, so visitors get 503. Publish a revision, or restore a ' +
    'backup. The store.catalog.incompatible line says why.',
};

function finding(code: FindingCode, severity: ConfigIssue['severity'] = 'fatal'): ConfigIssue {
  return { severity, key: KEY, code, message: MESSAGES[code] };
}

// The stores this module made, so a requirement check can tell one from any
// other object in its context.
const stores = new WeakSet<OwnerStore>();

/** The owner store in a requirement's context, if the owner branch put one there. */
export function ownerStoreOf(value: unknown): OwnerStore | undefined {
  return typeof value === 'object' && value !== null && stores.has(value as OwnerStore)
    ? (value as OwnerStore)
    : undefined;
}

/** Store log lines through the server's log: IDs, seq, stage, duration, and drift, never content. */
const storeLog = (entry: StoreLogEntry) => log({ ...entry });

/** A StoreError's code alone: a cause can carry a path. */
const codeOf = (error: unknown): StoreErrorCode =>
  error instanceof StoreError ? error.code : 'storage_unavailable';

/**
 * The data directory by its real path, found once, so the lock's turns and
 * the claim key one spelling of it; as given, resolved, while it isn't
 * there yet, as `next dev`'s .data before startup makes it.
 */
function realDataDir(dataDir: string): string {
  try {
    return realpathSync(dataDir);
  } catch {
    return path.resolve(dataDir);
  }
}

/** Who Studio acts as. The operator, who skips the session hold, is the CLI's alone. */
const OWNER: StoreActor = 'owner';

/** A pointer move's context, refused without the session hold. */
function held(context: OwnerMoveContext): PublicationContext {
  if (typeof context?.holdSession !== 'function') {
    throw new TypeError("A Studio pointer move holds the owner's session.");
  }
  return {
    holdSession: context.holdSession,
    ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
  };
}

/**
 * The store as the owner, and only as the owner: no method takes an actor,
 * and every pointer move needs the session hold. `writable` runs before
 * each write.
 */
export function studioStore(
  store: Store,
  reader: RevisionCatalogReader,
  writable: () => Promise<void>,
): StudioStore {
  const { drafts, publication } = store;
  const write =
    <I, O>(run: (input: I) => Promise<O>) =>
    async (input: I): Promise<O> => {
      await writable();
      return run(input);
    };
  const move =
    <I>(
      run: (
        input: I,
        actor: StoreActor,
        context: PublicationContext,
      ) => Promise<PublicationOutcome>,
    ) =>
    async (input: I, context: OwnerMoveContext): Promise<PublicationOutcome> => {
      const checked = held(context);
      await writable();
      return run(input, OWNER, checked);
    };
  return Object.freeze({
    status: () => reader.status(),
    history: (page: ListPage) => publication.history(page),
    revisions: (page: ListPage) => publication.revisions(page),
    revision: (revisionId: RevisionId) => publication.revision(revisionId),
    getWorking: () => drafts.getWorking(),
    getDraft: (draftId: DraftId) => drafts.get(draftId),
    createDraft: write((input: Parameters<StudioStore['createDraft']>[0]) =>
      drafts.create(input, OWNER),
    ),
    saveDraft: write((input: Parameters<StudioStore['saveDraft']>[0]) => drafts.save(input, OWNER)),
    applyEdits: write((input: Parameters<StudioStore['applyEdits']>[0]) =>
      drafts.applyEdits(input, OWNER),
    ),
    rebaseDraft: write((input: Parameters<StudioStore['rebaseDraft']>[0]) =>
      drafts.rebase(input, OWNER),
    ),
    discardDraft: write((input: Parameters<StudioStore['discardDraft']>[0]) =>
      drafts.discard(input, OWNER),
    ),
    publish: move<PublishInput>((input, actor, context) =>
      publication.publish(input, actor, context),
    ),
    rollback: move<RollbackInput>((input, actor, context) =>
      publication.rollback(input, actor, context),
    ),
    recover: move<RecoverInput>((input, actor, context) =>
      publication.recover(input, actor, context),
    ),
  });
}

export function ownerStore({
  config,
  checks,
  documents,
  renderDrift,
  setServable,
  audit,
  now,
  timing = {},
}: OwnerStoreInput): OwnerStore {
  // The data.directory requirement refuses startup without one.
  const dataDir = realDataDir(config.dataDir ?? '');
  const store = openStore({
    dataDir,
    checks,
    log: storeLog,
    ...(timing.lockWaitMs === undefined ? {} : { lockWaitMs: timing.lockWaitMs }),
    audit:
      audit ??
      filesystemAuditSink({ dataDir, ...(now ? { now } : {}), log: (entry) => log(entry) }),
    ...(now ? { now } : {}),
  });
  const reader = revisionCatalogReader({
    dataDir,
    checks,
    whenEmpty: documents,
    ...(renderDrift ? { renderDrift } : {}),
    setServable,
    log: storeLog,
  });
  let claim: ServerClaim | undefined;
  let claiming: Promise<ServerClaim> | undefined;
  let retry: NodeJS.Timeout | undefined;
  let preflighted = false;
  let probed: { readonly at: number; readonly result: Promise<boolean> } | undefined;
  const clock = now ?? Date.now;
  const retryMs = timing.claimRetryMs ?? CLAIM_RETRY_MS;
  // Set when startup repair fails, or waits for the claim: each write tries
  // it again first, and stops while it still fails.
  let repairPending = false;
  let repairing: Promise<void> | undefined;

  /**
   * This server's claim on the data directory: the one it holds, or a new
   * one taken now. It throws the StoreError that says why not: the lock
   * still busy (lock_timeout), or another server holding the directory
   * (data_dir_in_use). One try at a time.
   */
  function ensureClaim(): Promise<ServerClaim> {
    if (claim?.held) return Promise.resolve(claim);
    claiming ??= claimServer({
      paths: store.paths,
      lock: store.lock,
      log: storeLog,
      ...(timing.claimRefreshMs === undefined ? {} : { refreshMs: timing.claimRefreshMs }),
    })
      .then((claimed) => {
        if (!claimed.ok) {
          throw new StoreError(
            'data_dir_in_use',
            'Another owner server holds this data directory.',
          );
        }
        claim = claimed.claim;
        return claimed.claim;
      })
      .finally(() => {
        claiming = undefined;
      });
    return claiming;
  }

  /** The repair startup couldn't finish, one run at a time. */
  function finishRepair(): Promise<void> {
    repairing ??= store.publication
      .repair()
      .then(() => {
        repairPending = false;
        log({ level: 'info', event: 'store.repair.finished' });
      })
      .finally(() => {
        repairing = undefined;
      });
    return repairing;
  }

  /** Before a write: the claim, and the startup repair that didn't finish, done now, or the write stops. */
  async function writable(): Promise<void> {
    let code: StoreErrorCode;
    try {
      await ensureClaim();
      if (repairPending) await finishRepair();
      return;
    } catch (error) {
      code = codeOf(error);
    }
    log({ level: 'error', event: 'store.writes.stopped', code });
    throw new StoreError(
      code,
      "Owner writes stop until this server holds the data directory and the store's repair finishes.",
    );
  }

  /**
   * After startup found the lock busy: claims the directory, then finishes
   * the repair, trying again with backoff while the lock stays busy. It
   * stops once another server holds the directory, where each write tries
   * the claim again, and leaves a repair that fails to the writes too.
   */
  function claimInBackground(attempt: number): void {
    if (retry) return;
    retry = setTimeout(
      () => {
        retry = undefined;
        ensureClaim().then(
          () => {
            log({ level: 'info', event: 'store.server.claimed' });
            if (repairPending) finishRepair().catch(() => {});
          },
          (error: unknown) => {
            const code = codeOf(error);
            if (code === 'data_dir_in_use') {
              log({ level: 'error', event: 'store.server.claim_refused', code });
              return;
            }
            log({ level: 'warn', event: 'store.server.claim_waiting', code });
            claimInBackground(attempt + 1);
          },
        );
      },
      retryMs[Math.min(attempt, retryMs.length - 1)],
    );
    retry.unref();
  }

  const owner: OwnerStore = Object.freeze({
    store,
    reader,
    studio: studioStore(store, reader, writable),
    async checkDirectory() {
      const problem = await preflight({ dataDir, sourceDir: config.sourceDir });
      if (problem) return [finding(problem)];
      preflighted = true;
      try {
        await ensureClaim();
        return [];
      } catch (error) {
        if (!(error instanceof StoreError)) throw error;
        if (error.code === 'data_dir_in_use') return [finding('data_dir_in_use')];
        // The lock stayed busy: start anyway, and claim it once it's free.
        log({ level: 'warn', event: 'store.server.claim_waiting', code: error.code });
        claimInBackground(0);
        return [finding('data_dir_unclaimed', 'warning')];
      }
    },
    async checkIntegrity() {
      // Nothing to check in a directory that failed its own.
      if (!preflighted) return [];
      const issues: ConfigIssue[] = [];
      if (!claim?.held) {
        // Repair writes, so it waits for the claim, and the claim's retry runs it.
        repairPending = true;
      } else {
        try {
          await store.publication.repair();
        } catch (error) {
          // Visitors are still served what the reader can serve, and owner
          // starts degraded; owner writes wait for the repair, which each one
          // tries again first.
          repairPending = true;
          log({ level: 'warn', event: 'store.repair.failed', code: codeOf(error) });
          issues.push(finding('store_repair_failed'));
        }
      }
      const status = await reader.status();
      if (status.state === 'degraded') issues.push(finding('revision_damaged'));
      if (status.state === 'incompatible') issues.push(finding('revision_unservable'));
      return issues;
    },
    writes(): WriteState {
      if (claim?.lost) return { state: 'stopped', code: 'data_dir_in_use' };
      if (!claim?.held) return { state: 'stopped', code: 'data_dir_unclaimed' };
      if (repairPending) return { state: 'stopped', code: 'store_repair_failed' };
      return { state: 'open' };
    },
    probe() {
      const at = clock();
      if (!probed || at - probed.at >= PROBE_INTERVAL_MS) {
        const result = preflight({ dataDir, sourceDir: config.sourceDir }).then(
          (problem) => problem === null,
          () => false,
        );
        probed = { at, result };
      }
      return probed.result;
    },
    release() {
      if (retry) clearTimeout(retry);
      claim?.releaseSync();
    },
  });
  stores.add(owner);
  return owner;
}
