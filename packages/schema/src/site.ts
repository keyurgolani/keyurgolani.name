import { z } from 'zod';
import { SectionIdSchema } from './kinds/common';
import { SCHEMA_VERSION } from './portfolio';

/**
 * How the selected color scheme resolves: `system` follows the visitor's
 * prefers-color-scheme, the others pin one mode. An environment modifier, not
 * a fifth appearance axis.
 */
export const DisplayModeSchema = z.enum(['system', 'light', 'dark', 'high-contrast']);
export type DisplayMode = z.infer<typeof DisplayModeSchema>;

/**
 * `respect-os` follows the visitor's prefers-reduced-motion; `reduce` always
 * reduces motion. No policy forces motion past an OS reduce preference.
 */
export const MotionPolicySchema = z.enum(['respect-os', 'reduce']);
export type MotionPolicy = z.infer<typeof MotionPolicySchema>;

/** Whether visitors may change an appearance axis for themselves. */
export const VisitorControlSchema = z.enum(['locked', 'selectable']);
export type VisitorControl = z.infer<typeof VisitorControlSchema>;

/**
 * A variant, pack, or route id: #5's registry grammar. Third-party ids carry
 * their scope as a prefix, so `@acme/ocean` is `acme-ocean`.
 */
export const REGISTRY_ID_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;
export const RegistryIdSchema = z.string().regex(REGISTRY_ID_PATTERN, {
  message:
    'must start with a lowercase letter, then 1 to 47 lowercase letters, digits, or hyphens, such as editorial.',
});

/**
 * The published appearance: four independent axes plus the display mode.
 * Registries for each axis check the ids, so a selection that parses here
 * can still name something this build doesn't register.
 */
export const AppearanceSelectionSchema = z.object({
  variant: RegistryIdSchema,
  designLanguage: RegistryIdSchema,
  colorScheme: RegistryIdSchema,
  typography: RegistryIdSchema,
  displayMode: DisplayModeSchema,
});
export type AppearanceSelection = z.infer<typeof AppearanceSelectionSchema>;
export type AppearanceAxis = keyof AppearanceSelection;

/** One policy per appearance field; all five are required. */
export const VisitorControlsSchema = z.object({
  variant: VisitorControlSchema,
  designLanguage: VisitorControlSchema,
  colorScheme: VisitorControlSchema,
  typography: VisitorControlSchema,
  displayMode: VisitorControlSchema,
});
export type VisitorControls = z.infer<typeof VisitorControlsSchema>;

/**
 * Input for a generator-backed color scheme: a seed color, or a media asset
 * whose colors seed the scheme. Asset ids follow the section-id rule.
 */
export const AppearanceInputSchema = z.union([
  z.object({
    seedColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, {
      message: 'must be a six-digit hex color, such as #3366ff.',
    }),
  }),
  z.object({ sourceAsset: SectionIdSchema }),
]);
export type AppearanceInput = z.infer<typeof AppearanceInputSchema>;

export const SiteFeaturesSchema = z.object({
  /** Serve /feed.xml. */
  feed: z.boolean(),
  /** Credit the platform in the page footer. Nothing renders it yet. */
  productAttribution: z.boolean().default(false),
});
export type SiteFeatures = z.infer<typeof SiteFeaturesSchema>;

/**
 * The site document: how the portfolio is presented and which product
 * behavior is on. It carries no deployment authority and no secrets; the
 * profile, canonical origin, Studio, preview origin, and proxy trust come
 * from the environment.
 */
export const SiteSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  appearance: AppearanceSelectionSchema,
  visitorControls: VisitorControlsSchema,
  /** Keyed by generator-backed color scheme id. */
  appearanceInputs: z.record(RegistryIdSchema, AppearanceInputSchema).optional(),
  motionPolicy: MotionPolicySchema,
  features: SiteFeaturesSchema,
  /** Keyed by #5 route id. */
  routes: z.record(RegistryIdSchema, z.object({ enabled: z.boolean() })).optional(),
  /** Keyed by variant id. #5's validators check the values against each manifest. */
  variantControls: z
    .record(
      RegistryIdSchema,
      z.object({
        version: z.number().int().positive(),
        values: z.record(z.string(), z.unknown()),
      }),
    )
    .optional(),
  /** Keyed by section id. */
  sections: z.record(SectionIdSchema, z.object({ hidden: z.boolean().optional() })).optional(),
});
export type Site = z.infer<typeof SiteSchema>;
