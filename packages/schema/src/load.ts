import type { z } from 'zod';
import { composeSchemas, DEFAULT_SCHEMAS, type ComposedSchemas } from './compose';
import {
  findUnregisteredExtensions,
  type ContentExtension,
  type ExtensionRegistry,
} from './extensions';
import { closestWord, keyContext } from './hints';
import { parseExtensionKind } from './ids';
import { isPlainObject } from './json';
import type { Portfolio } from './portfolio';
import { SCHEMA_VERSION } from './portfolio';
import { redactedPointer, redactSecrets } from './secrets';
import type { Site } from './site';
import { parseSource, type DocumentFormat, type Locate } from './source';

// Reads a portfolio or site document from source text into its typed model,
// or into problems located by JSON pointer, line, and column. No message
// quotes a value from the document.

export interface DocumentProblem {
  /**
   * `syntax`: not one plain YAML or JSON document within the size and
   * nesting limits. `version`: no `schemaVersion: 2`, so nothing else was
   * checked. `schema`: the data doesn't match the schema. `duplicate-id`:
   * two sections share an id.
   */
  readonly kind: 'syntax' | 'version' | 'schema' | 'duplicate-id';
  /** The parser's or the schema's own code, such as DUPLICATE_KEY or invalid_type. */
  readonly code: string;
  /** JSON pointer into the document; absent for a syntax problem that isn't a node. */
  readonly pointer?: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

/** Something a valid document holds that the reader should know about. */
export interface DocumentWarning {
  /** `extension_unregistered`: data from an extension this build doesn't register. */
  readonly code: 'extension_unregistered';
  readonly pointer: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export type DocumentResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly locate: Locate;
      readonly warnings: readonly DocumentWarning[];
    }
  | { readonly ok: false; readonly problems: readonly DocumentProblem[] };

export interface ParseOptions {
  /**
   * The content extensions to check against. Data from any other extension
   * is kept as written, unchecked, with a warning.
   */
  readonly extensions?: readonly ContentExtension[];
}

/** Parses and validates a portfolio document, section ids included. */
export function parsePortfolio(
  source: string,
  format: DocumentFormat,
  options: ParseOptions = {},
): DocumentResult<Portfolio> {
  const read = readPortfolio(source, format, options);
  return finish(read, read.duplicates);
}

/** Parses and validates a site document. */
export function parseSite(
  source: string,
  format: DocumentFormat,
  options: ParseOptions = {},
): DocumentResult<Site> {
  return finish(readSite(source, format, options), []);
}

/**
 * One document read as far as it goes: the data as written once the text
 * parses, the model once it also matches the schema, and every problem
 * found on the way. validatePublicationUnit() builds its diagnostics from
 * this, so it can rank repeated ids below problems that stop rendering.
 */
export interface DocumentRead<T> {
  /** Syntax, version, and schema problems. Empty when `value` is set. */
  readonly problems: readonly DocumentProblem[];
  readonly value?: T;
  /** The parsed text, before the schema. Absent when the text didn't parse. */
  readonly data?: unknown;
  readonly locate?: Locate;
  readonly warnings: readonly DocumentWarning[];
}

/** A portfolio read as far as it goes, with its repeated section ids kept apart. */
export function readPortfolio(
  source: string,
  format: DocumentFormat,
  options: ParseOptions = {},
): DocumentRead<Portfolio> & { readonly duplicates: readonly DocumentProblem[] } {
  const schemas = schemasFor(options.extensions);
  const read = readWith(schemas.PortfolioSchema, schemas.registry, source, format);
  const checked = read.problems.every(({ kind }) => kind === 'schema');
  return {
    ...read,
    duplicates:
      checked && read.locate ? redactProblems(repeatedSectionIds(read.data, read.locate)) : [],
  };
}

/** A site document read as far as it goes. */
export function readSite(
  source: string,
  format: DocumentFormat,
  options: ParseOptions = {},
): DocumentRead<Site> {
  const schemas = schemasFor(options.extensions);
  return readWith(schemas.SiteSchema, schemas.registry, source, format);
}

function finish<T>(read: DocumentRead<T>, more: readonly DocumentProblem[]): DocumentResult<T> {
  const problems = [...read.problems, ...more];
  if (problems.length > 0 || read.value === undefined || !read.locate) {
    return { ok: false, problems };
  }
  return { ok: true, value: read.value, locate: read.locate, warnings: read.warnings };
}

/** Every section whose id an earlier section already has, with that earlier index. */
export function duplicateSectionIds(
  sections: readonly { readonly id?: unknown }[],
): { index: number; firstIndex: number }[] {
  const first = new Map<string, number>();
  const repeats: { index: number; firstIndex: number }[] = [];
  sections.forEach(({ id }, index) => {
    if (typeof id !== 'string') return;
    const seen = first.get(id);
    if (seen === undefined) first.set(id, index);
    else repeats.push({ index, firstIndex: seen });
  });
  return repeats;
}

/**
 * Two sections with one id, found in the data as written, so a schema
 * problem anywhere else in the document doesn't hide them.
 */
function repeatedSectionIds(data: unknown, locate: Locate): DocumentProblem[] {
  const sections = isPlainObject(data) && Array.isArray(data.sections) ? data.sections : [];
  const ids = sections.map((section: unknown) => ({
    id: isPlainObject(section) ? section.id : undefined,
  }));
  return duplicateSectionIds(ids).map(({ index, firstIndex }) => ({
    kind: 'duplicate-id',
    code: 'duplicate_id',
    pointer: `/sections/${index}/id`,
    message: `/sections/${index}/id repeats the id of /sections/${firstIndex}. Section ids must be unique.`,
    ...locate(['sections', index, 'id']),
  }));
}

const composed = new WeakMap<readonly ContentExtension[], ComposedSchemas>();

function schemasFor(extensions: readonly ContentExtension[] | undefined): ComposedSchemas {
  if (!extensions || extensions.length === 0) return DEFAULT_SCHEMAS;
  let schemas = composed.get(extensions);
  if (!schemas) {
    schemas = composeSchemas(extensions);
    composed.set(extensions, schemas);
  }
  return schemas;
}

function readWith<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  registry: ExtensionRegistry,
  source: string,
  format: DocumentFormat,
): DocumentRead<T> {
  const parsed = parseSource(source, format);
  if (!parsed.ok) {
    return {
      problems: redactProblems(parsed.problems.map((problem) => ({ kind: 'syntax', ...problem }))),
      warnings: [],
    };
  }
  const { data, locate } = parsed;

  // Checking the rest against version 2 would only bury this one problem.
  if (isPlainObject(data) && data.schemaVersion !== SCHEMA_VERSION) {
    const missing = data.schemaVersion === undefined;
    return {
      problems: [
        {
          kind: 'version',
          code: missing ? 'invalid_type' : 'invalid_literal',
          pointer: '/schemaVersion',
          message: `/schemaVersion ${missing ? 'is required' : `must be ${SCHEMA_VERSION}`}. This release reads only schemaVersion ${SCHEMA_VERSION} documents.`,
          ...locate(['schemaVersion']),
        },
      ],
      data,
      locate,
      warnings: [],
    };
  }

  const result = schema.safeParse(data);
  if (!result.success) {
    const problems = result.error.issues.flatMap((issue) =>
      issueProblems(issue, schema, data).map(({ path, at, ...problem }): DocumentProblem => ({
        ...problem,
        ...locate(path, at),
      })),
    );
    return { problems: redactProblems(problems), data, locate, warnings: [] };
  }
  const warnings = findUnregisteredExtensions(result.data, registry).map(
    ({ path, use }): DocumentWarning => {
      const pointer = redactedPointer(path);
      const what = use === 'section' ? 'is a section from' : 'belongs to';
      return {
        code: 'extension_unregistered',
        pointer,
        message: `${pointer} ${what} an extension this build doesn't register. It's kept as written, unchecked, and never shown to visitors.`,
        // An extensions entry is located at its namespace key.
        ...locate(path, use === 'fields' ? 'key' : 'value'),
      };
    },
  );
  return { problems: [], value: result.data, data, locate, warnings };
}

