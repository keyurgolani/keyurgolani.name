import path from 'node:path';
import type { DocumentFormat } from '@portfolio/schema';
import { recordOwnerModule } from '../load-trace';
import { isPermanentReadError, isStoreActor, type StoreActor } from './common';
import type { ReadFs } from './fs-port';
import {
  isDraftId,
  isRevisionId,
  isSha256,
  type DraftId,
  type RevisionId,
  type Sha256,
  type StorePaths,
} from './layout';
import {
  blobsOf,
  contentHash,
  DOCUMENT_NAMES,
  documentFileName,
  isSnapshotKind,
  olderSchema,
  plainModel,
  schemaMismatch,
  sha256,
  unitHashOf,
  type DocumentName,
  type Rendering,
  type SchemaVersions,
  type Unit,
  type UnitChecks,
  type UnitDiagnostic,
  type UnitDocument,
} from '../catalog/unit';

// The RevisionStore (#3, items 8, 11, 13, and 14): immutable catalog
// revisions under revisions/<revisionId>/. Each holds its documents' text as
// written and their normalized models, the snapshots derived at publish, and
// manifest.json, written last. A revision is staged in
// revisions/.staging-<id>/, each file and directory synced, read back and
// checked against its hashes, then renamed into place (commit.ts writes it);
// nothing changes it after that. This module only reads, and reading a
// revision checks every hash again.

recordOwnerModule('core/store/revisions');

export interface ManifestDocument {
  /** Its text's file under documents/, such as portfolio.yml. */
  readonly file: string;
  readonly format: DocumentFormat;
  readonly schemaVersion: number | null;
  readonly sourceHash: Sha256;
  readonly contentHash: Sha256;
}

/**
 * Where a revision's documents came from: a draft and its version, an
 * import's mounted files, or a migration to this build's schema of its
 * parent, a revision an older build wrote (#3, item 25).
 */
export type RevisionSource =
  | {
      readonly kind: 'draft';
      readonly draftId: DraftId;
      readonly draftVersion: number;
      /** A draft imported from source keeps the mounted files' hash (#3, item 24). */
      readonly sourceHash?: Sha256;
    }
  | { readonly kind: 'import'; readonly sourceHash: Sha256 }
  | { readonly kind: 'migration' };

/**
 * What a revision is (#3, item 8). It holds no secret, session ID, cookie,
 * IP address, email, path, or deployment setting: profile, canonical origin,
 * and Studio come from #1, never from a revision.
 */
export interface Manifest {
  readonly manifestVersion: 1;
  readonly revisionId: RevisionId;
  readonly parentRevisionId: RevisionId | null;
  /** ISO 8601. */
  readonly createdAt: string;
  readonly createdBy: StoreActor;
  readonly source: RevisionSource;
  readonly appVersion: string;
  readonly documents: Readonly<Partial<Record<DocumentName, ManifestDocument>>> & {
    readonly portfolio: ManifestDocument;
    readonly site: ManifestDocument;
  };
  readonly snapshots: Readonly<
    Record<string, { readonly file: string; readonly contentHash: Sha256 }>
  >;
  readonly unitHash: Sha256;
  readonly rendering: Rendering;
  readonly blobs: readonly Sha256[];
}

export interface Revision {
  readonly manifest: Manifest;
  readonly unit: Unit;
}

/**
 * What's wrong with a revision's files. `unreadable`: a file or directory
 * of it couldn't be read, for a link in its place, something that isn't a
 * file or directory there, or a failure that may pass, such as EACCES or
 * EMFILE.
 */
export type RevisionDamage = 'missing' | 'hash_mismatch' | 'parse_failure' | 'unreadable';

export type RevisionRead =
  | { readonly ok: true; readonly revision: Revision }
  | {
      readonly ok: false;
      readonly damage: RevisionDamage;
      /** Set when it may pass, such as for EACCES or EMFILE: a reader asks again soon. */
      readonly transient?: true;
    };

/** The file a document's normalized model is in, under documents/. */
export const modelFile = (name: DocumentName) => `${name}.model.json`;
/** The file a snapshot is in, under snapshots/. */
export const snapshotFile = (kind: string) => `${kind}.json`;

