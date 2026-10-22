import path from 'node:path';
import { canonicalize, type DocumentFormat } from '@portfolio/schema';
import { recordOwnerModule } from '../load-trace';
import { isStoreActor, storageError, type StoreActor } from './common';
import type { CrashPoint, FsPort } from './fs-port';
import { isRevisionId, isSha256, type RevisionId, type Sha256, type StorePaths } from './layout';
import {
  asEvent,
  DamagedPointerError,
  readEvents,
  readLive,
  type PublicationEvent,
} from './pointer';
import { isTombstoned, readRevision, type RevisionDamage, type RevisionSource } from './revisions';
import {
  checkUnit,
  documentFileName,
  isSnapshotKind,
  sha256,
  unitHashOf,
  type DocumentName,
  type Rendering,
  type UnitChecks,
  type UnitDiagnostic,
  type UnitInput,
} from '../catalog/unit';

// `portfolio-store export-revision` and `verify-revision` (#3, item 26). A
// full export is item 19's source layout, which `read-only` serves as it is
// from PORTFOLIO_SOURCE_DIR (#10, addition 7):
//
//   portfolio.<yml|json>   the stored source text, byte for byte
//   site.<yml|json>
//   snapshots/<kind>.json  each snapshot in the revision, as canonical JSON
//   media/media.json       the media document's text, when the revision has one (#10)
//   media/blobs/<hex>      #10's exportBlobs(unit): renditions, and sources that aren't images
//   bundle.json            IDs, versions, hashes, and the events that made it live;
//                          the reader ignores it
//
// `--documents-only` writes the two documents and nothing else: they carry
// the content to another store or tool, but without the snapshots and
// media, and with nothing to check them against, they aren't for switching
// `owner` to `read-only`. verify-revision checks a full export against its
// bundle.json: exactly the files it lists, each one's hash, the unitHash
// they make, and that the pair serves under this build.

recordOwnerModule('core/store/bundle');

export const BUNDLE_FORMAT = 1;
export const BUNDLE_FILE = 'bundle.json';
const MEDIA_FILE = 'media/media.json';

export interface BundleDocument {
  /** Relative to the bundle's directory: portfolio.yml, site.json, media/media.json. */
  readonly file: string;
  readonly format: DocumentFormat;
  readonly schemaVersion: number | null;
  /** The SHA-256 of the file's bytes. */
  readonly sourceHash: Sha256;
  /** The SHA-256 of #4's canonical form of the document's normalized model. */
  readonly contentHash: Sha256;
}

export interface Bundle {
  readonly bundleFormat: typeof BUNDLE_FORMAT;
  readonly revisionId: RevisionId;
  readonly parentRevisionId: RevisionId | null;
  readonly createdAt: string;
  readonly createdBy: StoreActor;
  readonly source: RevisionSource;
  readonly appVersion: string;
  readonly unitHash: Sha256;
  readonly documents: Readonly<Partial<Record<DocumentName, BundleDocument>>> & {
    readonly portfolio: BundleDocument;
    readonly site: BundleDocument;
  };
  readonly snapshots: Readonly<
    Record<string, { readonly file: string; readonly contentHash: Sha256 }>
  >;
  readonly blobs: readonly {
    readonly file: string;
    readonly sha256: Sha256;
    readonly size: number;
  }[];
  readonly rendering: Rendering;
  /** Every event that made the revision live, in seq order. */
  readonly events: readonly PublicationEvent[];
}

export type ExportProblem =
  | 'empty'
  | 'pointer_unreadable'
  | 'not_found'
  | 'revision_damaged'
  | 'asset_missing'
  | 'target_not_empty'
  | 'target_overlaps';

export type ExportOutcome =
  | {
      readonly kind: 'exported';
      readonly revisionId: RevisionId;
      readonly unitHash: Sha256;
      /** What it wrote, relative to the target. */
      readonly files: readonly string[];
    }
  | {
      readonly kind: 'refused';
      readonly code: ExportProblem;
      readonly damage?: RevisionDamage;
      readonly blob?: Sha256;
    };

export type BundleProblemCode =
  | 'bundle_unreadable'
  | 'file_missing'
  | 'unexpected_file'
  | 'hash_mismatch'
  | 'unit_hash_mismatch'
  | 'content_hash_mismatch'
  | 'does_not_serve';

export interface BundleProblem {
  readonly code: BundleProblemCode;
  /** The file, relative to the bundle's directory, when it's about one. */
  readonly path?: string;
  /** For does_not_serve: what the validator found. */
  readonly diagnostic?: Pick<UnitDiagnostic, 'code' | 'document' | 'pointer'>;
}

export interface VerifyRevisionReport {
  readonly problems: readonly BundleProblem[];
  readonly bundle: Bundle | null;
}

