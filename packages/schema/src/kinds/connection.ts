import { z } from 'zod';
import type { SchemaParts } from './common';

export function connectionSchemas({ section, Link }: SchemaParts) {
  const ContactSchema = section('contact', {
    message: z.string().optional(),
    links: z.array(Link).optional(),
    showAvailability: z.boolean().optional(),
  });

  const CtaSchema = section('cta', {
    description: z.string().optional(),
    primaryAction: Link.optional(),
    secondaryAction: Link.optional(),
  });

  return { ContactSchema, CtaSchema };
}

type Schemas = ReturnType<typeof connectionSchemas>;
export type Contact = z.infer<Schemas['ContactSchema']>;
export type Cta = z.infer<Schemas['CtaSchema']>;
