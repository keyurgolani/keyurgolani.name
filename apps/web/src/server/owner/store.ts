import 'server-only';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type {
  CatalogStatus,
  DocumentInput,
  RenderDrift,
  Rendering,
  UnitChecks,
} from '@portfolio/core';
import { parseMediaDocument, parseSource, type MediaDocument } from '@portfolio/schema';
import {
  claimServer,
  filesystemAuditSink,
  importAtFirstStart,
  importRefusal,
  mountedSource,
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
  type MediaIngestion,
  type ListPage,
  type MountedSource,
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
  type UnitDiagnostic,
  type UnitInput,
} from '@portfolio/core/owner';
import type { Context } from '@portfolio/schema';
import { readPairBytes, type PairFiles } from '@portfolio/schema/node';
import type { ConfigIssue, DeploymentConfig } from '../config';
import type { WriteState } from '../operations';
import { recordOwnerModule } from '../load-trace';
import { log } from '../log';
import { ownerMedia } from './media';

// Owner's revision store (#3, items 19, 21, and 24), over PORTFOLIO_DATA_DIR,
// and the reader owner's visitors are served through. The data directory is
// authoritative: the reader serves what's published, a publish from another
// process included, and an empty store serves nothing, so visitors get 503
// until owner's first-start import commits the mounted pair as revision 1.
// The startup requirements run its checks: data.directory's preflight and
// server claim, revision.integrity's repair, the live revision's hashes,
// render drift, and the state, then documents.shape's first-start import or,
// once a revision exists, the mounted pair's findings as warnings.
// Typed by shape, so this module doesn't import the composition root.
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
// finishes the repair, and a first-start import, in the background, with
// backoff, once the lock is free. Owner writes wait until then.

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
  /**
   * The bundled example pair, which an empty store under next dev imports
   * while PORTFOLIO_SOURCE_DIR holds neither document: only development
   * seeds from it.
   */
  readonly examples?: PairFiles;
  /** What the pair loader goes by to name an old-format record's fix. */
  readonly pairContext?: Context;
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

/**
 * What a draft save's session may do with media (#10), as #1's policy
 * decided for the request: derive renditions (media.ingest), and fetch an
 * https source for them (media.fetchRemote). Without media.ingest a save
 * keeps the media document the draft had.
 */
export interface MediaGrant {
  readonly ingest: boolean;
  readonly fetchRemote: boolean;
}

export const NO_MEDIA: MediaGrant = Object.freeze({ ingest: false, fetchRemote: false });

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
  /**
   * Saves the draft's portfolio and site. Its media document is derived
   * here, never taken from the caller: ingestion's, when `media` allows it,
   * or the one the draft had.
   */
  saveDraft(
    input: {
      readonly draftId: DraftId;
      readonly expectedVersion: number;
      readonly documents: UnitInput;
    },
    media?: MediaGrant,
  ): Promise<DraftOutcome>;
  applyEdits(input: {
    readonly draftId: DraftId;
    readonly expectedVersion: number;
    readonly edits: readonly DraftEdit[];
  }): Promise<DraftOutcome>;
  /** Rebases the draft, its media document derived as saveDraft() derives it. */
  rebaseDraft(
    input: {
      readonly draftId: DraftId;
      readonly expectedVersion: number;
      readonly documents: UnitInput;
      readonly baseRevisionId: RevisionId | null;
    },
    media?: MediaGrant,
  ): Promise<DraftOutcome>;
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
  /**
   * documents.shape (item 24): with an empty store, the first-start import,
   * where a pair that can't go live is fatal; once a revision exists, the
   * mounted pair's findings as warnings.
   */
  checkSource(documents?: MountedFindings): Promise<readonly ConfigIssue[]>;
  /** Readiness's data-directory check: item 3's write, sync, and rename probe, run at most every 30 s. */
  probe(): Promise<boolean>;
  /** Whether owner writes go through now, and why not, for config.status. */
  writes(): WriteState;
  /** Lets publication/server.json go, at once, as the process exits. */
  release(): void;
}

/** What startup found in the mounted pair: whether it can serve, and every finding. */
export interface MountedFindings {
  readonly ok: boolean;
  readonly issues: readonly ConfigIssue[];
}

