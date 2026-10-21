// The contract's checks on a publication unit (#5, Slice 1): #4
// UnitValidators that validatePublicationUnit() runs after its own. Slice 5
// folds them into evaluateCompatibility.

import {
  toPublicView,
  type Context,
  type Diagnostic,
  type DiagnosticSeverity,
  type ParsedPair,
  type UnitValidator,
} from '@portfolio/schema';
import { checkControlValues, contentIndex } from './controls';
import { toPointer, UNIT_CODES, type UnitCode } from './diagnostics';
import { FALLBACK_ID } from './ids';
import { findVariant, type VariantRegistry } from './registry';

export interface ValidatorOptions {
  /**
   * The pair is live: startup and loadPair() check it (Slice 3, item 7). The
   * fallback composition renders for an unavailable selection, and controls
   * fall back to their defaults, so those records only warn. #3's publish
   * leaves it off, and they block.
   */
  readonly live?: boolean;
}

function record(
  code: UnitCode,
  path: readonly (string | number)[],
  message: string,
  remediation: string,
  severity: DiagnosticSeverity = UNIT_CODES[code],
): Diagnostic {
  const pointer = toPointer(path);
  return {
    code,
    severity,
    document: 'site',
    pointer,
    message: `${pointer} ${message}`,
    remediation,
  };
}

/** What a record that falls back when live blocks otherwise. */
const fallsBack = (code: UnitCode, { live = false }: ValidatorOptions): DiagnosticSeverity =>
  live ? 'warning' : UNIT_CODES[code];

const INSTALL = 'pnpm --filter @portfolio/web add <package>';

/**
 * `variant.unavailable` when the site selects a variant this build doesn't
 * register, or the fallback composition, which stands in for one and can't
 * be selected. Preview renders the fallback composition; publish is blocked.
 * Live, an unregistered selection only warns, since the fallback renders;
 * #4's site schema refuses the fallback itself before this runs.
 */
export function validateSelection(
  registry: VariantRegistry,
  options: ValidatorOptions = {},
): UnitValidator {
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
      const registered = choices.join(', ');
      return {
        diagnostics: [
          id === FALLBACK_ID
            ? record(
                'variant.unavailable',
                ['appearance', 'variant'],
                "names the fallback composition, which stands in for an unavailable variant and can't be selected.",
                choices.length
                  ? `Select a variant this build registers: ${registered}.`
                  : `Install a variant with ${INSTALL}, rebuild, and select it.`,
              )
            : record(
                'variant.unavailable',
                ['appearance', 'variant'],
                "names a variant this build doesn't register, so the fallback composition renders instead.",
                choices.length
                  ? `Install its package with ${INSTALL} and rebuild, or select one this build registers: ${registered}.`
                  : `Install its package with ${INSTALL} and rebuild. This build registers no variant yet.`,
                fallsBack('variant.unavailable', options),
              ),
        ],
      };
    },
  };
}

/**
 * The selected variant's stored control values against its manifest and the
 * content it renders: the public view's, which has no hidden section and no
 * unregistered extension section. Other variants' entries are kept and left
 * unchecked. Live, each record only warns, since the control renders its
 * default.
 */
export function validateControls(
  registry: VariantRegistry,
  options: ValidatorOptions = {},
): UnitValidator {
  return {
    id: 'variant-controls',
    covers: ['site.variantControls.*'],
    validate(pair: ParsedPair, ctx: Context) {
      const active = pair.site.appearance.variant;
      const entries = pair.site.variantControls ?? {};
      const registered = active === FALLBACK_ID ? undefined : findVariant(registry, active);
      const notChecked = Object.keys(entries)
        .filter((id) => id !== active || !registered)
        .map((id) => `site.variantControls.${id}`);
      if (!registered || !Object.hasOwn(entries, active)) return { diagnostics: [], notChecked };
      const content = contentIndex(toPublicView(pair, { extensions: ctx.extensions }).portfolio);
      const diagnostics = checkControlValues(registered.manifest, entries[active], content).map(
        (problem) =>
          record(
            problem.code,
            ['variantControls', active, ...problem.path],
            problem.message,
            problem.remediation,
            fallsBack(problem.code, options),
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

/**
 * All three, in the order the host passes them to validatePublicationUnit():
 * live at startup and in loadPair(), and not live for #3's publish.
 */
export function contractValidators(
  registry: VariantRegistry,
  options: ValidatorOptions = {},
): readonly UnitValidator[] {
  return [
    validateSelection(registry, options),
    validateControls(registry, options),
    validateRoutes(registry),
  ];
}
