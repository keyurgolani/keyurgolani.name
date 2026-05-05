import { z } from 'zod';
import { LinkSchema, LooseDateSchema, SectionBase } from './common';

export const HeroSchema = z.object({
  kind: z.literal('hero'),
  ...SectionBase,
  greeting: z.string().optional(),
  name: z.string().optional(),
  tagline: z.string().optional(),
  subtagline: z.string().optional(),
  ctas: z.array(LinkSchema).optional(),
});
export type Hero = z.infer<typeof HeroSchema>;

export const LedeSchema = z.object({
  kind: z.literal('lede'),
  ...SectionBase,
  body: z.string(),
});
export type Lede = z.infer<typeof LedeSchema>;

export const NowSchema = z.object({
  kind: z.literal('now'),
  ...SectionBase,
  asOf: LooseDateSchema.optional(),
  body: z.string(),
});
export type Now = z.infer<typeof NowSchema>;
