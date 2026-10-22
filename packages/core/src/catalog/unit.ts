import { createHash } from 'node:crypto';
import {
  canonicalize,
  DOCUMENT_MAX_BYTES,
  parseSource,
  type Diagnostic,
  type DocumentFormat,
  type ParsedPair,
  type PublicationUnitResult,
  type SourceDocument,
} from '@portfolio/schema';

// A publication unit (#3, items 5 and 6): the portfolio and site documents
// (#4), an optional media document (#10, opaque here), and the snapshots
// derived from them at publish. Each document keeps its text as written,
// comments and key order included, and its normalized model. Hashes are
// `sha256:<hex>`: a document's contentHash covers #4's canonical form of its
// model, so YAML and JSON with equal content hash equally, its sourceHash
// covers its bytes, and the unitHash covers every document's and snapshot's
// contentHash by name.
//
// The store builds a revision with checkUnit(), and so does read-only's
// SourceCatalogReader from the mounted documents (item 19), so this module
// is shared code, not owner code: it records nothing in the owner load
// trace and imports nothing that does.

/** A SHA-256 digest as the store writes one: `sha256:` and 64 hex digits. */
export type Sha256 = `sha256:${string}`;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
export const isSha256 = (value: unknown): value is Sha256 =>
  typeof value === 'string' && SHA256.test(value);

export type DocumentName = 'portfolio' | 'site' | 'media';
export const DOCUMENT_NAMES: readonly DocumentName[] = Object.freeze([
  'portfolio',
  'site',
  'media',
]);

/** A document as an author gives it. */
export interface DocumentInput {
  readonly format: DocumentFormat;
  readonly sourceText: string;
  /**
   * Its file's name, such as portfolio.yaml, which a finding's remediation
   * names. Without one, the name a revision stores it under: portfolio.yml.
   */
  readonly name?: string;
}

export interface UnitInput {
  readonly portfolio: DocumentInput;
  readonly site: DocumentInput;
  readonly media?: DocumentInput;
}

/** A document of a unit that validated: its text, its normalized model, and their hashes. */
export interface UnitDocument {
  readonly format: DocumentFormat;
  readonly sourceText: string;
  readonly model: unknown;
  /** The model's `schemaVersion`, or null when it has none, as #10's media may not. */
  readonly schemaVersion: number | null;
  readonly sourceHash: Sha256;
  readonly contentHash: Sha256;
}

export interface Unit {
  readonly portfolio: UnitDocument;
  readonly site: UnitDocument;
  readonly media?: UnitDocument;
  /** Derived at publish, by kind: `controls` (#5), later #19's tokens and #10's adapter data. */
  readonly snapshots: Readonly<Record<string, unknown>>;
  readonly unitHash: Sha256;
}

/** What a variant or pack is, as a manifest records it. */
export interface Versioned {
  readonly id: string;
  readonly version: string;
}

/** What the build renders a pair with: the variant and packs it selects, and the contract versions. */
export interface Rendering {
  readonly variant: Versioned | null;
  readonly packs: readonly Versioned[];
  readonly contracts: Readonly<Record<string, string>>;
}

/**
 * The checks a unit goes through, from the composition root: #4's composite
 * validator bound to the build's context, and what other packages derive
 * from a valid unit.
 */
export interface UnitChecks {
  /**
   * validatePublicationUnit with the build's context (#4, #5), as a publish
   * checks a unit: what can go live. An unregistered variant blocks it.
   */
  validate(pair: {
    readonly portfolio: SourceDocument;
    readonly site: SourceDocument;
  }): PublicationUnitResult;
  /**
   * The same, as serving checks a revision that is live already (#5's live
   * validators): an unregistered variant or stale controls only warn, since
   * the fallback composition and the controls' defaults render. Without
   * it, `validate` serves for both.
   */
  validateLive?(pair: {
    readonly portfolio: SourceDocument;
    readonly site: SourceDocument;
  }): PublicationUnitResult;
  /** Snapshots derived at publish, by kind: #5's materializeControls as `controls`. */
  snapshots?(pair: ParsedPair, media: unknown): Readonly<Record<string, unknown>>;
  /** The blobs a media document references (#10). None until #10 registers it. */
  referencedBlobs?(media: unknown): readonly Sha256[];
  /** What the build renders a pair with, for the manifest. */
  rendering?(pair: ParsedPair): Rendering;
  /** This build's version, for the manifest. */
  readonly appVersion: string;
}

