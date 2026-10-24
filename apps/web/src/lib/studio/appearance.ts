import type { DraftFinding, StudioDraft } from './documents';

// The Appearance workspace's model (#8, Slice 5 items 1 and 3): the five
// appearance axes of the draft's site document, each with its visitor
// control, what the build offers on each, and the edits a change makes.
// Framework-free, so a test drives it.
//
// - Independent axes. A change to one axis makes an edit to that axis's
//   pointer alone, through #4's applyEdits, never the site document written
//   back, so the other four, and everything else in the document, stay as
//   they are.
// - Only what ships. The catalog lists what selectableIds() gives: never
//   the fallback composition, a Research pack, or anything this build
//   doesn't register. The draft's own value, when it's none of those, shows
//   as itself with what renders in its place, and the validator's finding
//   on it blocks publishing.

export const AXES = [
  'variant',
  'designLanguage',
  'colorScheme',
  'typography',
  'displayMode',
] as const;
export type CatalogAxis = (typeof AXES)[number];

/** A visitor control: whether visitors may pick their own value on an axis. */
export type VisitorControl = 'locked' | 'selectable';

export interface CatalogOption {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  /** A pack's tier: stable, extended, or experimental. Research is never listed. */
  readonly tier: string | null;
  /** Where it comes from, and its license. */
  readonly provenance: readonly string[];
  /** What it may ship. */
  readonly performance: string | null;
  /** What it means for access: modes, motion. */
  readonly access: string | null;
}

export interface AppearanceCatalog {
  readonly axes: readonly {
    readonly axis: CatalogAxis;
    readonly label: string;
    /** What renders on the axis for a value this build doesn't offer. */
    readonly fallback: string;
    readonly options: readonly CatalogOption[];
  }[];
}

/** The draft site's selection and visitor controls, by axis. */
export interface AppearanceState {
  readonly selection: Readonly<Record<CatalogAxis, string>>;
  readonly controls: Readonly<Record<CatalogAxis, VisitorControl>>;
}

/** One edit by JSON pointer, as #4's applyEdits takes it. */
export interface SiteEdit {
  readonly document: 'site';
  readonly pointer: string;
  readonly op: 'set';
  readonly value: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The saved draft site's appearance, from the model the store parsed, or
 * null when the site document doesn't parse to one.
 */
export function appearanceOf(draft: StudioDraft): AppearanceState | null {
  const site = record(draft.documents.site.model);
  const appearance = record(site.appearance);
  const visitors = record(site.visitorControls);
  if (Object.keys(appearance).length === 0) return null;
  const selection = {} as Record<CatalogAxis, string>;
  const controls = {} as Record<CatalogAxis, VisitorControl>;
  for (const axis of AXES) {
    const value = appearance[axis];
    selection[axis] = typeof value === 'string' ? value : '';
    controls[axis] = visitors[axis] === 'selectable' ? 'selectable' : 'locked';
  }
  return { selection, controls };
}

/** The edits that take `saved` to `next`: one per axis value or visitor control that changed. */
export function appearanceEdits(saved: AppearanceState, next: AppearanceState): SiteEdit[] {
  const edits: SiteEdit[] = [];
  for (const axis of AXES) {
    if (next.selection[axis] !== saved.selection[axis]) {
      edits.push({
        document: 'site',
        pointer: `/appearance/${axis}`,
        op: 'set',
        value: next.selection[axis],
      });
    }
  }
  for (const axis of AXES) {
    if (next.controls[axis] !== saved.controls[axis]) {
      edits.push({
        document: 'site',
        pointer: `/visitorControls/${axis}`,
        op: 'set',
        value: next.controls[axis],
      });
    }
  }
  return edits;
}

/** What the workspace says of `id` on `axis`: offered, or what renders in its place. */
export function optionNote(
  catalog: AppearanceCatalog,
  axis: CatalogAxis,
  id: string,
): { readonly option: CatalogOption | null; readonly fallback: string | null } {
  const entry = catalog.axes.find((each) => each.axis === axis);
  const option = entry?.options.find((each) => each.id === id) ?? null;
  if (option || !entry) return { option, fallback: null };
  const shown = entry.options.find((each) => each.id === entry.fallback);
  return {
    option: null,
    fallback: shown?.name ?? (axis === 'variant' ? 'the fallback composition' : entry.fallback),
  };
}

/** The saved draft's findings on its appearance and visitor controls, the validator's own. */
export function appearanceFindings(draft: StudioDraft): readonly DraftFinding[] {
  return draft.documents.site.diagnostics.filter(({ pointer }) =>
    /^\/(?:appearance|visitorControls)(?:\/|$)/.test(pointer),
  );
}
