import type { VariantManifest } from '@portfolio/kit';
import type { AppearanceSelection } from '@portfolio/schema';

// Which variant renders a page, and in which color scheme and typography
// preset. `/` renders the site's appearance. /sample (#1, item 17) starts
// from it and takes what its `variant`, `scheme`, and `typography` query
// parameters name instead, and only registered values reach the variant.

export interface VariantSelection {
  /** A registered variant's slug. */
  readonly variant: string;
  /** A color scheme the variant declares. Omitted, it renders its default. */
  readonly colorScheme?: string;
  /** A typography preset the variant declares. Omitted, it renders its default. */
  readonly typography?: string;
}

export type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/** What the site's appearance selects: its variant, color scheme, and typography preset. */
export function siteSelection(appearance: AppearanceSelection): VariantSelection {
  return {
    variant: appearance.variant,
    colorScheme: appearance.colorScheme,
    typography: appearance.typography,
  };
}

/**
 * The selection for a /sample query, or null when the variant is unknown,
 * which is a 404. Each axis the query doesn't name is the site appearance's:
 * its variant, and its color scheme and typography preset where the variant
 * declares them. A scheme or preset the query names that the variant doesn't
 * declare falls back to the variant's default. A parameter given twice counts
 * as unknown.
 */
export function sampleSelection(
  query: SearchParams,
  find: (slug: string) => VariantManifest | null,
  appearance: AppearanceSelection,
): VariantSelection | null {
  const site = siteSelection(appearance);
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
