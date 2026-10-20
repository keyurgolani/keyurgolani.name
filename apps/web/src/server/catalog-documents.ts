import 'server-only';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseToml, TomlError } from 'smol-toml';
import { isNode, LineCounter, parseDocument } from 'yaml';
import { PortfolioSchema, type Portfolio } from '@portfolio/schema';
import type { CatalogReader, LiveRevision } from './catalog-port';
import type { ConfigIssue, RuntimeMode } from './config';

// The documents adapter: the CatalogReader for a mounted PORTFOLIO_SOURCE_DIR.
// It reads the one portfolio document once at startup, validates it, checks
// its variant, and freezes the result. Under `next dev` only, it re-validates
// whenever a document changes on disk.

/** identity.name of each sample the image ships. A real deployment can't use one. */
export const BUNDLED_SAMPLE_NAMES: readonly string[] = ['Anamika Devi'];

const DOCUMENT = /^portfolio\.(yml|yaml|json|toml)$/;
const KEY = 'PORTFOLIO_SOURCE_DIR';
const BYTE_ORDER_MARK = 0xfeff;
const INVALID_SOURCE =
  'The portfolio source failed validation. The config.fatal lines in the server log say where.';

export interface DocumentsCatalogOptions {
  /** Absolute path of PORTFOLIO_SOURCE_DIR. */
  readonly sourceDir: string;
  readonly mode: RuntimeMode;
  /** The bundled example, rendered under `next dev` when the directory holds no document. */
  readonly examplePath: string;
  /** Slugs of the registered variants. */
  readonly variantSlugs: readonly string[];
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
        `${KEY} holds no portfolio document. Add portfolio.yml, portfolio.yaml, portfolio.json, or portfolio.toml.`,
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
    bytes = fs.readFileSync(/*turbopackIgnore: true*/ file);
  } catch {
    return fail({
      ...fatal('document_unreadable', "The server can't read the portfolio document."),
      file: name,
    });
  }

  const parsed = parseSource(bytes.toString('utf8'), formatOf(name));
  if (!parsed.ok) return fail(...parsed.issues.map((issue) => ({ ...issue, file: name })));
  const { portfolio, locate } = parsed;

  if (!options.variantSlugs.includes(portfolio.variant)) {
    return fail({
      ...fatal(
        'variant_unresolved',
        `/variant names no registered variant. Registered: ${options.variantSlugs.join(', ')}.`,
      ),
      file: name,
      path: '/variant',
      ...locate(['variant']),
    });
  }

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

/** Changes whenever a document is added, removed, or rewritten. */
function fingerprint({ sourceDir, examplePath }: DocumentsCatalogOptions): string {
  let names: string[];
  try {
    names = fs.readdirSync(/*turbopackIgnore: true*/ sourceDir);
  } catch (error) {
    return `unreadable:${(error as NodeJS.ErrnoException).code}`;
  }
  const documents = names.filter((name) => DOCUMENT.test(name)).sort();
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

type Format = 'yaml' | 'json' | 'toml';
type Position = { line?: number; column?: number };
type Locate = (at: readonly PropertyKey[]) => Position;
type SchemaIssue = NonNullable<
  ReturnType<typeof PortfolioSchema.safeParse>['error']
>['issues'][number];

function formatOf(name: string): Format {
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.toml')) return 'toml';
  return 'yaml';
}

/**
 * Parses and validates one document. YAML and JSON go through yaml's
 * parseDocument, which locates every problem by line and column; a JSON file
 * must also pass JSON.parse. TOML problems carry the key path only.
 */
function parseSource(
  source: string,
  format: Format,
): { ok: true; portfolio: Portfolio; locate: Locate } | { ok: false; issues: ConfigIssue[] } {
  const text = source.charCodeAt(0) === BYTE_ORDER_MARK ? source.slice(1) : source;
  let data: unknown;
  let locate: Locate = () => ({});

  if (format === 'toml') {
    try {
      data = parseToml(text);
    } catch (error) {
      const at = error instanceof TomlError ? { line: error.line, column: error.column } : {};
      return { ok: false, issues: [syntaxIssue('toml_syntax', at)] };
    }
  } else {
    const lineCounter = new LineCounter();
    const doc = parseDocument(text, { lineCounter, prettyErrors: false });
    const position = (offset: number): Position => {
      const { line, col } = lineCounter.linePos(offset);
      return { line, column: col };
    };
    const [error] = doc.errors;
    if (format === 'json') {
      try {
        data = JSON.parse(text);
      } catch (jsonError) {
        // Only the offset is taken from the message, which can quote the document.
        const offset = /at position (\d+)/.exec(String(jsonError))?.[1];
        const at =
          offset !== undefined ? position(Number(offset)) : error ? position(error.pos[0]) : {};
        return { ok: false, issues: [syntaxIssue('json_syntax', at)] };
      }
    }
    if (error) return { ok: false, issues: [syntaxIssue(error.code, position(error.pos[0]))] };
    if (format === 'yaml') {
      try {
        data = doc.toJS();
      } catch {
        return { ok: false, issues: [syntaxIssue('yaml_resolve', {})] };
      }
    }
    locate = (at) => {
      for (let depth = at.length; depth >= 0; depth--) {
        const node = depth === 0 ? doc.contents : doc.getIn(at.slice(0, depth), true);
        if (isNode(node) && node.range) return position(node.range[0]);
      }
      return {};
    };
  }

  const result = PortfolioSchema.safeParse(data);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        ...fatal('document_invalid', describe(issue)),
        path: pointer(issue.path),
        issueCode: issue.code,
        ...locate(issue.path),
      })),
    };
  }
  return { ok: true, portfolio: result.data, locate };
}

function fatal(code: string, message: string): ConfigIssue {
  return { severity: 'fatal', key: KEY, code, message };
}

function syntaxIssue(issueCode: string, at: Position): ConfigIssue {
  return {
    ...fatal('document_syntax', 'The portfolio document is not well-formed at this position.'),
    issueCode,
    ...at,
  };
}

/** What is wrong, without quoting any value from the document. */
function describe(issue: SchemaIssue): string {
  const where = pointer(issue.path) || 'The document';
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined'
        ? `${where} is required.`
        : `${where} should be ${issue.expected}, not ${issue.received}.`;
    case 'invalid_union_discriminator':
      return `${where} is not a known section kind.`;
    case 'invalid_enum_value':
      return `${where} should be one of: ${issue.options.join(', ')}.`;
    default:
      return `${where} doesn't match the schema (${issue.code}).`;
  }
}

/** RFC 6901 JSON pointer for a schema path; '' is the whole document. */
function pointer(at: readonly PropertyKey[]): string {
  return at.map((part) => `/${String(part).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
}

function isSampleIdentity(name: string): boolean {
  const normalize = (value: string) =>
    value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  return BUNDLED_SAMPLE_NAMES.some((sample) => normalize(sample) === normalize(name));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
