import { FALLBACK_VARIANT_ID } from '@portfolio/schema/ids';
import { compositionStatus, type CompositionStatus } from '@portfolio/variant-contract/status';
import { VARIANTS } from './generated/registry.meta';

// Which variant /sample renders (#1, item 17; #5, Slice 4; #9). It reads
// only the registered ids, with no zod and no component, so proxy.ts, which
// picks the experience segment from it before every request, can load it.
// A `variant` that names nothing this build can select falls back to the
// sample site's own selection, as every other axis does (#9), and the page
// sends the visitor to the URL without it (sample-query.ts). So does one
// that names a composition still in progress (A2): the sample's own
// composition renders, never a half-built one, nor the fallback.

/**
 * The variant specs' opt-in (A2): with it set to exactly `1`, /sample's
 * switch reaches a pending composition too, so tests/variants can check one
 * on the bundled sample before it's ready. Unset, or any other value, and it
 * doesn't. Only the specs' harness sets it; no deployment does.
 */
export const SAMPLE_PENDING_OPT_IN = 'SAMPLE_PENDING_TEST_OPT_IN';

const pendingAllowed = (): boolean =>
  typeof process !== 'undefined' && process.env?.[SAMPLE_PENDING_OPT_IN] === '1';

export type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/** What sampleVariant() reads from the registry: each variant's id. */
export type RegisteredIds = readonly { readonly manifest: { readonly id: string } }[];

/**
 * The registered variant /sample's `variant` parameter names, or undefined
 * for the sample site's own selection: with no parameter, and with one that
 * names the fallback composition, an id this build doesn't register, a
 * pending composition (A2), an empty one, or two values. `status` is the
 * status ledger's (A2): a test gives its own once no composition is pending.
 */
export function sampleVariant(
  query: URLSearchParams,
  registry: RegisteredIds = VARIANTS,
  status: (id: string) => CompositionStatus = compositionStatus,
): string | undefined {
  const named = query.getAll('variant');
  const [only] = named;
  if (named.length !== 1 || only === undefined || only === FALLBACK_VARIANT_ID) return undefined;
  if (status(only) === 'pending' && !pendingAllowed()) return undefined;
  return registry.some(({ manifest }) => manifest.id === only) ? only : undefined;
}
