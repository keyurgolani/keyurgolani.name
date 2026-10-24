import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { canonicalize } from '@portfolio/schema';
import { recordOwnerModule } from '../load-trace';
import { BUNDLE_FILE, BUNDLE_FORMAT, BUNDLE_LIMITS, type BundleProblem } from '../catalog/bundle';
import { documentFileName, sha256, type DocumentName, type UnitChecks } from '../catalog/unit';
import { exportBlobs, verifyExport } from './bundle-files';
import { storageError } from './common';
import type { CrashPoint, FsPort } from './fs-port';
import { isRevisionId, isSha256, tempBeside, type RevisionId, type Sha256, type StorePaths } from './layout';
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
//   media/blobs/<hex>      exportBlobs(): every rendition, and a source that isn't an image
//   bundle.json            IDs, versions, hashes, and the events that made it live
//
// `--documents-only` writes the two documents and nothing else.
//
// What it holds is the revision's published content and nothing of the
// store's own: no draft, session, claim, lock, configuration, environment,
// password hash, audit record, or ephemeral/ file. It reads the revision by
// its ID, which nothing changes once it's written, and blobs by their
// hash, so a publish while it runs can't mix two revisions; it takes no
// lock and writes nothing in the data directory. Of the publication log it
// keeps the events that made the revision live, and of each only what's
// public: its seq, type, revision, the revision before, the role that
// moved the pointer (owner or operator, never a session), when, an
// import's source hash, and a migration's origin. An event's reason, free
// text, and its idempotency key, a client's token, stay out.
//
// The target is new or an empty directory, outside the data directory and
// the source directory, holding neither, and reached through no symbolic
// link. Everything is read and checked, every blob against its hash,
// before anything is written. It's written into a new directory beside the
// target, each file created exclusively and never through a link, then
// checked whole by the reader the demo uses, then renamed into place in one
// move. So a refusal or a failure leaves the target as it was, and nothing
// beside it.

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
  /** The target, or a directory above it, is a symbolic link. */
  | 'target_linked'
  /** The directory the target goes in isn't there. */
  | 'target_parent_missing';

export type ExportOutcome =
  | {
      readonly kind: 'exported';
      readonly revisionId: RevisionId;
      readonly unitHash: Sha256;
      /** What it wrote, relative to the target, bundle.json last. */
      readonly files: readonly string[];
      /** The blobs' bytes, together. */
      readonly blobBytes: number;
    }
  | {
      readonly kind: 'refused';
      readonly code: ExportRefusal;
      readonly damage?: RevisionDamage;
      readonly blob?: Sha256;
      readonly limit?: number;
      readonly problems?: readonly BundleProblem[];
    };

/** An event as an export carries it: the public fields alone. */
export type ExportedEvent = Pick<
  PublicationEvent,
  'seq' | 'type' | 'revisionId' | 'previousRevisionId' | 'actor' | 'at' | 'sourceHash' | 'restoredFrom'
>;

export interface ExportOptions {
  readonly fs: FsPort;
  readonly paths: StorePaths;
  /** The build's checks, which the written bundle is verified with. */
  readonly checks: UnitChecks;
  /** PORTFOLIO_SOURCE_DIR, which the target stays out of as it does the data directory. */
  readonly sourceDir?: string;
}

