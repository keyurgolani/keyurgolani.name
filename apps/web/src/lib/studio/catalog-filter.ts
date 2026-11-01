import type { CatalogOption } from './appearance';

// The scheme and language pickers' filters (the Studio mockup's family chips;
// the redesign brief's 3.2 step 3): a family, from each pack's manifest, and
// a search over its name and description. A pack with no family lists under
// All only. Plain functions, so every count the chips show is the filter's.

/** The families each axis files packs under, in the order its chips list them. */
export const FAMILIES = {
  // A composition's family (P-5): the platform's, by id, in @portfolio/variant-contract's
  // studio-catalog, since a composition's manifest has none. Its chips count ready ones only.
  variant: [
    { id: 'print', label: 'Print' },
    { id: 'technical', label: 'Technical' },
    { id: 'stage', label: 'Stage' },
    { id: 'surface', label: 'Surface' },
  ],
  colorScheme: [
    { id: 'earthy', label: 'Earthy' },
    { id: 'neutral', label: 'Neutral' },
    { id: 'vivid', label: 'Vivid' },
    { id: 'accessible', label: 'Accessible' },
    { id: 'generated', label: 'Generated' },
  ],
  // A typography pack's style (P-5): by its display role's generic family, which picker-catalog
  // gives each option as its family for the chips.
  typography: [
    { id: 'sans', label: 'Sans' },
    { id: 'serif', label: 'Serif' },
    { id: 'mono', label: 'Mono' },
  ],
  designLanguage: [
    { id: 'quiet', label: 'Quiet' },
    { id: 'product-systems', label: 'Product systems' },
    { id: 'expressive', label: 'Expressive' },
    { id: 'raw', label: 'Raw' },
    { id: 'retro', label: 'Retro' },
  ],
} as const;

export type FamilyAxis = keyof typeof FAMILIES;

/** All, the chip that filters nothing out. */
export const ALL = 'all';

/** A family chip: its id, its label, and how many of the options it holds. */
export interface FamilyCount {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

/** All, then each family that holds an option, with its count. */
export function familyCounts(
  axis: FamilyAxis,
  options: readonly CatalogOption[],
): readonly FamilyCount[] {
  const families = FAMILIES[axis]
    .map(({ id, label }) => ({
      id,
      label,
      count: options.filter((option) => option.family === id).length,
    }))
    .filter((family) => family.count > 0);
  return [{ id: ALL, label: 'All', count: options.length }, ...families];
}

/** The family an option is in, or All when it has none the axis lists. */
export function familyOf(axis: FamilyAxis, option: CatalogOption | undefined): string {
  const id = option?.family;
  return FAMILIES[axis].some((family) => family.id === id) ? (id as string) : ALL;
}

/** Whether `option` matches a search: every word, in its name, id, tier or description. */
export function matchesQuery(option: CatalogOption, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text =
    `${option.name} ${option.id} ${option.tier ?? ''} ${option.description ?? ''}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

/** The options a family and a search keep, in their order. */
export function catalogFilter(
  options: readonly CatalogOption[],
  filter: { readonly family?: string; readonly query?: string },
): readonly CatalogOption[] {
  const family = filter.family ?? ALL;
  return options.filter(
    (option) =>
      (family === ALL || option.family === family) && matchesQuery(option, filter.query ?? ''),
  );
}

/** `options` sorted quiet to loud by `score`: a stable sort, so ties keep their order. */
export function quietToLoud<T>(options: readonly T[], score: (option: T) => number): T[] {
  return options
    .map((option, at) => ({ option, at, score: score(option) }))
    .sort((a, b) => a.score - b.score || a.at - b.at)
    .map(({ option }) => option);
}
