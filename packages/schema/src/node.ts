import fs from 'node:fs';
import path from 'node:path';
import { MIGRATE_COMMAND } from './legacy';
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
 * read passes the limit, even if the file grows meanwhile.
 */
function readBounded(file: string): string {
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
