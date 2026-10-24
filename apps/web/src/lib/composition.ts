import {
  FALLBACK_ID,
  findVariant,
  type RegisteredVariant,
  type VariantRegistry,
} from '@portfolio/variant-contract';

// Which composition renders for a selection (#5, Slice 3), against the
// registry its caller passes: the server's own (lib/variants.ts), or the
// one Demo Studio's local preview frame gets from its page (#9), since the
// metadata module the server reads is server-only. It imports no registry.

/** What renders for a selection. */
export interface Composition {
  /** The variant that renders. */
  readonly rendered: RegisteredVariant;
  /** The id the site selected. */
  readonly requested: string;
  /**
   * Whether the fallback composition stands in: the selection isn't
   * registered, or it leaves a work's own page to the host (#10b).
   */
  readonly fallback: boolean;
}

/**
 * The registered variant `selected` names, else the fallback composition in
 * its place. The fallback itself is never a selection (the site schema
 * refuses it), so naming it gets the stand-in too.
 */
export function compositionIn(selected: string, registry: VariantRegistry): Composition {
  const registered = selected === FALLBACK_ID ? undefined : findVariant(registry, selected);
  if (registered) return { rendered: registered, requested: selected, fallback: false };
  const fallback = findVariant(registry, FALLBACK_ID);
  // Registry generation fails without it, so only a broken build gets here.
  if (!fallback) throw new Error('This build registers no fallback composition.');
  return { rendered: fallback, requested: selected, fallback: true };
}
