import { z } from 'zod';
import { SectionBase } from './common';

export const SkillsSchema = z.object({
  kind: z.literal('skills'),
  ...SectionBase,
  groups: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        items: z.array(z.string()),
      }),
    )
    .optional(),
  items: z.array(z.string()).optional(),
});
export type Skills = z.infer<typeof SkillsSchema>;

export const StackSchema = z.object({
  kind: z.literal('stack'),
  ...SectionBase,
  groups: z.array(
    z.object({
      name: z.string(),
      items: z.array(
        z.object({
          name: z.string(),
          url: z.string().optional(),
          version: z.string().optional(),
        }),
      ),
    }),
  ),
});
export type Stack = z.infer<typeof StackSchema>;

export const ServicesSchema = z.object({
  kind: z.literal('services'),
  ...SectionBase,
  items: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      pricing: z.string().optional(),
      url: z.string().optional(),
      highlights: z.array(z.string()).optional(),
    }),
  ),
});
export type Services = z.infer<typeof ServicesSchema>;
