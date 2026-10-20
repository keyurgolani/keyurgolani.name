import { z } from 'zod';
import { LanguageTagSchema, type SchemaParts } from './kinds/common';
import type { Section } from './kinds';

/** The version both documents declare. The unversioned legacy file counts as version 1. */
export const SCHEMA_VERSION = 2;

/** Writing direction of the portfolio's text. */
export const DirectionSchema = z.enum(['ltr', 'rtl']);
export type Direction = z.infer<typeof DirectionSchema>;

/**
 * The portfolio document: portable, authored content only. Presentation and
 * product behavior live in the site document (SiteSchema), and deployment
 * settings, the canonical origin included, come from the environment.
 */
export function portfolioSchemas(
  { object, Image, Link }: SchemaParts,
  sections: z.ZodType<Section, z.ZodTypeDef, unknown>,
) {
  const IdentitySchema = object({
    name: z.string(),
    tagline: z.string().optional(),
    pronouns: z.string().optional(),
    location: z.string().optional(),
    email: z.string().optional(),
    avatar: Image.optional(),
  });

  const PortfolioSchema = object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    /** BCP 47 language tag of the content, such as `en` or `pt-BR`. */
    locale: LanguageTagSchema,
    direction: DirectionSchema,
    identity: IdentitySchema,
    links: z.array(Link).default([]),
    meta: object({
      title: z.string().optional(),
      description: z.string().optional(),
      ogImage: Image.optional(),
    }).optional(),
    sections: z.array(sections).default([]),
  });

  return { IdentitySchema, PortfolioSchema };
}

type Schemas = ReturnType<typeof portfolioSchemas>;
export type Identity = z.infer<Schemas['IdentitySchema']>;
export type Portfolio = z.infer<Schemas['PortfolioSchema']>;
