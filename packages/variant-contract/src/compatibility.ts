// How a publication unit renders in a composition (#5, Slice 5, item 1): the
// renderer each visible kind gets, how full each content slot is, the views
// of the previous variant this one doesn't serve, and what to fix, as #4
// Diagnostics that say what renders instead and whether publishing is
// blocked. It folds in Slice 1's checks on the selection, the stored control
// values, and the route toggles. Pure and browser-safe: the host's checks
// run it, and #3's publish and #9's in-browser render can.

import {
  canonicalize,
  compareDiagnostics,
  isPlainObject,
  languageDirection,
  parseExtensionKind,
  resolvePortfolioView,
  type ContentExtension,
  type Diagnostic,
  type DiagnosticSeverity,
  type ParsedPair,
  type PublicPortfolio,
} from '@portfolio/schema';
import {
  checkControlValues,
  contentIndex,
  materializeControls,
  storedControls,
  type ControlProblem,
  type ControlValues,
} from './controls';
import { toPointer, UNIT_CODES, type UnitCode } from './diagnostics';
import { FALLBACK_ID } from './ids';
import type { ContentSlot, VariantManifest } from './manifest-schema';
import { findVariant, type RegisteredVariant, type VariantRegistry } from './registry';
import { viewShape } from './segments';
import { sha256 } from './sha256';
import { CONTRACT_VERSION } from './version';

/** The report's shape version, which a stored report carries. */
export const REPORT_VERSION = 1;

/** How a visible kind renders. */
export type KindRenderer =
  /** The composition's own renderer: the kind is in its renderedKinds. */
  | 'bespoke'
  /** The kit's shared renderer for a core kind. */
  | 'shared'
  /** The renderer the kind's content extension registered. */
  | 'extension'
  /** Nothing: the composition lists the kind in unsupportedKinds. */
  | 'unsupported'
  /** Nothing: no content extension registered a renderer for the kind. */
  | 'none';

export interface KindReport {
  readonly kind: string;
  /** How many visible sections are of the kind. */
  readonly sections: number;
  readonly renderer: KindRenderer;
}

export interface SlotReport {
  readonly id: string;
  readonly label: string;
  readonly level: ContentSlot['level'];
  /**
   * How many items fill it: visible sections of its kind, visible sections
   * its control points at, or values its field holds, where an array counts
   * each item in it.
   */
  readonly count: number;
  readonly min: number;
  readonly max?: number;
  /** What the composition does without enough: present when the slot has fewer than min, or none. */
  readonly whenEmpty?: ContentSlot['whenEmpty'];
}

/**
 * A path view of the previous variant that this one doesn't serve. Its
 * address redirects to its parent route while the previous variant stays
 * installed, and is missing (404) once it's removed.
 */
export interface RouteReport {
  readonly id: string;
  readonly under: 'home' | 'work';
  readonly segment: string;
}

/** The most severe finding's severity, or `ok` with none. */
export type CompatibilityStatus = 'ok' | 'warning' | 'blocks-publish';

export interface CompatibilityReport {
  readonly reportVersion: typeof REPORT_VERSION;
  readonly variant: {
    /** What the site document selects. In a candidate's report from evaluateCompatibility(), the candidate's id. */
    readonly requested: string;
    /**
     * What renders: the selection, or the fallback composition in its place.
     * A candidate's report describes the candidate, so it's the candidate's
     * id there, even when its `variant.unavailable` says what would render.
     */
    readonly rendered: string;
    /** The rendered variant's package version, when the registry lists it. */
    readonly version: string | null;
  };
  /**
   * `sha256:` and the hex digest of every input the report depends on, so a
   * stored report can be checked against the pair it describes.
   */
  readonly inputHash: string;
  readonly status: CompatibilityStatus;
  /** Each visible kind, in the order it first appears. */
  readonly kinds: readonly KindReport[];
  /** Each of the composition's content slots, in manifest order. */
  readonly slots: readonly SlotReport[];
  readonly routes: readonly RouteReport[];
  /** Sorted by document, pointer, and code, as #4 sorts them. */
  readonly diagnostics: readonly Diagnostic[];
  /** What the report couldn't check, such as the recommended appearance until #20 lists recipes. */
  readonly notChecked: readonly string[];
}

