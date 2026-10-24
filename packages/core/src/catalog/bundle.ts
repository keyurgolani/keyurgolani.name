import {
  DOCUMENT_MAX_BYTES,
  parseMediaDocumentText,
  parseSnapshotText,
  type DocumentFormat,
} from '@portfolio/schema';
import type { PublicationUnit } from './port';
import {
  checkUnit,
  documentFileName,
  isSha256,
  isSnapshotKind,
  sha256,
  unitHashOf,
  type DocumentInput,
  type DocumentName,
  type Sha256,
  type UnitChecks,
} from './unit';
import { publicationUnitOf } from './view';

// A full export's bundle, read and checked without a store (#9, #3). The
// layout is the one #3's deferred `export-revision` writes, and read-only
// serves as it is from PORTFOLIO_SOURCE_DIR:
//
//   portfolio.<yml|json>   the stored source text, byte for byte
//   site.<yml|json>
//   snapshots/<kind>.json  each snapshot, as canonical JSON
//   media/media.json       the media document, always JSON, when there is one
//   media/blobs/<hex>      each blob, named by its bare lowercase hex digest
//   bundle.json            IDs, versions, hashes, and the events that made it live
//
// Bundle format 1 is provisional: nothing ships `export-revision` yet, so the
// format can still change with it, and this reader refuses any other
// number. The demo's read-only reference (#9) is the one reader today. This
// module is pure: it reads no file and opens no store. The caller hands it a
// BundleFiles port over the directory, the way checkUnit() takes its inputs,
// so it records nothing in the owner load trace and reaches no owner module.
//
// It checks exactly what bundle.json lists, as verify-revision does: every
// file there and nothing else, each one's hash and size, the unitHash they
// make, that the pair serves under this build and means what the revision
// meant, and, for a caller that serves media, that every blob it keeps is
// listed. It reads each file once. The texts it parses and the blob bytes it
// hands back are the bytes it hashed, so nothing changes between the check
// and the use. Any problem refuses the whole bundle: none is ever served in
// part. From bundle.json it reads only the fields it checks. `events`,
// `createdBy`, `createdAt`, `source`, `appVersion`, `parentRevisionId`, and
// `rendering` are never read, so nothing in them can reach a page.

/** The one bundle format this build reads. Provisional until `export-revision` ships (#3). */
export const BUNDLE_FORMAT = 1;
export const BUNDLE_FILE = 'bundle.json';

/**
 * What a bundle may hold. Over any of them, the bundle is refused whole.
 * `heldBytes` bounds the blobs a caller keeps in memory, which for the
 * demo's reference is every rendition its public view serves.
 */
export const BUNDLE_LIMITS = Object.freeze({
  /** bundle.json: 1 MiB. */
  bundleBytes: 1024 * 1024,
  /** Each document, snapshot, and the media document: #4's 1 MiB. */
  documentBytes: DOCUMENT_MAX_BYTES,
  /** Each blob: 20 MiB, #10's most for a source. */
  blobBytes: 20 * 1024 * 1024,
  /** Files in all, bundle.json included. */
  files: 4096,
  /** Every file's bytes together: 256 MiB. */
  totalBytes: 256 * 1024 * 1024,
});

/** Why a bundle doesn't verify: #3's verify-revision codes, and the limits'. */
export type BundleProblemCode =
  | 'bundle_unreadable'
  | 'file_missing'
  | 'unexpected_file'
  | 'hash_mismatch'
  | 'unit_hash_mismatch'
  | 'content_hash_mismatch'
  | 'does_not_serve'
  | 'too_large'
  | 'blob_unlisted';

export interface BundleProblem {
  readonly code: BundleProblemCode;
  /** The file, relative to the bundle's directory, when it's about one. */
  readonly path?: string;
  /** For does_not_serve: what the validator found, never its message. */
  readonly diagnostic?: {
    readonly code: string;
    readonly document: string;
    readonly pointer: string;
  };
  /** For too_large: the limit it passed, in bytes or files. */
  readonly limit?: number;
}

/** One entry under the bundle's directory, as the port lists it. */
export interface BundleEntry {
  /** Relative to the directory, with / between names. */
  readonly path: string;
  /** `other`: a link, a device, a socket, anything but a regular file or a directory. */
  readonly type: 'file' | 'other';
  readonly size: number;
}

/** How verifyBundle() reads the bundle's directory. */
export interface BundleFiles {
  /** Every entry below the directory but its directories, never following a link. */
  list(): Promise<readonly BundleEntry[]>;
  /**
   * The file's bytes, at most `limit` and one more, so a file that grew past
   * it shows. It never follows a link, and throws for anything but a regular file.
   */
  read(path: string, limit: number): Promise<Uint8Array>;
}

