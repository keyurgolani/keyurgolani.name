// The contract's checks on a publication unit (#5, Slice 1): #4
// UnitValidators that validatePublicationUnit() runs after its own. Slice 5
// folds them into evaluateCompatibility.

import type { Diagnostic, ParsedPair, UnitValidator } from '@portfolio/schema';
import { checkControlValues, contentIndex, hiddenSectionIds } from './controls';
import { toPointer, UNIT_CODES, type UnitCode } from './diagnostics';
import { FALLBACK_ID } from './ids';
import { findVariant, type VariantRegistry } from './registry';

function record(
  code: UnitCode,
  path: readonly (string | number)[],
  message: string,
  remediation: string,
): Diagnostic {
  const pointer = toPointer(path);
  return {
    code,
    severity: UNIT_CODES[code],
    document: 'site',
    pointer,
    message: `${pointer} ${message}`,
    remediation,
  };
}

const INSTALL = 'pnpm --filter @portfolio/web add <package>';

/**
 * `variant.unavailable` when the site selects a variant this build doesn't
 * register, or the fallback composition, which stands in for one and can't
 * be selected. Preview renders the fallback composition; publish is blocked.
 */
export function validateSelection(registry: VariantRegistry): UnitValidator {
  return {
    id: 'variant-selection',
    covers: ['site.appearance.variant'],
    validate(pair: ParsedPair) {
      const id = pair.site.appearance.variant;
      if (id !== FALLBACK_ID && findVariant(registry, id)) return { diagnostics: [] };
      const choices = registry
        .map((entry) => entry.manifest.id)
        .filter((choice) => choice !== FALLBACK_ID)
        .sort();
      const pick = choices.length
        ? `pick one this build registers: ${choices.join(', ')}.`
        : `install a variant with ${INSTALL}.`;
      return {
        diagnostics: [
          id === FALLBACK_ID
            ? record(
                'variant.unavailable',
                ['appearance', 'variant'],
                "names the fallback composition, which stands in for an unavailable variant and can't be selected.",
                `Select a variant: ${pick}`,
              )
            : record(
                'variant.unavailable',
                ['appearance', 'variant'],
                "names a variant this build doesn't register, so the fallback composition renders instead.",
                `Install its package with ${INSTALL} and rebuild, or ${pick}`,
              ),
        ],
      };
    },
  };
}

/**
 * The selected variant's stored control values against its manifest and the
 * visible content. Other variants' entries are kept and left unchecked.
 */
export function validateControls(registry: VariantRegistry): UnitValidator {
  return {
    id: 'variant-controls',
    covers: ['site.variantControls.*'],
    validate(pair: ParsedPair) {
      const active = pair.site.appearance.variant;
      const entries = pair.site.variantControls ?? {};
      const registered = active === FALLBACK_ID ? undefined : findVariant(registry, active);
      const notChecked = Object.keys(entries)
        .filter((id) => id !== active || !registered)
        .map((id) => `site.variantControls.${id}`);
      if (!registered || !Object.hasOwn(entries, active)) return { diagnostics: [], notChecked };
      const content = contentIndex(pair.portfolio, hiddenSectionIds(pair.site));
      const diagnostics = checkControlValues(registered.manifest, entries[active], content).map(
        (problem) =>
          record(
            problem.code,
            ['variantControls', active, ...problem.path],
            problem.message,
            problem.remediation,
          ),
      );
      return { diagnostics, notChecked };
    },
  };
}

/**
 * The site's route toggles against the selected variant's routes. A toggle
 * for a route it doesn't have warns, since another variant may have it, and
 * `home` can't be turned off.
 */
export function validateRoutes(registry: VariantRegistry): UnitValidator {
  return {
    id: 'variant-routes',
    covers: ['site.routes.*'],
    validate(pair: ParsedPair) {
      const toggles = pair.site.routes ?? {};
      const registered = findVariant(registry, pair.site.appearance.variant);
      if (!registered) {
        return {
          diagnostics: [],
          notChecked: Object.keys(toggles).map((id) => `site.routes.${id}`),
        };
      }
      const ids = ['home', 'work', ...registered.manifest.routes.views.map((view) => view.id)];
      const diagnostics: Diagnostic[] = [];
      for (const [id, toggle] of Object.entries(toggles)) {
        if (!ids.includes(id)) {
          diagnostics.push(
            record(
              'route.unknown',
              ['routes', id],
              "names a route the selected variant doesn't have, so it changes nothing unless a variant with that route is selected.",
              `Remove it, or use one of the variant's routes: ${ids.join(', ')}.`,
            ),
          );
        } else if (id === 'home' && toggle.enabled === false) {
          diagnostics.push(
            record(
              'route.required',
              ['routes', 'home', 'enabled'],
              "turns off the front page, which every site serves, so it's ignored.",
              'Remove the home entry.',
            ),
          );
        }
      }
      return { diagnostics };
    },
  };
}

/** All three, in the order Slice 3 passes them to validatePublicationUnit(). */
export function contractValidators(registry: VariantRegistry): readonly UnitValidator[] {
  return [validateSelection(registry), validateControls(registry), validateRoutes(registry)];
}
