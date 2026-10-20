import type { VariantManifest } from '@portfolio/kit';

// Which variant renders a page, and in which color scheme and typography
// preset. /sample (#1, item 17) starts from the site's appearance and takes
// what its `variant`, `scheme`, and `typography` query parameters name
// instead, and only registered values reach the variant.

export interface VariantSelection {
  /** A registered variant's slug. */
  readonly variant: string;
  /** A color scheme the variant declares. Omitted, it renders its default. */
  readonly colorScheme?: string;
  /** A typography preset the variant declares. Omitted, it renders its default. */
  readonly typography?: string;
}

export type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/**
 * The selection for a /sample query, or null when the variant is unknown,
 * which is a 404. Each axis the query doesn't name is the site's: its
 * variant, and its color scheme and typography preset where the variant
 * declares them. A scheme or preset the query names that the variant doesn't
 * declare falls back to the variant's default. A parameter given twice counts
 * as unknown.
 */
export function sampleSelection(
  query: SearchParams,
  find: (slug: string) => VariantManifest | null,
  site: VariantSelection,
): VariantSelection | null {
  const slug = query.variant === undefined ? site.variant : single(query.variant);
  const manifest = slug === undefined ? null : find(slug);
  if (!manifest || manifest.slug !== slug) return null;
  const pick = (named: string | string[] | undefined, own: string | undefined) =>
    named === undefined ? own : single(named);
  const scheme = pick(query.scheme, site.colorScheme);
  const typography = pick(query.typography, site.typography);
  return {
    variant: manifest.slug,
    ...(manifest.colorSchemes?.some((entry) => entry.id === scheme) ? { colorScheme: scheme } : {}),
    ...(manifest.typographyPresets?.some((entry) => entry.id === typography) ? { typography } : {}),
  };
}

function single(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