export interface CompatibilityOptions {
  /** Every variant this build registers. */
  readonly registry: VariantRegistry;
  /** The variant the site rendered before, such as the live revision's, whose path views it checks. */
  readonly previous?: VariantManifest;
  /** The content extensions this build registers. Other extension data isn't visible. */
  readonly extensions?: readonly ContentExtension[];
  /** The extension kinds with a renderer, as `<namespace>/<name>`. Without it, none has one. */
  readonly extensionRenderers?: readonly string[];
  /** The appearance recipes this build lists (#20). Without it, a recommended appearance isn't checked. */
  readonly recipes?: readonly string[];
  /**
   * The pair is live: startup and loadPair() check it (Slice 3, item 7).
   * What renders anyway, such as the fallback composition or a control's
   * default, only warns. #3's publish leaves it off, and those block.
   */
  readonly live?: boolean;
}

type Path = readonly (string | number)[];

/** The sentence every finding ends with: what it holds back. */
const BLOCKS_PUBLISHING = 'It blocks publishing, not preview.';
const BLOCKS_NOTHING = 'It blocks neither preview nor publishing.';
const INSTALL = 'pnpm --filter @portfolio/web add <package>';

/**
 * The report for `unit`, rendered in the registered variant it selects, or
 * in the fallback composition when the selection isn't registered. Without a
 * fallback composition in the registry, only the selection is checked.
 */
export function compatibilityFor(
  unit: ParsedPair,
  options: CompatibilityOptions,
): CompatibilityReport {
  const requested = unit.site.appearance.variant;
  const selection = new Findings(options.live ?? false);
  const selected = selectable(requested, options.registry);
  if (!selected) unavailable(requested, options.registry, selection);
  const rendered = selected ?? findVariant(options.registry, FALLBACK_ID);
  if (!rendered) {
    return report(
      { requested, rendered: FALLBACK_ID, version: null },
      hashInputs(null, requested, unit, options),
      NOTHING_RENDERED,
      selection.diagnostics,
      notCheckedWithout(unit),
    );
  }
  const composition = evaluate(rendered.manifest, unit, options, selected !== undefined);
  return report(
    { requested, rendered: rendered.manifest.id, version: rendered.version },
    hashInputs(rendered.manifest, requested, unit, options),
    composition.parts,
    [...selection.diagnostics, ...composition.diagnostics],
    composition.notChecked,
  );
}

/**
 * How `unit` would render with `manifest` selected, as #8 and #9 explain a
 * candidate before the owner selects it: the candidate is the selection, so
 * the site's own selection plays no part, and the route toggles are checked
 * against the candidate's routes. A candidate this build doesn't register,
 * or the fallback composition, is `variant.unavailable`, whose message says
 * what selecting it would render. The rest of the report still describes
 * `manifest`, without the route toggles, which no site selecting it gets.
 */
export function evaluateCompatibility(
  manifest: VariantManifest,
  unit: ParsedPair,
  options: CompatibilityOptions,
): CompatibilityReport {
  const requested = manifest.id;
  const selection = new Findings(options.live ?? false);
  const selected = selectable(requested, options.registry);
  if (!selected) unavailable(requested, options.registry, selection);
  const composition = evaluate(manifest, unit, options, selected !== undefined);
  return report(
    {
      requested,
      rendered: manifest.id,
      version: findVariant(options.registry, manifest.id)?.version ?? null,
    },
    hashInputs(manifest, requested, unit, options),
    composition.parts,
    [...selection.diagnostics, ...composition.diagnostics],
    composition.notChecked,
  );
}

/**
 * The report's diagnostics and what it couldn't check, as the compatibility
 * validator returns them to #4: without the hash, which the validator has
 * no use for. The selection is checked first and apart, so when checking
 * the composition throws, `variant.unavailable` still stands, and the
 * composition, its stored controls, and the route toggles are listed as not
 * checked in place of what it would have found.
 */
