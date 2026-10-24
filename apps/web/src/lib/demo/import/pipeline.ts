import {
  DIAGNOSTIC_REMEDIATIONS,
  DIAGNOSTIC_SEVERITIES,
  DOCUMENT_MAX_BYTES,
  detectDocument,
  parseSource,
  validatePublicationUnit,
  type Context,
  type Diagnostic,
  type DocumentFormat,
  type Portfolio,
  type Site,
  type SourceDocument,
  type SourceProblem,
} from '@portfolio/schema';
import { redactDiagnostic, type DocumentData } from './redact';

// The Demo Studio's import (#9, PR 3): the logic the module worker runs,
// pure and headless, so Node tests drive it directly. index.ts is the
// main-thread API, and import.worker.ts only wires this to its messages.
//
// runImport(files) takes exactly the two documents of a publication unit
// and returns ImportResult. In order:
//
// 1. Count. More than two files is `too_many_files`; fewer is
//    `not_one_document`.
// 2. Size. A file over #4's DOCUMENT_MAX_BYTES (1 MiB) is `too_large`,
//    checked on the bytes before anything decodes or parses them.
// 3. Read. Bytes that aren't UTF-8 are `invalid`. The format comes from the
//    text, never the file name: JSON when the first character that isn't
//    space is { or [, else YAML. #4's parseSource reads it, with its
//    pre-parse limits: a problem with nesting, entry counts, size, anchors,
//    aliases, or merge keys (a YAML alias bomb among them) is `parse_limits`,
//    and any other syntax problem is `invalid`.
// 4. Identify. #4's detectDocument names each file by its content: the pair
//    needs one portfolio document (an old one-file document counts, and #4's
//    validator then reports legacy.document) and one site document. Anything
//    else is `not_one_document`.
// 5. Validate. validateImport() runs #4's publication-unit validator over
//    the pair in full: the schema with MarkdownSchema's per-field Markdown
//    cap (#10), UrlSchema and MediaSourceSchema's URL rules (#4), ids,
//    references, secrets, and the rest. A blocks-preview finding is
//    `invalid`; any other finding is returned with the unit.
//
// The unit keeps each document's text as imported, under a fixed name
// (portfolio.yml, site.json, ...), so it holds no file name, media, or
// snapshot. The models are #4's parsed documents. Markdown stays Markdown
// source: nothing here writes HTML, so the sanitizing post-pass (#10) runs
// where the content renders, in #7's /preview/local frame.
//
// `unchecked` lists what the validator couldn't check without the catalog
// and extensions the local frame has, as fixed strings: an axis such as
// `site.appearance.colorScheme`, `site.routes.*` for every route toggle,
// `site.variantControls.*`, `site.appearanceInputs.*`, `origin.sample`, a
// `validator:<id>` the build registers, and `other` for anything else. No
// key from the file is in it.
//
// Remote media: each portfolio media asset whose source is an https URL is
// listed in `remoteImages`, by kind, pointer, and host, for the notice:
// images, and video, audio, and documents, which would reveal the visitor
// just the same if anything loaded them. Nothing here loads one; they
// render as placeholders.
//
// Nothing here logs, fetches, or posts. A diagnostic is #4's: a pointer, a
// position, the rule, and #4's fixed wording, which never repeats a value.
// Its pointer, message, and stableId would name the file's own keys, so
// every key the schema doesn't name at its place is replaced by
// `(unknown key)` there (redact.ts); keys the schema names stay. A stableId
// that isn't a key is the id of a section in the file, which #4 holds to
// lowercase words, digits, and hyphens. The file names given are never read.

export type PortfolioDocument = Portfolio;
export type SiteDocument = Site;

/** One file to import: its bytes. The name is the caller's, and nothing reads it. */
export type ImportInput = { readonly name: string; readonly bytes: Uint8Array };

export type ImportedUnit = {
  /** Each document's text as imported, with its format. */
  readonly sources: { readonly portfolio: SourceDocument; readonly site: SourceDocument };
  /** The documents as #4's validator parsed them. */
  readonly models: { readonly portfolio: PortfolioDocument; readonly site: SiteDocument };
  readonly schemaVersions: { readonly portfolio: number; readonly site: number };
};

export type ImportRefusal =
  | 'too_large'
  | 'too_many_files'
  | 'not_one_document'
  | 'parse_limits'
  | 'timeout'
  | 'invalid'
  | 'worker_unavailable';

export type RemoteMediaKind = 'image' | 'video' | 'audio' | 'document';

