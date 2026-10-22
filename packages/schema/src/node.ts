import fs from 'node:fs';
import path from 'node:path';
import { MIGRATE_COMMAND } from './legacy';
import { parseMediaDocumentText, type MediaDocument } from './media';
import { redactSecrets } from './secrets';
import { isSnapshotKind, parseSnapshotText, type UnitFileProblem } from './snapshots';
import type { ParsedPair } from './view';
import { detectFormat, DOCUMENT_MAX_BYTES, type DocumentFormat } from './source';
import {
  DIAGNOSTIC_REMEDIATIONS,
  DIAGNOSTIC_SEVERITIES,
  legacyDocumentRecord,
  validatePublicationUnit,
  type Context,
  type Diagnostic,
  type DiagnosticCode,
} from './validate';

// `@portfolio/schema/node`: the publication unit from a directory (#4, items
// 4 and 5). Node only, so the browser-safe validator stays out of it.
// Startup, `pnpm config:validate`, and the skill's validate.mjs read pairs
// through here, so they report the same records.

export type PairDocument = 'portfolio' | 'site';

const DOCUMENT_FILE = /^(portfolio|site)\.(yml|yaml|json)$/;
/** The old one-file format in TOML, which this release doesn't read. */
const LEGACY_TOML = 'portfolio.toml';

/**
 * A byte order mark takes three bytes and isn't counted, so this many bytes
 * always hold more text than a document may: the parser refuses them where
 * they pass the limit.
 */
const READ_LIMIT = DOCUMENT_MAX_BYTES + 4;

/** One document's file, as read. */
export interface PairSource {
  /** The file's name, such as portfolio.yml. */
  readonly name: string;
  readonly path: string;
  readonly format: DocumentFormat;
  readonly text: string;
}

export type LoadPairResult =
  | {
      /** Nothing blocks: the pair can render and go live. */
      readonly ok: true;
      readonly pair: ParsedPair;
      /** Warnings only. */
      readonly diagnostics: readonly Diagnostic[];
      readonly notChecked: readonly string[];
      readonly sources: { readonly portfolio: PairSource; readonly site: PairSource };
    }
  | {
      readonly ok: false;
      /** Every finding, at least one of them blocking. Empty when the directory can't be listed. */
      readonly diagnostics: readonly Diagnostic[];
      readonly notChecked: readonly string[];
      /** Why the directory itself can't be read, when that's the problem. */
      readonly directory?: 'missing' | 'not-directory' | 'unreadable';
      /** Which documents the directory lacks, when that's the problem. */
      readonly missing?: readonly PairDocument[];
      /** The pair's two files once there are both, or the portfolio's alone when it's in the old format. */
      readonly files?: Partial<PairFiles>;
    };

export type PairFiles = { readonly [D in PairDocument]: string };

/** Which files hold the pair in `dir`, or what's wrong with them. */
export type FindPairResult =
  { readonly ok: true; readonly files: PairFiles } | Extract<LoadPairResult, { ok: false }>;

const record = (
  code: DiagnosticCode,
  document: PairDocument,
  message: string,
  remediation = DIAGNOSTIC_REMEDIATIONS[code],
): Diagnostic => ({
  code,
  severity: DIAGNOSTIC_SEVERITIES[code],
  document,
  pointer: '',
  message,
  remediation,
});

/**
 * Finds the pair in a directory: exactly one `portfolio.{yml,yaml,json}` and
 * one `site.{yml,yaml,json}`. A document it lacks is `source.missing`, and
 * one in two formats `source.duplicate`. A `portfolio.toml` is the old
 * format, and the only thing reported, as is an old-format portfolio with no
 * site document beside it, the layout an upgrade finds. Other files are
 * ignored. `ctx` names the ids the old format's record suggests.
 */