export function compatibilityFindings(
  unit: ParsedPair,
  options: CompatibilityOptions,
): { diagnostics: Diagnostic[]; notChecked: string[] } {
  const requested = unit.site.appearance.variant;
  const selection = new Findings(options.live ?? false);
  const selected = selectable(requested, options.registry);
  if (!selected) unavailable(requested, options.registry, selection);
  const rendered = selected ?? findVariant(options.registry, FALLBACK_ID);
  let composition: Composition | undefined;
  if (rendered) {
    try {
      composition = evaluate(rendered.manifest, unit, options, selected !== undefined);
    } catch {
      composition = undefined;
    }
  }
  return {
    diagnostics: [...selection.diagnostics, ...(composition?.diagnostics ?? [])].sort(
      compareDiagnostics,
    ),
    notChecked: [...new Set(composition?.notChecked ?? notCheckedWithout(unit))].sort(),
  };
}

const NOTHING_RENDERED: Composition['parts'] = { kinds: [], slots: [], routes: [] };

/** The registered variant `id` names, when a site can select it: any but the fallback composition. */
function selectable(id: string, registry: VariantRegistry): RegisteredVariant | undefined {
  return id === FALLBACK_ID ? undefined : findVariant(registry, id);
}

/** What a report that checks no composition leaves unchecked: the composition, every stored entry, and every toggle. */
function notCheckedWithout(unit: ParsedPair): string[] {
  return [
    ...entriesNotChecked(unit, undefined),
    ...togglesNotChecked(unit),
    'variant.compatibility',
  ];
}

/** How a pair renders in one composition: everything in the report but the selection's finding. */
interface Composition {
  readonly parts: Pick<CompatibilityReport, 'kinds' | 'slots' | 'routes'>;
  readonly diagnostics: readonly Diagnostic[];
  readonly notChecked: readonly string[];
}

/**
 * How `unit` renders in `manifest`'s composition. `selected` is whether the
 * composition is the selection itself: the route toggles are about the
 * selection's routes, so they're checked only then, and not while the
 * fallback composition renders in its place.
 */
function evaluate(
  manifest: VariantManifest,
  unit: ParsedPair,
  options: CompatibilityOptions,
  selected: boolean,
): Composition {
  const findings = new Findings(options.live ?? false);
  // Kinds, slots, and controls read the authored content alone, so the
  // unit's derived inputs don't change the report.
  const view = resolvePortfolioView(
    unit,
    {},
    { mediaBase: '/media', extensions: options.extensions },
  );
  // Where each visible section sits in the document.
  const sections = documentIndexes(unit, view.portfolio);
  const kinds = kindReports(manifest, view.portfolio, sections, options, findings);

  const content = contentIndex(view.portfolio);
  const entry = storedControls(unit.site, manifest.id);
  for (const problem of checkControlValues(manifest, entry, content)) {
    findings.add(
      problem.code,
      'site',
      ['variantControls', manifest.id, ...problem.path],
      `${problem.message}${controlConsequence(problem, manifest)} ${BLOCKS_PUBLISHING}`,
      problem.remediation,
    );
  }
  const values = materializeControls(manifest, entry, content);
  const slots = manifest.contentSlots.map((slot) =>
    slotReport(slot, manifest, view.portfolio, sections, values, findings),
  );

  checkDirection(manifest, view.portfolio, sections, findings);
  const notChecked = entriesNotChecked(unit, manifest.id);
  if (manifest.recommendedAppearance !== undefined) {
    if (!options.recipes) {
      notChecked.push('variant.recommendedAppearance');
    } else if (!options.recipes.includes(manifest.recommendedAppearance)) {
      findings.add(
        'appearance.unknown-recipe',
        'site',
        ['appearance', 'variant'],
        `names a variant that recommends an appearance recipe this build doesn't list, so nothing suggests it, and the site's own appearance renders. ${BLOCKS_NOTHING}`,
        'Install the appearance package that lists the recipe, or upgrade the variant to a release that recommends one this build has.',
      );
    }
  }
  if (selected) checkToggles(unit, manifest, findings);
  else notChecked.push(...togglesNotChecked(unit));

  return {
    parts: { kinds, slots, routes: routeReports(manifest, options.previous) },
    diagnostics: findings.diagnostics,
    notChecked,
  };
}