export type RemoteImage = {
  readonly document: 'portfolio' | 'site';
  readonly kind: RemoteMediaKind;
  readonly pointer: string;
  readonly host: string;
};

export type ImportResult =
  | {
      kind: 'imported';
      unit: ImportedUnit;
      diagnostics: readonly Diagnostic[];
      remoteImages: readonly RemoteImage[];
      /** What the validator couldn't check here, as fixed strings. */
      unchecked?: readonly string[];
    }
  | { kind: 'refused'; code: ImportRefusal; diagnostics: readonly Diagnostic[] };

/** The most bytes one file may hold: #4's document cap, 1 MiB. */
export const IMPORT_MAX_BYTES = DOCUMENT_MAX_BYTES;

/** #4's pre-parse limit codes: what keeps a parser's work bounded, the alias bomb's included. */
const LIMIT_CODES: ReadonlySet<string> = new Set([
  'TOO_LARGE',
  'TOO_DEEP',
  'TOO_MANY',
  'ANCHOR',
  'ALIAS',
  'MERGE_KEY',
]);

const NOT_TEXT = "The file isn't UTF-8 text.";

type Slot = 'portfolio' | 'site';

/** One file once read: its text and format, and what parseSource found. */
type Read =
  | { readonly ok: true; readonly text: string; readonly format: DocumentFormat; data: unknown }
  | { readonly ok: false; readonly problems: readonly SourceProblem[] };

export function runImport(files: readonly ImportInput[]): ImportResult {
  if (files.length > 2) return refused('too_many_files');
  if (files.length < 2) return refused('not_one_document');
  if (files.some(({ bytes }) => bytes.byteLength > IMPORT_MAX_BYTES)) return refused('too_large');

  const reads = files.map(({ bytes }) => read(bytes));
  const kinds = reads.map((entry) => (entry.ok ? slotOf(entry.data) : undefined));
  const failed = reads.flatMap((entry, index) => (entry.ok ? [] : [{ index, entry }]));
  if (failed.length > 0) {
    // A file that didn't parse can't say which document it is: it takes the
    // slot the other file leaves, or its position when neither parsed.
    const slotFor = (index: number): Slot => {
      const other = kinds[1 - index];
      if (other) return other === 'portfolio' ? 'site' : 'portfolio';
      return index === 0 ? 'portfolio' : 'site';
    };
    const problems = failed.flatMap(({ index, entry }) =>
      entry.problems.map((problem) => ({ slot: slotFor(index), problem })),
    );
    const limits = problems.filter(({ problem }) => LIMIT_CODES.has(problem.code));
    const shown = limits.length > 0 ? limits : problems;
    return refused(
      limits.length > 0 ? 'parse_limits' : 'invalid',
      // No data to look in, so every key in a pointer is redacted.
      shown.map(({ slot, problem }) => redactDiagnostic(parseDiagnostic(slot, problem), {})),
    );
  }

  const portfolioAt = kinds.indexOf('portfolio');
  const siteAt = kinds.indexOf('site');
  if (portfolioAt === -1 || siteAt === -1 || portfolioAt === siteAt) {
    return refused('not_one_document');
  }
  const sourceOf = (index: number, slot: Slot): SourceDocument => {
    const entry = reads[index] as Extract<Read, { ok: true }>;
    return { text: entry.text, format: entry.format, name: documentName(slot, entry.format) };
  };
  return validateImport({
    portfolio: sourceOf(portfolioAt, 'portfolio'),
    site: sourceOf(siteAt, 'site'),
  });
}

/**
 * Step 5 alone: #4's validator over a pair, and the remote images. The local
 * frame calls it again on what it's sent, with the catalog and extensions it
 * has in `ctx`.
 */
export function validateImport(
  sources: { readonly portfolio: SourceDocument; readonly site: SourceDocument },
  ctx: Context = {},
): ImportResult {
  const result = validatePublicationUnit(sources, ctx);
  const diagnostics = redacted(result.diagnostics, sources);
  if (!result.pair) return refused('invalid', diagnostics);
  const { portfolio, site } = result.pair;
  const unchecked = uncheckedNames(result.notChecked);
  return {
    kind: 'imported',
    unit: {
      sources: { portfolio: sources.portfolio, site: sources.site },
      models: { portfolio, site },
      schemaVersions: { portfolio: portfolio.schemaVersion, site: site.schemaVersion },
    },
    diagnostics,
    remoteImages: remoteImages(portfolio),
    ...(unchecked.length > 0 ? { unchecked } : {}),
  };
}

