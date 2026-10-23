import { applyEdits as applyTextEdits, type DocumentFormat } from '@portfolio/schema';
import { recordOwnerModule } from '../load-trace';
import {
  emitStoreEvent,
  isStoreActor,
  storageError,
  StoreError,
  type StoreActor,
  type StoreLog,
} from './common';
import type { CrashPoint, FsPort } from './fs-port';
import {
  isDraftId,
  isRevisionId,
  isSha256,
  newDraftId,
  tempBeside,
  type DraftId,
  type RevisionId,
  type Sha256,
  type StorePaths,
} from './layout';
import { LockLostError, type PublicationLock } from './lock';
import { DamagedPointerError, readLive, type LivePointer } from './pointer';
import { readManifest, readRevision } from './revisions';
import type { AssetStore } from './assets';
import {
  diagnoseUnit,
  DOCUMENT_NAMES,
  oversize,
  type DocumentInput,
  type DocumentName,
  type UnitChecks,
  type UnitDiagnostic,
  type UnitInput,
} from '../catalog/unit';

// The DraftStore (#3, items 15 and 16): the owner's working copy, in
// drafts/<draftId>.json. A draft holds each document's text as the owner
// wrote it, its parsed data, and the validator's findings, so an invalid
// draft saves; only a publish needs a unit that validates. There is one
// working draft at a time. Each write is a new version, written to a
// temporary file, synced, and renamed over the draft, with the version it
// replaces kept as <draftId>.prev.json. A write names the version it
// replaces and gets draft_conflict when that's no longer the draft's. Every
// draft command runs under the publication lock, and none of them touches
// the published pointer.

recordOwnerModule('core/store/drafts');

/** The draft file's format, in its `draftFormat` field. */
export const DRAFT_FORMAT = 1;

export interface DraftDocument {
  readonly format: DocumentFormat;
  readonly sourceText: string;
  /** The text's parsed data, or null when it doesn't parse. */
  readonly model: unknown;
  readonly diagnostics: readonly UnitDiagnostic[];
}

export type DraftDocuments = Readonly<Partial<Record<DocumentName, DraftDocument>>> & {
  readonly portfolio: DraftDocument;
  readonly site: DraftDocument;
};

export interface Draft {
  readonly draftFormat: typeof DRAFT_FORMAT;
  readonly draftId: DraftId;
  /** 1 for a new draft, and one more with each write. */
  readonly version: number;
  /** The revision that was live when the draft started or was last rebased; null before any. */
  readonly baseRevisionId: RevisionId | null;
  /** ISO 8601. */
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly updatedBy: StoreActor;
  /** A draft imported from source keeps the mounted files' hash for its publish event (#3, item 24). */
  readonly sourceHash?: Sha256;
  readonly documents: DraftDocuments;
}

/** One edit to a draft document by JSON pointer, as #4's applyEdits takes it. */
export interface DraftEdit {
  readonly document: DocumentName;
  readonly pointer: string;
  readonly op: 'set' | 'delete';
  readonly value?: unknown;
}

export interface DraftConflict {
  readonly kind: 'conflict';
  readonly code: 'draft_conflict';
  readonly draftId: DraftId;
  /** The draft's version now, and its documents, so Studio can show what changed. */
  readonly version: number;
  readonly documents: DraftDocuments;
}

export interface LiveConflict {
  readonly kind: 'conflict';
  readonly code: 'live_conflict';
  readonly liveRevisionId: RevisionId | null;
  /** The unitHash of the revision the caller expected, or null when there's none. */
  readonly baseHash: Sha256 | null;
  readonly liveHash: Sha256 | null;
  /** For a publish: the draft's unitHash, or null when it doesn't validate. */
  readonly draftHash?: Sha256 | null;
}

export interface Rejection<Code extends string> {
  readonly kind: 'rejected';
  readonly code: Code;
  readonly diagnostics: readonly UnitDiagnostic[];
  /** For payload_too_large: the documents past the 1 MiB cap. */
  readonly documents?: readonly DocumentName[];
  /** For asset_missing: the referenced blobs the AssetStore doesn't hold. */
  readonly blobs?: readonly Sha256[];
}

/**
 * `lock_lost`: the publication lock was broken and retaken while the write
 * held it, and nothing was written. A retry is safe.
 */
