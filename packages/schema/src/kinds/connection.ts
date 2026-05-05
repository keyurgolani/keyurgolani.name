import { z } from 'zod';
import { LinkSchema, LooseDateSchema, SectionBase } from './common';

export const ContactSchema = z.object({
  kind: z.literal('contact'),
  ...SectionBase,
  message: z.string().optional(),
  links: z.array(LinkSchema).optional(),
  showAvailability: z.boolean().optional(),
});
export type Contact = z.infer<typeof ContactSchema>;

export const CtaSchema = z.object({
  kind: z.literal('cta'),
  ...SectionBase,
  description: z.string().optional(),
  primaryAction: LinkSchema.optional(),
  secondaryAction: LinkSchema.optional(),
});
export type Cta = z.infer<typeof CtaSchema>;