/** A finding about a unit: #4's and #10's, or the store's own about the media document. */
export interface UnitDiagnostic {
  readonly code: string;
  readonly severity: Diagnostic['severity'];
  /** One of the unit's documents, or, for #10's, the snapshots beside them. */
  readonly document: DocumentName | Diagnostic['document'];
  readonly pointer: string;
  readonly line?: number;
  readonly column?: number;
  readonly message: string;
  readonly remediation: string;
}

export const sha256 = (bytes: string | Uint8Array): Sha256 =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/** SHA-256 of #4's canonical form of `model`: equal content hashes equally, in either format. */
export const contentHash = (model: unknown): Sha256 => sha256(canonicalize(model));

/** The hash over a map of names to hashes, in its canonical form. */
export const hashOfHashes = (hashes: Readonly<Record<string, Sha256>>): Sha256 =>
  sha256(canonicalize(hashes));

/** The name a unit's hash map gives a snapshot. */
export const snapshotKey = (kind: string) => `snapshots/${kind}`;

/** The unitHash of documents and snapshots by their content hashes. */
export function unitHashOf(
  documents: Partial<Record<DocumentName, { readonly contentHash: Sha256 }>>,
  snapshots: Readonly<Record<string, Sha256>>,
): Sha256 {
  const hashes: Record<string, Sha256> = {};
  for (const name of DOCUMENT_NAMES) {
    const document = documents[name];
    if (document) hashes[name] = document.contentHash;
  }
  for (const [kind, hash] of Object.entries(snapshots)) hashes[snapshotKey(kind)] = hash;
  return hashOfHashes(hashes);
}

/**
 * The sourceHash of an import: the hash over each mounted file's name and
 * the hash of its bytes, so a renamed file or a changed byte changes it.
 */
export const importSourceHash = (files: Readonly<Record<string, Uint8Array | string>>): Sha256 =>
  hashOfHashes(
    Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha256(bytes)])),
  );

const SNAPSHOT_KIND = /^[a-z][a-z0-9-]{0,63}$/;
export const isSnapshotKind = (kind: string) => SNAPSHOT_KIND.test(kind);

/** The file name a document of `format` has: portfolio.yml, site.json. */
export const documentFileName = (name: DocumentName, format: DocumentFormat) =>
  `${name}.${format === 'yaml' ? 'yml' : 'json'}`;

const sourceOf = (name: 'portfolio' | 'site', input: DocumentInput): SourceDocument => ({
  text: input.sourceText,
  format: input.format,
  name: input.name ?? documentFileName(name, input.format),
});

const blocks = (diagnostic: { readonly severity: Diagnostic['severity'] }) =>
  diagnostic.severity === 'blocks-preview' || diagnostic.severity === 'blocks-publish';

/** Whether a document's text is past the 1 MiB a document may hold. */
export const oversize = (input: DocumentInput) =>
  Buffer.byteLength(input.sourceText, 'utf8') > DOCUMENT_MAX_BYTES;

function schemaVersionOf(model: unknown): number | null {
  const version = (model as { schemaVersion?: unknown } | null)?.schemaVersion;
  return typeof version === 'number' && Number.isSafeInteger(version) ? version : null;
}

/** The media document's own finding when it doesn't parse: #4's validator never reads it. */
function mediaDiagnostics(input: DocumentInput): {
  model: unknown;
  diagnostics: UnitDiagnostic[];
} {
  const parsed = parseSource(input.sourceText, input.format);
  if (parsed.ok) return { model: parsed.data, diagnostics: [] };
  return {
    model: null,
    diagnostics: parsed.problems.map((problem) => ({
      code: 'parse.syntax',
      severity: 'blocks-preview' as const,
      document: 'media' as const,
      pointer: problem.pointer ?? '',
      ...(problem.line === undefined ? {} : { line: problem.line }),
      ...(problem.column === undefined ? {} : { column: problem.column }),
      message: problem.message,
      remediation: 'Fix the media document at this position.',
    })),
  };
}

