import { z } from 'zod';
import { ImageSchema, LinkSchema, LooseDateSchema, SectionBase } from './common';

export const GallerySchema = z.object({
  kind: z.literal('gallery'),
  ...SectionBase,
  layout: z.enum(['plates', 'grid', 'columns']).optional(),
  items: z.array(
    z.object({
      image: ImageSchema,
      caption: z.string().optional(),
      takenAt: LooseDateSchema.optional(),
      location: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
  ),
});
export type Gallery = z.infer<typeof GallerySchema>;

export const DiscographySchema = z.object({
  kind: z.literal('discography'),
  ...SectionBase,
  items: z.array(
    z.object({
      title: z.string(),
      artist: z.string().optional(),
      role: z.string().optional(),
      releasedAt: LooseDateSchema.optional(),
      label: z.string().optional(),
      cover: ImageSchema.optional(),
      description: z.string().optional(),
      tracks: z
        .array(
          z.object({
            title: z.string(),
            durationSeconds: z.number().positive().optional(),
            url: z.string().optional(),
          }),
        )
        .optional(),
      links: z.array(LinkSchema).optional(),
    }),
  ),
});
export type Discography = z.infer<typeof DiscographySchema>;
