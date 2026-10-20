import 'server-only';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  detectFormat,
  DOCUMENT_MAX_BYTES,
  parsePortfolio,
  type ContentExtension,
  type DocumentProblem,
  type DocumentWarning,
} from '@portfolio/schema';
import type { CatalogReader, LiveRevision } from './catalog-port';
import type { ConfigIssue, RuntimeMode } from './config';
import { deepFreeze } from './freeze';

// The documents adapter: the CatalogReader for a mounted PORTFOLIO_SOURCE_DIR.
// It reads the one portfolio document once at startup, validates it, and
// freezes the result. Under `next dev` only, it re-validates whenever a
// document changes on disk.

/** identity.name of each sample the image ships. A real deployment can't use one. */
export const BUNDLED_SAMPLE_NAMES: readonly string[] = ['Anamika Devi'];

const DOCUMENT = /^portfolio\.(yml|yaml|json)$/;
/** A format this release no longer reads. Refused by name, never skipped. */
const UNSUPPORTED = /^portfolio\.toml$/;
const KEY = 'PORTFOLIO_SOURCE_DIR';
const INVALID_SOURCE =
  'The portfolio source failed validation. The config.fatal lines in the server log say where.';

export interface DocumentsCatalogOptions {
  /** Absolute path of PORTFOLIO_SOURCE_DIR. */
  readonly sourceDir: string;
  readonly mode: RuntimeMode;
  /** The bundled example, rendered under `next dev` when the directory holds no document. */
  readonly examplePath: string;
  /** The content extensions documents are checked against. Others warn. */
  readonly extensions?: readonly ContentExtension[];
  /** Receives the findings of every re-validation under `next dev`. */
  readonly report: (issue: ConfigIssue) => void;
}

export type OpenDocumentsResult =
  | { readonly ok: true; readonly reader: CatalogReader; readonly issues: ConfigIssue[] }
  | { readonly ok: false; readonly issues: ConfigIssue[] };

export function openDocumentsCatalog(options: DocumentsCatalogOptions): OpenDocumentsResult {
  const first = loadRevision(options);
  if (!first.ok) return { ok: false, issues: first.issues };
  if (options.mode === 'production') {
    const live = first.revision;
    return { ok: true, issues: first.issues, reader: Object.freeze({ getLive: async () => live }) };
  }

  let current: { fingerprint: string; revision?: LiveRevision } = first;
  const reader: CatalogReader = Object.freeze({
    async getLive() {
      if (fingerprint(options) !== current.fingerprint) {
        const next = loadRevision(options);
        for (const issue of next.issues) options.report(issue);
        current = next.ok ? next : { fingerprint: next.fingerprint };
      }
      if (!current.revision) throw new Error(INVALID_SOURCE);
      return current.revision;
    },
  });
  return { ok: true, issues: first.issues, reader };
}

type Loaded =
  | { ok: true; revision: LiveRevision; issues: ConfigIssue[]; fingerprint: string }
  | { ok: false; issues: ConfigIssue[]; fingerprint: string };

