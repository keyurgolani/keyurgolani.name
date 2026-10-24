import { FALLBACK_VARIANT_ID } from '@portfolio/schema/ids';
import { VARIANTS } from './generated/registry.meta';

// Which variant /sample renders (#1, item 17; #5, Slice 4; #9). It reads
// only the registered ids, with no zod and no component, so proxy.ts, which
// picks the experience segment from it before every request, can load it.
// A `variant` that names nothing this build can select falls back to the
// sample site's own selection, as every other axis does (#9), and the page
// sends the visitor to the URL without it (sample-query.ts).

export type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/** What sampleVariant() reads from the registry: each variant's id. */
export type RegisteredIds = readonly { readonly manifest: { readonly id: string } }[];

/**
 * The registered variant /sample's `variant` parameter names, or undefined
 * for the sample site's own selection: with no parameter, and with one that
 * names the fallback composition, an id this build doesn't register, an
 * empty one, or two values.
 */
export function sampleVariant(
  query: URLSearchParams,
  registry: RegisteredIds = VARIANTS,
): string | undefined {
  const named = query.getAll('variant');
  const [only] = named;
  if (named.length !== 1 || only === undefined || only === FALLBACK_VARIANT_ID) return undefined;
  return registry.some(({ manifest }) => manifest.id === only) ? only : undefined;
}
