import path from 'node:path';
import { canonicalize, type DocumentFormat } from '@portfolio/schema';
import { recordOwnerModule } from '../load-trace';
import { isStoreActor, type StoreActor } from './common';
import type { CrashPoint, FsPort } from './fs-port';
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
  sha256,
  unitHashOf,
  type DocumentName,
  type Rendering,
  type Unit,
  type UnitChecks,
  type UnitDiagnostic,
  type UnitDocument,
} from './unit';

// The RevisionStore (#3, items 8, 11, 13, and 14): immutable catalog
// revisions under revisions/<revisionId>/. Each holds its documents' text as
// written and their normalized models, the snapshots derived at publish, and
// manifest.json, written last. A revision is staged in
// revisions/.staging-<id>/, each file and directory synced, read back and
// checked against its hashes, then renamed into place; nothing changes it
// after that. Reading a revision checks every hash again.

recordOwnerModule('core/store/revisions');

export interface ManifestDocument {
  /** Its text's file under documents/, such as portfolio.yml. */
  readonly file: string;
  readonly format: DocumentFormat;
  readonly schemaVersion: number | null;
  readonly sourceHash: Sha256;
  readonly contentHash: Sha256;
}

/** Where a revision's documents came from: a draft and its version, or an import's mounted files. */
export type RevisionSource =
  | {
      readonly kind: 'draft';
      readonly draftId: DraftId;
      readonly draftVersion: number;
      /** A draft imported from source keeps the mounted files' hash (#3, item 24). */
      readonly sourceHash?: Sha256;
    }
  | { readonly kind: 'import'; readonly sourceHash: Sha256 };

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

/** What's wrong with a revision's files. */
export type RevisionDamage = 'missing' | 'hash_mismatch' | 'parse_failure';

export type RevisionRead =
  | { readonly ok: true; readonly revision: Revision }
  | { readonly ok: false; readonly damage: RevisionDamage };

const modelFile = (name: DocumentName) => `${name}.model.json`;
const snapshotFile = (kind: string) => `${kind}.json`;

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

async function writeSynced(
  fs: FsPort,
  file: string,
  text: string,
  point: CrashPoint,
): Promise<void> {
  await fs.writeFile(file, text, `${point}.write`);
  await fs.fsync(file, `${point}.fsync`);
}

/**
 * Writes `revision` as revisions/<id>/: staged, each file and directory
 * synced, the manifest last, read back and checked, renamed into place, and
 * revisions/ synced. The caller holds the publication lock.
 */
export async function writeRevision(
  fs: FsPort,
  paths: StorePaths,
  revision: Revision,
  operation: string,
): Promise<void> {
  const { manifest, unit } = revision;
  const id = manifest.revisionId;
  const staging = paths.staging(id);
  const point = (step: string): CrashPoint => `${operation}.staging.${step}`;
  const documents = path.join(staging, 'documents');
  const snapshots = path.join(staging, 'snapshots');
  await fs.mkdir(documents, point('mkdir'));
  await fs.mkdir(snapshots, point('mkdir'));
  for (const name of DOCUMENT_NAMES) {
    const document = unit[name];
    const entry = manifest.documents[name];
    if (!document || !entry) continue;
    await writeSynced(fs, path.join(documents, entry.file), document.sourceText, point(name));
    await writeSynced(
      fs,
      path.join(documents, modelFile(name)),
      canonicalize(document.model),
      point(`${name}-model`),
    );
  }
  for (const [kind, value] of Object.entries(unit.snapshots)) {
    await writeSynced(
      fs,
      path.join(snapshots, snapshotFile(kind)),
      canonicalize(value),
      point(kind),
    );
  }
  await fs.fsync(documents, point('documents.fsync'));
  await fs.fsync(snapshots, point('snapshots.fsync'));
  await writeSynced(
    fs,
    path.join(staging, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    point('manifest'),
  );
  await fs.fsync(staging, point('dir.fsync'));
  const check = await readRevisionAt(fs, staging, id);
  if (!check.ok) throw new Error(`A staged revision failed its own check: ${check.damage}.`);
  await fs.rename(staging, paths.revision(id), `${operation}.revision.rename`);
  await fs.fsync(paths.revisions, `${operation}.revisions.fsync`);
}

function asManifest(value: unknown, id: RevisionId): Manifest | null {
  if (value === null || typeof value !== 'object') return null;
  const manifest = value as Record<string, unknown>;
  const documents = manifest.documents as Record<string, unknown> | undefined;
  const snapshots = manifest.snapshots as Record<string, unknown> | undefined;
  const source = manifest.source as Record<string, unknown> | undefined;
  const rendering = manifest.rendering as Record<string, unknown> | undefined;
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
      (source.kind === 'import' && isSha256(source.sourceHash)));
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
    rendering !== undefined &&
    Array.isArray(rendering.packs) &&
    Array.isArray(manifest.blobs) &&
    (manifest.blobs as unknown[]).every(isSha256);
  return ok ? (manifest as unknown as Manifest) : null;
}