/** The media assets whose source is an https URL, by kind, pointer, and host. Reads only; loads nothing. */
export function remoteImages(portfolio: PortfolioDocument): RemoteImage[] {
  const found: RemoteImage[] = [];
  (portfolio.media ?? []).forEach((asset, index) => {
    if (!/^https:/i.test(asset.source)) return;
    // MediaSourceSchema has already accepted it as an https URL with a host.
    found.push({
      document: 'portfolio',
      kind: asset.kind,
      pointer: `/media/${index}/source`,
      host: new URL(asset.source).host,
    });
  });
  return found;
}

/** The validator's findings, with the keys the schema doesn't name redacted. */
function redacted(
  diagnostics: readonly Diagnostic[],
  sources: { readonly portfolio: SourceDocument; readonly site: SourceDocument },
): Diagnostic[] {
  if (diagnostics.length === 0) return [];
  const dataOf = (source: SourceDocument) => {
    const parsed = parseSource(source.text, source.format === 'json' ? 'json' : 'yaml');
    return parsed.ok ? parsed.data : undefined;
  };
  const data: DocumentData = { portfolio: dataOf(sources.portfolio), site: dataOf(sources.site) };
  return diagnostics.map((diagnostic) => redactDiagnostic(diagnostic, data));
}

/** Entries the validator names by a key from the file, which this lists by their place alone. */
const KEYED_UNCHECKED = /^(site\.(?:routes|variantControls|appearanceInputs))\.[\s\S]*$/;
const FIXED_UNCHECKED = [
  /^site\.appearance\.(?:variant|designLanguage|colorScheme|typography|displayMode)$/,
  /^site\.(?:routes|variantControls|appearanceInputs)\.\*$/,
  /^origin\.(?:sample|stale)$/,
  /^(?:derived\.unapproved|id\.reused|urls\.vanished)$/,
  /^validator:[a-z0-9@/._-]+$/,
];

/** The validator's notChecked as fixed strings, each once, sorted. */
export function uncheckedNames(notChecked: readonly string[]): string[] {
  const names = notChecked.map((entry) => {
    const name = entry.replace(KEYED_UNCHECKED, '$1.*');
    return FIXED_UNCHECKED.some((pattern) => pattern.test(name)) ? name : 'other';
  });
  return [...new Set(names)].sort();
}

/**
 * What the worker answers a message with: runImport over its files, or
 * `invalid` for a message that isn't `{ files: ImportInput[] }`. It never
 * throws.
 */
export function importMessage(data: unknown): ImportResult {
  try {
    const files = (data as { files?: unknown } | null)?.files;
    if (!Array.isArray(files) || !files.every(isInput)) return refused('invalid');
    return runImport(files);
  } catch {
    return refused('invalid');
  }
}

export function refused(
  code: ImportRefusal,
  diagnostics: readonly Diagnostic[] = [],
): ImportResult {
  return { kind: 'refused', code, diagnostics };
}

function isInput(value: unknown): value is ImportInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { bytes?: unknown }).bytes instanceof Uint8Array
  );
}

function read(bytes: Uint8Array): Read {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, problems: [{ code: 'NOT_TEXT', message: NOT_TEXT }] };
  }
  const format = formatOf(text);
  const parsed = parseSource(text, format);
  return parsed.ok ? { ok: true, text, format, data: parsed.data } : parsed;
}

/** JSON when the text starts with { or [ past any byte order mark and space, else YAML. */
function formatOf(text: string): DocumentFormat {
  return /^\uFEFF?\s*[[{]/.test(text) ? 'json' : 'yaml';
}

function slotOf(data: unknown): Slot | undefined {
  const kind = detectDocument(data);
  if (kind === 'site') return 'site';
  // An old one-file document goes in the portfolio's place, where the
  // validator reports legacy.document and names the migration.
  return kind === 'portfolio' || kind === 'legacy' ? 'portfolio' : undefined;
}

function documentName(slot: Slot, format: DocumentFormat): string {
  return `${slot}.${format === 'json' ? 'json' : 'yml'}`;
}

function parseDiagnostic(document: Slot, problem: SourceProblem): Diagnostic {
  return {
    code: 'parse.syntax',
    severity: DIAGNOSTIC_SEVERITIES['parse.syntax'],
    document,
    pointer: problem.pointer ?? '',
    ...(problem.line !== undefined ? { line: problem.line, column: problem.column } : {}),
    message: problem.message,
    remediation: DIAGNOSTIC_REMEDIATIONS['parse.syntax'],
  };
}