const within = (outer: string, inner: string) => {
  const relative = path.relative(path.resolve(outer), path.resolve(inner));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};
const abs = (root: string, file: string) => path.join(root, ...file.split('/'));

/** Every file under `dir`, relative to it, with / between names. */
async function filesUnder(fs: FsPort, dir: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const name of (await fs.readdir(dir)).sort()) {
    const full = path.join(dir, name);
    const found = await fs.stat(full);
    if (found?.isDirectory) files.push(...(await filesUnder(fs, full, `${prefix}${name}/`)));
    else if (found) files.push(`${prefix}${name}`);
  }
  return files;
}

export interface ExportOptions {
  readonly fs: FsPort;
  readonly paths: StorePaths;
  readonly checks: Pick<UnitChecks, 'exportBlobs'>;
}

/** `export-revision <id|live> --out <dir> [--documents-only]`, into a target that's empty or not there. */
export async function exportRevision(
  { fs, paths, checks }: ExportOptions,
  target: RevisionId | 'live',
  out: string,
  { documentsOnly = false }: { readonly documentsOnly?: boolean } = {},
): Promise<ExportOutcome> {
  if (within(paths.root, out) || within(out, paths.root)) {
    return { kind: 'refused', code: 'target_overlaps' };
  }
  try {
    let id: RevisionId;
    if (target === 'live') {
      let pointer;
      try {
        pointer = await readLive(fs, paths);
      } catch (error) {
        if (error instanceof DamagedPointerError) {
          return { kind: 'refused', code: 'pointer_unreadable' };
        }
        throw error;
      }
      if (!pointer) return { kind: 'refused', code: 'empty' };
      id = pointer.revisionId;
    } else {
      if (!isRevisionId(target)) throw new TypeError('Not a revision ID.');
      id = target;
    }
    if (await isTombstoned(fs, paths, id)) return { kind: 'refused', code: 'not_found' };
    if (!(await fs.stat(paths.revision(id)))?.isDirectory) {
      return { kind: 'refused', code: 'not_found' };
    }
    const read = await readRevision(fs, paths, id);
    if (!read.ok) return { kind: 'refused', code: 'revision_damaged', damage: read.damage };
    const { manifest, unit } = read.revision;

    const existing = await fs.stat(out);
    if (existing && (!existing.isDirectory || (await fs.readdir(out)).length > 0)) {
      return { kind: 'refused', code: 'target_not_empty' };
    }

    // Every blob, read and checked before anything is written.
    const blobs: { file: string; sha256: Sha256; bytes: Buffer }[] = [];
    if (!documentsOnly) {
      for (const hash of [...new Set(checks.exportBlobs?.(unit.media?.model) ?? [])].sort()) {
        if (!isSha256(hash)) throw new TypeError('An export blob is not a SHA-256 digest.');
        let bytes: Buffer;
        try {
          bytes = await fs.readFile(paths.blob(hash));
        } catch {
          return { kind: 'refused', code: 'asset_missing', blob: hash };
        }
        if (sha256(bytes) !== hash) return { kind: 'refused', code: 'asset_missing', blob: hash };
        blobs.push({ file: `media/blobs/${hash.slice('sha256:'.length)}`, sha256: hash, bytes });
      }
    }

    const written: string[] = [];
    const point = (step: string): CrashPoint => `export.${step}`;
    const write = async (file: string, bytes: Uint8Array) => {
      const full = abs(out, file);
      await fs.mkdir(path.dirname(full), point('mkdir'));
      await fs.writeFile(full, bytes, point('write'), { exclusive: true });
      await fs.fsync(full, point('fsync'));
      written.push(file);
    };
    await fs.mkdir(out, point('mkdir'));
    try {
      const documents: Partial<Record<DocumentName, BundleDocument>> = {};
      for (const name of ['portfolio', 'site'] as const) {
        const document = unit[name];
        const file = documentFileName(name, document.format);
        await write(file, Buffer.from(document.sourceText, 'utf8'));
        documents[name] = {
          file,
          format: document.format,
          schemaVersion: document.schemaVersion,
          sourceHash: document.sourceHash,
          contentHash: document.contentHash,
        };
      }
      if (!documentsOnly) {
        const snapshots: Record<string, { file: string; contentHash: Sha256 }> = {};
        for (const [kind, value] of Object.entries(unit.snapshots).sort(([a], [b]) =>
          a.localeCompare(b),
        )) {
          const file = `snapshots/${kind}.json`;
          const bytes = Buffer.from(canonicalize(value), 'utf8');
          await write(file, bytes);
          snapshots[kind] = { file, contentHash: sha256(bytes) };
        }
        if (unit.media) {
          // media.json is JSON: a media document stored as YAML goes as the
          // canonical JSON of its model, with the hash of what's written.
          const text =
            unit.media.format === 'json' ? unit.media.sourceText : canonicalize(unit.media.model);
          const bytes = Buffer.from(text, 'utf8');
          await write(MEDIA_FILE, bytes);
          documents.media = {
            file: MEDIA_FILE,
            format: 'json',
            schemaVersion: unit.media.schemaVersion,
            sourceHash: sha256(bytes),
            contentHash: unit.media.contentHash,
          };
        }
        for (const blob of blobs) await write(blob.file, blob.bytes);
        const pointer = await readLive(fs, paths).catch(() => null);
        const events = await readEvents(fs, paths);
        if (pointer && !events.some((event) => event.seq === pointer.seq))
          events.push(pointer.event);
        const bundle: Bundle = {
          bundleFormat: BUNDLE_FORMAT,
          revisionId: manifest.revisionId,
          parentRevisionId: manifest.parentRevisionId,
          createdAt: manifest.createdAt,
          createdBy: manifest.createdBy,
          source: manifest.source,
          appVersion: manifest.appVersion,
          unitHash: manifest.unitHash,
          documents: documents as Bundle['documents'],
          snapshots,
          blobs: blobs.map(({ file, sha256: hash, bytes }) => ({
            file,
            sha256: hash,
            size: bytes.byteLength,
          })),
          rendering: manifest.rendering,
          events: events.filter((event) => event.revisionId === id).sort((a, b) => a.seq - b.seq),
        };
        // bundle.json last: an export without it is one that didn't finish.
        await write(BUNDLE_FILE, Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`, 'utf8'));
      }
      for (const dir of new Set(written.map((file) => path.dirname(abs(out, file))))) {
        await fs.fsync(dir, point('dir.fsync'));
      }
      await fs.fsync(out, point('dir.fsync'));
    } catch (error) {
      for (const name of await fs.readdir(out).catch(() => [] as string[])) {
        await fs.remove(path.join(out, name), point('undo')).catch(() => {});
      }
      throw error;
    }
    return { kind: 'exported', revisionId: id, unitHash: manifest.unitHash, files: written };
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw storageError(error);
  }
}

const DOCUMENT_FILE: Readonly<Record<DocumentName, RegExp>> = {
  portfolio: /^portfolio\.(yml|json)$/,
  site: /^site\.(yml|json)$/,
  media: /^media\/media\.json$/,
};

function asBundleDocument(value: unknown, name: DocumentName): BundleDocument | null {
  const document = value as Record<string, unknown> | null;
  if (document === null || typeof document !== 'object') return null;
  const ok =
    typeof document.file === 'string' &&
    DOCUMENT_FILE[name].test(document.file) &&
    (document.format === 'yaml' || document.format === 'json') &&
    (name === 'media' || document.file === documentFileName(name, document.format)) &&
    (document.schemaVersion === null || Number.isSafeInteger(document.schemaVersion)) &&
    isSha256(document.sourceHash) &&
    isSha256(document.contentHash);
  return ok ? (document as unknown as BundleDocument) : null;
}

/**
 * The bundle in `value`, or null when it isn't one. Every file it names is
 * checked against the layout before anything joins it to a path.
 */
export function asBundle(value: unknown): Bundle | null {
  const bundle = value as Record<string, unknown> | null;
  if (bundle === null || typeof bundle !== 'object') return null;
  const documents = bundle.documents as Record<string, unknown> | null | undefined;
  const snapshots = bundle.snapshots as Record<string, unknown> | null | undefined;
  const blobs = bundle.blobs as unknown[] | undefined;
  const events = bundle.events as unknown[] | undefined;
  const rendering = bundle.rendering as Record<string, unknown> | null | undefined;
  const ok =
    bundle.bundleFormat === BUNDLE_FORMAT &&
    isRevisionId(bundle.revisionId) &&
    (bundle.parentRevisionId === null || isRevisionId(bundle.parentRevisionId)) &&
    typeof bundle.createdAt === 'string' &&
    isStoreActor(bundle.createdBy) &&
    typeof bundle.appVersion === 'string' &&
    isSha256(bundle.unitHash) &&
    documents !== null &&
    typeof documents === 'object' &&
    Object.keys(documents).every((name) => name in DOCUMENT_FILE) &&
    asBundleDocument(documents.portfolio, 'portfolio') !== null &&
    asBundleDocument(documents.site, 'site') !== null &&
    (documents.media === undefined || asBundleDocument(documents.media, 'media') !== null) &&
    snapshots !== null &&
    typeof snapshots === 'object' &&
    Object.entries(snapshots).every(([kind, entry]) => {
      const snapshot = entry as Record<string, unknown> | null;
      return (
        isSnapshotKind(kind) &&
        snapshot !== null &&
        snapshot.file === `snapshots/${kind}.json` &&
        isSha256(snapshot.contentHash)
      );
    }) &&
    Array.isArray(blobs) &&
    blobs.every((entry) => {
      const blob = entry as Record<string, unknown> | null;
      return (
        blob !== null &&
        isSha256(blob.sha256) &&
        blob.file === `media/blobs/${(blob.sha256 as string).slice('sha256:'.length)}` &&
        Number.isSafeInteger(blob.size)
      );
    }) &&
    new Set(blobs.map((blob) => (blob as { file: string }).file)).size === blobs.length &&
    rendering !== null &&
    typeof rendering === 'object' &&
    Array.isArray(rendering.packs) &&
    Array.isArray(events) &&
    events.every((event) => asEvent(event)?.revisionId === bundle.revisionId);
  return ok ? (bundle as unknown as Bundle) : null;
}

/** `verify-revision <dir>`: a full export against its bundle.json, and whether it serves. */
export async function verifyRevision(
  { fs, checks }: { readonly fs: FsPort; readonly checks: UnitChecks },
  dir: string,
): Promise<VerifyRevisionReport> {
  const problems: BundleProblem[] = [];
  try {
    let bundle: Bundle | null = null;
    try {
      bundle = asBundle(
        JSON.parse((await fs.readFile(path.join(dir, BUNDLE_FILE))).toString('utf8')),
      );
    } catch {
      bundle = null;
    }
    if (!bundle) return { problems: [{ code: 'bundle_unreadable', path: BUNDLE_FILE }], bundle };

    // Exactly the files bundle.json lists, so read-only finds one pair.
    const documents = (['portfolio', 'site', 'media'] as const).flatMap((name) => {
      const entry = bundle.documents[name];
      return entry ? [{ name, entry }] : [];
    });
    const expected = new Map<string, Sha256>();
    for (const { entry } of documents) expected.set(entry.file, entry.sourceHash);
    for (const entry of Object.values(bundle.snapshots))
      expected.set(entry.file, entry.contentHash);
    for (const blob of bundle.blobs) expected.set(blob.file, blob.sha256);
    const present = new Set((await filesUnder(fs, dir)).filter((file) => file !== BUNDLE_FILE));
    for (const file of present) {
      if (!expected.has(file)) problems.push({ code: 'unexpected_file', path: file });
    }
    const texts = new Map<string, string>();
    for (const [file, hash] of expected) {
      if (!present.has(file)) {
        problems.push({ code: 'file_missing', path: file });
        continue;
      }
      const bytes = await fs.readFile(abs(dir, file));
      if (sha256(bytes) !== hash) problems.push({ code: 'hash_mismatch', path: file });
      else texts.set(file, bytes.toString('utf8'));
    }
    const unitHash = unitHashOf(
      Object.fromEntries(documents.map(({ name, entry }) => [name, entry])),
      Object.fromEntries(
        Object.entries(bundle.snapshots).map(([kind, entry]) => [kind, entry.contentHash]),
      ),
    );
    if (unitHash !== bundle.unitHash)
      problems.push({ code: 'unit_hash_mismatch', path: BUNDLE_FILE });
    if (problems.length > 0) return { problems, bundle };

    // It serves: the pair validates the way read-only startup reads it, and
    // means what the revision meant.
    const input = (name: DocumentName) => {
      const entry = bundle.documents[name]!;
      return { format: entry.format, sourceText: texts.get(entry.file)! };
    };
    const unit: UnitInput = {
      portfolio: input('portfolio'),
      site: input('site'),
      ...(bundle.documents.media ? { media: input('media') } : {}),
    };
    const serving: UnitChecks = { ...checks, validate: checks.validateLive ?? checks.validate };
    const checked = checkUnit(unit, serving);
    if (!checked.ok) {
      for (const diagnostic of checked.diagnostics) {
        if (diagnostic.severity === 'warning') continue;
        problems.push({
          code: 'does_not_serve',
          path:
            (diagnostic.document === 'snapshots'
              ? undefined
              : bundle.documents[diagnostic.document]?.file) ?? BUNDLE_FILE,
          diagnostic: {
            code: diagnostic.code,
            document: diagnostic.document,
            pointer: diagnostic.pointer,
          },
        });
      }
      return { problems, bundle };
    }
    for (const { name, entry } of documents) {
      if (checked.unit[name]?.contentHash !== entry.contentHash) {
        problems.push({ code: 'content_hash_mismatch', path: entry.file });
      }
    }
    return { problems, bundle };
  } catch (error) {
    throw storageError(error);
  }
}