/**
 * Collects the findings, each with its #4 severity, or a warning when the
 * pair is live and something renders in place of what it's about.
 */
class Findings {
  readonly diagnostics: Diagnostic[] = [];

  constructor(private readonly live: boolean) {}

  add(
    code: UnitCode,
    document: Diagnostic['document'],
    path: Path,
    message: string,
    remediation: string,
    { fallsBack = true }: { readonly fallsBack?: boolean } = {},
  ): void {
    const severity: DiagnosticSeverity =
      this.live && fallsBack && UNIT_CODES[code] === 'blocks-publish'
        ? 'warning'
        : UNIT_CODES[code];
    const pointer = toPointer(path);
    this.diagnostics.push({
      code,
      severity,
      document,
      pointer,
      message: `${pointer} ${message}`,
      remediation,
    });
  }
}

function report(
  variant: CompatibilityReport['variant'],
  inputHash: string,
  parts: Composition['parts'],
  findings: readonly Diagnostic[],
  notChecked: readonly string[],
): CompatibilityReport {
  const diagnostics = [...findings].sort(compareDiagnostics);
  const status: CompatibilityStatus = diagnostics.some(
    ({ severity }) => severity === 'blocks-publish',
  )
    ? 'blocks-publish'
    : diagnostics.length > 0
      ? 'warning'
      : 'ok';
  return {
    reportVersion: REPORT_VERSION,
    variant,
    inputHash,
    status,
    ...parts,
    diagnostics,
    notChecked: [...new Set(notChecked)].sort(),
  };
}

/**
 * `variant.unavailable`: the selection isn't registered, so the fallback
 * composition renders in its place, or it names the fallback composition,
 * which can't be selected. The site schema refuses the second, so only a
 * caller that skips it gets here with one.
 */
function unavailable(requested: string, registry: VariantRegistry, findings: Findings): void {
  const choices = registry
    .map((entry) => entry.manifest.id)
    .filter((choice) => choice !== FALLBACK_ID)
    .sort();
  const registered = choices.join(', ');
  if (requested === FALLBACK_ID) {
    findings.add(
      'variant.unavailable',
      'site',
      ['appearance', 'variant'],
      `names the fallback composition, which stands in for an unavailable variant and can't be selected. ${BLOCKS_PUBLISHING}`,
      choices.length
        ? `Select a variant this build registers: ${registered}.`
        : `Install a variant with ${INSTALL}, rebuild, and select it.`,
      // Nothing stands in for the stand-in, so it blocks live too.
      { fallsBack: false },
    );
    return;
  }
  findings.add(
    'variant.unavailable',
    'site',
    ['appearance', 'variant'],
    `names a variant this build doesn't register, so the fallback composition renders instead. ${BLOCKS_PUBLISHING}`,
    choices.length
      ? `Install its package with ${INSTALL} and rebuild, or select one this build registers: ${registered}.`
      : `Install its package with ${INSTALL} and rebuild. This build registers no variant yet.`,
  );
}

/** What a control finding leaves on the page, after its message. */
function controlConsequence(problem: ControlProblem, manifest: VariantManifest): string {
  // A stale entry's message already says every control renders its default.
  if (problem.code === 'controls.stale') return '';
  const key = problem.path[1];
  return manifest.controls.items.some((control) => control.id === key)
    ? ' The control renders its default.'
    : ' Nothing reads it.';
}

/**
 * Each visible section's index in the portfolio document, so a finding
 * points where the owner edits. The published view keeps the document's
 * order and drops sections, and an id is unique in a version 3 document,
 * so the view's sections match the document's in order by id.
 */
