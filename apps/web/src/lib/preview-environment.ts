import { DisplayModeSchema } from '@portfolio/schema';
import type { EnvironmentOverride } from './environment';

// The environment the dev fixture route's query asks for (#7, Slice 1, item
// 8): the display mode, contrast, motion, and enhancement it renders under.
// environment.ts turns it into the boundary's attributes, as it does a
// grant's.

/** The values each environment parameter takes in a preview's query. */
export const ENVIRONMENT_QUERY = {
  displayMode: DisplayModeSchema.options,
  contrast: ['system', 'more'],
  motion: ['system', 'reduce'],
  enhancement: ['on', 'off'],
} as const;

type Parameter = keyof typeof ENVIRONMENT_QUERY;

/**
 * The environment parameters `query` sets, or null when one of them names a
 * value it doesn't take or comes twice. Other parameters don't count.
 */
export function environmentValues(query: URLSearchParams): EnvironmentOverride | null {
  const values: Partial<Record<Parameter, string>> = {};
  for (const parameter of Object.keys(ENVIRONMENT_QUERY) as Parameter[]) {
    const sent = query.getAll(parameter);
    if (sent.length === 0) continue;
    const [value] = sent;
    const allowed: readonly string[] = ENVIRONMENT_QUERY[parameter];
    if (sent.length > 1 || value === undefined || !allowed.includes(value)) return null;
    values[parameter] = value;
  }
  return values as EnvironmentOverride;
}

/** `values` as a query, which every link in the preview keeps. */
export function environmentQuery(values: EnvironmentOverride): Readonly<Record<string, string>> {
  const query: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) if (value !== undefined) query[name] = value;
  return query;
}
