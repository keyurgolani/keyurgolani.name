import type { AppearanceCatalog, ContentExtension, UnitValidator } from '@portfolio/schema';
import type { VariantComponent } from '@portfolio/kit/sections';
import {
  contractValidators,
  FALLBACK_ID,
  findVariant,
  type RegisteredVariant,
  type VariantRegistry,
} from '@portfolio/variant-contract';
import { createAppearanceCatalog } from '../server/appearance-catalog';
import { CONTENT_EXTENSIONS } from './generated/registry.extensions';
import { VARIANT_LOADERS } from './generated/registry.loaders';
import { VARIANTS } from './generated/registry.meta';

// The variants and content extensions this build registers (#5, Slice 3),
// from the modules registry generation writes: which composition renders
// for a selection, which one /sample renders, and what documents are checked
// against. The only variant id the host names is the fallback composition's.
// It imports no server-only module, so `pnpm config:validate` loads it too.

/** Every variant this build registers, the fallback composition included. */
export const REGISTRY: VariantRegistry = VARIANTS;

export { CONTENT_EXTENSIONS };

/** What renders for a selection. */
export interface Composition {
  /** The variant that renders. */
  readonly rendered: RegisteredVariant;
  /** The id the site selected. */
  readonly requested: string;
  /** Whether the fallback composition stands in, since the selection isn't registered. */
  readonly fallback: boolean;
}

/**
 * The registered variant `selected` names, else the fallback composition in
 * its place. The fallback itself is never a selection (the site schema
 * refuses it), so naming it gets the stand-in too.
 */
export function compositionFor(
  selected: string,
  registry: VariantRegistry = REGISTRY,
): Composition {
  const registered = selected === FALLBACK_ID ? undefined : findVariant(registry, selected);
  if (registered) return { rendered: registered, requested: selected, fallback: false };
  const fallback = findVariant(registry, FALLBACK_ID);
  // Registry generation fails without it, so only a broken build gets here.
  if (!fallback) throw new Error('This build registers no fallback composition.');
  return { rendered: fallback, requested: selected, fallback: true };
}

/** A registered variant's component, loaded through the import() generation wrote for it. */
export async function loadComposition(id: string): Promise<VariantComponent> {
  const load = VARIANT_LOADERS[id];
  if (!load) throw new Error('That variant is not registered in this build.');
  return (await load()).default;
}

/**
 * What documents are checked against, live, as startup and `pnpm
 * config:validate` check them: the interim appearance catalog, the
 * registered content extensions, and the contract's validators, under which
 * an unavailable selection and stale controls only warn.
 */
export function liveContext(): {
  readonly catalog: AppearanceCatalog;
  readonly extensions: readonly ContentExtension[];
  readonly validators: readonly UnitValidator[];
} {
  return {
    catalog: createAppearanceCatalog(),
    extensions: CONTENT_EXTENSIONS,
    validators: contractValidators(REGISTRY, { live: true }),
  };
}

export type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/**
 * The variant /sample renders (#1, item 17): with no `variant` parameter, the
 * sample site's own selection, which falls back like `/` does; with one, the
 * registered variant it names. The fallback composition, an unknown id, an
 * empty one, and a parameter given twice are null, which is a 404.
 */
export function sampleVariant(
  query: SearchParams,
  siteSelection: string,
  registry: VariantRegistry = REGISTRY,
): string | null {
  const named = query.variant;
  if (named === undefined) return siteSelection;
  if (typeof named !== 'string' || named === FALLBACK_ID) return null;
  return findVariant(registry, named) ? named : null;
}