function documentIndexes(unit: ParsedPair, portfolio: PublicPortfolio): number[] {
  const authored = unit.portfolio.sections ?? [];
  const indexes: number[] = [];
  let next = 0;
  for (const section of portfolio.sections) {
    while (next < authored.length && authored[next]!.id !== section.id) {
      next++;
    }
    indexes.push(next);
    next++;
  }
  return indexes;
}

function kindReports(
  manifest: VariantManifest,
  portfolio: PublicPortfolio,
  sections: readonly number[],
  options: CompatibilityOptions,
  findings: Findings,
): KindReport[] {
  const renderers = new Set(options.extensionRenderers ?? []);
  const byKind = new Map<string, { sections: number; renderer: KindRenderer }>();
  portfolio.sections.forEach((section, index) => {
    const renderer = rendererFor(manifest, section.kind, renderers);
    const seen = byKind.get(section.kind);
    if (seen) seen.sections++;
    else byKind.set(section.kind, { sections: 1, renderer });
    const at = ['sections', sections[index]!] as const;
    if (renderer === 'unsupported') {
      findings.add(
        'kind.unsupported',
        'portfolio',
        at,
        `is of a kind the composition doesn't show, so visitors don't see it. ${BLOCKS_NOTHING}`,
        "Hide it in the site document's sections, or select a variant that shows its kind.",
      );
    } else if (renderer === 'none') {
      findings.add(
        'kind.no-renderer',
        'portfolio',
        at,
        `is of an extension kind nothing renders, since its content extension registered no renderer for it, so it doesn't appear and the rest of the page does. ${BLOCKS_PUBLISHING}`,
        "Install a release of its content extension that renders the kind, hide the section in the site document's sections, or remove it.",
      );
    }
  });
  return [...byKind].map(([kind, entry]) => ({ kind, ...entry }));
}

function rendererFor(
  manifest: VariantManifest,
  kind: string,
  extensionRenderers: ReadonlySet<string>,
): KindRenderer {
  if (manifest.renderedKinds.includes(kind)) return 'bespoke';
  if (manifest.unsupportedKinds.includes(kind)) return 'unsupported';
  if (!parseExtensionKind(kind)) return 'shared';
  return extensionRenderers.has(kind) ? 'extension' : 'none';
}

/** One item filling a slot, located where the owner edits it. */
interface SlotItem {
  readonly document: Diagnostic['document'];
  readonly path: Path;
}

function slotReport(
  slot: ContentSlot,
  manifest: VariantManifest,
  portfolio: PublicPortfolio,
  sections: readonly number[],
  values: ControlValues,
  findings: Findings,
): SlotReport {
  const { items, empty, remediation } = slotItems(slot, manifest, portfolio, sections, values);
  const count = items.length;
  const want = Math.max(slot.min, 1);
  const short = count < want;
  const whenEmpty =
    slot.whenEmpty.mode === 'omit'
      ? 'the composition leaves the slot out'
      : "the composition keeps the slot's place";
  const label = JSON.stringify(slot.label);
  if (slot.level === 'required' && count < slot.min) {
    findings.add(
      'slot.required-empty',
      empty.document,
      empty.path,
      `holds ${count} of the ${slot.min} items the composition's ${label} slot needs, so ${whenEmpty}: ${slot.whenEmpty.note} ${BLOCKS_PUBLISHING}`,
      remediation,
    );
  } else if (slot.level === 'recommended' && short) {
    findings.add(
      'slot.recommended-empty',
      empty.document,
      empty.path,
      `holds ${count} of the ${want} items the composition's ${label} slot recommends, so ${whenEmpty}: ${slot.whenEmpty.note} ${BLOCKS_NOTHING}`,
      remediation,
    );
  }
  if (slot.max !== undefined && count > slot.max) {
    const first = items[slot.max]!;
    findings.add(
      'slot.overflow',
      first.document,
      first.path,
      `is past the ${slot.max} items the composition's ${label} slot takes, of the ${count} there are, so it and any after it render after the slot. ${BLOCKS_NOTHING}`,
      `Keep it, or trim to ${slot.max} to fit the slot.`,
    );
  }
  return {
    id: slot.id,
    label: slot.label,
    level: slot.level,
    count,
    min: slot.min,
    ...(slot.max === undefined ? {} : { max: slot.max }),
    ...(short ? { whenEmpty: slot.whenEmpty } : {}),
  };
}