/** What startup can find wrong with the data directory or the store in it. */
type FindingCode =
  | PreflightCode
  | 'data_dir_in_use'
  | 'data_dir_unclaimed'
  | 'data_dir_claim_failed'
  | 'store_repair_failed'
  | 'revision_damaged'
  | 'revision_unservable'
  | 'store_import_waiting'
  | 'store_import_failed';

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
  data_dir_restore_incomplete:
    'PORTFOLIO_DATA_DIR holds a restore that did not finish, so what is there is part of a ' +
    'store. Restore again with portfolio-store restore, into an empty directory, and point ' +
    'PORTFOLIO_DATA_DIR there: under compose, remove the portfolio-data volume first ' +
    '(docs/deployment.md, Backups).',
  data_dir_in_use:
    'Another owner server holds PORTFOLIO_DATA_DIR. Stop it first: one server runs per data ' +
    'directory. A claim its server stopped refreshing is free after 45 seconds.',
  data_dir_unclaimed:
    'The publication lock stayed busy, as while the CLI takes a backup, so this server has not ' +
    'claimed PORTFOLIO_DATA_DIR yet. It serves visitors, and claims the directory and finishes ' +
    'its repair once the lock is free; owner writes wait until then. The store.server.claimed ' +
    'line says when.',
  data_dir_claim_failed:
    "The server couldn't claim PORTFOLIO_DATA_DIR: reading or writing publication/ failed, as " +
    'when the volume is full or something other than a regular file, such as a link, stands at ' +
    'publication/lock. Free space, or remove what the store did not write there. It serves ' +
    'visitors and tries the claim again; owner writes wait until it holds the directory. The ' +
    'store.server.claim_failed line gives the code.',
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
  store_import_waiting:
    'The store is empty, and the publication lock stayed busy, so the mounted pair is not ' +
    'imported yet. Visitors get 503 until it is: the server imports it as revision 1 once the ' +
    'lock is free, and the store.import.first_start line says when.',
  store_import_failed:
    "The store is empty, and the mounted pair can't go in as revision 1, so nothing can be " +
    'served. A first start publishes it, as portfolio-store import does, and refuses what a ' +
    'publish refuses: the records before this one, or the store.import.failed line, say why.',
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

/** The mounted pair as an import reads it, or #4's findings when it can't be read. */
export type MountedRead =
  | { readonly ok: true; readonly mounted: MountedSource }
  | { readonly ok: false; readonly diagnostics: readonly UnitDiagnostic[] };

/** A record about the mounted pair as a startup issue under PORTFOLIO_SOURCE_DIR. */
function sourceIssue(record: UnitDiagnostic): ConfigIssue {
  return {
    severity: record.severity === 'warning' ? 'warning' : 'fatal',
    key: 'PORTFOLIO_SOURCE_DIR',
    code: record.code,
    document: record.document,
    path: record.pointer,
    ...(record.line === undefined ? {} : { line: record.line, column: record.column }),
    message: record.message,
    remediation: record.remediation,
  };
}

/** A file of the bundled example pair, as an import reads one. */
function exampleFile(file: string) {
  return { name: path.basename(file), bytes: readFileSync(/*turbopackIgnore: true*/ file) };
}

/**
 * How a first-start import went: `done` once it committed or something else
 * went live first, `waiting` while the lock is busy or was taken over, and
 * `failed`, with the findings, when it can't go at all.
 */
type Imported =
  | { readonly kind: 'done' | 'waiting' }
  | { readonly kind: 'failed'; readonly records: readonly UnitDiagnostic[] };

/**
 * Startup's findings for a first start the import refused: its records,
 * fatal where they block a publish, in place of startup's own on the same
 * field, which checked the pair as served, then store_import_failed.
 */
function refusedImport(
  found: readonly ConfigIssue[],
  records: readonly UnitDiagnostic[],
): ConfigIssue[] {
  const issues = records.map(sourceIssue);
  const same = (a: ConfigIssue, b: ConfigIssue) =>
    a.code === b.code && a.document === b.document && a.path === b.path;
  return [
    ...found.filter((issue) => !issues.some((record) => same(issue, record))),
    ...issues,
    finding('store_import_failed'),
  ];
}

/** A draft's media document as a model, or null when it has none that checks. */
function draftMedia(draft: Draft | null): MediaDocument | null {
  const model = draft?.documents.media?.model;
  if (model === undefined || model === null) return null;
  const parsed = parseMediaDocument(model);
  return parsed.ok ? parsed.value : null;
}

/** A media document as the store keeps one: JSON text. */
const mediaInput = (document: MediaDocument): DocumentInput => ({
  format: 'json',
  sourceText: `${JSON.stringify(document, null, 2)}\n`,
});

/** The media document is derived: an edit to it is refused, as one that doesn't apply. */
const MEDIA_EDIT: DraftOutcome = Object.freeze({
  kind: 'rejected',
  code: 'validation_failed',
  diagnostics: Object.freeze([
    Object.freeze({
      code: 'media.derived',
      severity: 'blocks-preview',
      document: 'media',
      pointer: '',
      message: 'The media document is derived from the media entries when the draft is saved.',
      remediation: "Edit the portfolio's media entries, then save the draft.",
    }),
  ]),
}) as DraftOutcome;

