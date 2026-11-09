import { z } from 'zod';
import { isPlainObject } from './json';
import { redactedPointer } from './secrets';

// Issues from a parse inside a parse: the section router and the extensions
// field each run a schema of their own with safeParse(), then report what it
// found as part of the document's parse.

/**
 * Adds an issue from a nested safeParse() to the parse around it, `prefix`
 * below the current path. Each schema around it puts its own key before the
 * path. The paths in a union's nested errors stay relative to the union, as
 * every union's do, so readers join them with the union issue's path.
 */
export function addNestedIssue(
  ctx: z.RefinementCtx,
  issue: z.ZodIssue,
  prefix: readonly (string | number)[] = [],
): void {
  ctx.addIssue({ ...issue, path: [...prefix, ...issue.path] } as z.IssueData);
}

/** A union issue's failed shapes, each with its paths from the document's root. */
export function unionFailures(issue: z.ZodIssue): z.ZodIssue[][] {
  if (issue.code !== 'invalid_union') return [];
  return issue.errors.map((issues) =>
    issues.map((inner) => ({ ...inner, path: [...issue.path, ...inner.path] }) as z.ZodIssue),
  );
}

/**
 * The issues as the diagnostics report them. A union whose value only fails
 * an option's checks, not its shape, reports that option's issues: the first
 * such option, at its paths. Checks are refinements, patterns, bounds, whole
 * numbers, and keys a strict object doesn't name; a wrong type, a value
 * outside a literal or an enum, or a missing tag fails the shape.
 */
export function reportedIssues(issues: readonly z.ZodIssue[]): z.ZodIssue[] {
  return issues.flatMap((issue) => {
    const checked = unionFailures(issue).find((failure) => failure.every(onlyCheck));
    return checked ? reportedIssues(checked) : [issue];
  });
}

function onlyCheck(issue: z.ZodIssue): boolean {
  switch (issue.code) {
    case 'custom':
    case 'invalid_format':
    case 'too_small':
    case 'too_big':
    case 'not_multiple_of':
    case 'unrecognized_keys':
      return true;
    case 'invalid_type':
      return issue.expected === 'int';
    case 'invalid_key':
      return issue.issues.every(onlyCheck);
    case 'invalid_union':
      return unionFailures(issue).some((failure) => failure.every(onlyCheck));
    default:
      return false;
  }
}

/** Marks the issue a discriminated union reports when no option has the value's tag. */
export const NO_MATCHING_DISCRIMINATOR = 'No matching discriminator';

/** Whether the issue is a discriminated union's: no option has the value's tag. */
export function isDiscriminatorIssue(issue: z.ZodIssue): boolean {
  return (
    issue.code === 'invalid_union' &&
    issue.errors.length === 0 &&
    (issue as { readonly note?: unknown }).note === NO_MATCHING_DISCRIMINATOR
  );
}

/**
 * A schema issue as the diagnostics read it, given the document its path
 * starts from. The codes and fields predate zod 4's, and every reader of a
 * document or manifest problem keys on them:
 * - a literal that doesn't match is invalid_literal, with the literal;
 * - an enum given a string it doesn't list is invalid_enum_value, with the
 *   options; given anything else, or nothing, it's invalid_type;
 * - a string pattern is invalid_string, a missing tag
 *   invalid_union_discriminator, .inf or .nan not_finite;
 * - an invalid_type names the type it got, `undefined` when the value is missing;
 * - a record key's issue is its own check's.
 */
export interface IssueView {
  readonly code: string;
  readonly expected?: string;
  readonly received?: string;
  readonly options?: readonly string[];
  readonly literal?: unknown;
}

