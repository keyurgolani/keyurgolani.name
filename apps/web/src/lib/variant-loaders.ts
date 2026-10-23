import 'server-only';
import { VARIANT_LOADERS } from './generated/registry.loaders';
import type { VariantLoader } from './experience-document';

// Every registered variant's loader (#5, Slice 3), for what renders the
// variant a request names rather than the live site's: #7's preview frames
// and dev fixture route, and the startup health check. No visitor page
// imports this module (#6, Slice 2): proxy.ts sends each one to the
// experience segment of the composition that renders, which imports only
// that variant, so its chunks hold no other variant's code. check:deps
// fails any app/(site) module that reaches this one or the loaders it reads.

/** The import() registry generation wrote for the registered variant `id`. */
export function variantLoader(id: string): VariantLoader {
  const load = VARIANT_LOADERS[id];
  if (!load) throw new Error('That variant is not registered in this build.');
  return load;
}
