import { z } from 'zod';
import { UrlSchema, type SchemaParts } from './common';

/**
 * Iconography for external portfolios. Variants map these to concrete icon
 * components — the schema only declares the symbolic name so portfolio
 * authors aren't tied to a specific icon library.
 */
export const ExternalPortfolioIconSchema = z.enum([
  'camera',
  'music',
  'book',
  'palette',
  'code',
  'pen',
  'globe',
  'film',
  'mic',
  'headphones',
  'gallery',
]);
export type ExternalPortfolioIcon = z.infer<typeof ExternalPortfolioIconSchema>;

export function externalSchemas({ object, section }: SchemaParts) {
  /**
   * A single external portfolio entry — points readers to a separate site
   * the author maintains for a different audience or medium (photography
   * site, music blog, writing journal, etc.). Designed as a *redirect card*,
   * not an inline gallery — the destination is the artifact.
   */
  const ExternalPortfolioItemSchema = object({
    url: UrlSchema,
    brandName: z.string(),
    description: z.string().optional(),
    /** Short location label (e.g. "Portland, OR" or "online"). */
    locationLabel: z.string().optional(),
    /** Short categorical tags shown on the card. */
    categories: z.array(z.string()).optional(),
    /** Bullet-shaped highlights ({ label, sub }). */
    highlights: z.array(object({ label: z.string(), sub: z.string() })).optional(),
    /** Override for the visible URL label. Defaults to brandName. */
    urlLabel: z.string().optional(),
    /** Override for the CTA button text. */
    buttonText: z.string().optional(),
    iconName: ExternalPortfolioIconSchema.optional(),
  });

  const ExternalPortfoliosSchema = section('external-portfolios', {
    items: z.array(ExternalPortfolioItemSchema).min(1),
  });

  return { ExternalPortfolioItemSchema, ExternalPortfoliosSchema };
}

type Schemas = ReturnType<typeof externalSchemas>;
export type ExternalPortfolioItem = z.infer<Schemas['ExternalPortfolioItemSchema']>;
export type ExternalPortfolios = z.infer<Schemas['ExternalPortfoliosSchema']>;
