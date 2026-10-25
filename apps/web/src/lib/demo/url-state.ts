import { QUERY_KEYS } from '@portfolio/appearance';
import { AXES, type AppearanceCatalog, type CatalogAxis } from '../studio/appearance';

// Demo Studio's selection in the URL (#9, design note section 2): the five
// appearance axes under #19's own query keys, `variant`, `language`,
// `scheme`, `type`, and `mode`, the same keys /sample reads, so the Studio
// URL and its frame's carry one selection. A value counts only when the
// catalog the page was given offers it on that axis, and when a scheme's
// own modes allow the display mode. Anything else falls back on that axis
// to the sample's own value. Framework-free, so a test drives it.

/**
 * What the frame shows: the neutral sample, or the read-only reference (#9),
 * which the page offers only when the server verified one at startup.
 */
export type DemoSource = 'sample' | 'reference';

/** What Demo Studio's frame shows: the read-only reference, the visitor's imported pair, or the sample. */
export type DemoFrameKind = 'reference' | 'local' | 'sample';

/**
 * Which frame shows: the reference while the visitor has asked for it, else
 * their imported pair while this tab holds one, else the sample.
 */
export function frameKind(source: DemoSource, imported: boolean): DemoFrameKind {
  if (source === 'reference') return 'reference';
  return imported ? 'local' : 'sample';
}

/** The source once an import lands: a new import switches off the reference, so the frame shows it. */
export function sourceAfterImport(source: DemoSource, imported: boolean): DemoSource {
  return imported ? 'sample' : source;
}

/** The Studio URL's key for the source. The frame's own path says it, so its URL never carries one. */
export const SOURCE_KEY = 'source';

/**
 * The source `search` names: the reference only when the URL says exactly
 * `source=reference` once and the page has one to show. Anything else, a
 * reference the demo doesn't have included, is the sample.
 */
export function sourceFrom(search: URLSearchParams, hasReference: boolean): DemoSource {
  const named = search.getAll(SOURCE_KEY);
  return hasReference && named.length === 1 && named[0] === 'reference' ? 'reference' : 'sample';
}

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

/** A task's id, as a task link's fragment or a `task` query names it. */
const TASK_ID = /^[a-z][a-z-]*$/;

/**
 * The task fragment Studio's URL keeps: the fragment it has, or else the
 * task a `task` query named, as a link or the quality harness opens one
 * with. The shell reads the fragment first, so writing the selection's
 * query in place of the URL's never loses the task.
 */
export function taskFragment(search: string, hash: string): string {
  if (hash) return hash;
  const task = new URLSearchParams(search).get('task');
  return task && TASK_ID.test(task) ? `#${task}` : '';
}

/**
 * The Studio page's own URL for `selection`: its path, the selection's
 * query, `source=reference` while the reference shows, and its task fragment.
 */
export function studioLocation(
  pathname: string,
  hash: string,
  selection: DemoSelection,
  rules: SelectionRules,
  source: DemoSource = 'sample',
): string {
  const params = selectionQuery(selection, rules);
  if (source === 'reference') params.set(SOURCE_KEY, 'reference');
  const query = params.toString();
  return `${pathname}${query === '' ? '' : `?${query}`}${hash}`;
}

/**
 * Where a preview frame loads: /sample, or /reference for the read-only
 * reference, with the selection's canonical query, and `motion=reduce` when
 * the preview asks for reduced motion. Always one of those two paths on
 * Studio's own origin, never a grant's or /preview's.
 */
export function frameSource(
  selection: DemoSelection,
  rules: SelectionRules,
  options: { readonly reduceMotion?: boolean; readonly source?: DemoSource } = {},
): string {
  const query = selectionQuery(selection, rules);
  if (options.reduceMotion) query.set('motion', 'reduce');
  const text = query.toString();
  const path = options.source === 'reference' ? '/reference' : '/sample';
  return `${path}${text === '' ? '' : `?${text}`}`;
}
