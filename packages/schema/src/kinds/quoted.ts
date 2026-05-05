import { z } from 'zod';
import { ImageSchema, LooseDateSchema, SectionBase } from './common';

export const TestimonialsSchema = z.object({
  kind: z.literal('testimonials'),
  ...SectionBase,
  items: z.array(
    z.object({
      quote: z.string(),
      author: z.string(),
      authorRole: z.string().optional(),
      authorOrganization: z.string().optional(),
      authorAvatar: ImageSchema.optional(),
      authorUrl: z.string().optional(),
      sourceUrl: z.string().optional(),
    }),
  ),
});
export type Testimonials = z.infer<typeof TestimonialsSchema>;

export const PressSchema = z.object({
  kind: z.literal('press'),
  ...SectionBase,
  items: z.array(
    z.object({
      title: z.string(),
      publication: z.string(),
      publishedAt: LooseDateSchema.optional(),
      excerpt: z.string().optional(),
      url: z.string().optional(),
      author: z.string().optional(),
    }),
  ),
});
export type Press = z.infer<typeof PressSchema>;

export const QuoteSchema = z.object({
  kind: z.literal('quote'),
  ...SectionBase,
  text: z.string(),
  attribution: z.string().optional(),
  source: z.string().optional(),
  sourceUrl: z.string().optional(),
});
export type Quote = z.infer<typeof QuoteSchema>;
