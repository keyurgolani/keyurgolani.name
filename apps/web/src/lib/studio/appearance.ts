import type { DraftFinding, StudioDraft } from './documents';
import type { TypeStills, TypeStyle } from './type-stills';

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
// - Retired ids read as their survivors (LANG-1). A stored value that names
//   a retired pack shows as the pack that replaced it, and is never an
//   option or a count of its own. Nothing rewrites it: it stays in the
//   draft until the owner saves a change on that axis, which writes what
//   the owner picked, and the validator's warning says so until then.

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
  /**
   * A composition's idiom in a few words, as its manifest gives Studio (`studio.signature`),
   * which the picker shows under its name. Null or absent for one with none, and for a pack.
   */
  readonly signature?: string | null;
  /**
   * Whether the owner may pick it (A2): a composition still in progress is
   * `pending`, which the picker shows disabled, labelled `statusLabel`, with
   * no thumbnail. Every pack and mode, and every other composition, is `ready`.
   */
  readonly status: 'pending' | 'ready';
  /** "In progress" for a pending composition, and null for a ready option. */
  readonly statusLabel: string | null;
  /**
   * What its picker draws it with (owner direction, 2026-10-25: every option a
   * specimen of itself), from its manifest. Absent for a composition, whose
   * thumbnail Studio draws from its id, and for a display mode.
   */
  readonly specimen?: Specimen | null;
  /**
   * Its compiled stylesheet, `/_portfolio/pack/<id>.<hash>.css`, which a
   * preview frame swaps in place (#7's `appearance` message), or null when
   * there's none, as for a generated scheme, which a frame shows by loading
   * again.
   */
  readonly stylesheet?: string | null;
  /**
   * The family its picker files it under, from its manifest's `family`: a
   * scheme's palette character or a language's register. Absent for a pack
   * without one, which lists under All, and on the other axes.
   */
  readonly family?: string | null;
  /**
   * A composition's catalog still (#6): the page as its package commits it,
   * at about 720px, which Compare's grid shows when it varies the composition.
   * Absent for a pack, and for a composition that ships none.
   */
  readonly still?: { readonly url: string; readonly width: number; readonly height: number } | null;
}

/** A scheme's anchor colours in one mode: its ground, its text, and two accents. */
export interface SchemeAnchors {
  readonly canvas: string;
  readonly text: string;
  readonly accent: string;
  readonly secondary: string;
}

/** What a picker draws an option with: a split chip, a type specimen, or a language's corners and borders. */
export type Specimen =
  | {
      readonly kind: 'scheme';
      readonly light: SchemeAnchors | null;
      readonly dark: SchemeAnchors | null;
      readonly swatches: readonly string[];
      /** The display modes it has: light, dark, or both. */
      readonly modes: readonly string[];
    }
  | {
      readonly kind: 'type';
      readonly display: string;
      readonly body: string;
      readonly displayWeight: string;
      /** Sans, serif, or mono, by its display role's generic family (P-5). */
      readonly style: TypeStyle;
      /** Whether it ships its own fonts, or sets system ones. */
      readonly source: 'self-hosted' | 'system';
      /** The bytes of the font files it ships, which the preview loads once it's chosen; 0 for system fonts. */
      readonly fontBytes?: number;
      /**
       * A self-hosted pack's two stills, which its row shows so Studio's document loads no
       * web font (P-5), or null: always for a system-font pack, and for one the build has none for.
       */
      readonly stills: TypeStills | null;
    }
  | {
      readonly kind: 'language';
      readonly radiusControl: string;
      readonly radiusCard: string;
      readonly borderControl: string;
      readonly borderCard: string;
      readonly shadowCard: string;
      /** Its backdrop blur, '0px' for none, which makes a language louder. */
      readonly backdropBlur?: string;
      /** Its control height, how dense it sits: '2rem' tight to '2.875rem' roomy. */
      readonly controlHeight?: string;
      /** Its surface's inline padding: '0.75rem' tight to '1.5rem' roomy. */
      readonly surfacePadding?: string;
      /** Whether its surfaces carry a texture: ruled lines, dots, or a pattern, or none. */
      readonly texture?: 'none' | 'lines' | 'dots' | 'pattern';
      /** Whether its surfaces are flat or lit by a gradient. */
      readonly material?: 'flat' | 'gradient';
    };

export interface AppearanceCatalog {
  readonly axes: readonly {
    readonly axis: CatalogAxis;
    readonly label: string;
    /** What renders on the axis for a value this build doesn't offer. */
    readonly fallback: string;
    readonly options: readonly CatalogOption[];
    /** The axis's retired ids, each with the id of the option that replaced it (LANG-1). */
    readonly aliases?: Readonly<Record<string, string>>;
  }[];
}