export function findPair(dir: string, ctx: Context = {}): FindPairResult {
  let names: string[];
  try {
    // Not a path the build can know: the comment keeps Turbopack from tracing it.
    names = fs.readdirSync(/*turbopackIgnore: true*/ dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const directory =
      code === 'ENOENT' ? 'missing' : code === 'ENOTDIR' ? 'not-directory' : 'unreadable';
    return { ok: false, diagnostics: [], notChecked: [], directory };
  }
  if (names.includes(LEGACY_TOML)) {
    return {
      ok: false,
      diagnostics: [
        record(
          'legacy.document',
          'portfolio',
          `${LEGACY_TOML} is in the old one-file format, in TOML, which this release doesn't read.`,
          `Convert it to YAML or JSON first, then run ${MIGRATE_COMMAND} on that to split it into portfolio.yml and site.yml, and remove ${LEGACY_TOML}.`,
        ),
      ],
      notChecked: [],
    };
  }
  const found: Record<PairDocument, string[]> = { portfolio: [], site: [] };
  for (const name of [...names].sort()) {
    const document = DOCUMENT_FILE.exec(name)?.[1] as PairDocument | undefined;
    if (document) found[document].push(name);
  }
  const diagnostics: Diagnostic[] = [];
  const missing: PairDocument[] = [];
  for (const document of ['portfolio', 'site'] as const) {
    const files = found[document];
    if (files.length === 0) {
      missing.push(document);
      diagnostics.push(
        record(
          'source.missing',
          document,
          `The directory holds no ${document} document: ${document}.yml, ${document}.yaml, or ${document}.json.`,
          `Add ${document}.yml, or its .yaml or .json form, to the directory. ${document}.example.yml is one to start from.`,
        ),
      );
    } else if (files.length > 1) {
      diagnostics.push(
        record(
          'source.duplicate',
          document,
          `The directory holds ${list(files)}, one ${document} document in ${files.length} formats.`,
        ),
      );
    }
  }
  if (missing.length === 1 && missing[0] === 'site' && found.portfolio.length === 1) {
    const portfolio = path.join(/*turbopackIgnore: true*/ dir, found.portfolio[0]!);
    const legacy = legacyRecord(portfolio, ctx);
    if (legacy) return { ok: false, diagnostics: [legacy], notChecked: [], files: { portfolio } };
  }
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics, notChecked: [], ...(missing.length ? { missing } : {}) };
  }
  return {
    ok: true,
    files: {
      portfolio: path.join(/*turbopackIgnore: true*/ dir, found.portfolio[0]!),
      site: path.join(/*turbopackIgnore: true*/ dir, found.site[0]!),
    },
  };
}

/**
 * Reads the pair in `dir` and validates it as one publication unit. It
 * returns the validated pair or the diagnostics, never partial data, and
 * never throws.
 */
export function loadPair(dir: string, ctx: Context = {}): LoadPairResult {
  const found = findPair(dir, ctx);
  return found.ok ? readPair(found.files, ctx) : found;
}

/**
 * Reads the pair from two files, such as the bundled portfolio.example.yml
 * and site.example.yml, and validates it like loadPair(). A file that doesn't
 * exist is `source.missing`, and one that can't be read `source.unreadable`.
 */
export function readPair(files: PairFiles, ctx: Context = {}): LoadPairResult {
  const sources: Partial<Record<PairDocument, PairSource>> = {};
  const diagnostics: Diagnostic[] = [];
  for (const document of ['portfolio', 'site'] as const) {
    const file = files[document];
    const name = path.basename(file);
    try {
      sources[document] = { name, path: file, format: detectFormat(name), text: readBounded(file) };
    } catch (error) {
      diagnostics.push(
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? record('source.missing', document, `${name} doesn't exist.`)
          : record(
              'source.unreadable',
              document,
              `${name} can't be read.`,
              `Make ${name} a file the server's user can read.`,
            ),
      );
    }
  }
  if (!sources.portfolio || !sources.site) return { ok: false, diagnostics, notChecked: [], files };
  const { portfolio, site } = sources;
  const result = validatePublicationUnit({ portfolio, site }, ctx);
  const blocking = result.diagnostics.some(({ severity }) => severity !== 'warning');
  if (!result.pair || blocking) {
    return { ok: false, diagnostics: result.diagnostics, notChecked: result.notChecked, files };
  }
  return {
    ok: true,
    pair: result.pair,
    diagnostics: result.diagnostics,
    notChecked: result.notChecked,
    sources: { portfolio, site },
  };
}