/** The manifest for `unit`, from what the caller knows about how it came to be. */
export function manifestFor(
  unit: Unit,
  fields: {
    readonly revisionId: RevisionId;
    readonly parentRevisionId: RevisionId | null;
    readonly createdAt: string;
    readonly createdBy: StoreActor;
    readonly source: RevisionSource;
  },
  checks: UnitChecks,
  rendering: Rendering,
): Manifest {
  const documents: Partial<Record<DocumentName, ManifestDocument>> = {};
  for (const name of DOCUMENT_NAMES) {
    const document = unit[name];
    if (!document) continue;
    documents[name] = {
      file: documentFileName(name, document.format),
      format: document.format,
      schemaVersion: document.schemaVersion,
      sourceHash: document.sourceHash,
      contentHash: document.contentHash,
    };
  }
  const snapshots: Record<string, { file: string; contentHash: Sha256 }> = {};
  for (const [kind, value] of Object.entries(unit.snapshots)) {
    snapshots[kind] = { file: snapshotFile(kind), contentHash: contentHash(value) };
  }
  return Object.freeze({
    manifestVersion: 1 as const,
    revisionId: fields.revisionId,
    parentRevisionId: fields.parentRevisionId,
    createdAt: fields.createdAt,
    createdBy: fields.createdBy,
    source: fields.source,
    appVersion: checks.appVersion,
    documents: documents as Manifest['documents'],
    snapshots,
    unitHash: unit.unitHash,
    rendering,
    blobs: blobsOf(unit, checks),
  });
}

/** An object, not null or an array, whose fields can be read. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** A variant or pack as a manifest names one: string `id` and `version`. */
const isVersioned = (value: unknown) =>
  isRecord(value) && typeof value.id === 'string' && typeof value.version === 'string';

/** A rendering every reader of it can walk: the variant, each pack, and every contract. */
function isRendering(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.variant === null || isVersioned(value.variant)) &&
    Array.isArray(value.packs) &&
    value.packs.every(isVersioned) &&
    isRecord(value.contracts) &&
    Object.values(value.contracts).every((version) => typeof version === 'string')
  );
}

function asManifest(value: unknown, id: RevisionId): Manifest | null {
  if (!isRecord(value)) return null;
  const manifest = value;
  if (
    !isRecord(manifest.documents) ||
    !isRecord(manifest.snapshots) ||
    !isRecord(manifest.source)
  ) {
    return null;
  }
  const documents = manifest.documents;
  const snapshots = manifest.snapshots;
  const source = manifest.source;
  const documentOk = (entry: unknown, name: DocumentName) => {
    const document = entry as Record<string, unknown> | undefined;
    return (
      document !== undefined &&
      (document.format === 'yaml' || document.format === 'json') &&
      document.file === documentFileName(name, document.format) &&
      (document.schemaVersion === null || Number.isSafeInteger(document.schemaVersion)) &&
      isSha256(document.sourceHash) &&
      isSha256(document.contentHash)
    );
  };
  const sourceOk =
    source !== undefined &&
    ((source.kind === 'draft' &&
      isDraftId(source.draftId) &&
      Number.isSafeInteger(source.draftVersion) &&
      (source.sourceHash === undefined || isSha256(source.sourceHash))) ||
      (source.kind === 'import' && isSha256(source.sourceHash)) ||
      (source.kind === 'migration' && isRevisionId(manifest.parentRevisionId)));
  const ok =
    manifest.manifestVersion === 1 &&
    manifest.revisionId === id &&
    (manifest.parentRevisionId === null || isRevisionId(manifest.parentRevisionId)) &&
    typeof manifest.createdAt === 'string' &&
    isStoreActor(manifest.createdBy) &&
    sourceOk &&
    typeof manifest.appVersion === 'string' &&
    documents !== undefined &&
    documentOk(documents.portfolio, 'portfolio') &&
    documentOk(documents.site, 'site') &&
    (documents.media === undefined || documentOk(documents.media, 'media')) &&
    Object.keys(documents).every((name) => (DOCUMENT_NAMES as readonly string[]).includes(name)) &&
    snapshots !== undefined &&
    Object.entries(snapshots).every(
      ([kind, entry]) =>
        isSnapshotKind(kind) &&
        (entry as Record<string, unknown>)?.file === snapshotFile(kind) &&
        isSha256((entry as Record<string, unknown>)?.contentHash),
    ) &&
    isSha256(manifest.unitHash) &&
    isRendering(manifest.rendering) &&
    Array.isArray(manifest.blobs) &&
    (manifest.blobs as unknown[]).every(isSha256);
  return ok ? (manifest as unknown as Manifest) : null;
}