function loadRevision(options: DocumentsCatalogOptions): Loaded {
  const { sourceDir, mode } = options;
  const stamp = fingerprint(options);
  const issues: ConfigIssue[] = [];
  const fail = (...found: ConfigIssue[]): Loaded => ({
    ok: false,
    issues: [...issues, ...found],
    fingerprint: stamp,
  });

  let names: string[];
  try {
    names = fs.readdirSync(/*turbopackIgnore: true*/ sourceDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return fail(fatal('source_missing', `${KEY} names a directory that doesn't exist.`));
    }
    // The likely mistake when moving from PORTFOLIO_PATH, which named the file.
    if (code === 'ENOTDIR') {
      return fail(
        fatal(
          'source_not_directory',
          `${KEY} names a file, not a directory. Set it to the directory that holds portfolio.yml.`,
        ),
      );
    }
    return fail(fatal('source_unreadable', `The server can't read the ${KEY} directory.`));
  }
  const unsupported = names.filter((name) => UNSUPPORTED.test(name));
  if (unsupported.length > 0) {
    return fail(
      ...unsupported.map((name) => ({
        ...fatal(
          'document_unsupported',
          'TOML portfolio documents are no longer read. Convert portfolio.toml to portfolio.yml or portfolio.json, then remove it.',
        ),
        file: name,
      })),
    );
  }
  const documents = names.filter((name) => DOCUMENT.test(name)).sort();
  if (documents.length > 1) {
    return fail(
      fatal(
        'source_several',
        `${KEY} holds ${documents.length} portfolio documents (${documents.join(', ')}). Keep exactly one.`,
      ),
    );
  }

  let name = documents[0];
  let file: string;
  if (name !== undefined) {
    file = path.join(/*turbopackIgnore: true*/ sourceDir, name);
  } else if (mode === 'production') {
    return fail(
      fatal(
        'source_empty',
        `${KEY} holds no portfolio document. Add portfolio.yml, portfolio.yaml, or portfolio.json.`,
      ),
    );
  } else {
    issues.push({
      ...fatal(
        'source_empty',
        `${KEY} holds no portfolio document, so next dev renders the bundled example. Production refuses to start without one.`,
      ),
      severity: 'warning',
    });
    file = options.examplePath;
    name = path.basename(file);
  }
  const usingExample = documents.length === 0;

  let bytes: Buffer;
  try {
    bytes = readDocument(file);
  } catch {
    return fail({
      ...fatal('document_unreadable', "The server can't read the portfolio document."),
      file: name,
    });
  }

  const parsed = parsePortfolio(bytes.toString('utf8'), detectFormat(name), {
    extensions: options.extensions,
  });
  if (!parsed.ok) return fail(...parsed.problems.map((problem) => documentIssue(problem, name)));
  const { value: portfolio, locate } = parsed;
  issues.push(...parsed.warnings.map((warning) => warningIssue(warning, name)));

  if (!usingExample && isSampleIdentity(portfolio.identity.name)) {
    const sample: ConfigIssue = {
      ...fatal(
        'sample_identity',
        mode === 'production'
          ? '/identity/name is the bundled sample. Replace the sample with your own portfolio.'
          : '/identity/name is the bundled sample. Production refuses to start with it.',
      ),
      file: name,
      path: '/identity/name',
      ...locate(['identity', 'name']),
    };
    if (mode === 'production') return fail(sample);
    issues.push({ ...sample, severity: 'warning' });
  }

  const revision: LiveRevision = Object.freeze({
    revisionId: `doc-${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}`,
    unit: Object.freeze({ portfolio: deepFreeze(portfolio) }),
  });
  return { ok: true, revision, issues, fingerprint: stamp };
}

/**
 * A byte order mark takes three bytes and isn't counted, so this many bytes
 * always hold more text than a document may: the parser refuses them where
 * they pass the limit.
 */
const READ_LIMIT = DOCUMENT_MAX_BYTES + 4;

/**
 * The document's bytes, or its first READ_LIMIT when it's larger, so an
 * oversized file is never read or decoded whole. The size on disk sets the
 * first read, and no read passes the limit, even if the file grows meanwhile.
 */
function readDocument(file: string): Buffer {
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
    return Buffer.concat(chunks, length);
  } finally {
    fs.closeSync(fd);
  }
}

/** Changes whenever a document is added, removed, or rewritten. */
function fingerprint({ sourceDir, examplePath }: DocumentsCatalogOptions): string {
  let names: string[];
  try {
    names = fs.readdirSync(/*turbopackIgnore: true*/ sourceDir);
  } catch (error) {
    return `unreadable:${(error as NodeJS.ErrnoException).code}`;
  }
  const documents = names.filter((name) => DOCUMENT.test(name) || UNSUPPORTED.test(name)).sort();
  const files = documents.length
    ? documents.map((name) => path.join(/*turbopackIgnore: true*/ sourceDir, name))
    : [examplePath];
  return files
    .map((file) => {
      try {
        const stat = fs.statSync(/*turbopackIgnore: true*/ file);
        return `${file}:${stat.mtimeMs}:${stat.size}`;
      } catch {
        return `${file}:missing`;
      }
    })
    .join('|');
}

function fatal(code: string, message: string): ConfigIssue {
  return { severity: 'fatal', key: KEY, code, message };
}

/**
 * A problem the schema package found, as a startup issue: `document_syntax`
 * when the text isn't one plain YAML or JSON document, else `document_invalid`.
 * The message never quotes the document.
 */
function documentIssue(problem: DocumentProblem, file: string): ConfigIssue {
  return {
    ...fatal(problem.kind === 'syntax' ? 'document_syntax' : 'document_invalid', problem.message),
    file,
    ...(problem.pointer !== undefined ? { path: problem.pointer } : {}),
    ...(problem.line !== undefined ? { line: problem.line, column: problem.column } : {}),
    issueCode: problem.code,
  };
}

/** Something a valid document holds that the owner should know about, as a startup warning. */
function warningIssue(warning: DocumentWarning, file: string): ConfigIssue {
  return {
    severity: 'warning',
    key: KEY,
    code: warning.code,
    message: warning.message,
    file,
    path: warning.pointer,
    ...(warning.line !== undefined ? { line: warning.line, column: warning.column } : {}),
  };
}

function isSampleIdentity(name: string): boolean {
  const normalize = (value: string) =>
    value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  return BUNDLED_SAMPLE_NAMES.some((sample) => normalize(sample) === normalize(name));
}