export type DraftRejection = Rejection<
  'payload_too_large' | 'asset_missing' | 'validation_failed' | 'not_found' | 'lock_lost'
>;

export type DraftOutcome =
  { readonly kind: 'saved'; readonly draft: Draft } | DraftRejection | DraftConflict | LiveConflict;

export type DiscardOutcome =
  | { readonly kind: 'discarded'; readonly draftId: DraftId }
  | Rejection<'not_found' | 'lock_lost'>
  | DraftConflict;

export interface CreateDraftInput {
  /** Required while a working draft exists: its version, which this replaces. */
  readonly expectedVersion?: number;
  /** Restore into draft: start from this revision's documents instead of live's. */
  readonly fromRevisionId?: RevisionId;
  /** Start from these documents instead, as `draft.importSource` does (Slice 3). */
  readonly documents?: UnitInput;
  /** The mounted files' hash, for a draft imported from source. */
  readonly sourceHash?: Sha256;
}

export interface DraftStore {
  /** The working draft, or null when there's none. */
  getWorking(): Promise<Draft | null>;
  get(draftId: DraftId): Promise<Draft | null>;
  /**
   * Starts the working draft from live, a chosen revision, or given
   * documents. While one exists, it replaces that draft's documents as a new
   * version, with live as the base.
   */
  create(input: CreateDraftInput, actor: StoreActor): Promise<DraftOutcome>;
  save(
    input: {
      readonly draftId: DraftId;
      readonly expectedVersion: number;
      readonly documents: UnitInput;
    },
    actor: StoreActor,
  ): Promise<DraftOutcome>;
  /** Applies the edits to each document's text in order, as one new version. */
  applyEdits(
    input: {
      readonly draftId: DraftId;
      readonly expectedVersion: number;
      readonly edits: readonly DraftEdit[];
    },
    actor: StoreActor,
  ): Promise<DraftOutcome>;
  /** Saves `documents` on a new base, which must be live. */
  rebase(
    input: {
      readonly draftId: DraftId;
      readonly expectedVersion: number;
      readonly documents: UnitInput;
      readonly baseRevisionId: RevisionId | null;
    },
    actor: StoreActor,
  ): Promise<DraftOutcome>;
  /** Deletes the draft and its previous version. */
  discard(
    input: { readonly draftId: DraftId; readonly expectedVersion?: number },
    actor: StoreActor,
  ): Promise<DiscardOutcome>;
}

const DRAFT_FILE = /^(drf_[0-9a-f]{32})\.json$/;

function isDiagnostic(value: unknown): value is UnitDiagnostic {
  const diagnostic = value as Record<string, unknown> | null;
  return (
    diagnostic !== null &&
    typeof diagnostic === 'object' &&
    typeof diagnostic.code === 'string' &&
    typeof diagnostic.severity === 'string' &&
    (DOCUMENT_NAMES as readonly unknown[]).includes(diagnostic.document) &&
    typeof diagnostic.pointer === 'string' &&
    typeof diagnostic.message === 'string'
  );
}

function asDraftDocument(value: unknown): DraftDocument | null {
  const document = value as Record<string, unknown> | null;
  if (document === null || typeof document !== 'object') return null;
  const ok =
    (document.format === 'yaml' || document.format === 'json') &&
    typeof document.sourceText === 'string' &&
    'model' in document &&
    Array.isArray(document.diagnostics) &&
    document.diagnostics.every(isDiagnostic);
  return ok ? (document as unknown as DraftDocument) : null;
}

/** The draft in `value`, or null when it isn't one. */
export function asDraft(value: unknown): Draft | null {
  const draft = value as Record<string, unknown> | null;
  if (draft === null || typeof draft !== 'object') return null;
  const documents = draft.documents as Record<string, unknown> | null | undefined;
  const ok =
    draft.draftFormat === DRAFT_FORMAT &&
    isDraftId(draft.draftId) &&
    Number.isSafeInteger(draft.version) &&
    (draft.version as number) >= 1 &&
    (draft.baseRevisionId === null || isRevisionId(draft.baseRevisionId)) &&
    typeof draft.createdAt === 'string' &&
    typeof draft.updatedAt === 'string' &&
    isStoreActor(draft.updatedBy) &&
    (draft.sourceHash === undefined || isSha256(draft.sourceHash)) &&
    documents !== null &&
    typeof documents === 'object' &&
    asDraftDocument(documents.portfolio) !== null &&
    asDraftDocument(documents.site) !== null &&
    (documents.media === undefined || asDraftDocument(documents.media) !== null) &&
    Object.keys(documents).every((name) => (DOCUMENT_NAMES as readonly string[]).includes(name));
  return ok ? (draft as unknown as Draft) : null;
}