/**
 * A pointer names keys, and a key could be a pasted secret. Messages quote
 * pointers but never values, so redacting both keeps a secret out of every
 * log line and diagnostic.
 */
function redactProblems(problems: readonly DocumentProblem[]): DocumentProblem[] {
  return problems.map((problem) => ({
    ...problem,
    message: redactSecrets(problem.message),
    ...(problem.pointer !== undefined ? { pointer: redactSecrets(problem.pointer) } : {}),
  }));
}

type IssueProblem = Omit<DocumentProblem, 'line' | 'column'> & {
  path: (string | number)[];
  /** An unknown key is located at the key, not its value. */
  at?: 'key';
};

/**
 * One problem per schema issue, except that an object with several unknown
 * keys gets one problem per key. Unknown keys and kinds carry a did-you-mean
 * hint when an allowed one is close.
 */
function issueProblems(issue: z.ZodIssue, schema: z.ZodTypeAny, data: unknown): IssueProblem[] {
  if (issue.code === 'unrecognized_keys') {
    const { allowed = [], extension } = keyContext(schema, data, issue.path);
    const present = new Set(Object.keys(valueAt(data, issue.path) ?? {}));
    return issue.keys.map((key) => {
      const path = [...issue.path, key];
      const pointer = redactedPointer(path);
      const suggestion = closestWord(
        key,
        allowed.filter((candidate) => !present.has(candidate)),
      );
      const hint = suggestion
        ? `Did you mean ${suggestion}?`
        : extension
          ? "Its extension doesn't define it."
          : 'Custom data goes under extensions, keyed by an npm package name.';
      return {
        kind: 'schema',
        code: issue.code,
        pointer,
        path,
        at: 'key',
        message: `${pointer} isn't a field here. ${hint}`,
      };
    });
  }
  if (issue.code === 'invalid_union') {
    // When every shape fails and the closest one names an unknown key, its
    // problems say more than "matches no shape": the key gets its hint.
    const closest = closestUnionFailure(issue.unionErrors);
    if (closest?.issues.some(({ code }) => code === 'unrecognized_keys')) {
      return closest.issues.flatMap((inner) => issueProblems(inner, schema, data));
    }
  }
  const problem: IssueProblem = {
    kind: 'schema',
    code: issue.code,
    pointer: redactedPointer(issue.path),
    path: issue.path,
    message: describeIssue(issue),
  };
  if (issue.code === 'invalid_union_discriminator') {
    const hint = kindHint(valueAt(data, issue.path), issue.options.map(String));
    return [{ ...problem, message: `${problem.message}${hint}` }];
  }
  return [problem];
}