/**
 * A revision file that's there but can't be read: the revision is damaged,
 * `unreadable`, for good when what's there is the reason, and for now when
 * the failure may pass.
 */
class UnreadableError extends Error {
  constructor(readonly transient: boolean) {
    super("A revision file can't be read.");
  }
}

/** The file's text, null when it isn't there, or an UnreadableError for any other failure. */
async function readText(fs: ReadFs, file: string): Promise<string | null> {
  try {
    return (await fs.readFile(file)).toString('utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    // A link in a file's place (ELOOP), since the store's reads never go
    // through one, or a directory or a FIFO there, stays so; EACCES or
    // EMFILE may pass.
    throw new UnreadableError(!isPermanentReadError(error));
  }
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * Whether each directory a revision's files are read through is one itself,
 * never a link to one: revisions/, the revision's own, documents/, and
 * snapshots/. A file's own read refuses a link only as its last component.
 * One that isn't there leaves its files missing, as their reads find. One
 * that can't be looked at throws an UnreadableError that may pass.
 */
async function throughDirectories(fs: ReadFs, dir: string): Promise<boolean> {
  for (const each of [
    path.dirname(dir),
    dir,
    path.join(dir, 'documents'),
    path.join(dir, 'snapshots'),
  ]) {
    let found;
    try {
      found = await fs.lstat(each);
    } catch (error) {
      throw new UnreadableError(!isPermanentReadError(error));
    }
    if (found !== null && !found.isDirectory) return false;
  }
  return true;
}

/**
 * Reads and checks the revision in `dir`: every file there, and every hash
 * right. A file that's there but can't be read leaves it `unreadable`, and
 * so does a link in place of a directory it's read through; `transient`
 * when the failure may pass.
 */
export async function readRevisionAt(
  fs: ReadFs,
  dir: string,
  id: RevisionId,
): Promise<RevisionRead> {
  try {
    if (!(await throughDirectories(fs, dir))) return { ok: false, damage: 'unreadable' };
    return await readRevisionFiles(fs, dir, id);
  } catch (error) {
    if (!(error instanceof UnreadableError)) throw error;
    return error.transient
      ? { ok: false, damage: 'unreadable', transient: true }
      : { ok: false, damage: 'unreadable' };
  }
}

async function readRevisionFiles(fs: ReadFs, dir: string, id: RevisionId): Promise<RevisionRead> {
  const manifestText = await readText(fs, path.join(dir, 'manifest.json'));
  if (manifestText === null) return { ok: false, damage: 'missing' };
  const parsed = parseJson(manifestText);
  if (!parsed.ok) return { ok: false, damage: 'parse_failure' };
  const manifest = asManifest(parsed.value, id);
  if (!manifest) return { ok: false, damage: 'parse_failure' };

  const documents: Partial<Record<DocumentName, UnitDocument>> = {};
  for (const name of DOCUMENT_NAMES) {
    const entry = manifest.documents[name];
    if (!entry) continue;
    const sourceText = await readText(fs, path.join(dir, 'documents', entry.file));
    const modelText = await readText(fs, path.join(dir, 'documents', modelFile(name)));
    if (sourceText === null || modelText === null) return { ok: false, damage: 'missing' };
    if (sha256(sourceText) !== entry.sourceHash) return { ok: false, damage: 'hash_mismatch' };
    const model = parseJson(modelText);
    if (!model.ok) return { ok: false, damage: 'parse_failure' };
    if (contentHash(model.value) !== entry.contentHash) {
      return { ok: false, damage: 'hash_mismatch' };
    }
    documents[name] = Object.freeze({
      format: entry.format,
      sourceText,
      model: model.value,
      schemaVersion: entry.schemaVersion,
      sourceHash: entry.sourceHash,
      contentHash: entry.contentHash,
    });
  }
  const snapshots: Record<string, unknown> = {};
  const snapshotHashes: Record<string, Sha256> = {};
  for (const [kind, entry] of Object.entries(manifest.snapshots)) {
    const text = await readText(fs, path.join(dir, 'snapshots', entry.file));
    if (text === null) return { ok: false, damage: 'missing' };
    const value = parseJson(text);
    if (!value.ok) return { ok: false, damage: 'parse_failure' };
    if (contentHash(value.value) !== entry.contentHash)
      return { ok: false, damage: 'hash_mismatch' };
    snapshots[kind] = value.value;
    snapshotHashes[kind] = entry.contentHash;
  }
  if (unitHashOf(documents, snapshotHashes) !== manifest.unitHash) {
    return { ok: false, damage: 'hash_mismatch' };
  }
  const unit: Unit = Object.freeze({
    portfolio: documents.portfolio!,
    site: documents.site!,
    ...(documents.media ? { media: documents.media } : {}),
    snapshots: Object.freeze(snapshots),
    unitHash: manifest.unitHash,
  });
  return { ok: true, revision: Object.freeze({ manifest, unit }) };
}

/** Reads and checks revisions/<id>/. */
export function readRevision(fs: ReadFs, paths: StorePaths, id: RevisionId): Promise<RevisionRead> {
  return readRevisionAt(fs, paths.revision(id), id);
}

/**
 * The manifest of revisions/<id>/ alone, or null when it's missing or isn't
 * one. Its files go unchecked: for a hash in a conflict, not for serving.
 */
export async function readManifest(
  fs: ReadFs,
  paths: StorePaths,
  id: RevisionId,
): Promise<Manifest | null> {
  if (!isRevisionId(id)) return null;
  let text: string | null;
  try {
    text = await readText(fs, path.join(paths.revision(id), 'manifest.json'));
  } catch (error) {
    if (error instanceof UnreadableError) return null;
    throw error;
  }
  if (text === null) return null;
  const parsed = parseJson(text);
  return parsed.ok ? asManifest(parsed.value, id) : null;
}

/** What serves a live revision an older build wrote again (#3, item 25). */
export const MIGRATE_COMMAND = 'portfolio-store migrate-store';

/**
 * Whether a migration is what makes revision `id` serve under this build
 * again (#3, item 25): its health `reason` names another schema major, and
 * its manifest's documents are at versions older than this build's. One a
 * newer build wrote is for that build.
 */
export async function migratable(
  fs: ReadFs,
  paths: StorePaths,
  id: RevisionId,
  reason: string | undefined,
  versions: SchemaVersions | undefined,
): Promise<boolean> {
  if (!versions || !schemaMismatch(reason)) return false;
  const manifest = await readManifest(fs, paths, id);
  if (!manifest) return false;
  const { portfolio, site } = manifest.documents;
  return olderSchema({ portfolio: portfolio.schemaVersion, site: site.schemaVersion }, versions);
}

/** Every revision ID with a directory, staging and tombstones aside. */
export async function revisionIds(fs: ReadFs, paths: StorePaths): Promise<RevisionId[]> {
  return (await fs.readdir(paths.revisions)).filter(isRevisionId);
}

export async function isTombstoned(fs: ReadFs, paths: StorePaths, id: RevisionId) {
  return (await fs.stat(paths.tombstone(id))) !== null;
}

/**
 * What the running build makes of a revision. `damaged`: a file is missing,
 * a hash doesn't match, something doesn't parse, or the validator finds it
 * can't render (#3, item 14). `incompatible`: it renders, but this build
 * can't publish it, by its schema version, the contract, its packs, or a
 * blob that's gone (item 13). `removed`: retention left a tombstone.
 *
 * The validator checks the stored text, as the running build parses it,
 * and that parse is what serves: `served` holds it, so the reader serves
 * the very models the check passed, as read-only does from its mounted
 * text. The revision's own models stay what the publishing build
 * normalized, which its hashes cover and revision.get shows.
 */
export type RevisionHealth =
  | {
      readonly state: 'ok';
      readonly revision: Revision;
      /** The pair the validator passed: the stored text, as the running build parses it. */
      readonly served: { readonly portfolio: unknown; readonly site: unknown };
    }
  | {
      readonly state: 'damaged';
      readonly reason: string;
      /** Set when it may pass: a read failure such as EACCES or EMFILE. Ask again soon. */
      readonly transient?: true;
    }
  | {
      readonly state: 'incompatible';
      readonly reason: string;
      readonly revision: Revision;
      readonly diagnostics: readonly UnitDiagnostic[];
    }
  | { readonly state: 'removed' };

const blocking = (diagnostic: { readonly severity: string }) =>
  diagnostic.severity === 'blocks-preview' || diagnostic.severity === 'blocks-publish';

/**
 * What a revision is checked for. `serve`: whether it renders as the live
 * revision, with UnitChecks.validateLive, under which an unregistered
 * variant only warns; damage, status(), the last-known-good walk, the
 * reader, and verify ask this. `publish`: whether it may be made live, with
 * UnitChecks.validate; rollback's and recover's targets and
 * revision.list's `compatible` ask this.
 */
export type HealthPurpose = 'serve' | 'publish';

export async function revisionHealth(
  fs: ReadFs,
  paths: StorePaths,
  id: RevisionId,
  checks: UnitChecks,
  hasBlob: (hash: Sha256) => Promise<boolean>,
  purpose: HealthPurpose,
): Promise<RevisionHealth> {
  if (await isTombstoned(fs, paths, id)) return { state: 'removed' };
  const read = await readRevision(fs, paths, id);
  if (!read.ok) {
    return read.transient
      ? { state: 'damaged', reason: read.damage, transient: true }
      : { state: 'damaged', reason: read.damage };
  }
  const { revision } = read;
  const pair = {
    portfolio: {
      text: revision.unit.portfolio.sourceText,
      format: revision.unit.portfolio.format,
      name: revision.manifest.documents.portfolio.file,
    },
    site: {
      text: revision.unit.site.sourceText,
      format: revision.unit.site.format,
      name: revision.manifest.documents.site.file,
    },
  };
  const result =
    purpose === 'serve' && checks.validateLive ? checks.validateLive(pair) : checks.validate(pair);
  const blockers = result.diagnostics.filter(blocking);
  // An older schema major renders after a migration, not as damage: one no
  // step reads (schema.version), or one the migration does (schema.outdated, #10).
  const previewBlockers = blockers.filter(
    (diagnostic) =>
      diagnostic.severity === 'blocks-preview' &&
      diagnostic.code !== 'schema.version' &&
      diagnostic.code !== 'schema.outdated',
  );
  if (previewBlockers.length > 0) {
    return { state: 'damaged', reason: [...new Set(previewBlockers.map((d) => d.code))].join(',') };
  }
  if (blockers.length > 0) {
    return {
      state: 'incompatible',
      reason: [...new Set(blockers.map((d) => d.code))].join(','),
      revision,
      diagnostics: blockers,
    };
  }
  for (const blob of revision.manifest.blobs) {
    if (!(await hasBlob(blob))) {
      return { state: 'incompatible', reason: 'asset_missing', revision, diagnostics: [] };
    }
  }
  // With no blocking finding the validator returns the pair; one that
  // doesn't has nothing to serve.
  if (!result.pair) return { state: 'damaged', reason: 'parse_failure' };
  return {
    state: 'ok',
    revision,
    served: { portfolio: plainModel(result.pair.portfolio), site: plainModel(result.pair.site) },
  };
}

/** The RevisionStore port: reading revisions. Only the PublicationService writes them. */
export interface RevisionStore {
  read(revisionId: RevisionId): Promise<RevisionRead>;
  manifest(revisionId: RevisionId): Promise<Manifest | null>;
  /** Every revision with a directory. */
  list(): Promise<RevisionId[]>;
  /** What the running build makes of a revision, for serving or for publishing it. */
  health(revisionId: RevisionId, purpose: HealthPurpose): Promise<RevisionHealth>;
}

export function filesystemRevisionStore({
  fs,
  paths,
  checks,
  hasBlob,
}: {
  readonly fs: ReadFs;
  readonly paths: StorePaths;
  readonly checks: UnitChecks;
  readonly hasBlob: (hash: Sha256) => Promise<boolean>;
}): RevisionStore {
  return Object.freeze({
    read: (revisionId: RevisionId): Promise<RevisionRead> =>
      isRevisionId(revisionId)
        ? readRevision(fs, paths, revisionId)
        : Promise.resolve({ ok: false, damage: 'missing' }),
    manifest: (revisionId: RevisionId) => readManifest(fs, paths, revisionId),
    list: () => revisionIds(fs, paths),
    health: (revisionId: RevisionId, purpose: HealthPurpose): Promise<RevisionHealth> =>
      isRevisionId(revisionId)
        ? revisionHealth(fs, paths, revisionId, checks, hasBlob, purpose)
        : Promise.resolve({ state: 'damaged', reason: 'missing' }),
  });
}