/** `id` as Studio shows it on `axis`: its survivor when it's a retired pack's id, else itself. */
export function canonicalValue(catalog: AppearanceCatalog, axis: CatalogAxis, id: string): string {
  const aliases = catalog.axes.find((entry) => entry.axis === axis)?.aliases;
  return aliases && Object.hasOwn(aliases, id) ? aliases[id]! : id;
}

/** `selection` with every retired id read as its survivor. */
export function canonicalSelection(
  catalog: AppearanceCatalog,
  selection: Readonly<Record<CatalogAxis, string>>,
): Record<CatalogAxis, string> {
  return Object.fromEntries(
    AXES.map((axis) => [axis, canonicalValue(catalog, axis, selection[axis])]),
  ) as Record<CatalogAxis, string>;
}

/**
 * `state` as the workspace starts from it: each retired id read as its
 * survivor, so the picker checks the survivor and no edit is pending until
 * the owner changes the axis (LANG-1, the lead's option a).
 */
export function canonicalState(
  catalog: AppearanceCatalog,
  state: AppearanceState | null,
): AppearanceState | null {
  if (!state) return null;
  const selection = canonicalSelection(catalog, state.selection);
  return AXES.every((axis) => selection[axis] === state.selection[axis])
    ? state
    : { ...state, selection };
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
  return appearanceOfSite(draft.documents.site.model);
}

/**
 * The appearance of a site document's parsed model: a draft's, or the live
 * revision's, which the workspace shows before any draft exists. Null when
 * it selects none.
 */
export function appearanceOfSite(model: unknown): AppearanceState | null {
  const site = record(model);
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
  const shownId = canonicalValue(catalog, axis, id);
  const option = entry?.options.find((each) => each.id === shownId) ?? null;
  if (option || !entry) return { option, fallback: null };
  const shown = entry.options.find((each) => each.id === entry.fallback);
  return {
    option: null,
    fallback: shown?.name ?? (axis === 'variant' ? 'the fallback composition' : entry.fallback),
  };
}

/** The axes a preview frame shows in place, over its channel: each a pack with a build stylesheet. */
export const IN_PLACE_AXES = ['designLanguage', 'colorScheme', 'typography'] as const;

const DISPLAY_MODE_IDS = new Set(['system', 'light', 'dark', 'high-contrast']);

/** What a frame's `appearance` message carries (#7's protocol): each pack by id and stylesheet, and the display mode. */
export interface InPlaceAppearance {
  readonly designLanguage: { readonly id: string; readonly stylesheet: string };
  readonly colorScheme: { readonly id: string; readonly stylesheet: string };
  readonly typography: { readonly id: string; readonly stylesheet: string };
  readonly displayMode: 'system' | 'light' | 'dark' | 'high-contrast';
}

/**
 * `selection` as a frame shows it in place, or null when it can't: a pack
 * this build doesn't offer, or one with no build stylesheet, as a generated
 * scheme has, or a display mode the frame doesn't know.
 */
export function inPlaceAppearance(
  catalog: AppearanceCatalog,
  selection: Readonly<Record<CatalogAxis, string>>,
): InPlaceAppearance | null {
  const swap = (axis: (typeof IN_PLACE_AXES)[number]) => {
    const shown = canonicalValue(catalog, axis, selection[axis]);
    const option = catalog.axes
      .find((entry) => entry.axis === axis)
      ?.options.find(({ id }) => id === shown);
    return option?.stylesheet ? { id: option.id, stylesheet: option.stylesheet } : null;
  };
  const [designLanguage, colorScheme, typography] = IN_PLACE_AXES.map(swap);
  if (!designLanguage || !colorScheme || !typography) return null;
  if (!DISPLAY_MODE_IDS.has(selection.displayMode)) return null;
  return {
    designLanguage,
    colorScheme,
    typography,
    displayMode: selection.displayMode as InPlaceAppearance['displayMode'],
  };
}

/**
 * Whether showing `next` in a frame that renders `base` needs a new load: a
 * new composition, which the server renders into the document, or a change
 * the frame can't show in place.
 */
export function needsLoad(
  catalog: AppearanceCatalog,
  next: Readonly<Record<CatalogAxis, string>>,
  base: Readonly<Record<CatalogAxis, string>>,
): boolean {
  if (next.variant !== base.variant) return true;
  const changed = AXES.some((axis) => axis !== 'variant' && next[axis] !== base[axis]);
  return changed && inPlaceAppearance(catalog, next) === null;
}

/**
 * The saved draft's findings on its appearance, its schemes' inputs, and its visitor controls,
 * the validator's own: a scheme the save couldn't generate is at /appearanceInputs/<id>.
 */
export function appearanceFindings(draft: StudioDraft): readonly DraftFinding[] {
  return draft.documents.site.diagnostics.filter(({ pointer }) =>
    /^\/(?:appearance|appearanceInputs|visitorControls)(?:\/|$)/.test(pointer),
  );
}