/** Whether `inner` is `outer` or under it. Both absolute. */
function within(outer: string, inner: string): boolean {
  const relative = path.relative(outer, inner);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** `dir` with every link in it resolved, or as it is when it can't be. */
async function resolved(dir: string): Promise<string> {
  try {
    return await realpath(dir);
  } catch {
    return path.resolve(dir);
  }
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
  const found = await fs.lstat(out);
  if (found?.isSymbolicLink) return 'target_linked';
  for (const dir of avoid) {
    // The data directory may be a link to the operator's volume: both
    // spellings of each are kept out.
    for (const spelled of new Set([path.resolve(dir), await resolved(dir)])) {
      if (within(spelled, out) || within(out, spelled)) return 'target_overlaps';
    }
  }
  if (found && (!found.isDirectory || (await fs.readdir(out)).length > 0)) {
    return 'target_not_empty';
  }
  return null;
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
  | { readonly ok: true; readonly blobs: readonly { file: string; sha256: Sha256; bytes: Buffer }[] }
  | { readonly ok: false; readonly code: 'asset_missing' | 'too_large'; readonly blob: Sha256; readonly limit?: number }
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
  { fs, paths, checks, sourceDir }: ExportOptions,
  target: RevisionId | 'live',
  outGiven: string,
  { documentsOnly = false }: { readonly documentsOnly?: boolean } = {},
): Promise<ExportOutcome> {
  if (target !== 'live' && !isRevisionId(target)) throw new TypeError('Not a revision ID.');
  const out = path.resolve(outGiven);
  const refused = (
    code: ExportRefusal,
    extra: Omit<Extract<ExportOutcome, { kind: 'refused' }>, 'kind' | 'code'> = {},
  ): ExportOutcome => ({ kind: 'refused', code, ...extra });
  try {
    const avoid = [paths.root, ...(sourceDir === undefined ? [] : [sourceDir])];
    const problem = await targetProblem(fs, out, avoid);
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
      const blobs = await readBlobs(fs, paths, exportBlobs(unit.media?.model));
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
    const limits = [
      { over: files.length > BUNDLE_LIMITS.files, limit: BUNDLE_LIMITS.files },
      {
        over: files.some(
          ({ file, bytes }) =>
            !file.startsWith('media/blobs/') &&
            bytes.byteLength > (file === BUNDLE_FILE ? BUNDLE_LIMITS.bundleBytes : BUNDLE_LIMITS.documentBytes),
        ),
        limit: BUNDLE_LIMITS.documentBytes,
      },
      {
        over: files.reduce((sum, { bytes }) => sum + bytes.byteLength, 0) > BUNDLE_LIMITS.totalBytes,
        limit: BUNDLE_LIMITS.totalBytes,
      },
    ];
    const over = limits.find(({ over }) => over);
    if (over) return refused('too_large', { limit: over.limit });

    // Written beside the target, checked, and moved into place.
    const staging = tempBeside(out);
    const point = (step: string): CrashPoint => `export.${step}`;
    try {
      await fs.mkdir(staging, point('mkdir'));
      const dirs = new Set<string>([staging]);
      for (const { file, bytes } of files) {
        const full = path.join(staging, ...file.split('/'));
        const dir = path.dirname(full);
        if (!dirs.has(dir)) {
          await fs.mkdir(dir, point('mkdir'));
          dirs.add(dir);
        }
        await fs.writeFile(full, bytes, point('write'), { exclusive: true });
        await fs.fsync(full, point('fsync'));
      }
      for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
        await fs.fsync(dir, point('dir.fsync'));
      }
      if (!documentsOnly) {
        const verified = await verifyExport(staging, checks);
        if (!verified.ok) {
          await fs.remove(staging, point('undo'));
          return refused('does_not_serve', { problems: verified.problems });
        }
      }
      // An empty directory at the target is replaced; one something landed
      // in since it was checked stays, and the rename fails.
      try {
        await fs.rename(staging, out, point('rename'));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code !== 'ENOTEMPTY' && code !== 'EEXIST' && code !== 'ENOTDIR') throw error;
        await fs.remove(staging, point('undo'));
        return refused('target_not_empty');
      }
      await fs.fsync(path.dirname(out), point('parent.fsync'));
    } catch (error) {
      await fs.remove(staging, point('undo')).catch(() => {});
      throw error;
    }
    return {
      kind: 'exported',
      revisionId: id,
      unitHash: manifest.unitHash,
      files: files.map(({ file }) => file),
      blobBytes,
    };
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw storageError(error);
  }
}
