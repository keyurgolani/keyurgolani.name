import { z } from 'zod';

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
