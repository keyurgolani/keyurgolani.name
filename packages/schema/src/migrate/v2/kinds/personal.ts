import { z } from 'zod';
import type { SchemaParts } from '../../../kinds/common';

export function personalSchemas({ section }: SchemaParts) {
  /**
   * Current focus — the few things the author is putting energy into right
   * now. Distinct from `now` (which is long-form prose) and `skills` (which
   * is comprehensive). Items are short labels.
   */
  const FocusSchema = section('focus', {
    items: z.array(z.string()).min(1),
  });

  /**
   * Fun facts — playful personal details that humanize the page. Pure list
   * of strings; no metadata.
   */
  const FunFactsSchema = section('fun-facts', {
    items: z.array(z.string()).min(1),
  });

  /**
   * Tenure — career duration with an optional one-line summary. Renders as
   * a single accent figure ("12+ years") rather than as a list.
   */
  const TenureSchema = section('tenure', {
    years: z.number().finite().nonnegative().optional(),
    summary: z.string().optional(),
  });

  return { FocusSchema, FunFactsSchema, TenureSchema };
}

type Schemas = ReturnType<typeof personalSchemas>;
export type Focus = z.infer<Schemas['FocusSchema']>;
export type FunFacts = z.infer<Schemas['FunFactsSchema']>;
export type Tenure = z.infer<Schemas['TenureSchema']>;
