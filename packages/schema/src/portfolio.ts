import { z } from 'zod';
import { ImageSchema, LinkSchema } from './kinds/common';
import { SectionSchema } from './kinds';

export const ThemePreferenceSchema = z.enum(['light', 'dark', 'bright', 'black', 'system']);
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;

export const MotionPreferenceSchema = z.enum(['respect-os', 'reduce', 'full']);
export type MotionPreference = z.infer<typeof MotionPreferenceSchema>;

export const IdentitySchema = z.object({
  name: z.string(),
  tagline: z.string().optional(),
  pronouns: z.string().optional(),
  location: z.string().optional(),
  email: z.string().optional(),
  avatar: ImageSchema.optional(),
});
export type Identity = z.infer<typeof IdentitySchema>;

export const PortfolioSchema = z.object({
  identity: IdentitySchema,
  variant: z.string().default('editorial'),
  theme: ThemePreferenceSchema.default('system'),
  /**
   * How motion behaves: `respect-os` follows the visitor's
   * prefers-reduced-motion; `reduce` forces reduced motion always;
   * `full` overrides OS pref and animates regardless.
   */
  motionPreference: MotionPreferenceSchema.default('respect-os'),
  /** Active color scheme id (must match one declared by the active variant). */
  colorScheme: z.string().optional(),
  /** Active typography preset id (must match one declared by the active variant). */
  typography: z.string().optional(),
  links: z.array(LinkSchema).default([]),
  sections: z.array(SectionSchema).default([]),
  meta: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      url: z.string().optional(),
      ogImage: ImageSchema.optional(),
    })
    .optional(),
});
export type Portfolio = z.infer<typeof PortfolioSchema>;
