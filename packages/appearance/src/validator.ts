// The appearance check on a publication unit (#19, Slice 1, item 6): a #4
// UnitValidator for validatePublicationUnit(), in place of #4's catalog and
// its appearance.unknown. The host plugs it in at startup and in loadPair()
// with `live`, and #3's import and publish without (Slice 4). Whether the
// variant is registered stays #5's validateSelection to say.

import {
  resolvePortfolioView,
  type ContentExtension,
  type Diagnostic,
  type DiagnosticSeverity,
  type ParsedPair,
  type UnitValidator,
} from '@portfolio/schema';
import { toPointer } from '@portfolio/variant-contract';
import { AXIS_NAMES, PACK_AXES, PLATFORM_DEFAULTS } from './axes';
import { APPEARANCE_CODES, type AppearanceDiagnostic } from './diagnostics';
import { findPack, otherAxes, selectableIds, type AppearanceRegistry } from './registry';
import { coversScript, scriptOf } from './scripts';
import { alone, valueProblem } from './selection';

export interface AppearanceValidatorOptions {
  /**
   * The pair is live: startup and loadPair() check it. An unregistered pack
   * only warns, since its axis's fallback renders, with the owner's
   * diagnostic and degraded readiness. Import and publish leave it off, and
   * it blocks.
   */
  readonly live?: boolean;
}

/** Which input a generator reads, by the appearanceInputs field that holds it. */
const INPUT_FIELDS = { 'seed-color': 'seedColor', asset: 'sourceAsset' } as const;

/**
 * The site's appearance against this build's registry: each pack id
 * registered on its own axis and not Research, the display mode one the
 * scheme has, a generator scheme's input, and each script the visible
 * content uses covered by the typography profile.
 */
export function validateAppearance(
  registry: AppearanceRegistry,
  options: AppearanceValidatorOptions = {},
): UnitValidator {
  return {
    id: 'appearance',
    covers: [
      'site.appearance.designLanguage',
      'site.appearance.colorScheme',
      'site.appearance.typography',
      'site.appearance.displayMode',
      'site.appearanceInputs.*',
    ],
    validate(pair: ParsedPair, ctx) {
      const diagnostics: Diagnostic[] = [];
      const notChecked: string[] = [];
      const { appearance } = pair.site;
      const add: Add = (document, path, finding) => {
        const pointer = toPointer(path);
        diagnostics.push({
          code: finding.code,
          severity: severityOf(finding, options),
          document,
          pointer,
          message: `${pointer} ${finding.message}`,
          remediation: finding.remediation,
        });
      };

      // An unregistered variant is #5's variant.unavailable; one another axis registers is a type error.
      const variant = valueProblem(registry, 'variant', appearance.variant, appearance);
      if (variant?.code === 'schema.invalid') add('site', ['appearance', 'variant'], variant);

      for (const axis of PACK_AXES) {
        const id = appearance[axis];
        const problem = valueProblem(registry, axis, id, alone(axis, id));
        if (problem) {
          add('site', ['appearance', axis], {
            ...problem,
            ...(problem.code === 'appearance.unavailable'
              ? {
                  message: `${problem.message} Preview shows ${PLATFORM_DEFAULTS[axis]} in its place.`,
                }
              : {}),
          });
        } else if (findPack(registry, axis, id)!.manifest.tier === 'research') {
          add('site', ['appearance', axis], {
            code: 'appearance.not-publishable',
            axis,
            message: `names a Research ${AXIS_NAMES[axis]}, which never ships. Preview renders it for review only.`,
            remediation: `Select a stable, extended, or experimental one: ${selectableIds(registry, axis).join(', ')}.`,
          });
        }
      }

      const mode = valueProblem(registry, 'displayMode', appearance.displayMode, appearance);
      if (mode) add('site', ['appearance', 'displayMode'], mode);

      checkInputs(registry, pair, add, notChecked);
      checkScripts(registry, pair, ctx.extensions, add);
      return { diagnostics, notChecked };
    },
  };
}

function severityOf(
  finding: AppearanceDiagnostic,
  options: AppearanceValidatorOptions,
): DiagnosticSeverity {
  if (finding.code === 'schema.invalid') return 'blocks-preview';
  if (finding.code === 'variant.unavailable') return 'blocks-publish';
  if (finding.code === 'appearance.unavailable' && options.live) return 'warning';
  return APPEARANCE_CODES[finding.code];
}

type Add = (
  document: Diagnostic['document'],
  path: readonly (string | number)[],
  finding: AppearanceDiagnostic,
) => void;

