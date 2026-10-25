import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { canonicalize, type ContentExtension } from '@portfolio/schema';
import { recordOwnerModule } from '../load-trace';
import { BUNDLE_FILE, BUNDLE_FORMAT, BUNDLE_LIMITS, type BundleProblem } from '../catalog/bundle';
import { documentFileName, sha256, type DocumentName, type UnitChecks } from '../catalog/unit';
import { publicationUnitOf } from '../catalog/view';
import { servedBlobs, verifyExport } from './bundle-files';
import { storageError } from './common';
import type { CrashPoint, FsPort } from './fs-port';
import {
  isRevisionId,
  isSha256,
  isWithin,
  tempBeside,
  type RevisionId,
  type Sha256,
  type StorePaths,
} from './layout';
import { DamagedPointerError, readEvents, readLive, type PublicationEvent } from './pointer';
import { isTombstoned, readRevision, type Manifest, type RevisionDamage } from './revisions';

// `portfolio-store export-revision <revisionId|live> --out <dir>
// [--documents-only]` (#9, from #3's items 19 and 26): one published
// revision as read-only's source layout, which read-only serves as it is
// from PORTFOLIO_SOURCE_DIR and the demo mounts as its reference, in export
// format 1, the one catalog/bundle.ts reads:
//
//   portfolio.<yml|json>   the stored source text, byte for byte
//   site.<yml|json>
//   snapshots/<kind>.json  each snapshot the revision has, as canonical JSON
//   media/media.json       the media document, always JSON, when there is one
//   media/blobs/<hex>      servedBlobs(): the renditions the public view serves
//   bundle.json            IDs, versions, hashes, and the events that made it live
//
// `--documents-only` writes the two documents and nothing else.
//
// What it holds is the revision's published content and nothing of the
// store's own: no draft, session, claim, lock, configuration, environment,
// password hash, audit record, or ephemeral/ file. Of the media it holds
// only what a visitor can be served: no private or unplaced asset's
// renditions, and no original. It reads the revision by its ID, which
// nothing changes once it's written, and blobs by their hash, so a publish
// while it runs can't mix two revisions; it takes no lock and writes
// nothing in the data directory. Of the publication log it keeps the events
// that made the revision live, and of each only what's public: its seq,
// type, revision, the revision before, the role that moved the pointer
// (owner or operator, never a session), when, an import's source hash, and
// a migration's origin. An event's reason, free text, and its idempotency
// key, a client's token, stay out.
//
// The target is new or an empty directory, outside the data directory and
// the source directory, holding neither, and reached through no symbolic
// link. Everything is read and checked, every blob against its hash,
// before anything is written. It's written into a new directory beside the
// target, made exclusively, each file created exclusively and never
// through a link, then checked whole by the reader the demo uses. The
// target's directory and the target are checked again, then the staging
// directory is renamed into place in one move. So a refusal or a failure
// leaves the target as it was, and nothing beside it. The checks go by
// path, since node:fs has no *at() calls: someone who can write above the
// target can still swap a directory between the last check and the rename.

recordOwnerModule('core/store/export');

const MEDIA_FILE = 'media/media.json';

export type ExportRefusal =
  /** `live` on a store with nothing live. */
  | 'empty'
  | 'pointer_unreadable'
  /** No revision with that ID, or retention removed it. */
  | 'not_found'
  /** A file of the revision is missing, or a hash of it doesn't match. */
  | 'revision_damaged'
  /** A blob the export holds isn't in the AssetStore, or its bytes aren't its hash. */
  | 'asset_missing'
  /** Over one of the reader's limits, which a bundle can't pass. */
  | 'too_large'
  /** What it wrote doesn't verify under this build: `problems` says why. */
  | 'does_not_serve'
  /** The target is a file, a link, or a directory with something in it. */
  | 'target_not_empty'
  /** The target is inside the data directory or the source directory, or holds one. */
  | 'target_overlaps'
  /** The target, or a directory above it, is a symbolic link, or became one. */
  | 'target_linked'
  /** The directory the target goes in isn't there, or isn't a directory. */
  | 'target_parent_missing'
  /** The target's directory can't be looked in or written, or it's full: `reason` is the error's code. */
  | 'target_unwritable';