/** The failed union shape with the fewest unknown keys, then the fewest problems; the first on a tie. */
function closestUnionFailure(failures: readonly z.ZodError[]): z.ZodError | undefined {
  const unknown = (failure: z.ZodError) =>
    failure.issues.reduce(
      (count, issue) => count + (issue.code === 'unrecognized_keys' ? issue.keys.length : 0),
      0,
    );
  let best: z.ZodError | undefined;
  for (const failure of failures) {
    if (
      !best ||
      unknown(failure) < unknown(best) ||
      (unknown(failure) === unknown(best) && failure.issues.length < best.issues.length)
    ) {
      best = failure;
    }
  }
  return best;
}

/** A hint for a section kind the schemas don't know, given the kinds they do. */
function kindHint(kind: unknown, known: readonly string[]): string {
  if (typeof kind !== 'string') return '';
  const extensionKinds = known.flatMap((option) => parseExtensionKind(option) ?? []);
  const extension = parseExtensionKind(kind);
  if (extension) {
    // The router refuses a namespaced kind only when its extension is
    // registered, so compare the name with the names that extension adds.
    const names = extensionKinds
      .filter(({ namespace }) => namespace === extension.namespace)
      .map(({ name }) => name);
    const name = closestWord(extension.name, names);
    return name
      ? ` Did you mean ${extension.namespace}/${name}?`
      : " Its extension doesn't add a section kind by that name.";
  }
  const core = closestWord(
    kind,
    known.filter((option) => !parseExtensionKind(option)),
  );
  if (core) return ` Did you mean ${core}?`;
  // A registered extension's kind written without its namespace.
  const name = closestWord(
    kind,
    extensionKinds.map(({ name }) => name),
  );
  const match = extensionKinds.find((option) => option.name === name);
  if (match) return ` Did you mean ${match.namespace}/${match.name}?`;
  return kind.includes('/')
    ? ' An extension section kind is <npm package name>/<name>, such as @acme/portfolio-photography/exhibitions.'
    : ' A section kind from an extension is <npm package name>/<name>.';
}

function valueAt(data: unknown, path: readonly (string | number)[]): unknown {
  let value = data;
  for (const segment of path) {
    if (!isPlainObject(value) && !Array.isArray(value)) return undefined;
    if (!Object.hasOwn(value, segment)) return undefined;
    value = (value as Record<string | number, unknown>)[segment];
  }
  return value;
}

/** What a schema issue says is wrong, without quoting any value from the document. */
export function describeIssue(issue: z.ZodIssue): string {
  const where = redactedPointer(issue.path) || 'The document';
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined'
        ? `${where} is required.`
        : `${where} should be ${issue.expected}, not ${issue.received}.`;
    case 'invalid_literal':
      return issue.received === undefined
        ? `${where} is required.`
        : `${where} must be ${JSON.stringify(issue.expected)}.`;
    case 'invalid_union_discriminator':
      return `${where} is not a known section kind.`;
    case 'invalid_union':
      return `${where} doesn't match any of the shapes it allows.`;
    case 'invalid_enum_value':
      return `${where} should be one of: ${issue.options.join(', ')}.`;
    case 'unrecognized_keys':
      return `${where} has fields that aren't allowed here.`;
    case 'too_small':
      return `${where} ${boundPhrase(issue.type, issue.inclusive ? 'at least' : 'more than', Number(issue.minimum))}.`;
    case 'too_big':
      return `${where} ${boundPhrase(issue.type, issue.inclusive ? 'at most' : 'less than', Number(issue.maximum))}.`;
    case 'invalid_string':
    case 'custom':
      // Every regex and refinement in the schemas carries its own value-free message.
      return `${where} ${issue.message}`;
    default:
      return `${where} doesn't match the schema (${issue.code}).`;
  }
}

function boundPhrase(type: string, bound: string, limit: number): string {
  switch (type) {
    case 'string':
      return `must be ${bound} ${limit} character${limit === 1 ? '' : 's'} long`;
    case 'array':
    case 'set':
      return `must have ${bound} ${limit} item${limit === 1 ? '' : 's'}`;
    default:
      return `must be ${bound} ${limit}`;
  }
}
