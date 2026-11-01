import type { PublicView } from '@portfolio/schema';
import type { VariantRegistry } from '@portfolio/variant-contract';
import { REGISTRY } from './variants';
import { resolveVisitorPathIn, type VisitorPath, type VisitorRoute } from './visitor-dispatch';

// What a visitor's path is (#5, Slice 4), against this build's registry:
// lib/visitor-dispatch.ts has the rule, which Demo Studio's local preview
// frame (#9) runs against the registry its page hands it.

export type { VisitorPath, VisitorRoute } from './visitor-dispatch';

/**
 * Which route `path` is, against the public view `load` returns. A path
 * whose first segment the host owns, such as /api or /_next, is never a
 * view, so it's missing before anything loads.
 */
export function resolveVisitorPath(
  path: VisitorPath,
  load: () => Promise<PublicView>,
  registry: VariantRegistry = REGISTRY,
): Promise<VisitorRoute> {
  return resolveVisitorPathIn(path, load, registry);
}
