import { z } from 'zod';
import { ImageSchema, LanguageTagSchema, LinkSchema } from './kinds/common';
import { SectionSchema } from './kinds';

/** The version both documents declare. The unversioned legacy file counts as version 1. */
export const SCHEMA_VERSION = 2;

/** Writing direction of the portfolio's text. */
export const DirectionSchema = z.enum(['ltr', 'rtl']);
export type Direction = z.infer<typeof DirectionSchema>;

export const IdentitySchema = z.object({
  name: z.string(),
  tagline: z.string().optional(),
  pronouns: z.string().optional(),
  location: z.string().optional(),
  email: z.string().optional(),
  avatar: ImageSchema.optional(),
});
export type Identity = z.infer<typeof IdentitySchema>;

/**
 * The portfolio document: portable, authored content only. Presentation and
 * product behavior live in the site document (SiteSchema), and deployment
 * settings, the canonical origin included, come from the environment.
 */
export const PortfolioSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  /** BCP 47 language tag of the content, such as `en` or `pt-BR`. */
  locale: LanguageTagSchema,
  direction: DirectionSchema,
  identity: IdentitySchema,
  links: z.array(LinkSchema).default([]),
  meta: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      ogImage: ImageSchema.optional(),
    })
    .optional(),
  sections: z.array(SectionSchema).default([]),
});
export type Portfolio = z.infer<typeof PortfolioSchema>;
