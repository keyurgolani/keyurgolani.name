import { z } from 'zod';
import { SectionBase } from './common';

/**
 * Current focus — the few things the author is putting energy into right
 * now. Distinct from `now` (which is long-form prose) and `skills` (which
 * is comprehensive). Items are short labels.
 */
export const FocusSchema = z.object({
  kind: z.literal('focus'),
  ...SectionBase,
  items: z.array(z.string()).min(1),
});
export type Focus = z.infer<typeof FocusSchema>;

/**
 * Fun facts — playful personal details that humanize the page. Pure list
 * of strings; no metadata.
 */
export const FunFactsSchema = z.object({
  kind: z.literal('fun-facts'),
  ...SectionBase,
  items: z.array(z.string()).min(1),
});
export type FunFacts = z.infer<typeof FunFactsSchema>;

/**
 * Tenure — career duration with an optional one-line summary. Renders as
 * a single accent figure ("12+ years") rather than as a list.
 */
export const TenureSchema = z.object({
  kind: z.literal('tenure'),
  ...SectionBase,
  years: z.number().nonnegative().optional(),
  summary: z.string().optional(),
});
export type Tenure = z.infer<typeof TenureSchema>;