export type CheckedUnit =
  | {
      readonly ok: true;
      readonly unit: Unit;
      readonly rendering: Rendering;
      readonly diagnostics: readonly UnitDiagnostic[];
    }
  | { readonly ok: false; readonly diagnostics: readonly UnitDiagnostic[] };

/** What a manifest records when the build doesn't say what it renders with. */
export const NO_RENDERING: Rendering = Object.freeze({
  variant: null,
  packs: Object.freeze([]) as readonly Versioned[],
  contracts: Object.freeze({}),
});

/**
 * Normalizes and validates a unit with #4's composite validator and builds
 * it: models, snapshots, and hashes. It fails on any `blocks-preview` or
 * `blocks-publish` finding; warnings come back with the unit.
 */
export function checkUnit(input: UnitInput, checks: UnitChecks): CheckedUnit {
  const result = checks.validate({
    portfolio: sourceOf('portfolio', input.portfolio),
    site: sourceOf('site', input.site),
  });
  const media = input.media ? mediaDiagnostics(input.media) : undefined;
  const diagnostics: UnitDiagnostic[] = [...result.diagnostics, ...(media?.diagnostics ?? [])];
  if (!result.pair || diagnostics.some(blocks)) return { ok: false, diagnostics };

  const documentOf = (source: DocumentInput, model: unknown): UnitDocument => ({
    format: source.format,
    sourceText: source.sourceText,
    model,
    schemaVersion: schemaVersionOf(model),
    sourceHash: sha256(source.sourceText),
    contentHash: contentHash(model),
  });
  // JSON round trips leave plain data alone and drop what canonicalize can't hold.
  const portfolio = documentOf(input.portfolio, plainModel(result.pair.portfolio));
  const site = documentOf(input.site, plainModel(result.pair.site));
  const mediaDocument = input.media && media ? documentOf(input.media, media.model) : undefined;
  const snapshots = checks.snapshots?.(result.pair, mediaDocument?.model) ?? {};
  const snapshotHashes: Record<string, Sha256> = {};
  for (const [kind, value] of Object.entries(snapshots)) {
    if (!isSnapshotKind(kind)) throw new TypeError(`Not a snapshot kind: ${kind}.`);
    snapshotHashes[kind] = contentHash(value);
  }
  const documents = { portfolio, site, ...(mediaDocument ? { media: mediaDocument } : {}) };
  const unit: Unit = Object.freeze({
    ...documents,
    snapshots: Object.freeze({ ...snapshots }),
    unitHash: unitHashOf(documents, snapshotHashes),
  });
  const rendering = checks.rendering?.(result.pair) ?? NO_RENDERING;
  return { ok: true, unit, rendering, diagnostics };
}

/**
 * The findings on a unit that may not validate, and each document's parsed
 * data, or null when its text doesn't parse. For drafts, which save whatever
 * they hold.
 */
export function diagnoseUnit(
  input: UnitInput,
  checks: UnitChecks,
): {
  readonly diagnostics: readonly UnitDiagnostic[];
  readonly models: Readonly<Partial<Record<DocumentName, unknown>>>;
} {
  const result = checks.validate({
    portfolio: sourceOf('portfolio', input.portfolio),
    site: sourceOf('site', input.site),
  });
  const media = input.media ? mediaDiagnostics(input.media) : undefined;
  const models: Partial<Record<DocumentName, unknown>> = {};
  for (const name of DOCUMENT_NAMES) {
    const document = input[name];
    if (!document) continue;
    const parsed = parseSource(document.sourceText, document.format);
    models[name] = parsed.ok ? plainModel(parsed.data) : null;
  }
  return { diagnostics: [...result.diagnostics, ...(media?.diagnostics ?? [])], models };
}

/** A model as plain JSON data: what a revision stores and canonicalize() hashes. */
export function plainModel(model: unknown): unknown {
  const text = JSON.stringify(model);
  return text === undefined ? null : (JSON.parse(text) as unknown);
}

/** The blobs a unit references. */
export function blobsOf(unit: Pick<Unit, 'media'>, checks: UnitChecks): readonly Sha256[] {
  const blobs = checks.referencedBlobs?.(unit.media?.model) ?? [];
  for (const blob of blobs) {
    if (!isSha256(blob)) throw new TypeError('A referenced blob is not a SHA-256 digest.');
  }
  return [...new Set(blobs)].sort();
}
