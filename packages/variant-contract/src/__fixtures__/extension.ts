import { z } from 'zod';
import { defineContentExtension } from '@portfolio/schema';

// A test content extension: a photographer's exhibitions. Tests register it
// to see its sections reach the render, and leave it out to see them dropped.
export const exhibitions = defineContentExtension({
  namespace: '@acme/portfolio-photography',
  sections: {
    exhibitions: z.object({ items: z.array(z.object({ title: z.string() }).strict()) }).strict(),
  },
});
