import { z } from 'zod';
import { LooseDateSchema, UrlSchema, type SchemaParts } from './common';

export function visualSchemas({ object, section, Image, Link }: SchemaParts) {
  const GallerySchema = section('gallery', {
    layout: z.enum(['plates', 'grid', 'columns']).optional(),
    items: z.array(
      object({
        image: Image,
        caption: z.string().optional(),
        takenAt: LooseDateSchema.optional(),
        location: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }),
    ),
  });

  const DiscographySchema = section('discography', {
    items: z.array(
      object({
        title: z.string(),
        artist: z.string().optional(),
        role: z.string().optional(),
        releasedAt: LooseDateSchema.optional(),
        label: z.string().optional(),
        cover: Image.optional(),
        description: z.string().optional(),
        tracks: z
          .array(
            object({
              title: z.string(),
              durationSeconds: z.number().positive().optional(),
              url: UrlSchema.optional(),
            }),
          )
          .optional(),
        links: z.array(Link).optional(),
      }),
    ),
  });

  return { GallerySchema, DiscographySchema };
}

type Schemas = ReturnType<typeof visualSchemas>;
export type Gallery = z.infer<Schemas['GallerySchema']>;
export type Discography = z.infer<Schemas['DiscographySchema']>;