/**
 * The selected generator scheme needs an entry of the kind its generator
 * reads. Every entry is keyed by a generator scheme; one keyed by an id
 * this build doesn't register goes unchecked.
 */
function checkInputs(
  registry: AppearanceRegistry,
  pair: ParsedPair,
  add: Add,
  notChecked: string[],
) {
  const inputs = pair.site.appearanceInputs ?? {};
  const selected = findPack(registry, 'colorScheme', pair.site.appearance.colorScheme);
  const generator = selected?.manifest.generator;
  if (generator && !Object.hasOwn(inputs, selected.manifest.id)) {
    add('site', ['appearance', 'colorScheme'], {
      code: 'appearance.input-missing',
      axis: 'colorScheme',
      message: `names a generated color scheme with no appearanceInputs entry to generate it from.`,
      remediation: `Add appearanceInputs.${selected.manifest.id} with ${INPUT_FIELDS[generator.input]}.`,
    });
  }
  for (const [id, input] of Object.entries(inputs)) {
    const scheme = findPack(registry, 'colorScheme', id);
    if (!scheme) {
      const others = otherAxes(registry, 'colorScheme', id);
      if (others.length === 0) {
        notChecked.push(`site.appearanceInputs.${id}`);
        continue;
      }
      add('site', ['appearanceInputs', id], {
        code: 'schema.invalid',
        axis: 'colorScheme',
        message: `is keyed by a ${others.map((axis) => AXIS_NAMES[axis]).join(' and a ')}, and appearanceInputs is keyed by generated color schemes.`,
        remediation: 'Remove the entry, or key it by a generated color scheme.',
      });
      continue;
    }
    const takes = scheme.manifest.generator?.input;
    if (!takes) {
      add('site', ['appearanceInputs', id], {
        code: 'schema.invalid',
        axis: 'colorScheme',
        message: 'is for a color scheme that takes no input.',
        remediation: 'Remove the entry, or key it by a generated color scheme.',
      });
    } else if (!(INPUT_FIELDS[takes] in input)) {
      add('site', ['appearanceInputs', id], {
        code: 'appearance.input-missing',
        axis: 'colorScheme',
        message: `gives ${id} the wrong kind of input.`,
        remediation: `${id} takes ${takes === 'seed-color' ? 'a seed color' : 'a source asset'}: set ${INPUT_FIELDS[takes]}.`,
      });
    }
  }
}

/**
 * A warning for the locale, and for the lang of each visible section and of
 * each work, evidence entry, and chronology entry the published view keeps
 * (#10), written in a script the profile lacks.
 */
function checkScripts(
  registry: AppearanceRegistry,
  pair: ParsedPair,
  extensions: readonly ContentExtension[] | undefined,
  add: Add,
) {
  const typography =
    findPack(registry, 'typography', pair.site.appearance.typography) ??
    findPack(registry, 'typography', PLATFORM_DEFAULTS.typography)!;
  const { id, scripts } = typography.manifest;
  // The published view keeps only what a visitor reads, whose ids are unique in the document.
  const view = resolvePortfolioView(pair, {}, { mediaBase: '/media', extensions }).portfolio;
  const visible = new Set(
    [view.sections, view.works, view.evidence, view.chronology].flatMap((list) =>
      list.map(({ id }) => id),
    ),
  );
  const check = (path: readonly (string | number)[], tag: unknown) => {
    if (typeof tag !== 'string') return;
    const script = scriptOf(tag);
    if (!script || coversScript(scripts, script)) return;
    const covering = selectableIds(registry, 'typography').filter((other) =>
      coversScript(findPack(registry, 'typography', other)!.manifest.scripts, script),
    );
    add('portfolio', path, {
      code: 'appearance.script-coverage',
      axis: 'typography',
      message: `is written in the ${script} script, which ${id} doesn't cover, so browsers fall back to a font of their own for it.`,
      remediation: covering.length
        ? `Select a typography profile that covers ${script}: ${covering.join(', ')}.`
        : `No typography profile this build registers covers ${script}. Install one that does, or keep the browser's fallback.`,
    });
  };
  check(['locale'], pair.portfolio.locale);
  const { portfolio } = pair;
  for (const [list, items] of [
    ['sections', portfolio.sections],
    ['works', portfolio.works],
    ['evidence', portfolio.evidence],
    ['chronology', portfolio.chronology],
  ] as const) {
    (items ?? []).forEach((item: { readonly id: string; readonly lang?: unknown }, index) => {
      if (visible.has(item.id)) check([list, index, 'lang'], item.lang);
    });
  }
}