/** What fills a slot, where an empty one is located, and how to fill it. */
function slotItems(
  slot: ContentSlot,
  manifest: VariantManifest,
  portfolio: PublicPortfolio,
  sections: readonly number[],
  values: ControlValues,
): { items: SlotItem[]; empty: SlotItem; remediation: string } {
  const select = slot.select;
  if ('kind' in select) {
    const items: SlotItem[] = [];
    portfolio.sections.forEach((section, index) => {
      if (section.kind === select.kind) {
        items.push({ document: 'portfolio', path: ['sections', sections[index]!] });
      }
    });
    return {
      items,
      empty: { document: 'portfolio', path: ['sections'] },
      remediation: `Add a visible ${select.kind} section, or unhide one in the site document's sections.`,
    };
  }
  if ('control' in select) {
    const at = ['variantControls', manifest.id, 'values', select.control] as const;
    const value = values[select.control];
    const refs = Array.isArray(value)
      ? value.map((_, index) => [...at, index])
      : value === null || value === undefined
        ? []
        : [at];
    return {
      items: refs.map((path) => ({ document: 'site', path })),
      empty: { document: 'site', path: at },
      remediation: `Point the ${select.control} control at a visible section, in the site document's variantControls.${manifest.id}.values.`,
    };
  }
  return {
    items: fieldItems(portfolio, select.field, sections),
    empty: { document: 'portfolio', path: staticPrefix(select.field) },
    remediation: `Fill in ${select.field} in the portfolio document.`,
  };
}

/** The pointer's segments, decoded as RFC 6901 says. */
function pointerParts(pointer: string): string[] {
  return pointer
    .slice(1)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** The pointer's segments before its first `*`: where an empty field slot is located. */
function staticPrefix(pointer: string): string[] {
  const parts = pointerParts(pointer);
  const star = parts.indexOf('*');
  return star === -1 ? parts : parts.slice(0, star);
}

/**
 * The values a field pointer reaches in the public portfolio, where `*`
 * matches any array index, each located in the document. An array counts
 * each item in it; a blank string, null, or nothing counts none.
 */
function fieldItems(
  portfolio: PublicPortfolio,
  pointer: string,
  sections: readonly number[],
): SlotItem[] {
  const parts = pointerParts(pointer);
  const items: SlotItem[] = [];
  // Paths into the public view, whose sections the document numbers its own way.
  const located = (path: readonly (string | number)[]): SlotItem => ({
    document: 'portfolio',
    path:
      path[0] === 'sections' && typeof path[1] === 'number'
        ? ['sections', sections[path[1]]!, ...path.slice(2)]
        : path,
  });
  const walk = (value: unknown, depth: number, path: readonly (string | number)[]): void => {
    if (depth === parts.length) {
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          if (present(item)) items.push(located([...path, index]));
        });
      } else if (present(value)) {
        items.push(located(path));
      }
      return;
    }
    const part = parts[depth]!;
    if (Array.isArray(value)) {
      if (part === '*') value.forEach((item, index) => walk(item, depth + 1, [...path, index]));
      else if (/^(?:0|[1-9]\d*)$/.test(part))
        walk(value[Number(part)], depth + 1, [...path, Number(part)]);
      return;
    }
    if (isPlainObject(value) && Object.hasOwn(value, part)) {
      walk(value[part], depth + 1, [...path, part]);
    }
  };
  walk(portfolio, 0, []);
  return items;
}

function present(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return !(Array.isArray(value) && value.length === 0);
}