/** The old format's record for the portfolio in `file`, or undefined when it's current or can't be read. */
function legacyRecord(file: string, ctx: Context): Diagnostic | undefined {
  const name = path.basename(file);
  try {
    return legacyDocumentRecord({ name, format: detectFormat(name), text: readBounded(file) }, ctx);
  } catch {
    return undefined;
  }
}

/** The names of the files the result is about: both once there are both. */
export function pairFileNames(result: LoadPairResult): Partial<PairFiles> | undefined {
  if (result.ok)
    return { portfolio: result.sources.portfolio.name, site: result.sources.site.name };
  if (!result.files) return undefined;
  const { portfolio, site } = result.files;
  return {
    ...(portfolio !== undefined ? { portfolio: path.basename(portfolio) } : {}),
    ...(site !== undefined ? { site: path.basename(site) } : {}),
  };
}

/**
 * The records as `pnpm config:validate` and the portfolio-author skill print
 * them: where each one is, its code and severity, then what's wrong and how
 * to fix it, with a blank line after each.
 */
export function formatRecords(result: LoadPairResult): string {
  const names = pairFileNames(result);
  return result.diagnostics
    .map((record) => {
      const file =
        record.file ??
        (record.document === 'portfolio' || record.document === 'site'
          ? names?.[record.document]
          : undefined) ??
        `${record.document} document`;
      const where = record.line === undefined ? file : `${file}:${record.line}:${record.column}`;
      const pointer = record.pointer === '' ? '' : ` at ${record.pointer}`;
      return `${where}: ${record.code} (${record.severity})${pointer}\n  ${record.message}\n  ${record.remediation}\n\n`;
    })
    .join('');
}

/**
 * The file's text, from at most READ_LIMIT bytes, so an oversized file is
 * never read or decoded whole. The size on disk sets the first read, and no
 * read passes the limit, even if the file grows meanwhile. Anything but a
 * regular file is refused before it's opened: opening a FIFO waits for a
 * writer, which would hang startup.
 */
