import type { AppearanceCatalog, UnitValidator } from '@portfolio/schema';
import {
  legacyAppearanceRemediation,
  validateAppearance,
  type AppearanceRegistry,
} from '@portfolio/appearance';

// What a publication unit's appearance is checked with (#19, Slice 4), for
// the server, `pnpm config:validate`, and #3's CLI alike, against the
// appearance registries the caller passes: validateAppearance() in place of
// #4's interim catalog, and the appearance lines a legacy document's
// remediation adds. It imports nothing server-only, since the CLI bundles it.

/**
 * What #4's core check asks of the registries. It checks no axis and no
 * appearance input itself, since validateAppearance() checks each with the
 * registry's own messages, and it adds the appearance lines to a legacy
 * document's remediation.
 */
export function appearanceCatalog(registry: AppearanceRegistry): AppearanceCatalog {
  return {
    ids: () => null,
    generatorInput: () => undefined,
    legacyAppearance: (data) => legacyAppearanceRemediation(data, registry),
  };
}

/**
 * The appearance check. `live`, as startup and loadPair() run it, an
 * unregistered pack warns and its axis falls back; at import and publish it
 * blocks.
 */
export function appearanceValidator(registry: AppearanceRegistry, live: boolean): UnitValidator {
  return validateAppearance(registry, { live });
}