/** `direction.unsupported`: content that runs right to left, in a composition that lays out left to right only. */
function checkDirection(
  manifest: VariantManifest,
  portfolio: PublicPortfolio,
  sections: readonly number[],
  findings: Findings,
): void {
  if (manifest.textDirection.includes('rtl')) return;
  const remediation =
    'Select a variant whose textDirection includes rtl, or keep this one and its left-to-right layout.';
  if (portfolio.direction === 'rtl') {
    findings.add(
      'direction.unsupported',
      'portfolio',
      ['direction'],
      `runs right to left, and the composition lays out left to right only, so its layout doesn't mirror. ${BLOCKS_NOTHING}`,
      remediation,
    );
    return;
  }
  portfolio.sections.forEach((section, index) => {
    if (section.lang !== undefined && languageDirection(section.lang) === 'rtl') {
      findings.add(
        'direction.unsupported',
        'portfolio',
        ['sections', sections[index]!, 'lang'],
        `names a language that runs right to left, and the composition lays out left to right only, so the section's layout doesn't mirror. ${BLOCKS_NOTHING}`,
        remediation,
      );
    }
  });
}

/**
 * The site's route toggles against the composition's routes. One for a
 * route it doesn't have warns, since another variant may have it, and `home`
 * can't be turned off.
 */
function checkToggles(unit: ParsedPair, manifest: VariantManifest, findings: Findings): void {
  const ids = ['home', 'work', ...manifest.routes.views.map((view) => view.id)];
  for (const [id, toggle] of Object.entries(unit.site.routes ?? {})) {
    if (!ids.includes(id)) {
      findings.add(
        'route.unknown',
        'site',
        ['routes', id],
        `names a route the selected variant doesn't have, so it changes nothing unless a variant with that route is selected. ${BLOCKS_NOTHING}`,
        `Remove it, or use one of the variant's routes: ${ids.join(', ')}.`,
      );
    } else if (id === 'home' && toggle.enabled === false) {
      findings.add(
        'route.required',
        'site',
        ['routes', 'home', 'enabled'],
        `turns off the front page, which every site serves, so it's ignored. ${BLOCKS_NOTHING}`,
        'Remove the home entry.',
      );
    }
  }
}

/** Stored control values the report doesn't check: every entry but the rendered variant's. */
function entriesNotChecked(unit: ParsedPair, rendered: string | undefined): string[] {
  return Object.keys(unit.site.variantControls ?? {})
    .filter((id) => id !== rendered)
    .map((id) => `site.variantControls.${id}`);
}

/** Route toggles the report doesn't check, when the selection isn't registered. */
function togglesNotChecked(unit: ParsedPair): string[] {
  return Object.keys(unit.site.routes ?? {}).map((id) => `site.routes.${id}`);
}

/** The previous variant's path views this composition has no view at the same address for. */
function routeReports(manifest: VariantManifest, previous?: VariantManifest): RouteReport[] {
  if (!previous || previous.id === manifest.id) return [];
  const served = new Set(manifest.routes.views.map((view) => viewShape(view)));
  return previous.routes.views
    .filter((view) => view.type === 'path' && !served.has(viewShape(view)))
    .map(({ id, under, segment }) => ({ id, under, segment }));
}

/**
 * The digest of every input the report depends on: what renders, the
 * selection it's for (the site's, or a candidate's), the pair, and the
 * options.
 */
function hashInputs(
  manifest: VariantManifest | null,
  requested: string,
  unit: ParsedPair,
  options: CompatibilityOptions,
): string {
  const inputs = {
    reportVersion: REPORT_VERSION,
    contract: CONTRACT_VERSION,
    manifest,
    requested,
    previous: options.previous ?? null,
    portfolio: unit.portfolio,
    site: unit.site,
    registry: options.registry
      .map(({ packageName, version, manifest: { id } }) => ({ id, packageName, version }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    extensions: (options.extensions ?? []).map(({ namespace }) => namespace).sort(),
    extensionRenderers: [...(options.extensionRenderers ?? [])].sort(),
    recipes: options.recipes ? [...options.recipes].sort() : null,
    live: options.live ?? false,
  };
  const digest = sha256(new TextEncoder().encode(canonicalize(inputs)));
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
