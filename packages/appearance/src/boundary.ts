// What a presentation boundary renders (#19, Slice 3, item 1), as plain data,
// so the React boundary, #7's preview frames, and the tests agree on one
// set of attributes. The compiled packs key their tokens on these
// attributes, and the document's :root:has() rules on a document boundary's.

import { PACK_AXES, type IdAxis, type PackAxis } from './axes';
import type { AppearanceDiagnostic } from './diagnostics';
import { findPack, type AppearanceRegistry } from './registry';
import type { Motion, ResolvedAppearance } from './resolve';
import type { Selection } from './selection';

/**
 * `document`: the page's one boundary, around its variant, with unprefixed
 * ids and the skip link. `plate`: a preview of another selection inside a
 * page, inert, contained, still, and with its own id prefix.
 */
export type BoundaryKind = 'document' | 'plate';
export const BOUNDARY_KINDS = ['document', 'plate'] as const satisfies readonly BoundaryKind[];

/** What a boundary reads from resolveAppearance()'s result. */
export type BoundaryAppearance = Pick<
  ResolvedAppearance,
  | 'selection'
  | 'requested'
  | 'resolvedMode'
  | 'modeLocked'
  | 'contrast'
  | 'motion'
  | 'enhancement'
  | 'fallbackAxes'
  | 'diagnostics'
>;

/** The attributes on a boundary's element, by name. */
export type BoundaryAttributes = Readonly<Record<`data-${string}`, string>>;

/**
 * Every attribute boundaryAttributes() sets by a fixed name, and the
 * prefixes of the ones it names per axis (data-requested-<axis>) or adds
 * for the owner's surfaces (data-appearance-*): the boundary's, which a
 * composition's own rules never key on. The source audit refuses a root
 * rule keyed on any of them, and on the kit runtime's, and a test holds
 * the list to what boundaryAttributes() sets.
 */
export const BOUNDARY_ATTRIBUTE_NAMES = [
  'data-appearance-boundary',
  'data-variant',
  'data-design-language',
  'data-color-scheme',
  'data-typography',
  'data-display-mode',
  'data-mode-locked',
  'data-contrast',
  'data-motion',
  'data-enhancement',
  'data-appearance-fallback',
  'data-appearance-diagnostics',
] as const;
export const BOUNDARY_ATTRIBUTE_PREFIXES = ['data-requested-', 'data-appearance-'] as const;
/** What the kit's runtime sets on a runtime root, which may be the composition's own root. */
export const RUNTIME_ATTRIBUTE_NAMES = ['data-activity', 'data-kit-runtime'] as const;

/** Whether the platform, not a composition, sets the attribute `name`: the boundary or the kit runtime. */
export function isPlatformAttribute(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    (BOUNDARY_ATTRIBUTE_NAMES as readonly string[]).includes(lower) ||
    (RUNTIME_ATTRIBUTE_NAMES as readonly string[]).includes(lower) ||
    BOUNDARY_ATTRIBUTE_PREFIXES.some((prefix) => lower.startsWith(prefix))
  );
}

