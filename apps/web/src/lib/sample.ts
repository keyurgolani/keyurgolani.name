import { FALLBACK_VARIANT_ID } from '@portfolio/schema/ids';
import { VARIANTS } from './generated/registry.meta';

// Which variant /sample renders (#1, item 17; #5, Slice 4). It reads only
// the registered ids, with no zod and no component, so the route table,
// which proxy.ts asks before every request, decides from it too: a
// parameter this returns null for is missing, and the app's 404 page
// answers it.

export type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/** What /sample renders, and the query its links keep. */
export interface SampleSelection {
  /** The variant `?variant=` names; absent for the sample site's own selection. */
  readonly selected?: string;
  /** `{ variant }` when the request named one, so every link and redirect keeps it. */
  readonly query: Readonly<Record<string, string>>;
}

/** What sampleSelection() reads from the registry: each variant's id. */
export type RegisteredIds = readonly { readonly manifest: { readonly id: string } }[];

/**
 * The variant /sample renders (#1, item 17), under any path below it (#5,
 * Slice 4): with no `variant` parameter, the sample site's own selection,
 * which falls back like `/` does; with one, the registered variant it names.
 * The fallback composition, an unknown id, an empty one, and a parameter
 * given twice are null, which is a 404.
 */
export function sampleSelection(
  query: SearchParams,
  registry: RegisteredIds = VARIANTS,
): SampleSelection | null {
  const named = query.variant;
  if (named === undefined) return { query: {} };
  if (typeof named !== 'string' || named === FALLBACK_VARIANT_ID) return null;
  return registry.some(({ manifest }) => manifest.id === named)
    ? { selected: named, query: { variant: named } }
    : null;
}