/**
 * The store as the owner, and only as the owner: no method takes an actor,
 * and every pointer move needs the session hold. `writable` runs before
 * each write. A save or a rebase derives the draft's media document with
 * `media`, the AssetStore's ingestion (#10); a caller's own media document
 * is never written, and no edit reaches it.
 */
export function studioStore(
  store: Store,
  reader: RevisionCatalogReader,
  writable: () => Promise<void>,
  media?: MediaIngestion,
): StudioStore {
  const { drafts, publication } = store;
  /**
   * `documents` with the media document derived for the draft: ingestion's,
   * from its portfolio and the records the draft had, or those records as
   * they were. A document with no asset in it is left out.
   */
  async function withMedia(
    draftId: DraftId,
    documents: UnitInput,
    grant: MediaGrant,
  ): Promise<UnitInput> {
    // The caller's media document, if it sent one, is never written.
    const authored: UnitInput = { portfolio: documents.portfolio, site: documents.site };
    const draft = await drafts.get(draftId);
    // No draft: the save answers not_found, and nothing is ingested for it.
    if (!draft) return authored;
    const previous = draftMedia(draft);
    let document = previous;
    if (grant.ingest && media) {
      const parsed = parseSource(authored.portfolio.sourceText, authored.portfolio.format);
      const result = await media.ingest({
        portfolio: parsed.ok ? parsed.data : null,
        previous,
        fetchRemote: grant.fetchRemote,
      });
      document = result.document;
    }
    return document && document.assets.length > 0
      ? { ...authored, media: mediaInput(document) }
      : authored;
  }
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
    saveDraft: async (input: Parameters<StudioStore['saveDraft']>[0], grant = NO_MEDIA) => {
      await writable();
      const documents = await withMedia(input.draftId, input.documents, grant);
      return drafts.save({ ...input, documents }, OWNER);
    },
    applyEdits: write((input: Parameters<StudioStore['applyEdits']>[0]) =>
      input.edits.some((edit) => edit.document === 'media')
        ? Promise.resolve(MEDIA_EDIT)
        : drafts.applyEdits(input, OWNER),
    ),
    rebaseDraft: async (input: Parameters<StudioStore['rebaseDraft']>[0], grant = NO_MEDIA) => {
      await writable();
      const documents = await withMedia(input.draftId, input.documents, grant);
      return drafts.rebase({ ...input, documents }, OWNER);
    },
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
  examples,
  pairContext = {},
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
  // Set when the first-start import waits for the lock: the background claim
  // runs it once the lock is free.
  let importPending = false;
  let importing: Promise<Imported> | undefined;

  /**
   * The mounted pair as an import reads it: PORTFOLIO_SOURCE_DIR's, or under
   * next dev, while that holds neither document, the bundled examples, as
   * next dev renders them.
   */
  function readMounted(): MountedRead {
    const read = readPairBytes(config.sourceDir ?? '', pairContext);
    if (read.ok) return { ok: true, mounted: mountedSource(read.files) };
    if (config.mode !== 'production' && examples && read.missing?.length === 2) {
      try {
        const portfolio = exampleFile(examples.portfolio);
        const site = exampleFile(examples.site);
        return { ok: true, mounted: mountedSource({ portfolio, site }) };
      } catch {
        // The build's own files, so only a broken checkout gets here.
      }
    }
    return { ok: false, diagnostics: read.diagnostics };
  }

  /** One first-start import: the mounted pair as revision 1, unless something is live. */
  async function importOnce(): Promise<Imported> {
    const read = readMounted();
    if (!read.ok) {
      log({ level: 'error', event: 'store.import.failed', code: 'source_unreadable' });
      return { kind: 'failed', records: read.diagnostics };
    }
    let outcome: PublicationOutcome;
    try {
      outcome = await importAtFirstStart(store, read.mounted);
    } catch (error) {
      const code = codeOf(error);
      if (code === 'lock_timeout') return { kind: 'waiting' };
      log({ level: 'error', event: 'store.import.failed', code });
      return { kind: 'failed', records: [] };
    }
    if (outcome.kind === 'rejected') {
      // The CLI took the lock over in between: import once it's free.
      if (outcome.code === 'lock_lost') return { kind: 'waiting' };
      log({ level: 'error', event: 'store.import.failed', code: outcome.code });
      return { kind: 'failed', records: outcome.diagnostics };
    }
    if (outcome.kind === 'committed') {
      log({
        level: 'info',
        event: 'store.import.first_start',
        revisionId: outcome.revisionId,
        seq: outcome.seq,
      });
    } else {
      // Something went live first, as through the CLI's own import.
      log({ level: 'info', event: 'store.import.not_needed', code: outcome.code });
    }
    // The reader decides again, so visitors are served from now on.
    await reader.status().catch(() => {});
    return { kind: 'done' };
  }

  /** The first-start import, one run at a time; still pending while it waits for the lock. */
  function finishImport(): Promise<Imported> {
    importing ??= importOnce()
      .then((imported) => {
        importPending = imported.kind === 'waiting';
        return imported;
      })
      .finally(() => {
        importing = undefined;
      });
    return importing;
  }

  /** Once the claim is held: the repair startup couldn't finish, then a first-start import. */
  async function settle(attempt: number): Promise<void> {
    if (repairPending) await finishRepair().catch(() => {});
    if (importPending && (await finishImport()).kind === 'waiting') claimInBackground(attempt + 1);
  }

  /**
   * This server's claim on the data directory: the one it holds, or a new
   * one taken now. It throws the StoreError that says why not: the lock
   * still busy (lock_timeout), another server holding the directory
   * (data_dir_in_use), or publication/ that can't be read or written
   * (storage_unavailable, storage_full). One try at a time.
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
   * Why the claim waits, by its own event: the lock stayed busy
   * (claim_waiting), or publication/ couldn't be read or written
   * (claim_failed), as when something other than a regular file stands at
   * the lock's name.
   */
  function logClaimDelay(code: StoreErrorCode): void {
    const event =
      code === 'lock_timeout' ? 'store.server.claim_waiting' : 'store.server.claim_failed';
    log({ level: 'warn', event, code });
  }

  /**
   * After startup couldn't claim the directory, with the lock busy or
   * publication/ failing: claims it, then finishes the repair, trying again
   * with backoff while that lasts. It stops once another server holds the
   * directory, where each write tries the claim again, and leaves a repair
   * that fails to the writes too.
   */
  function claimInBackground(attempt: number): void {
    if (retry) return;
    retry = setTimeout(
      () => {
        retry = undefined;
        const claimed = claim?.held === true;
        ensureClaim().then(
          () => {
            if (!claimed) log({ level: 'info', event: 'store.server.claimed' });
            void settle(attempt);
          },
          (error: unknown) => {
            const code = codeOf(error);
            if (code === 'data_dir_in_use') {
              log({ level: 'error', event: 'store.server.claim_refused', code });
              return;
            }
            logClaimDelay(code);
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
    studio: studioStore(store, reader, writable, ownerMedia({ config, assets: store.assets })),
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
        // The lock stayed busy, or publication/ couldn't be read or written:
        // start anyway, and claim the directory once it can be.
        logClaimDelay(error.code);
        claimInBackground(0);
        const busy = error.code === 'lock_timeout';
        return [finding(busy ? 'data_dir_unclaimed' : 'data_dir_claim_failed', 'warning')];
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
      // The reader keeps a failure as nothing servable; anything it throws
      // all the same starts owner degraded too, never stopped.
      const state = await reader.status().then(
        (status) => status.state,
        () => 'incompatible' as const,
      );
      if (state === 'degraded') issues.push(finding('revision_damaged'));
      if (state === 'incompatible') issues.push(finding('revision_unservable'));
      return issues;
    },
    async checkSource(documents?: MountedFindings) {
      // Nothing to import into a directory that failed its own check.
      if (!preflighted) return [];
      const found = documents?.issues ?? [];
      const status = await reader.status();
      // Empty only with no live.json and no history, an event or a
      // tombstone (Slice 2's hasHistory()): the reader serves the last known
      // good of a store that has published and lost its pointer, and nothing
      // imports over it. A revision alone was never live, and imports.
      const first = status.state === 'empty' && (await store.publication.isEmpty());
      if (!first) {
        // The data directory is authoritative now: what's wrong with the
        // mounted pair only warns, since it's import input.
        return found.map((issue): ConfigIssue =>
          issue.severity === 'fatal' ? { ...issue, severity: 'warning' } : issue,
        );
      }
      // First start: the mounted pair is what goes live, so one that can't
      // serve, an old-format one, or the bundled sample in production, stops
      // startup, as it always has.
      if (documents && !documents.ok) return found;
      // The import is a publish, as portfolio-store import's is: what a
      // publish refuses, such as a variant this build doesn't register,
      // stops startup now, before any wait for the lock.
      const read = readMounted();
      if (!read.ok) return refusedImport(found, read.diagnostics);
      const refusal = importRefusal(read.mounted, checks);
      if (refusal.length > 0) return refusedImport(found, refusal);
      if (!claim?.held) {
        // Another server holds the directory, which data.directory reports.
        if (!retry && !claiming) return found;
        // The background claim imports it once the lock is free.
        importPending = true;
        return [...found, finding('store_import_waiting', 'warning')];
      }
      importPending = true;
      const imported = await finishImport();
      switch (imported.kind) {
        case 'done':
          return found;
        case 'waiting':
          claimInBackground(0);
          return [...found, finding('store_import_waiting', 'warning')];
        case 'failed':
          return refusedImport(found, imported.records);
      }
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
