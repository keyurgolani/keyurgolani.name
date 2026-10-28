import { z } from 'zod';
import {
  LabelSchema,
  LanguageTagSchema,
  listOf,
  RefSchema,
  TextSchema,
  type SchemaParts,
} from './kinds/common';
import type { Section } from './kinds';
import { recordSchemas } from './kinds/records';
import { PORTFOLIO_SCHEMA_VERSION } from './versions';

export { PORTFOLIO_SCHEMA_VERSION } from './versions';

/** Writing direction of the portfolio's text. */
export const DirectionSchema = z.enum(['ltr', 'rtl']);
export type Direction = z.infer<typeof DirectionSchema>;

/**
 * The portfolio document, version 3: portable, authored content only, as a
 * body of work. Records (works, evidence, chronology, media) carry ids; the
 * curation lists (signature, featured, proof, archive) and the sections name
 * them in the order the author chose. Presentation and product behavior live
 * in the site document, and deployment settings in the environment.
 */
export function portfolioSchemas(
  parts: SchemaParts,
  sections: z.ZodType<Section, z.ZodTypeDef, unknown>,
) {
  const { object, Link, Placement } = parts;
  const records = recordSchemas(parts);

  const IdentitySchema = object({
    /** The name every page shows. */
    name: z.string().refine((value) => value.trim() !== '', {
      message: 'is blank. It names the portfolio on every page.',
    }),
    tagline: TextSchema.optional(),
    pronouns: TextSchema.optional(),
    location: TextSchema.optional(),
    email: TextSchema.optional(),
    /** A placement of an image asset. */
    avatar: Placement.optional(),
  });

  const MetaSchema = object({
    title: LabelSchema.optional(),
    description: TextSchema.optional(),
    /** A placement of an image asset. */
    ogImage: Placement.optional(),
  });

  const PortfolioSchema = object({
    schemaVersion: z.literal(PORTFOLIO_SCHEMA_VERSION),
    /** BCP 47 language tag of the content, such as `en` or `pt-BR`. */
    locale: LanguageTagSchema,
    direction: DirectionSchema,
    identity: IdentitySchema,
    links: listOf(Link).optional(),
    meta: MetaSchema.optional(),
    practice: records.PracticeSchema.optional(),
    /** The one work the portfolio leads with, by id. */
    signature: RefSchema.optional(),
    /** Flagship works, by id, in order. Never the signature. */
    featured: listOf(RefSchema).optional(),
    /** The proof strip: evidence ids, in order. */
    proof: listOf(RefSchema).optional(),
    /** Older works, by id, in order. Never a featured one. */
    archive: listOf(RefSchema).optional(),
    works: listOf(records.WorkSchema).optional(),
    evidence: listOf(records.EvidenceSchema).optional(),
    chronology: listOf(records.ChronologyEntrySchema).optional(),
    media: listOf(records.MediaAssetSchema).optional(),
    contact: records.ContactSchema.optional(),
    /** The reading order. */
    sections: listOf(sections).optional(),
  });

  return { IdentitySchema, MetaSchema, PortfolioSchema, ...records };
}

type Schemas = ReturnType<typeof portfolioSchemas>;
export type Identity = z.infer<Schemas['IdentitySchema']>;
export type PortfolioMeta = z.infer<Schemas['MetaSchema']>;
export type Portfolio = z.infer<Schemas['PortfolioSchema']>;