/** An axis as attribute names spell it: `designLanguage` is `design-language`. */
export function attributeAxis(axis: IdAxis): string {
  return axis.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * A boundary's attributes. The four pack attributes name what renders. The
 * display mode is the one that renders, never a mode the scheme lacks, and
 * data-mode-locked says when the scheme pinned it. A plate is always still,
 * with its enhancements off. When an axis falls back, data-appearance-fallback
 * lists it and data-requested-<axis> names what was asked for, and
 * data-appearance-diagnostics lists the codes of the resolver's diagnostics,
 * such as appearance.mode-incompatible, so the owner's surfaces can tell a
 * mode the scheme refused from one it merely pins. Neither is visible text.
 */
export function boundaryAttributes(
  appearance: BoundaryAppearance,
  kind: BoundaryKind,
): BoundaryAttributes {
  const { selection, requested } = appearance;
  const attributes: Record<`data-${string}`, string> = {
    'data-appearance-boundary': kind,
    'data-variant': selection.variant,
    'data-design-language': selection.designLanguage,
    'data-color-scheme': selection.colorScheme,
    'data-typography': selection.typography,
    'data-display-mode': appearance.resolvedMode,
    'data-mode-locked': String(appearance.modeLocked),
    'data-contrast': appearance.contrast,
    'data-motion': kind === 'plate' ? 'static' : appearance.motion,
    'data-enhancement': kind === 'plate' ? 'off' : appearance.enhancement,
  };
  if (appearance.fallbackAxes.length > 0) {
    attributes['data-appearance-fallback'] = appearance.fallbackAxes.map(attributeAxis).join(' ');
    for (const axis of appearance.fallbackAxes) {
      attributes[`data-requested-${attributeAxis(axis)}`] = requested[axis];
    }
  }
  const codes = diagnosticCodes(appearance.diagnostics);
  if (codes.length > 0) attributes['data-appearance-diagnostics'] = codes.join(' ');
  return attributes;
}

/** Each diagnostic's code once, in the order the resolver reported them. */
export function diagnosticCodes(diagnostics: readonly AppearanceDiagnostic[]): string[] {
  return [...new Set(diagnostics.map((diagnostic) => diagnostic.code))];
}

/** How motion ranks: a lower one only ever replaces a higher one. */
const MOTION_RANK: Readonly<Record<Motion, number>> = { full: 2, reduced: 1, static: 0 };

/** The lower of two motions: what #6's pause or #7's override does to a boundary's motion. */
export function lowerMotion(base: Motion, override: Motion | null | undefined): Motion {
  return override && MOTION_RANK[override] < MOTION_RANK[base] ? override : base;
}

/**
 * Where a boundary's stylesheets come from, so the boundary assumes nothing
 * about how a build lists its compiled files. Slice 4 builds one from the
 * registry's pack files.
 */
export interface AppearanceStylesheets {
  /** The platform stylesheet every boundary links, or null when there's none to link. */
  readonly platform: string | null;
  /** The URL of the compiled stylesheet of the pack `id` names on `axis`, or null when there's none to link. */
  pack(axis: PackAxis, id: string): string | null;
  /**
   * The URL of the one font a document under the typography profile `id`
   * preloads, or null when it ships none to preload, as a system-font
   * profile doesn't. A source without it preloads nothing.
   */
  font?(id: string): string | null;
}

/**
 * A build's own stylesheets: the platform stylesheet and each pack's
 * compiled one, as registry generation listed them in the metadata module,
 * and each typography profile's font preload. A generated scheme has none
 * here; Slice 4's route serves its CSS.
 */
export function registryStylesheets(registry: AppearanceRegistry): AppearanceStylesheets {
  return {
    platform: registry.platformStylesheet?.url ?? null,
    pack: (axis, id) => findPack(registry, axis, id)?.stylesheet?.url ?? null,
    font: (id) => findPack(registry, 'typography', id)?.preload ?? null,
  };
}

/**
 * The fonts a document boundary preloads for `selection`: its typography
 * profile's one, or none. At most one per page, so a page's first paint
 * waits on one font file at most and display faces load as text needs them.
 */
export function fontPreloads(
  selection: Pick<Selection, 'typography'>,
  source: AppearanceStylesheets,
): string[] {
  const href = source.font?.(selection.typography) ?? null;
  return href ? [href] : [];
}

/** The stylesheets a boundary links for `selection`: the platform's, then each pack's in axis order, each once. */
export function stylesheetHrefs(
  selection: Pick<Selection, PackAxis>,
  source: AppearanceStylesheets,
): string[] {
  const hrefs = [source.platform, ...PACK_AXES.map((axis) => source.pack(axis, selection[axis]))];
  return [...new Set(hrefs.filter((href): href is string => typeof href === 'string'))];
}