export interface BundleDocument {
  readonly file: string;
  readonly format: DocumentFormat;
  readonly schemaVersion: number | null;
  /** The SHA-256 of the file's bytes. */
  readonly sourceHash: Sha256;
  /** The SHA-256 of #4's canonical form of the document's normalized model. */
  readonly contentHash: Sha256;
}

/** What this reader takes from bundle.json, and nothing else. */
export interface Bundle {
  readonly bundleFormat: typeof BUNDLE_FORMAT;
  readonly revisionId: string;
  readonly unitHash: Sha256;
  readonly documents: Readonly<Partial<Record<DocumentName, BundleDocument>>> & {
    readonly portfolio: BundleDocument;
    readonly site: BundleDocument;
  };
  /** Each snapshot's file and the SHA-256 of its bytes, which are its canonical JSON. */
  readonly snapshots: Readonly<
    Record<string, { readonly file: string; readonly contentHash: Sha256 }>
  >;
  readonly blobs: readonly {
    readonly file: string;
    readonly sha256: Sha256;
    readonly size: number;
  }[];
}

export interface VerifyBundleOptions {
  /** The build's checks. The pair is checked as served, with validateLive when there is one. */
  readonly checks: UnitChecks;
  /**
   * The blobs the caller serves from the unit, such as the renditions its
   * public view keeps. Each must be listed, and their bytes come back.
   */
  readonly keep?: (unit: PublicationUnit) => ReadonlySet<Sha256>;
  /** The most the kept blobs may hold together. */
  readonly heldBytes?: number;
}

export type VerifiedBundle =
  | {
      readonly ok: true;
      readonly bundle: Bundle;
      readonly unit: PublicationUnit;
      /** The kept blobs' verified bytes, by hash. */
      readonly blobs: ReadonlyMap<Sha256, Uint8Array>;
    }
  | { readonly ok: false; readonly problems: readonly BundleProblem[] };

const REVISION_ID = /^rev_[0-9a-f]{32}$/;
const DOCUMENT_FILE: Readonly<Record<DocumentName, RegExp>> = {
  portfolio: /^portfolio\.(yml|json)$/,
  site: /^site\.(yml|json)$/,
  media: /^media\/media\.json$/,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function asDocument(value: unknown, name: DocumentName): BundleDocument | null {
  if (!isObject(value)) return null;
  const format = value.format;
  const ok =
    typeof value.file === 'string' &&
    DOCUMENT_FILE[name].test(value.file) &&
    (format === 'yaml' || format === 'json') &&
    (name === 'media' ? format === 'json' : value.file === documentFileName(name, format)) &&
    (value.schemaVersion === null || Number.isSafeInteger(value.schemaVersion)) &&
    isSha256(value.sourceHash) &&
    isSha256(value.contentHash);
  return ok
    ? {
        file: value.file as string,
        format,
        schemaVersion: value.schemaVersion as number | null,
        sourceHash: value.sourceHash as Sha256,
        contentHash: value.contentHash as Sha256,
      }
    : null;
}

/**
 * The fields of bundle.json this reader uses, checked against the layout
 * before any file name is used, or null when it isn't a format 1 bundle.
 */
export function parseBundle(value: unknown): Bundle | null {
  if (!isObject(value) || value.bundleFormat !== BUNDLE_FORMAT) return null;
  if (typeof value.revisionId !== 'string' || !REVISION_ID.test(value.revisionId)) return null;
  if (!isSha256(value.unitHash)) return null;
  const documents = value.documents;
  if (
    !isObject(documents) ||
    !Object.keys(documents).every((name) => Object.hasOwn(DOCUMENT_FILE, name))
  ) {
    return null;
  }
  const portfolio = asDocument(documents.portfolio, 'portfolio');
  const site = asDocument(documents.site, 'site');
  const media = documents.media === undefined ? undefined : asDocument(documents.media, 'media');
  if (!portfolio || !site || media === null) return null;

  if (!isObject(value.snapshots)) return null;
  const snapshots: Record<string, { file: string; contentHash: Sha256 }> = {};
  for (const [kind, entry] of Object.entries(value.snapshots)) {
    if (!isSnapshotKind(kind) || !isObject(entry)) return null;
    if (entry.file !== `snapshots/${kind}.json` || !isSha256(entry.contentHash)) return null;
    snapshots[kind] = { file: entry.file, contentHash: entry.contentHash };
  }

  if (!Array.isArray(value.blobs)) return null;
  const blobs: { file: string; sha256: Sha256; size: number }[] = [];
  for (const entry of value.blobs as unknown[]) {
    if (!isObject(entry) || !isSha256(entry.sha256)) return null;
    const hex = entry.sha256.slice('sha256:'.length);
    const size = entry.size;
    if (entry.file !== `media/blobs/${hex}`) return null;
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) return null;
    blobs.push({ file: entry.file, sha256: entry.sha256, size });
  }
  if (new Set(blobs.map(({ file }) => file)).size !== blobs.length) return null;

  return {
    bundleFormat: BUNDLE_FORMAT,
    revisionId: value.revisionId,
    unitHash: value.unitHash,
    documents: { portfolio, site, ...(media ? { media } : {}) },
    snapshots,
    blobs,
  };
}