export function issueView(issue: z.ZodIssue, data: unknown): IssueView {
  const value = valueAt(data, issue.path);
  switch (issue.code) {
    case 'invalid_type': {
      if (nonFinite(issue)) return { code: 'not_finite' };
      const expected = expectedName(issue.expected);
      const received = value === undefined ? 'undefined' : receivedName(value, expected);
      return { code: issue.code, expected, received };
    }
    case 'invalid_value': {
      if (issue.values.length === 1) return { code: 'invalid_literal', literal: issue.values[0] };
      if (typeof value !== 'string' && issue.values.every((option) => typeof option === 'string')) {
        const expected = issue.values.map((option) => `'${String(option)}'`).join(' | ');
        const received = value === undefined ? 'undefined' : receivedName(value, expected);
        return { code: 'invalid_type', expected, received };
      }
      return { code: 'invalid_enum_value', options: issue.values.map(String) };
    }
    case 'invalid_format':
      return { code: 'invalid_string' };
    case 'invalid_union':
      return { code: isDiscriminatorIssue(issue) ? 'invalid_union_discriminator' : issue.code };
    case 'invalid_key':
      return issue.issues[0]
        ? issueView({ ...issue.issues[0], path: issue.path } as z.ZodIssue, data)
        : { code: issue.code };
    default:
      return { code: issue.code };
  }
}

/** The issue's code as the diagnostics name it: issueView()'s. */
export function issueCode(issue: z.ZodIssue, data: unknown): string {
  return issueView(issue, data).code;
}

function nonFinite(issue: z.ZodIssue): boolean {
  const { received } = issue as { readonly received?: unknown };
  return issue.code === 'invalid_type' && (received === 'Infinity' || received === 'NaN');
}

/**
 * What a schema issue says is wrong, without quoting any value from the
 * document. `data` is the document the issue's path starts from.
 */
export function describeIssue(issue: z.ZodIssue, data: unknown): string {
  // A record key's issue says what its own check found, at the key.
  if (issue.code === 'invalid_key' && issue.issues[0]) {
    return describeIssue({ ...issue.issues[0], path: issue.path } as z.ZodIssue, data);
  }
  const where = redactedPointer(issue.path) || 'The document';
  const view = issueView(issue, data);
  switch (view.code) {
    case 'invalid_type':
      return view.received === 'undefined'
        ? `${where} is required.`
        : `${where} should be ${view.expected}, not ${view.received}.`;
    case 'invalid_literal':
      return valueAt(data, issue.path) === undefined
        ? `${where} is required.`
        : `${where} must be ${JSON.stringify(view.literal)}.`;
    case 'invalid_union_discriminator':
      return `${where} is not a known section kind.`;
    case 'invalid_union':
      return `${where} doesn't match any of the shapes it allows.`;
    case 'invalid_enum_value':
      return `${where} should be one of: ${view.options?.join(', ')}.`;
    case 'unrecognized_keys':
      return `${where} has fields that aren't allowed here.`;
    case 'too_small': {
      const { origin, inclusive, minimum } = issue as z.core.$ZodIssueTooSmall;
      return `${where} ${boundPhrase(origin, inclusive ? 'at least' : 'more than', Number(minimum))}.`;
    }
    case 'too_big': {
      const { origin, inclusive, maximum } = issue as z.core.$ZodIssueTooBig;
      return `${where} ${boundPhrase(origin, inclusive ? 'at most' : 'less than', Number(maximum))}.`;
    }
    case 'invalid_string':
    case 'custom':
      // Every regex and refinement in the schemas carries its own value-free message.
      return `${where} ${issue.message}`;
    case 'not_finite':
      return `${where} must be a finite number, not .inf or .nan.`;
    default:
      return `${where} doesn't match the schema (${view.code}).`;
  }
}

/**
 * An invalid_type issue's expected type as the diagnostics name it: zod 4
 * names a record, a whole number, and a tuple by their own types.
 */
export function expectedName(expected: string): string {
  if (expected === 'record') return 'object';
  if (expected === 'int') return 'integer';
  if (expected === 'tuple') return 'array';
  return expected;
}

/** The type of a value that failed an invalid_type check, as the diagnostics name it. */
export function receivedName(value: unknown, expected: string): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'nan';
    if (expected === 'integer') return 'float';
  }
  return typeof value;
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

/** The value at `path` in `data`: own keys only, undefined when the path leaves the data. */
export function valueAt(data: unknown, path: readonly PropertyKey[]): unknown {
  let value = data;
  for (const segment of path) {
    if (!isPlainObject(value) && !Array.isArray(value)) return undefined;
    if (typeof segment === 'symbol' || !Object.hasOwn(value, segment)) return undefined;
    value = (value as Record<string | number, unknown>)[segment];
  }
  return value;
}