async function readText(fs: FsPort, file: string): Promise<string | null> {
  try {
    return (await fs.readFile(file)).toString('utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Reads and checks the revision in `dir`: every file there, and every hash right. */
export async function readRevisionAt(
  fs: FsPort,
  dir: string,
  id: RevisionId,
): Promise<RevisionRead> {
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
export function readRevision(fs: FsPort, paths: StorePaths, id: RevisionId): Promise<RevisionRead> {
  return readRevisionAt(fs, paths.revision(id), id);
}

/**
 * The manifest of revisions/<id>/ alone, or null when it's missing or isn't
 * one. Its files go unchecked: for a hash in a conflict, not for serving.
 */
export async function readManifest(
  fs: FsPort,
  paths: StorePaths,
  id: RevisionId,
): Promise<Manifest | null> {
  if (!isRevisionId(id)) return null;
  const text = await readText(fs, path.join(paths.revision(id), 'manifest.json'));
  if (text === null) return null;
  const parsed = parseJson(text);
  return parsed.ok ? asManifest(parsed.value, id) : null;
}

/** Every revision ID with a directory, staging and tombstones aside. */
export async function revisionIds(fs: FsPort, paths: StorePaths): Promise<RevisionId[]> {
  return (await fs.readdir(paths.revisions)).filter(isRevisionId);
}

export async function isTombstoned(fs: FsPort, paths: StorePaths, id: RevisionId) {
  return (await fs.stat(paths.tombstone(id))) !== null;
}

/**
 * What the running build makes of a revision. `damaged`: a file is missing,
 * a hash doesn't match, something doesn't parse, or the validator finds it
 * can't render (#3, item 14). `incompatible`: it renders, but this build
 * can't publish it, by its schema version, the contract, its packs, or a
 * blob that's gone (item 13). `removed`: retention left a tombstone.
 */
export type RevisionHealth =
  | { readonly state: 'ok'; readonly revision: Revision }
  | { readonly state: 'damaged'; readonly reason: string }
  | {
      readonly state: 'incompatible';
      readonly reason: string;
      readonly revision: Revision;
      readonly diagnostics: readonly UnitDiagnostic[];
    }
  | { readonly state: 'removed' };

const blocking = (diagnostic: { readonly severity: string }) =>
  diagnostic.severity === 'blocks-preview' || diagnostic.severity === 'blocks-publish';

export async function revisionHealth(
  fs: FsPort,
  paths: StorePaths,
  id: RevisionId,
  checks: UnitChecks,
  hasBlob: (hash: Sha256) => Promise<boolean>,
): Promise<RevisionHealth> {
  if (await isTombstoned(fs, paths, id)) return { state: 'removed' };
  const read = await readRevision(fs, paths, id);
  if (!read.ok) return { state: 'damaged', reason: read.damage };
  const { revision } = read;
  const result = checks.validate({
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
  });
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
  return { state: 'ok', revision };
}

/** The RevisionStore port: reading revisions. Only the PublicationService writes them. */
export interface RevisionStore {
  read(revisionId: RevisionId): Promise<RevisionRead>;
  manifest(revisionId: RevisionId): Promise<Manifest | null>;
  /** Every revision with a directory. */
  list(): Promise<RevisionId[]>;
  health(revisionId: RevisionId): Promise<RevisionHealth>;
}

export function filesystemRevisionStore({
  fs,
  paths,
  checks,
  hasBlob,
}: {
  readonly fs: FsPort;
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
    health: (revisionId: RevisionId): Promise<RevisionHealth> =>
      isRevisionId(revisionId)
        ? revisionHealth(fs, paths, revisionId, checks, hasBlob)
        : Promise.resolve({ state: 'damaged', reason: 'missing' }),
  });
}
