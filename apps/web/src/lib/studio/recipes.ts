import recipesFile from '@portfolio/appearance/recipes' with { type: 'json' };
import { AXES, canonicalSelection, type AppearanceCatalog, type CatalogAxis } from './appearance';

// The appearance recipes (packages/appearance/appearance-recipes.json): a
// starting point on all five axes, which Demo Studio's rail offers first
// (the Studio mockup, owner direction, 2026-10-25). A recipe applies to every
// axis the visitor hasn't kept, and Surprise me picks one of them, never
// anything outside the list, so a surprise is always a combination someone
// chose. Only recipes this build can show in full are offered.

export type Selection = Readonly<Record<CatalogAxis, string>>;

export interface Recipe {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly selection: Selection;
}

/** Every recipe the file lists, read as recipes, skipping any entry that isn't one. */
export const RECIPES: readonly Recipe[] = Object.freeze(
  (Array.isArray((recipesFile as { recipes?: unknown }).recipes)
    ? (recipesFile as { recipes: unknown[] }).recipes
    : []
  ).flatMap((entry): Recipe[] => {
    const { id, name, description, selection } = (entry ?? {}) as Record<string, unknown>;
    const values = (selection ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string') return [];
    if (!AXES.every((axis) => typeof values[axis] === 'string')) return [];
    return [
      {
        id,
        name,
        description: typeof description === 'string' ? description : '',
        selection: Object.fromEntries(
          AXES.map((axis) => [axis, values[axis] as string]),
        ) as Selection,
      },
    ];
  }),
);

/**
 * The recipes whose every value `catalog` offers and `allowed` accepts,
 * such as a display mode the scheme has, in the file's order.
 */
export function offeredRecipes(
  catalog: AppearanceCatalog,
  allowed: (selection: Selection) => boolean = () => true,
  recipes: readonly Recipe[] = RECIPES,
): Recipe[] {
  // An option still in progress (A2), as a composition not yet signed off, isn't offered: its
  // recipe stays in the file and comes back once it's ready.
  const offers = (axis: CatalogAxis, value: string) =>
    catalog.axes
      .find((entry) => entry.axis === axis)
      ?.options.some(({ id, status }) => id === value && status !== 'pending') ?? false;
  // A recipe that names a retired pack's id stands for its survivor (LANG-1), so it lists, and
  // applies, only ids the catalog offers.
  return recipes
    .map((recipe) => {
      const selection = canonicalSelection(catalog, recipe.selection);
      return AXES.every((axis) => selection[axis] === recipe.selection[axis])
        ? recipe
        : { ...recipe, selection };
    })
    .filter(
      (recipe) =>
        AXES.every((axis) => offers(axis, recipe.selection[axis])) && allowed(recipe.selection),
    );
}

/** `current` with `recipe` on every axis but the kept ones. */
export function withRecipe(
  current: Selection,
  recipe: Recipe,
  kept: ReadonlySet<CatalogAxis>,
): Selection {
  return Object.fromEntries(
    AXES.map((axis) => [axis, kept.has(axis) ? current[axis] : recipe.selection[axis]]),
  ) as Selection;
}

/**
 * Surprise me: one of `recipes` that changes something, given the kept axes,
 * picked by `random` (0 to 1), or null when none would.
 */
export function surprise(
  recipes: readonly Recipe[],
  current: Selection,
  kept: ReadonlySet<CatalogAxis>,
  random: number,
): Recipe | null {
  const changes = recipes.filter((recipe) => {
    const next = withRecipe(current, recipe, kept);
    return AXES.some((axis) => next[axis] !== current[axis]);
  });
  if (changes.length === 0) return null;
  const at = Math.min(changes.length - 1, Math.floor(Math.max(0, random) * changes.length));
  return changes[at]!;
}
