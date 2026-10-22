// The contract's check on a publication unit: a #4 UnitValidator that
// validatePublicationUnit() runs after its own. Since Slice 5 it's the
// compatibility report (compatibility.ts), which folds in Slice 1's checks on
// the selection, the stored control values, and the route toggles.

import type { ParsedPair, UnitValidator } from '@portfolio/schema';
import { compatibilityFindings, type CompatibilityOptions } from './compatibility';
import type { VariantRegistry } from './registry';

export type ValidatorOptions = Omit<CompatibilityOptions, 'registry' | 'extensions'>;

/**
 * The compatibility report's findings, for the composition that renders the
 * pair: its selection, or the fallback composition in its place. Live at
 * startup and in loadPair(), and not live for #3's publish. It skips the
 * report's hash, and keeps `variant.unavailable` when checking the
 * composition throws, so one broken input can't take every finding with it.
 */
export function validateCompatibility(
  registry: VariantRegistry,
  options: ValidatorOptions = {},
): UnitValidator {
  return {
    id: 'variant-compatibility',
    covers: ['site.appearance.variant', 'site.variantControls.*', 'site.routes.*'],
    validate(pair: ParsedPair, ctx) {
      return compatibilityFindings(pair, { ...options, registry, extensions: ctx.extensions });
    },
  };
}

/** What the host passes to validatePublicationUnit(), in order. */
export function contractValidators(
  registry: VariantRegistry,
  options: ValidatorOptions = {},
): readonly UnitValidator[] {
  return [validateCompatibility(registry, options)];
}
