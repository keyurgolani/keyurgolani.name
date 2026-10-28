import { z } from 'zod';
import { SECTION_ID_MAX_LENGTH, SECTION_ID_PATTERN } from '../../../ids';
import type { SchemaParts } from '../../../kinds/common';

/**
 * Names what a stat measures, so every place that states it can be checked
 * against the others. `tenure.years` counts as `tenure-years`.
 */
export const MetricKeySchema = z.string().max(SECTION_ID_MAX_LENGTH).regex(SECTION_ID_PATTERN, {
  message: 'must be lowercase letters and digits in hyphen-separated words, such as tenure-years.',
});

export function accentSchemas({ object, section }: SchemaParts) {
  const StatsSchema = section('stats', {
    items: z.array(
      object({
        value: z.union([z.string(), z.number().finite()]),
        label: z.string(),
        description: z.string().optional(),
        metric: MetricKeySchema.optional(),
      }),
    ),
  });

  return { StatsSchema };
}

type Schemas = ReturnType<typeof accentSchemas>;
export type Stats = z.infer<Schemas['StatsSchema']>;