export type ExportOutcome =
  | {
      readonly kind: 'exported';
      readonly revisionId: RevisionId;
      readonly unitHash: Sha256;
      /** What it wrote, relative to the target, bundle.json last. */
      readonly files: readonly string[];
      /** The blobs' bytes, together. */
      readonly blobBytes: number;
      /** `parent_fsync_failed`: the export is in place, but its directory's entry may not be on disk yet. */
      readonly warnings: readonly 'parent_fsync_failed'[];
    }
  | {
      readonly kind: 'refused';
      readonly code: ExportRefusal;
      readonly damage?: RevisionDamage;
      readonly blob?: Sha256;
      readonly limit?: number;
      readonly reason?: string;
      readonly problems?: readonly BundleProblem[];
    };

/** An event as an export carries it: the public fields alone. */
export type ExportedEvent = Pick<
  PublicationEvent,
  | 'seq'
  | 'type'
  | 'revisionId'
  | 'previousRevisionId'
  | 'actor'
  | 'at'
  | 'sourceHash'
  | 'restoredFrom'
>;

export interface ExportOptions {
  readonly fs: FsPort;
  readonly paths: StorePaths;
  /** The build's checks, which the written bundle is verified with. */
  readonly checks: UnitChecks;
  /** The build's content extensions, which the public view keeps records for. */
  readonly extensions?: readonly ContentExtension[];
  /** PORTFOLIO_SOURCE_DIR, which the target stays out of as it does the data directory. */
  readonly sourceDir?: string;
}

/** `dir` with every link in it resolved, or as it is when it can't be. */
async function resolved(dir: string): Promise<string> {
  try {
    return await realpath(dir);
  } catch {
    return path.resolve(dir);
  }
}

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException)?.code;

/** A target-side failure as the refusal it is, or undefined for one that isn't the target's. */
function targetFailure(error: unknown): ExportRefusal | undefined {
  switch (errorCode(error)) {
    case 'ENOTDIR':
      return 'target_parent_missing';
    case 'ELOOP':
      return 'target_linked';
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
    case 'ENOSPC':
    case 'EDQUOT':
      return 'target_unwritable';
    default:
      return undefined;
  }
}

/** Whether `out` holds an export now: absent, or an empty directory, and no link. */
async function targetFree(fs: FsPort, out: string): Promise<ExportRefusal | null> {
  const found = await fs.lstat(out);
  if (found?.isSymbolicLink) return 'target_linked';
  if (found && (!found.isDirectory || (await fs.readdir(out)).length > 0)) {
    return 'target_not_empty';
  }
  return null;
}

/**
 * Whether the target's directory is still the one checked: there, a
 * directory, and its real path the path given, so no link stands at it or
 * above it.
 */
async function parentHolds(fs: FsPort, parent: string): Promise<ExportRefusal | null> {
  let real: string;
  try {
    real = await realpath(parent);
  } catch {
    return 'target_parent_missing';
  }
  if (real !== parent) return 'target_linked';
  return (await fs.lstat(parent))?.isDirectory ? null : 'target_parent_missing';
}

/** Why `out` can't take an export, or null. */
async function targetProblem(
  fs: FsPort,
  out: string,
  avoid: readonly string[],
): Promise<ExportRefusal | null> {
  const parent = path.dirname(out);
  const above = await fs.lstat(parent);
  if (!above) return 'target_parent_missing';
  // No link at the target's name or above it: realpath() resolves every
  // one, so it gives back the same path only when there's none.
  if (above.isSymbolicLink || (await resolved(parent)) !== parent) return 'target_linked';
  if (!above.isDirectory) return 'target_parent_missing';
  if ((await fs.lstat(out))?.isSymbolicLink) return 'target_linked';
  for (const dir of avoid) {
    // The data directory may be a link to the operator's volume: both
    // spellings of each are kept out.
    for (const spelled of new Set([path.resolve(dir), await resolved(dir)])) {
      if (isWithin(spelled, out) || isWithin(out, spelled)) return 'target_overlaps';
    }
  }
  return targetFree(fs, out);
}

