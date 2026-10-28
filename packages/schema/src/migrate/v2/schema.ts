import { z } from 'zod';
import { sectionRouter } from '../../compose';
import { createExtensionRegistry } from '../../extensions';
import { LanguageTagSchema, makeParts } from '../../kinds/common';
import { DirectionSchema } from '../../portfolio';
import { coreSectionSchemas } from './kinds';

// The version 2 portfolio schema (#4), kept for the migration alone: the
// legacy step reads it for the keys the old format's schema read. Nothing
// else parses with it; the runtime reads only version 3.

/** The version the old one-file format went to, and the 2-to-3 step reads. */
export const V2_SCHEMA_VERSION = 2;

function v2Schemas() {
  const registry = createExtensionRegistry([]);
  const parts = makeParts(registry);
  const { object, Image, Link } = parts;
  const core = coreSectionSchemas(parts);
  const SectionSchema = sectionRouter(parts, core.sections, registry);
  const PortfolioSchema = object({
    schemaVersion: z.literal(V2_SCHEMA_VERSION),
    locale: LanguageTagSchema,
    direction: DirectionSchema,
    identity: object({
      name: z.string(),
      tagline: z.string().optional(),
      pronouns: z.string().optional(),
      location: z.string().optional(),
      email: z.string().optional(),
      avatar: Image.optional(),
    }),
    links: z.array(Link).default([]),
    meta: object({
      title: z.string().optional(),
      description: z.string().optional(),
      ogImage: Image.optional(),
    }).optional(),
    sections: z.array(SectionSchema).default([]),
  });
  return { PortfolioSchema };
}

/** The version 2 portfolio schema, for its keys. */
export const V2_PORTFOLIO_SCHEMA = v2Schemas().PortfolioSchema;
