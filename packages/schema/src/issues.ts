import { z } from 'zod';
import { redactedPointer } from './secrets';

// Issues from a parse inside a parse: the section router and the extensions
// field each run a schema of their own with safeParse(), then report what it
// found as part of the document's parse.

/**
 * Adds an issue from a nested safeParse() to the parse around it, `prefix`
 * below the current path. ctx.addIssue() puts the current path before the
 * issue's own path but leaves the paths in a union's nested errors relative
 * to the nested parse, so those get the whole path here, at every depth.
 */
export function addNestedIssue(
  ctx: z.RefinementCtx,
  issue: z.ZodIssue,
  prefix: readonly (string | number)[] = [],
): void {
  const base = [...ctx.path, ...prefix];
  ctx.addIssue({ ...underBase(issue, base), path: [...prefix, ...issue.path] } as z.IssueData);
}

/** The issue with the paths of every union error inside it moved under `base`. */
function underBase(issue: z.ZodIssue, base: readonly (string | number)[]): z.ZodIssue {
  if (issue.code !== z.ZodIssueCode.invalid_union) return issue;
  return {
    ...issue,
    unionErrors: issue.unionErrors.map(
      (error) =>
        new z.ZodError(
          error.issues.map((inner) => ({
            ...underBase(inner, base),
            path: [...base, ...inner.path],
          })),
        ),
    ),
  };
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
    case 'not_finite':
      return `${where} must be a finite number, not .inf or .nan.`;
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
