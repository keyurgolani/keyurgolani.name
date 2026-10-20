import type { z } from 'zod';
import { PortfolioSchema, SCHEMA_VERSION, type Portfolio } from './portfolio';
import { SiteSchema, type Site } from './site';
import { parseSource, toPointer, type DocumentFormat, type Locate } from './source';

// Reads a portfolio or site document from source text into its typed model,
// or into problems located by JSON pointer, line, and column. No message
// quotes a value from the document.

export interface DocumentProblem {
  /**
   * `syntax`: not one plain YAML or JSON document. `version`: no
   * `schemaVersion: 2`, so nothing else was checked. `schema`: the data
   * doesn't match the schema. `duplicate-id`: two sections share an id.
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

export type DocumentResult<T> =
  | { readonly ok: true; readonly value: T; readonly locate: Locate }
  | { readonly ok: false; readonly problems: readonly DocumentProblem[] };

/** Parses and validates a portfolio document, section ids included. */
export function parsePortfolio(source: string, format: DocumentFormat): DocumentResult<Portfolio> {
  const result = parseWith(PortfolioSchema, source, format);
  if (!result.ok) return result;
  const repeats = duplicateSectionIds(result.value.sections);
  if (repeats.length === 0) return result;
  return {
    ok: false,
    problems: repeats.map(({ index, firstIndex }) => ({
      kind: 'duplicate-id',
      code: 'duplicate_id',
      pointer: `/sections/${index}/id`,
      message: `/sections/${index}/id repeats the id of /sections/${firstIndex}. Section ids must be unique.`,
      ...result.locate(['sections', index, 'id']),
    })),
  };
}

/** Parses and validates a site document. */
export function parseSite(source: string, format: DocumentFormat): DocumentResult<Site> {
  return parseWith(SiteSchema, source, format);
}

/** Every section whose id an earlier section already has, with that earlier index. */
export function duplicateSectionIds(
  sections: readonly { readonly id: string }[],
): { index: number; firstIndex: number }[] {
  const first = new Map<string, number>();
  const repeats: { index: number; firstIndex: number }[] = [];
  sections.forEach(({ id }, index) => {
    const seen = first.get(id);
    if (seen === undefined) first.set(id, index);
    else repeats.push({ index, firstIndex: seen });
  });
  return repeats;
}

function parseWith<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  source: string,
  format: DocumentFormat,
): DocumentResult<T> {
  const parsed = parseSource(source, format);
  if (!parsed.ok) {
    return {
      ok: false,
      problems: parsed.problems.map((problem) => ({ kind: 'syntax', ...problem })),
    };
  }
  const { data, locate } = parsed;

  // Checking the rest against version 2 would only bury this one problem.
  if (isRecord(data) && data.schemaVersion !== SCHEMA_VERSION) {
    const missing = data.schemaVersion === undefined;
    return {
      ok: false,
      problems: [
        {
          kind: 'version',
          code: missing ? 'invalid_type' : 'invalid_literal',
          pointer: '/schemaVersion',
          message: `/schemaVersion ${missing ? 'is required' : `must be ${SCHEMA_VERSION}`}. This release reads only schemaVersion ${SCHEMA_VERSION} documents.`,
          ...locate(['schemaVersion']),
        },
      ],
    };
  }

  const result = schema.safeParse(data);
  if (result.success) return { ok: true, value: result.data, locate };
  return {
    ok: false,
    problems: result.error.issues.map((issue) => ({
      kind: 'schema',
      code: issue.code,
      pointer: toPointer(issue.path),
      message: describeIssue(issue),
      ...locate(issue.path),
    })),
  };
}

/** What a schema issue says is wrong, without quoting any value from the document. */
export function describeIssue(issue: z.ZodIssue): string {
  const where = toPointer(issue.path) || 'The document';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