/** The events that made `id` live, the pointer's own when the log doesn't have it yet, public fields alone. */
async function eventsFor(
  fs: FsPort,
  paths: StorePaths,
  id: RevisionId,
): Promise<readonly ExportedEvent[]> {
  const events = await readEvents(fs, paths);
  const pointer = await readLive(fs, paths).catch(() => null);
  if (pointer && !events.some((event) => event.seq === pointer.seq)) events.push(pointer.event);
  return events
    .filter((event) => event.revisionId === id)
    .sort((a, b) => a.seq - b.seq)
    .map((event) => ({
      seq: event.seq,
      type: event.type,
      revisionId: event.revisionId,
      previousRevisionId: event.previousRevisionId,
      actor: event.actor,
      at: event.at,
      ...(event.sourceHash === undefined ? {} : { sourceHash: event.sourceHash }),
      ...(event.restoredFrom === undefined ? {} : { restoredFrom: event.restoredFrom }),
    }));
}

/** The revision's blobs, each read and checked against its hash, or why one can't be. */
async function readBlobs(
  fs: FsPort,
  paths: StorePaths,
  hashes: readonly Sha256[],
): Promise<
  | {
      readonly ok: true;
      readonly blobs: readonly { file: string; sha256: Sha256; bytes: Buffer }[];
    }
  | {
      readonly ok: false;
      readonly code: 'asset_missing' | 'too_large';
      readonly blob: Sha256;
      readonly limit?: number;
    }
> {
  const blobs: { file: string; sha256: Sha256; bytes: Buffer }[] = [];
  let total = 0;
  for (const hash of hashes) {
    if (!isSha256(hash)) throw new TypeError('An export blob is not a SHA-256 digest.');
    const found = await fs.lstat(paths.blob(hash));
    if (!found?.isFile) return { ok: false, code: 'asset_missing', blob: hash };
    if (found.size > BUNDLE_LIMITS.blobBytes) {
      return { ok: false, code: 'too_large', blob: hash, limit: BUNDLE_LIMITS.blobBytes };
    }
    total += found.size;
    if (total > BUNDLE_LIMITS.totalBytes) {
      return { ok: false, code: 'too_large', blob: hash, limit: BUNDLE_LIMITS.totalBytes };
    }
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(paths.blob(hash));
    } catch {
      return { ok: false, code: 'asset_missing', blob: hash };
    }
    if (sha256(bytes) !== hash) return { ok: false, code: 'asset_missing', blob: hash };
    blobs.push({ file: `media/blobs/${hash.slice('sha256:'.length)}`, sha256: hash, bytes });
  }
  return { ok: true, blobs };
}

/** bundle.json's `source`: how the revision came to be, without the draft it came from. */
const sourceOf = (manifest: Manifest) => ({ kind: manifest.source.kind });

