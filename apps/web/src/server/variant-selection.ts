import type { VariantManifest } from '@portfolio/kit';

// Which variant renders a page, and in which color scheme and typography
// preset. /sample (#1, item 17) takes them from its `variant`, `scheme`, and
// `typography` query parameters, and only registered values reach the
// variant.

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
 * which is a 404. Without `variant` it's `fallback`, the host's variant. A
 * scheme or typography preset the variant doesn't declare falls back to its
 * default. A parameter given twice counts as unknown.
 */
export function sampleSelection(
  query: SearchParams,
  find: (slug: string) => VariantManifest | null,
  fallback: string,
): VariantSelection | null {
  const slug = query.variant === undefined ? fallback : single(query.variant);
  const manifest = slug === undefined ? null : find(slug);
  if (!manifest || manifest.slug !== slug) return null;
  const scheme = single(query.scheme);
  const typography = single(query.typography);
  return {
    variant: manifest.slug,
    ...(manifest.colorSchemes?.some((entry) => entry.id === scheme) ? { colorScheme: scheme } : {}),
    ...(manifest.typographyPresets?.some((entry) => entry.id === typography) ? { typography } : {}),
  };
}

function single(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
