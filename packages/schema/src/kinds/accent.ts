import { z } from 'zod';
import { SectionBase } from './common';

export const StatsSchema = z.object({
  kind: z.literal('stats'),
  ...SectionBase,
  items: z.array(
    z.object({
      value: z.union([z.string(), z.number()]),
      label: z.string(),
      description: z.string().optional(),
    }),
  ),
});
export type Stats = z.infer<typeof StatsSchema>;
