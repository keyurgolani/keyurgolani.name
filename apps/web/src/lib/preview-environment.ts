import { DisplayModeSchema, type DisplayMode } from '@portfolio/schema';

// The environment a preview fixes for its document (#7, Slices 1 and 4): the
// display mode, contrast, motion, and enhancement it renders under, asked for
// in the query, and set as attributes on the presentation boundary under the
// names #19 keeps. A public page renders in its visitor's own environment and
// sets none. Motion only reduces: `motion=system` sets nothing, so a preview
// never moves more than the reader's own setting allows.

/** The environment's attributes on the presentation boundary. */
export interface EnvironmentAttributes {
  readonly 'data-display-mode'?: DisplayMode;
  readonly 'data-contrast'?: 'system' | 'more';
  readonly 'data-motion'?: 'full' | 'reduced';
  readonly 'data-enhancement'?: 'on' | 'off';
}

/** The values each environment parameter takes in a preview's query. */
export const ENVIRONMENT_QUERY = {
  displayMode: DisplayModeSchema.options,
  contrast: ['system', 'more'],
  motion: ['system', 'reduce'],
  enhancement: ['on', 'off'],
} as const;

type Parameter = keyof typeof ENVIRONMENT_QUERY;
type Values = { readonly [P in Parameter]?: (typeof ENVIRONMENT_QUERY)[P][number] };

/**
 * The environment parameters `query` sets, or null when one of them names a
 * value it doesn't take or comes twice. Other parameters don't count.
 */
export function environmentValues(query: URLSearchParams): Values | null {
  const values: Partial<Record<Parameter, string>> = {};
  for (const parameter of Object.keys(ENVIRONMENT_QUERY) as Parameter[]) {
    const sent = query.getAll(parameter);
    if (sent.length === 0) continue;
    const [value] = sent;
    const allowed: readonly string[] = ENVIRONMENT_QUERY[parameter];
    if (sent.length > 1 || value === undefined || !allowed.includes(value)) return null;
    values[parameter] = value;
  }
  return values as Values;
}

/** `values` as a query, which every link in the preview keeps. */
export function environmentQuery(values: Values): Readonly<Record<string, string>> {
  const query: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) if (value !== undefined) query[name] = value;
  return query;
}

/** The attributes `values` puts on the presentation boundary. */
export function environmentAttributes(values: Values): EnvironmentAttributes {
  return {
    ...(values.displayMode ? { 'data-display-mode': values.displayMode } : {}),
    ...(values.contrast ? { 'data-contrast': values.contrast } : {}),
    ...(values.motion === 'reduce' ? { 'data-motion': 'reduced' } : {}),
    ...(values.enhancement ? { 'data-enhancement': values.enhancement } : {}),
  };
}