const decoder = new TextDecoder('utf-8', { fatal: true });

/** bundle.json's bytes as a bundle, or null. */
function parseHead(bytes: Uint8Array): Bundle | null {
  try {
    return parseBundle(JSON.parse(decoder.decode(bytes)));
  } catch {
    return null;
  }
}

/** The bundle in `files`, verified whole, or every problem found before it stopped. */
export async function verifyBundle(
  files: BundleFiles,
  { checks, keep, heldBytes = Infinity }: VerifyBundleOptions,
): Promise<VerifiedBundle> {
  const refused = (...problems: BundleProblem[]): VerifiedBundle => ({ ok: false, problems });
  const read = async (file: string, limit: number): Promise<Uint8Array | BundleProblem> => {
    try {
      const bytes = await files.read(file, limit);
      return bytes.byteLength > limit ? { code: 'too_large', path: file, limit } : bytes;
    } catch {
      return { code: 'file_missing', path: file };
    }
  };
  const isProblem = (value: Uint8Array | BundleProblem): value is BundleProblem =>
    !(value instanceof Uint8Array);

  let entries: readonly BundleEntry[];
  try {
    entries = await files.list();
  } catch {
    return refused({ code: 'bundle_unreadable' });
  }
  if (entries.length > BUNDLE_LIMITS.files) {
    return refused({ code: 'too_large', limit: BUNDLE_LIMITS.files });
  }

  const head = await read(BUNDLE_FILE, BUNDLE_LIMITS.bundleBytes);
  if (isProblem(head)) {
    return refused(
      head.code === 'too_large' ? head : { code: 'bundle_unreadable', path: BUNDLE_FILE },
    );
  }
  const bundle = parseHead(head);
  if (!bundle) return refused({ code: 'bundle_unreadable', path: BUNDLE_FILE });

  // Exactly the files bundle.json lists, each within its limit.
  const documents = (['portfolio', 'site', 'media'] as const).flatMap((name) => {
    const entry = bundle.documents[name];
    return entry ? [{ name, entry }] : [];
  });
  const expected = new Map<string, { limit: number; size?: number }>();
  for (const { entry } of documents)
    expected.set(entry.file, { limit: BUNDLE_LIMITS.documentBytes });
  for (const entry of Object.values(bundle.snapshots)) {
    expected.set(entry.file, { limit: BUNDLE_LIMITS.documentBytes });
  }
  for (const blob of bundle.blobs) {
    expected.set(blob.file, { limit: BUNDLE_LIMITS.blobBytes, size: blob.size });
  }
  const problems: BundleProblem[] = [];
  const present = new Map<string, BundleEntry>();
  let total = 0;
  for (const entry of entries) {
    total += entry.size;
    if (entry.path === BUNDLE_FILE) continue;
    if (entry.type !== 'file' || !expected.has(entry.path)) {
      problems.push({ code: 'unexpected_file', path: entry.path });
    } else {
      present.set(entry.path, entry);
    }
  }
  for (const [file, { limit, size }] of expected) {
    const found = present.get(file);
    if (!found) problems.push({ code: 'file_missing', path: file });
    else if (found.size > limit) problems.push({ code: 'too_large', path: file, limit });
    else if (size !== undefined && found.size !== size) {
      problems.push({ code: 'hash_mismatch', path: file });
    }
  }
  if (total > BUNDLE_LIMITS.totalBytes) {
    problems.push({ code: 'too_large', limit: BUNDLE_LIMITS.totalBytes });
  }
  if (problems.length > 0) return refused(...problems);

  // The documents and snapshots, read once and hashed; what's parsed is what was hashed.
  const texts = new Map<string, string>();
  const readText = async (file: string, hash: Sha256) => {
    const bytes = await read(file, BUNDLE_LIMITS.documentBytes);
    if (isProblem(bytes)) return problems.push(bytes);
    if (sha256(bytes) !== hash) return problems.push({ code: 'hash_mismatch', path: file });
    try {
      texts.set(file, decoder.decode(bytes));
    } catch {
      problems.push({ code: 'hash_mismatch', path: file });
    }
  };
  for (const { entry } of documents) await readText(entry.file, entry.sourceHash);
  for (const entry of Object.values(bundle.snapshots))
    await readText(entry.file, entry.contentHash);
  if (problems.length > 0) return refused(...problems);

  const snapshots: Record<string, unknown> = {};
  for (const [kind, entry] of Object.entries(bundle.snapshots)) {
    const parsed = parseSnapshotText(kind, texts.get(entry.file)!);
    if (parsed.ok) snapshots[kind] = parsed.value;
    else problems.push({ code: 'does_not_serve', path: entry.file });
  }
  const mediaEntry = bundle.documents.media;
  if (mediaEntry && !parseMediaDocumentText(texts.get(mediaEntry.file)!).ok) {
    problems.push({ code: 'does_not_serve', path: mediaEntry.file });
  }
  const unitHash = unitHashOf(
    Object.fromEntries(documents.map(({ name, entry }) => [name, entry])),
    Object.fromEntries(
      Object.entries(bundle.snapshots).map(([kind, entry]) => [kind, entry.contentHash]),
    ),
  );
  if (unitHash !== bundle.unitHash)
    problems.push({ code: 'unit_hash_mismatch', path: BUNDLE_FILE });
  if (problems.length > 0) return refused(...problems);

  // It serves under this build, as read-only checks a mounted pair, and means
  // what the revision meant.
  const input = (entry: BundleDocument): DocumentInput => ({
    format: entry.format,
    sourceText: texts.get(entry.file)!,
    name: entry.file,
  });
  const checked = checkUnit(
    {
      portfolio: input(bundle.documents.portfolio),
      site: input(bundle.documents.site),
      ...(mediaEntry ? { media: input(mediaEntry) } : {}),
    },
    {
      ...checks,
      validate: (pair) => (checks.validateLive ? checks.validateLive(pair) : checks.validate(pair)),
      snapshots: () => snapshots,
    },
  );
  if (!checked.ok) {
    for (const diagnostic of checked.diagnostics) {
      if (diagnostic.severity === 'warning') continue;
      const document = diagnostic.document as DocumentName;
      problems.push({
        code: 'does_not_serve',
        path: bundle.documents[document]?.file ?? BUNDLE_FILE,
        diagnostic: {
          code: diagnostic.code,
          document: diagnostic.document,
          pointer: diagnostic.pointer,
        },
      });
    }
    return refused(...(problems.length > 0 ? problems : [{ code: 'does_not_serve' as const }]));
  }
  for (const { name, entry } of documents) {
    if (checked.unit[name]?.contentHash !== entry.contentHash) {
      problems.push({ code: 'content_hash_mismatch', path: entry.file });
    }
  }
  if (problems.length > 0) return refused(...problems);
  const unit = publicationUnitOf(checked.unit);

  // Every blob, hashed; the ones the caller keeps, held.
  const kept = keep?.(unit) ?? new Set<Sha256>();
  const listed = new Map(bundle.blobs.map((blob) => [blob.sha256, blob]));
  for (const hash of kept) {
    if (!listed.has(hash)) {
      problems.push({ code: 'blob_unlisted', path: `media/blobs/${hash.slice('sha256:'.length)}` });
    }
  }
  if (problems.length > 0) return refused(...problems);
  const blobs = new Map<Sha256, Uint8Array>();
  let held = 0;
  for (const blob of bundle.blobs) {
    const bytes = await read(blob.file, Math.min(blob.size, BUNDLE_LIMITS.blobBytes));
    if (isProblem(bytes)) {
      problems.push(
        bytes.code === 'too_large' ? { code: 'hash_mismatch', path: blob.file } : bytes,
      );
      continue;
    }
    if (bytes.byteLength !== blob.size || sha256(bytes) !== blob.sha256) {
      problems.push({ code: 'hash_mismatch', path: blob.file });
      continue;
    }
    if (!kept.has(blob.sha256)) continue;
    held += bytes.byteLength;
    if (held > heldBytes) return refused({ code: 'too_large', limit: heldBytes });
    blobs.set(blob.sha256, bytes);
  }
  if (problems.length > 0) return refused(...problems);
  return { ok: true, bundle, unit, blobs };
}
