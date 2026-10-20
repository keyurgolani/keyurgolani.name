import { z } from 'zod';
import { defineContentExtension } from '../extensions';
import { UrlSchema } from '../kinds/common';

// A test fixture standing in for a profession package: what a photographer's
// extension might add. Nothing ships it. Tests register it to check how the
// composed schemas treat a registered extension, and leave it out to check
// how they treat one this build doesn't know.

const ExhibitionSchema = z
  .object({
    title: z.string(),
    venue: z.string(),
    city: z.string().optional(),
    year: z.number().int().min(1800).max(2200),
    url: UrlSchema.optional(),
  })
  .strict();

export const acmePortfolioPhotography = defineContentExtension({
  namespace: '@acme/portfolio-photography',
  sections: {
    exhibitions: z.object({ items: z.array(ExhibitionSchema).min(1) }).strict(),
  },
  fields: z
    .object({
      camera: z.string().optional(),
      lens: z.string().optional(),
      film: z.boolean().optional(),
    })
    .strict(),
});
