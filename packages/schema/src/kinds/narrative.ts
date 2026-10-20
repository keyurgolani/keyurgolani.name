import { z } from 'zod';
import { LooseDateSchema, type SchemaParts } from './common';

export function narrativeSchemas({ section, Link }: SchemaParts) {
  const HeroSchema = section('hero', {
    greeting: z.string().optional(),
    name: z.string().optional(),
    tagline: z.string().optional(),
    subtagline: z.string().optional(),
    ctas: z.array(Link).optional(),
  });

  const LedeSchema = section('lede', {
    body: z.string(),
  });

  const NowSchema = section('now', {
    asOf: LooseDateSchema.optional(),
    body: z.string(),
  });

  return { HeroSchema, LedeSchema, NowSchema };
}

type Schemas = ReturnType<typeof narrativeSchemas>;
export type Hero = z.infer<Schemas['HeroSchema']>;
export type Lede = z.infer<Schemas['LedeSchema']>;
export type Now = z.infer<Schemas['NowSchema']>;
