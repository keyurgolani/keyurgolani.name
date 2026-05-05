import { z } from 'zod';
import { SectionBase } from './common';

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

/**
 * A single external portfolio entry — points readers to a separate site
 * the author maintains for a different audience or medium (photography
 * site, music blog, writing journal, etc.). Designed as a *redirect card*,
 * not an inline gallery — the destination is the artifact.
 */
export const ExternalPortfolioItemSchema = z.object({
  url: z.string(),
  brandName: z.string(),
  description: z.string().optional(),
  /** Short location label (e.g. "Portland, OR" or "online"). */
  locationLabel: z.string().optional(),
  /** Short categorical tags shown on the card. */
  categories: z.array(z.string()).optional(),
  /** Bullet-shaped highlights ({ label, sub }). */
  highlights: z
    .array(z.object({ label: z.string(), sub: z.string() }))
    .optional(),
  /** Override for the visible URL label. Defaults to brandName. */
  urlLabel: z.string().optional(),
  /** Override for the CTA button text. */
  buttonText: z.string().optional(),
  iconName: ExternalPortfolioIconSchema.optional(),
});
export type ExternalPortfolioItem = z.infer<typeof ExternalPortfolioItemSchema>;

export const ExternalPortfoliosSchema = z.object({
  kind: z.literal('external-portfolios'),
  ...SectionBase,
  items: z.array(ExternalPortfolioItemSchema).min(1),
});
export type ExternalPortfolios = z.infer<typeof ExternalPortfoliosSchema>;
