import type { AppearanceCatalog, CatalogAxis } from './appearance';
import { AXES, optionNote } from './appearance';

// Studio's Compare (the Studio mockup's compareMode; ST5), Demo Studio's and
// Owner Studio's alike: the look as it was when Compare started is pinned as
// A, and the rail keeps editing B. At most two live frames: side by side, or
// one over the other with a wipe. The grid of four starts as stills, and its
// plates go live through the preview scheduler. Plain functions, so both
// Studios and their tests read the same answers.

/** A whole selection, one value per axis: Demo's and Owner's alike. */
export type CompareSelection = Readonly<Record<CatalogAxis, string>>;

/** How Compare lays A and B out: side by side, a wipe, or a grid of stills. */
export type CompareMode = 'side' | 'wipe' | 'grid';

/** The axes a grid of stills varies, in the order its control lists them. */
export const VARY_AXES = ['variant', 'colorScheme', 'typography', 'designLanguage'] as const;
export type VaryAxis = (typeof VARY_AXES)[number];

/** The axes on which A and B differ, in the rail's order. */
export function differences(a: CompareSelection, b: CompareSelection): readonly CatalogAxis[] {
  return AXES.filter((axis) => a[axis] !== b[axis]);
}

/**
 * Compare's first layout: a wipe when only token axes differ, since the two
 * pages then share one layout and a wipe lines them up; side by side when the
 * composition differs.
 */
export function defaultMode(a: CompareSelection, b: CompareSelection): CompareMode {
  return a.variant === b.variant ? 'wipe' : 'side';
}

/**
 * The stills a grid shows: A, then the next `count` options on `axis` after
 * A's, wrapping, each with A's other axes. A composition still in progress (A2)
 * is never one of them, so with four ready ones the composition grid is one page.
 */
export function neighbours(
  catalog: AppearanceCatalog,
  a: CompareSelection,
  axis: VaryAxis,
  count: number,
): readonly CompareSelection[] {
  const ids =
    catalog.axes
      .find((entry) => entry.axis === axis)
      ?.options.filter(({ status }) => status !== 'pending')
      .map(({ id }) => id) ?? [];
  const at = Math.max(0, ids.indexOf(a[axis]));
  const others = [...ids.slice(at + 1), ...ids.slice(0, at)].filter((id) => id !== a[axis]);
  return [a, ...others.slice(0, count).map((id) => ({ ...a, [axis]: id }))];
}

/** How many stills besides A a grid's page shows: A and three, a 2x2 grid. */
export const GRID_OTHERS = 3;

/** One page of the grid: its plates, A first, and where it is among the pages. */
export interface GridPage {
  readonly plates: readonly CompareSelection[];
  readonly page: number;
  readonly pages: number;
  /** How many of A's neighbours the other pages hold that this one doesn't. */
  readonly more: number;
  /** Where this page's neighbours start among A's, counting from 1, A itself being fixed (M3). */
  readonly first: number;
  /** How many neighbours A has on the axis, every page's together. */
  readonly others: number;
}

/**
 * The grid's `page`: A and three of its neighbours on `axis`, always four
 * plates when the axis has them. The last page is the last three, so a fifth
 * composition goes to a second page that's still full, never an orphan.
 */
export function gridPage(
  catalog: AppearanceCatalog,
  a: CompareSelection,
  axis: VaryAxis,
  page: number,
): GridPage {
  const others = neighbours(catalog, a, axis, Number.POSITIVE_INFINITY).slice(1);
  const pages = Math.max(1, Math.ceil(others.length / GRID_OTHERS));
  const at = Math.min(Math.max(0, Math.floor(page)), pages - 1);
  const start = Math.min(at * GRID_OTHERS, Math.max(0, others.length - GRID_OTHERS));
  const shown = others.slice(start, start + GRID_OTHERS);
  return {
    plates: [a, ...shown],
    page: at,
    pages,
    more: others.length - shown.length,
    first: start + 1,
    others: others.length,
  };
}

/** `names` as a sentence's list: "X", "X and Y", "X, Y and Z". */
const listed = (names: readonly string[]) =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/** `value`'s name on `axis`, the display mode's with "mode" after it, as the plates read it. */
const pickName = (catalog: AppearanceCatalog, axis: CatalogAxis, value: string) => {
  const name = optionNote(catalog, axis, value).option?.name ?? value;
  return axis === 'displayMode' ? `${name} mode` : name;
};

/**
 * What moving `from` to `to` changes, as the picks it lands on, in the rail's order: "Zinc",
 * "Editorial Evidence with Zinc", "Editorial Evidence with Zinc and Dark mode". Null when
 * nothing changes. Use this on a plate makes B the plate's whole selection, so its notice and
 * its button name every axis that moves, not the varied one alone (M2).
 */
export function changeLine(
  catalog: AppearanceCatalog,
  from: CompareSelection,
  to: CompareSelection,
): string | null {
  const [first, ...rest] = differences(from, to).map((axis) => pickName(catalog, axis, to[axis]));
  if (first === undefined) return null;
  return rest.length === 0 ? first : `${first} with ${listed(rest)}`;
}

/**
 * What the grid's bar says in place of A against B (M1): the axis it varies, in the catalog's
 * own words, and every pick each plate keeps of A, the display mode last. For example "Varying
 * the color scheme. Every plate keeps A's Editorial Evidence, Humanist UI, Platform Neutral and
 * System mode."
 */
export function heldLine(catalog: AppearanceCatalog, a: CompareSelection, vary: VaryAxis): string {
  const axis = (catalog.axes.find((entry) => entry.axis === vary)?.label ?? vary).toLowerCase();
  const held = [...VARY_AXES.filter((each) => each !== vary), 'displayMode' as const].map((each) =>
    pickName(catalog, each, a[each]),
  );
  return `Varying the ${axis}. Every plate keeps A's ${listed(held)}.`;
}

/**
 * Which of the grid's live plates may run its heavy enhancements (round 5, P0-2b): the one
 * pointed at or focused, and none while none is. The other plates load static, so the grid
 * holds one heavy frame at most, and the slot moves with the pointer and the focus.
 */
export function heavyPlate(plates: readonly string[], pointed: string | null): string | null {
  return pointed !== null && plates.includes(pointed) ? pointed : null;
}

/** The wipe's divider, as a percentage of the frame's width from its left edge. */
export function wipeStep(at: number, key: string): number | null {
  const steps: Record<string, number> = {
    ArrowLeft: at - 5,
    ArrowDown: at - 5,
    ArrowRight: at + 5,
    ArrowUp: at + 5,
    PageDown: at - 20,
    PageUp: at + 20,
    Home: 0,
    End: 100,
  };
  const next = steps[key];
  return next === undefined ? null : Math.min(100, Math.max(0, next));
}