function readBounded(file: string): string {
  if (!fs.statSync(/*turbopackIgnore: true*/ file).isFile()) {
    throw Object.assign(new Error(`${path.basename(file)} isn't a regular file.`), {
      code: 'ENOTFILE',
    });
  }
  const fd = fs.openSync(/*turbopackIgnore: true*/ file, 'r');
  try {
    const chunks: Buffer[] = [];
    let length = 0;
    let want = Math.max(fs.fstatSync(fd).size, 1);
    while (length < READ_LIMIT) {
      const chunk = Buffer.alloc(Math.min(want, READ_LIMIT - length));
      const read = fs.readSync(fd, chunk, 0, chunk.length, length);
      if (read === 0) break;
      chunks.push(chunk.subarray(0, read));
      length += read;
      want = 64 * 1024;
    }
    return Buffer.concat(chunks, length).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function list(items: readonly string[]): string {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

/** The snapshots and the media document beside a pair, as the readers hand them to the view. */
export interface UnitFiles {
  /** Every snapshot that reads, by kind: the known kinds checked, the rest as plain JSON. */
  readonly snapshots: Readonly<Record<string, unknown>>;
  /** media/media.json, checked, when the directory has one that reads. */
  readonly media?: MediaDocument;
  /**
   * Problems reading them. A blocking one stops `read-only` startup: a
   * snapshot or media document that doesn't read would otherwise render as
   * missing.
   */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Reads `<dir>/snapshots/<kind>.json` and `<dir>/media/media.json`, the
 * layout #3's full `export-revision` writes beside the two documents. Both
 * are optional. Each file is JSON alone, at most 1 MiB, through #4's
 * pre-parse guards; any other entry in snapshots/ is a warning. Never throws.
 */
export function readUnitFiles(dir: string): UnitFiles {
  const snapshots = readSnapshots(dir);
  const media = readMediaDocument(dir);
  return {
    snapshots: snapshots.snapshots,
    ...(media.media ? { media: media.media } : {}),
    diagnostics: [...snapshots.diagnostics, ...media.diagnostics],
  };
}

/** `<dir>/snapshots/<kind>.json`, each kind read and checked. Never throws. */
export function readSnapshots(dir: string): {
  readonly snapshots: Readonly<Record<string, unknown>>;
  readonly diagnostics: readonly Diagnostic[];
} {
  const folder = path.join(/*turbopackIgnore: true*/ dir, 'snapshots');
  const snapshots: Record<string, unknown> = {};
  const diagnostics: Diagnostic[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(/*turbopackIgnore: true*/ folder);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { snapshots, diagnostics };
    diagnostics.push(
      code === 'ENOTDIR'
        ? fileRecord(
            'snapshot.ignored',
            'snapshots',
            'snapshots',
            "snapshots isn't a directory, so it holds no snapshot.",
          )
        : fileRecord(
            'snapshot.invalid',
            'snapshots',
            'snapshots',
            "The snapshots directory can't be read.",
          ),
    );
    return { snapshots, diagnostics };
  }
  for (const name of [...names].sort()) {
    if (name.startsWith('.')) continue;
    const file = `snapshots/${name}`;
    const kind = name.endsWith('.json') ? name.slice(0, -'.json'.length) : undefined;
    if (kind === undefined || !isSnapshotKind(kind)) {
      diagnostics.push(
        fileRecord(
          'snapshot.ignored',
          'snapshots',
          redactSecrets(file),
          `${redactSecrets(file)} isn't a snapshot, <kind>.json, so it's ignored.`,
        ),
      );
      continue;
    }
    let text: string;
    try {
      text = readBounded(path.join(/*turbopackIgnore: true*/ folder, name));
    } catch {
      diagnostics.push(fileRecord('snapshot.invalid', 'snapshots', file, `${file} can't be read.`));
      continue;
    }
    const result = parseSnapshotText(kind, text);
    if (result.ok) {
      Object.defineProperty(snapshots, kind, {
        value: result.value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    } else {
      diagnostics.push(...problemRecords(result.problems, 'snapshots', file, 'snapshot'));
    }
  }
  return { snapshots, diagnostics };
}

/** `<dir>/media/media.json`, read and checked, when there is one. Never throws. */
export function readMediaDocument(dir: string): {
  readonly media?: MediaDocument;
  readonly diagnostics: readonly Diagnostic[];
} {
  const file = 'media/media.json';
  let text: string;
  try {
    text = readBounded(path.join(/*turbopackIgnore: true*/ dir, 'media', 'media.json'));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { diagnostics: [] };
    return { diagnostics: [fileRecord('media.invalid', 'media', file, `${file} can't be read.`)] };
  }
  const result = parseMediaDocumentText(text);
  return result.ok
    ? { media: result.value, diagnostics: [] }
    : { diagnostics: problemRecords(result.problems, 'media', file, 'media') };
}

function fileRecord(
  code: DiagnosticCode,
  document: 'snapshots' | 'media',
  file: string,
  message: string,
  extra: { pointer?: string; line?: number; column?: number } = {},
): Diagnostic {
  return {
    code,
    severity: DIAGNOSTIC_SEVERITIES[code],
    document,
    file,
    pointer: extra.pointer ?? '',
    ...(extra.line !== undefined ? { line: extra.line, column: extra.column } : {}),
    message,
    remediation: DIAGNOSTIC_REMEDIATIONS[code],
  };
}

/** A file's problems as records: its first syntax problem, else each schema problem. */
function problemRecords(
  problems: readonly UnitFileProblem[],
  document: 'snapshots' | 'media',
  file: string,
  prefix: 'snapshot' | 'media',
): Diagnostic[] {
  const syntax = problems.find(({ kind }) => kind === 'syntax');
  if (syntax) {
    return [
      fileRecord(`${prefix}.syntax`, document, file, `${file}: ${syntax.message}`, {
        ...(syntax.line !== undefined ? { line: syntax.line, column: syntax.column } : {}),
      }),
    ];
  }
  return problems.map((problem) =>
    fileRecord(`${prefix}.invalid`, document, file, `${file}: ${problem.message}`, {
      ...(problem.pointer !== undefined ? { pointer: problem.pointer } : {}),
      ...(problem.line !== undefined ? { line: problem.line, column: problem.column } : {}),
    }),
  );
}