/** export-revision: `target` into `out`, a new or empty directory. */
export async function exportRevision(
  { fs, paths, checks, extensions = [], sourceDir }: ExportOptions,
  target: RevisionId | 'live',
  outGiven: string,
  { documentsOnly = false }: { readonly documentsOnly?: boolean } = {},
): Promise<ExportOutcome> {
  if (target !== 'live' && !isRevisionId(target)) throw new TypeError('Not a revision ID.');
  const out = path.resolve(outGiven);
  const parent = path.dirname(out);
  const refused = (
    code: ExportRefusal,
    extra: Omit<Extract<ExportOutcome, { kind: 'refused' }>, 'kind' | 'code'> = {},
  ): ExportOutcome => ({ kind: 'refused', code, ...extra });
  try {
    const avoid = [paths.root, ...(sourceDir === undefined ? [] : [sourceDir])];
    let problem: ExportRefusal | null;
    try {
      problem = await targetProblem(fs, out, avoid);
    } catch (error) {
      const failure = targetFailure(error);
      if (!failure) throw error;
      return refused(failure, { reason: String(errorCode(error)) });
    }
    if (problem) return refused(problem);

    // The revision, by its ID: what it is can't change while this reads it.
    let id: RevisionId;
    if (target === 'live') {
      let pointer;
      try {
        pointer = await readLive(fs, paths);
      } catch (error) {
        if (error instanceof DamagedPointerError) return refused('pointer_unreadable');
        throw error;
      }
      if (!pointer) return refused('empty');
      id = pointer.revisionId;
    } else {
      id = target;
    }
    if (await isTombstoned(fs, paths, id)) return refused('not_found');
    if (!(await fs.lstat(paths.revision(id)))?.isDirectory) return refused('not_found');
    const read = await readRevision(fs, paths, id);
    if (!read.ok) return refused('revision_damaged', { damage: read.damage });
    const { manifest, unit } = read.revision;

    // Every file, in memory and checked, before anything is written.
    const files: { file: string; bytes: Buffer }[] = [];
    const documents: Partial<Record<DocumentName, unknown>> = {};
    for (const name of ['portfolio', 'site'] as const) {
      const document = unit[name];
      const file = documentFileName(name, document.format);
      files.push({ file, bytes: Buffer.from(document.sourceText, 'utf8') });
      documents[name] = {
        file,
        format: document.format,
        schemaVersion: document.schemaVersion,
        sourceHash: document.sourceHash,
        contentHash: document.contentHash,
      };
    }
    let blobBytes = 0;
    if (!documentsOnly) {
      const snapshots: Record<string, { file: string; contentHash: Sha256 }> = {};
      for (const [kind, value] of Object.entries(unit.snapshots).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      )) {
        const file = `snapshots/${kind}.json`;
        const bytes = Buffer.from(canonicalize(value), 'utf8');
        files.push({ file, bytes });
        snapshots[kind] = { file, contentHash: sha256(bytes) };
      }
      if (unit.media) {
        // media.json is JSON: one stored as YAML goes as the canonical JSON
        // of its model, with the hash of what's written.
        const text =
          unit.media.format === 'json' ? unit.media.sourceText : canonicalize(unit.media.model);
        const bytes = Buffer.from(text, 'utf8');
        files.push({ file: MEDIA_FILE, bytes });
        documents.media = {
          file: MEDIA_FILE,
          format: 'json',
          schemaVersion: unit.media.schemaVersion,
          sourceHash: sha256(bytes),
          contentHash: unit.media.contentHash,
        };
      }
      let served: readonly Sha256[];
      try {
        served = servedBlobs(publicationUnitOf(unit), extensions);
      } catch {
        // A view this build can't make of the revision serves nothing.
        return refused('does_not_serve');
      }
      const blobs = await readBlobs(fs, paths, served);
      if (!blobs.ok) {
        return refused(blobs.code, {
          blob: blobs.blob,
          ...(blobs.limit === undefined ? {} : { limit: blobs.limit }),
        });
      }
      for (const blob of blobs.blobs) {
        files.push({ file: blob.file, bytes: blob.bytes });
        blobBytes += blob.bytes.byteLength;
      }
      const bundle = {
        bundleFormat: BUNDLE_FORMAT,
        revisionId: manifest.revisionId,
        parentRevisionId: manifest.parentRevisionId,
        createdAt: manifest.createdAt,
        createdBy: manifest.createdBy,
        source: sourceOf(manifest),
        appVersion: manifest.appVersion,
        unitHash: manifest.unitHash,
        documents,
        snapshots,
        blobs: blobs.blobs.map(({ file, sha256: hash, bytes }) => ({
          file,
          sha256: hash,
          size: bytes.byteLength,
        })),
        rendering: manifest.rendering,
        events: await eventsFor(fs, paths, id),
      };
      // bundle.json last.
      files.push({ file: BUNDLE_FILE, bytes: Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`) });
    }
    // The reader's limits, which no bundle over them passes.
    const limitOf = (file: string) =>
      file.startsWith('media/blobs/')
        ? BUNDLE_LIMITS.blobBytes
        : file === BUNDLE_FILE
          ? BUNDLE_LIMITS.bundleBytes
          : BUNDLE_LIMITS.documentBytes;
    const oversize = files.find(({ file, bytes }) => bytes.byteLength > limitOf(file));
    if (oversize) return refused('too_large', { limit: limitOf(oversize.file) });
    if (files.length > BUNDLE_LIMITS.files) {
      return refused('too_large', { limit: BUNDLE_LIMITS.files });
    }
    if (files.reduce((sum, { bytes }) => sum + bytes.byteLength, 0) > BUNDLE_LIMITS.totalBytes) {
      return refused('too_large', { limit: BUNDLE_LIMITS.totalBytes });
    }

    // Written beside the target, checked, and moved into place.
    const staging = tempBeside(out);
    const point = (step: string): CrashPoint => `export.${step}`;
    /** Takes the staging directory back, and refuses with `code`. */
    const undo = async (code: ExportRefusal, extra = {}) => {
      await fs.remove(staging, point('undo'));
      return refused(code, extra);
    };
    try {
      // A new directory, made exclusively: a name something else holds
      // fails with EEXIST, and is never written into or removed.
      await fs.mkdir(staging, point('mkdir'), { exclusive: true });
    } catch (error) {
      const failure = targetFailure(error);
      if (!failure) throw error;
      return refused(failure, { reason: String(errorCode(error)) });
    }
    try {
      const moved = await parentHolds(fs, parent);
      if (moved) return await undo(moved);
      const dirs = new Set<string>([staging]);
      for (const { file, bytes } of files) {
        const full = path.join(staging, ...file.split('/'));
        const dir = path.dirname(full);
        if (!dirs.has(dir)) {
          await fs.mkdir(dir, point('mkdir'), { exclusive: true });
          dirs.add(dir);
        }
        await fs.writeFile(full, bytes, point('write'), { exclusive: true });
        await fs.fsync(full, point('fsync'));
      }
      for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
        await fs.fsync(dir, point('dir.fsync'));
      }
      if (!documentsOnly) {
        const verified = await verifyExport(staging, checks, extensions);
        if (!verified.ok) return await undo('does_not_serve', { problems: verified.problems });
      }
      // Checked again just before the move: the same directory, at the
      // same real path, and the target still free.
      const changed = (await parentHolds(fs, parent)) ?? (await targetFree(fs, out));
      if (changed) return await undo(changed);
      // An empty directory at the target is replaced; one something landed
      // in since it was checked stays, and the rename fails.
      try {
        await fs.rename(staging, out, point('rename'));
      } catch (error) {
        const code = errorCode(error);
        if (code !== 'ENOTEMPTY' && code !== 'EEXIST' && code !== 'ENOTDIR') throw error;
        return await undo('target_not_empty');
      }
    } catch (error) {
      await fs.remove(staging, point('undo')).catch(() => {});
      const failure = targetFailure(error);
      if (!failure) throw error;
      return refused(failure, { reason: String(errorCode(error)) });
    }
    // The export is in place. The directory's own sync is the last step,
    // and its failure doesn't undo the export: it's a warning.
    const warnings: 'parent_fsync_failed'[] = [];
    try {
      await fs.fsync(parent, point('parent.fsync'));
    } catch {
      warnings.push('parent_fsync_failed');
    }
    return {
      kind: 'exported',
      revisionId: id,
      unitHash: manifest.unitHash,
      files: files.map(({ file }) => file),
      blobBytes,
      warnings,
    };
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw storageError(error);
  }
}
