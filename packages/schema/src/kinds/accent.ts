import { z } from 'zod';
import type { SchemaParts } from './common';

export function accentSchemas({ object, section }: SchemaParts) {
  const StatsSchema = section('stats', {
    items: z.array(
      object({
        value: z.union([z.string(), z.number()]),
        label: z.string(),
        description: z.string().optional(),
      }),
    ),
  });

  return { StatsSchema };
}

type Schemas = ReturnType<typeof accentSchemas>;
export type Stats = z.infer<Schemas['StatsSchema']>;
