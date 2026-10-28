import { z } from 'zod';
import { UrlSchema, type SchemaParts } from '../../../kinds/common';

export function listSchemas({ object, section }: SchemaParts) {
  const SkillsSchema = section('skills', {
    groups: z
      .array(
        object({
          name: z.string(),
          description: z.string().optional(),
          items: z.array(z.string()),
        }),
      )
      .optional(),
    items: z.array(z.string()).optional(),
  });

  const StackSchema = section('stack', {
    groups: z.array(
      object({
        name: z.string(),
        items: z.array(
          object({
            name: z.string(),
            url: UrlSchema.optional(),
            version: z.string().optional(),
          }),
        ),
      }),
    ),
  });

  const ServicesSchema = section('services', {
    items: z.array(
      object({
        name: z.string(),
        description: z.string().optional(),
        pricing: z.string().optional(),
        url: UrlSchema.optional(),
        highlights: z.array(z.string()).optional(),
      }),
    ),
  });

  return { SkillsSchema, StackSchema, ServicesSchema };
}

type Schemas = ReturnType<typeof listSchemas>;
export type Skills = z.infer<Schemas['SkillsSchema']>;
export type Stack = z.infer<Schemas['StackSchema']>;
export type Services = z.infer<Schemas['ServicesSchema']>;