const serialize = (draft: Draft) => `${JSON.stringify(draft)}\n`;

function parse(text: string): Draft | null {
  try {
    return asDraft(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

/** A draft as read, with the text it was read from, so a write can keep it as the previous version. */
export interface ReadDraft {
  readonly draft: Draft;
  readonly text: string;
}

async function readText(fs: FsPort, file: string): Promise<string | null> {
  try {
    return (await fs.readFile(file)).toString('utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Reads drafts/<draftId>.json, or null when there's no such draft. When the
 * file is there but isn't a draft, it reads the previous version instead.
 */
export async function readDraft(
  fs: FsPort,
  paths: StorePaths,
  draftId: DraftId,
  log: StoreLog = () => {},
): Promise<ReadDraft | null> {
  if (!isDraftId(draftId)) return null;
  const text = await readText(fs, paths.draft(draftId));
  if (text === null) return null;
  const draft = parse(text);
  if (draft?.draftId === draftId) return { draft, text };
  const previousText = await readText(fs, paths.draftPrevious(draftId));
  const previous = previousText === null ? null : parse(previousText);
  if (previousText !== null && previous?.draftId === draftId) {
    log({ level: 'warn', event: 'store.draft.previous_version', code: 'draft_unreadable' });
    return { draft: previous, text: previousText };
  }
  log({ level: 'error', event: 'store.draft.unreadable', code: 'draft_unreadable' });
  return null;
}

/** The IDs of the drafts in drafts/. */
export async function draftIds(fs: FsPort, paths: StorePaths): Promise<DraftId[]> {
  const ids: DraftId[] = [];
  for (const name of await fs.readdir(paths.drafts)) {
    const match = DRAFT_FILE.exec(name);
    if (match) ids.push(match[1] as DraftId);
  }
  return ids.sort();
}

/** The working draft, or null. Should a crash ever leave two, the latest one. */
export async function readWorkingDraft(
  fs: FsPort,
  paths: StorePaths,
  log: StoreLog = () => {},
): Promise<ReadDraft | null> {
  let working: ReadDraft | null = null;
  for (const id of await draftIds(fs, paths)) {
    const found = await readDraft(fs, paths, id, log);
    if (!found) continue;
    if (working) log({ level: 'warn', event: 'store.draft.several', code: 'drafts_several' });
    if (!working || found.draft.updatedAt > working.draft.updatedAt) working = found;
  }
  return working;
}

/**
 * Writes `draft` over drafts/<draftId>.json: a synced temporary file,
 * renamed into place once `previousText`, the version it replaces, is
 * synced and renamed to <draftId>.prev.json, then drafts/ synced. The
 * caller holds the publication lock, and `fence` checks it still does
 * before each rename; a LockLostError from it leaves the draft as it was.
 */
export async function writeDraft(
  fs: FsPort,
  paths: StorePaths,
  draft: Draft,
  previousText: string | null,
  operation: string,
  fence: () => Promise<void> = async () => {},
): Promise<void> {
  const file = paths.draft(draft.draftId);
  const temp = tempBeside(file);
  const point = (step: string): CrashPoint => `${operation}.${step}`;
  let previousTemp: string | undefined;
  try {
    await fs.writeFile(temp, serialize(draft), point('write'));
    await fs.fsync(temp, point('fsync'));
    if (previousText !== null) {
      const previous = paths.draftPrevious(draft.draftId);
      previousTemp = tempBeside(previous);
      await fs.writeFile(previousTemp, previousText, point('prev.write'));
      await fs.fsync(previousTemp, point('prev.fsync'));
      await fence();
      await fs.rename(previousTemp, previous, point('prev.rename'));
      previousTemp = undefined;
    }
    await fence();
    await fs.rename(temp, file, point('rename'));
    await fs.fsync(paths.drafts, point('dir.fsync'));
  } catch (error) {
    await fs.remove(temp, point('temp.remove')).catch(() => {});
    if (previousTemp) await fs.remove(previousTemp, point('temp.remove')).catch(() => {});
    if (error instanceof LockLostError) throw error;
    throw storageError(error);
  }
}

/** Deletes a draft and its previous version, then syncs drafts/. The caller holds the lock. */
export async function removeDraft(
  fs: FsPort,
  paths: StorePaths,
  draftId: DraftId,
  operation: string,
): Promise<void> {
  // The previous version goes first, so a crash between the two leaves a
  // whole draft, never a lone previous version.
  await fs.remove(paths.draftPrevious(draftId), `${operation}.prev.remove`);
  await fs.remove(paths.draft(draftId), `${operation}.remove`);
  await fs.fsync(paths.drafts, `${operation}.dir.fsync`);
}

/** The documents a draft holds, as a unit's input. */
export function draftInput(draft: Draft): UnitInput {
  const input = (document: DraftDocument): DocumentInput => ({
    format: document.format,
    sourceText: document.sourceText,
  });
  return {
    portfolio: input(draft.documents.portfolio),
    site: input(draft.documents.site),
    ...(draft.documents.media ? { media: input(draft.documents.media) } : {}),
  };
}

/** `documents`, checked to be a unit's input: each document's format and text, and no other document. */
export function checkedInput(documents: UnitInput): UnitInput {
  const one = (document: DocumentInput | undefined, name: DocumentName): DocumentInput => {
    if (
      document === null ||
      typeof document !== 'object' ||
      (document.format !== 'yaml' && document.format !== 'json') ||
      typeof document.sourceText !== 'string'
    ) {
      throw new TypeError(`The ${name} document needs a format and its text.`);
    }
    return { format: document.format, sourceText: document.sourceText };
  };
  if (documents === null || typeof documents !== 'object') {
    throw new TypeError('A draft needs its documents.');
  }
  for (const name of Object.keys(documents)) {
    if (!(DOCUMENT_NAMES as readonly string[]).includes(name)) {
      throw new TypeError(`A draft has no ${name} document.`);
    }
  }
  return {
    portfolio: one(documents.portfolio, 'portfolio'),
    site: one(documents.site, 'site'),
    ...(documents.media === undefined ? {} : { media: one(documents.media, 'media') }),
  };
}

const editFailed = (document: DocumentName, pointer: string): UnitDiagnostic => ({
  code: 'edit.failed',
  severity: 'blocks-preview',
  document,
  pointer: typeof pointer === 'string' ? pointer : '',
  message: "This edit couldn't apply: the document doesn't parse, or the pointer doesn't fit it.",
  remediation: "Fix the document's text, or edit it as text.",
});

export interface DraftStoreOptions {
  readonly fs: FsPort;
  readonly paths: StorePaths;
  readonly lock: PublicationLock;
  readonly checks: UnitChecks;
  readonly assets: AssetStore;
  readonly now?: () => number;
  readonly log?: StoreLog;
}

export function filesystemDraftStore({
  fs,
  paths,
  lock,
  checks,
  assets,
  now = Date.now,
  log = () => {},
}: DraftStoreOptions): DraftStore {
  const stamp = () => new Date(now()).toISOString();

  async function live(): Promise<LivePointer | null> {
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

  /** The documents of `input` with their parsed data and findings. */
  function documentsOf(input: UnitInput): DraftDocuments {
    const { diagnostics, models } = diagnoseUnit(input, checks);
    const of = (name: DocumentName, document: DocumentInput): DraftDocument => ({
      format: document.format,
      sourceText: document.sourceText,
      model: models[name] ?? null,
      diagnostics: diagnostics.filter((diagnostic) => diagnostic.document === name),
    });
    return {
      portfolio: of('portfolio', input.portfolio),
      site: of('site', input.site),
      ...(input.media ? { media: of('media', input.media) } : {}),
    };
  }

  /** The documents past the 1 MiB cap, which stop a save before anything parses them. */
  function tooLarge(input: UnitInput): DraftRejection | null {
    const large = DOCUMENT_NAMES.filter((name) => {
      const document = input[name];
      return document !== undefined && oversize(document);
    });
    return large.length > 0 ? rejected('payload_too_large', [], { documents: large }) : null;
  }

  /** The blobs the media document references that the AssetStore doesn't hold. */
  async function missingBlobs(documents: DraftDocuments): Promise<DraftRejection | null> {
    const media = documents.media?.model;
    if (media === undefined || media === null) return null;
    const missing: Sha256[] = [];
    for (const blob of new Set(checks.referencedBlobs?.(media) ?? [])) {
      if (!(await assets.has(blob))) missing.push(blob);
    }
    return missing.length > 0 ? rejected('asset_missing', [], { blobs: missing.sort() }) : null;
  }

  function conflict(found: ReadDraft): DraftConflict {
    return {
      kind: 'conflict',
      code: 'draft_conflict',
      draftId: found.draft.draftId,
      version: found.draft.version,
      documents: found.draft.documents,
    };
  }

  async function liveConflict(
    pointer: LivePointer | null,
    expected: RevisionId | null,
  ): Promise<LiveConflict> {
    const base = expected === null ? null : await readManifest(fs, paths, expected);
    return {
      kind: 'conflict',
      code: 'live_conflict',
      liveRevisionId: pointer?.revisionId ?? null,
      baseHash: base?.unitHash ?? null,
      liveHash: pointer?.unitHash ?? null,
    };
  }

  /** Writes `input` as the next version of `found`, or as a new draft. */
  async function commit(
    operation: string,
    found: ReadDraft | null,
    input: UnitInput,
    fields: {
      readonly baseRevisionId: RevisionId | null;
      readonly sourceHash?: Sha256;
      readonly actor: StoreActor;
    },
  ): Promise<DraftOutcome> {
    const large = tooLarge(input);
    if (large) return large;
    const documents = documentsOf(input);
    const missing = await missingBlobs(documents);
    if (missing) return missing;
    const at = stamp();
    const draft: Draft = {
      draftFormat: DRAFT_FORMAT,
      draftId: found?.draft.draftId ?? newDraftId(),
      version: (found?.draft.version ?? 0) + 1,
      baseRevisionId: fields.baseRevisionId,
      createdAt: found?.draft.createdAt ?? at,
      updatedAt: at,
      updatedBy: fields.actor,
      ...(fields.sourceHash === undefined ? {} : { sourceHash: fields.sourceHash }),
      documents,
    };
    await writeDraft(fs, paths, draft, found?.text ?? null, operation, () => lock.fence());
    emitStoreEvent({ name: 'draftSaved', draftId: draft.draftId, version: draft.version });
    return { kind: 'saved', draft };
  }

  function locked<T>(
    operation: string,
    body: () => Promise<T>,
  ): Promise<T | Rejection<'lock_lost'>> {
    return lock.withLock(operation, async () => {
      try {
        return await body();
      } catch (error) {
        if (error instanceof TypeError) throw error;
        if (error instanceof LockLostError) {
          // Broken and retaken while this write held it: nothing was written.
          log({ level: 'error', event: 'store.lock.lost', code: 'lock_lost' });
          return rejected('lock_lost', []);
        }
        const failure = storageError(error);
        log({ level: 'error', event: `store.${operation}.failed`, code: failure.code });
        throw failure;
      }
    });
  }

  async function find(draftId: DraftId): Promise<ReadDraft | null> {
    try {
      return await readDraft(fs, paths, draftId, log);
    } catch (error) {
      throw storageError(error);
    }
  }

  return {
    async getWorking() {
      try {
        return (await readWorkingDraft(fs, paths, log))?.draft ?? null;
      } catch (error) {
        throw storageError(error);
      }
    },

    async get(draftId) {
      return (await find(draftId))?.draft ?? null;
    },

    create(input, actor) {
      return locked('draft.create', async () => {
        const pointer = await live();
        const working = await readWorkingDraft(fs, paths, log);
        if (working && input.expectedVersion !== working.draft.version) return conflict(working);
        let documents: UnitInput;
        if (input.documents !== undefined) {
          documents = checkedInput(input.documents);
        } else {
          const from = input.fromRevisionId ?? pointer?.revisionId;
          const read = from && isRevisionId(from) ? await readRevision(fs, paths, from) : null;
          if (!read?.ok) return rejected('not_found', []);
          const { unit } = read.revision;
          documents = {
            portfolio: { format: unit.portfolio.format, sourceText: unit.portfolio.sourceText },
            site: { format: unit.site.format, sourceText: unit.site.sourceText },
            ...(unit.media
              ? { media: { format: unit.media.format, sourceText: unit.media.sourceText } }
              : {}),
          };
        }
        if (input.sourceHash !== undefined && !isSha256(input.sourceHash)) {
          throw new TypeError('Not a source hash.');
        }
        return commit('draft.create', working, documents, {
          baseRevisionId: pointer?.revisionId ?? null,
          ...(input.sourceHash === undefined ? {} : { sourceHash: input.sourceHash }),
          actor,
        });
      });
    },

    save({ draftId, expectedVersion, documents }, actor) {
      return locked('draft.save', async () => {
        const found = await find(draftId);
        if (!found) return rejected('not_found', []);
        if (found.draft.version !== expectedVersion) return conflict(found);
        return commit('draft.save', found, checkedInput(documents), {
          baseRevisionId: found.draft.baseRevisionId,
          ...(found.draft.sourceHash === undefined ? {} : { sourceHash: found.draft.sourceHash }),
          actor,
        });
      });
    },

    applyEdits({ draftId, expectedVersion, edits }, actor) {
      return locked('draft.applyEdits', async () => {
        const found = await find(draftId);
        if (!found) return rejected('not_found', []);
        if (found.draft.version !== expectedVersion) return conflict(found);
        if (!Array.isArray(edits)) throw new TypeError('Edits are a list.');
        if (
          edits.some((edit) => !(DOCUMENT_NAMES as readonly unknown[]).includes(edit?.document))
        ) {
          throw new TypeError('An edit names no document.');
        }
        const input: Record<string, DocumentInput> = { ...draftInput(found.draft) };
        for (const name of DOCUMENT_NAMES) {
          const own = edits.filter((edit) => edit?.document === name);
          if (own.length === 0) continue;
          const document = input[name];
          if (!document) return rejected('validation_failed', [editFailed(name, own[0]!.pointer)]);
          try {
            input[name] = {
              format: document.format,
              sourceText: applyTextEdits(
                document.sourceText,
                document.format,
                own.map(({ pointer, op, value }) => ({ pointer, op, value })),
              ),
            };
          } catch {
            return rejected('validation_failed', [editFailed(name, own[0]!.pointer)]);
          }
        }
        return commit('draft.applyEdits', found, input as unknown as UnitInput, {
          baseRevisionId: found.draft.baseRevisionId,
          ...(found.draft.sourceHash === undefined ? {} : { sourceHash: found.draft.sourceHash }),
          actor,
        });
      });
    },

    rebase({ draftId, expectedVersion, documents, baseRevisionId }, actor) {
      return locked('draft.rebase', async () => {
        const pointer = await live();
        const found = await find(draftId);
        if (!found) return rejected('not_found', []);
        if (found.draft.version !== expectedVersion) return conflict(found);
        if (baseRevisionId !== (pointer?.revisionId ?? null)) {
          return liveConflict(pointer, baseRevisionId);
        }
        return commit('draft.rebase', found, checkedInput(documents), {
          baseRevisionId,
          ...(found.draft.sourceHash === undefined ? {} : { sourceHash: found.draft.sourceHash }),
          actor,
        });
      });
    },

    discard({ draftId, expectedVersion }) {
      return locked('draft.discard', async (): Promise<DiscardOutcome> => {
        const found = await find(draftId);
        if (!found) return rejected('not_found', []);
        if (expectedVersion !== undefined && found.draft.version !== expectedVersion) {
          return conflict(found);
        }
        await lock.fence();
        await removeDraft(fs, paths, draftId, 'draft.discard');
        emitStoreEvent({ name: 'draftDiscarded', draftId });
        return { kind: 'discarded', draftId };
      });
    },
  };
}

export function rejected<Code extends string>(
  code: Code,
  diagnostics: readonly UnitDiagnostic[],
  extra: { readonly documents?: readonly DocumentName[]; readonly blobs?: readonly Sha256[] } = {},
): Rejection<Code> {
  return { kind: 'rejected', code, diagnostics, ...extra };
}
