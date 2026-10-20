import { z } from 'zod';
import { LooseDateSchema, UrlSchema, type SchemaParts } from './common';

export function quotedSchemas({ object, section, Image }: SchemaParts) {
  const TestimonialsSchema = section('testimonials', {
    items: z.array(
      object({
        quote: z.string(),
        author: z.string(),
        authorRole: z.string().optional(),
        authorOrganization: z.string().optional(),
        authorAvatar: Image.optional(),
        authorUrl: UrlSchema.optional(),
        sourceUrl: UrlSchema.optional(),
      }),
    ),
  });

  const PressSchema = section('press', {
    items: z.array(
      object({
        title: z.string(),
        publication: z.string(),
        publishedAt: LooseDateSchema.optional(),
        excerpt: z.string().optional(),
        url: UrlSchema.optional(),
        author: z.string().optional(),
      }),
    ),
  });

  const QuoteSchema = section('quote', {
    text: z.string(),
    attribution: z.string().optional(),
    source: z.string().optional(),
    sourceUrl: UrlSchema.optional(),
  });

  return { TestimonialsSchema, PressSchema, QuoteSchema };
}

type Schemas = ReturnType<typeof quotedSchemas>;
export type Testimonials = z.infer<Schemas['TestimonialsSchema']>;
export type Press = z.infer<Schemas['PressSchema']>;
export type Quote = z.infer<Schemas['QuoteSchema']>;
