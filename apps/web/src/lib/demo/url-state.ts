import { QUERY_KEYS } from '@portfolio/appearance';
import { AXES, type AppearanceCatalog, type CatalogAxis } from '../studio/appearance';

// Demo Studio's selection in the URL (#9, design note section 2): the five
// appearance axes under #19's own query keys, `variant`, `language`,
// `scheme`, `type`, and `mode`, the same keys /sample reads, so the Studio
// URL and its frame's carry one selection. A value counts only when the
// catalog the page was given offers it on that axis, and when a scheme's
// own modes allow the display mode. Anything else falls back on that axis
// to the sample's own value. Framework-free, so a test drives it.

/** The five values Demo Studio shows, by axis. */
export type DemoSelection = Readonly<Record<CatalogAxis, string>>;

/** The display modes a color scheme has, by its id, for the ones the page knows. */
export type SchemeModes = Readonly<Record<string, readonly string[]>>;

/** What a selection is checked against: the catalog's options, and each scheme's modes. */
export interface SelectionRules {
  readonly catalog: AppearanceCatalog;
  readonly schemeModes?: SchemeModes;
}

/** Whether the catalog offers `value` on `axis`. */
export function offers(catalog: AppearanceCatalog, axis: CatalogAxis, value: string): boolean {
  return catalog.axes.some(
    (entry) => entry.axis === axis && entry.options.some((option) => option.id === value),
  );
}

/**
 * Whether the scheme `scheme` can show the display mode `mode`. System and
 * high contrast fit every scheme, and light or dark one that has it. A
 * scheme the page names no modes for holds nothing against a mode.
 */
export function modeFits(schemeModes: SchemeModes | undefined, scheme: string, mode: string) {
  if (mode === 'system' || mode === 'high-contrast') return true;
  const modes = schemeModes?.[scheme];
  return modes === undefined || modes.includes(mode);
}

/**
 * Why `value` can't go on `axis` of `current`, in words, or null when it
 * can: the catalog must offer it, and a scheme and a display mode must fit
 * each other.
 */
export function selectionProblem(
  rules: SelectionRules,
  current: DemoSelection,
  axis: CatalogAxis,
  value: string,
): string | null {
  if (!offers(rules.catalog, axis, value)) return `This build doesn't offer ${value} here.`;
  if (axis === 'colorScheme' && !modeFits(rules.schemeModes, value, current.displayMode)) {
    return `${value} has no ${current.displayMode} mode.`;
  }
  if (axis === 'displayMode' && !modeFits(rules.schemeModes, current.colorScheme, value)) {
    return `${current.colorScheme} has no ${value} mode.`;
  }
  return null;
}

/** Whether `search` names any of the five keys: a URL that carries a selection. */
export function carriesSelection(search: URLSearchParams): boolean {
  return AXES.some((axis) => search.has(QUERY_KEYS[axis]));
}

/**
 * The selection `search` carries, axis by axis over `base`: each key
 * given once, with a value the rules accept, wins on its axis, scheme and
 * mode checked as a pair; every other axis keeps `base`'s value.
 */
export function selectionFrom(
  search: URLSearchParams,
  base: DemoSelection,
  rules: SelectionRules,
): DemoSelection {
  const next: Record<CatalogAxis, string> = { ...base };
  for (const axis of AXES) {
    const given = search.getAll(QUERY_KEYS[axis]);
    const [only] = given;
    if (given.length !== 1 || only === undefined || !offers(rules.catalog, axis, only)) continue;
    next[axis] = only;
  }
  // A scheme and a mode that don't fit each other: the mode gives way first.
  if (!modeFits(rules.schemeModes, next.colorScheme, next.displayMode)) {
    next.displayMode = modeFits(rules.schemeModes, next.colorScheme, base.displayMode)
      ? base.displayMode
      : 'system';
  }
  return next;
}

/**
 * Where a page load's selection comes from: the URL when it carries one,
 * then the stored one, but only on a bare /studio visit with no query at
 * all, then the sample's own.
 */
export function loadSelection(input: {
  readonly search: URLSearchParams;
  readonly stored: DemoSelection | null;
  readonly defaults: DemoSelection;
  readonly rules: SelectionRules;
}): { readonly selection: DemoSelection; readonly from: 'url' | 'stored' | 'default' } {
  const { search, stored, defaults, rules } = input;
  if (carriesSelection(search)) {
    return { selection: selectionFrom(search, defaults, rules), from: 'url' };
  }
  if (stored && search.size === 0) {
    return {
      selection: selectionFrom(selectionQuery(stored, rules), defaults, rules),
      from: 'stored',
    };
  }
  return { selection: defaults, from: 'default' };
}

/**
 * The query for `selection`, in #19's key order: each axis whose value the
 * catalog offers. A value it doesn't, such as the sample's own composition
 * in a build that doesn't register it, stays out, so /sample renders the
 * sample's own there and never redirects.
 */
export function selectionQuery(selection: DemoSelection, rules: SelectionRules): URLSearchParams {
  const query = new URLSearchParams();
  for (const axis of AXES) {
    if (offers(rules.catalog, axis, selection[axis])) query.set(QUERY_KEYS[axis], selection[axis]);
  }
  return query;
}

/** The Studio page's own URL for `selection`: its path, the selection's query, and its task fragment. */
export function studioLocation(
  pathname: string,
  hash: string,
  selection: DemoSelection,
  rules: SelectionRules,
): string {
  const query = selectionQuery(selection, rules).toString();
  return `${pathname}${query === '' ? '' : `?${query}`}${hash}`;
}

/**
 * Where a preview frame loads: /sample with the selection's canonical query,
 * and `motion=reduce` when the preview asks for reduced motion. Always a
 * path on Studio's own origin under /sample, never a grant's or /preview's.
 */
export function frameSource(
  selection: DemoSelection,
  rules: SelectionRules,
  options: { readonly reduceMotion?: boolean } = {},
): string {
  const query = selectionQuery(selection, rules);
  if (options.reduceMotion) query.set('motion', 'reduce');
  const text = query.toString();
  return `/sample${text === '' ? '' : `?${text}`}`;
}
