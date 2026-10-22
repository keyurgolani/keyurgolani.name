import { z } from 'zod';
import { EXTENSION_MAX_DEPTH, isPlainObject, plainJsonProblem } from './json';
import { FALLBACK_VARIANT_ID } from './ids';
import { SectionIdSchema, type SchemaParts } from './kinds/common';
import { SITE_SCHEMA_VERSION } from './versions';

export { SITE_SCHEMA_VERSION } from './versions';

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

/** A selected variant: a registry id, other than the fallback composition's. */
const SelectedVariantSchema = RegistryIdSchema.refine((id) => id !== FALLBACK_VARIANT_ID, {
  message:
    "names the fallback composition, which renders in place of a variant this build doesn't register and can't be selected. Select a variant.",
});

/**
 * A variant's stored control values hold any keys, but only plain JSON: the
 * render input and a revision (#3) canonicalize them, which .inf and .nan
 * can't be.
 */
function plainJsonValues(values: Record<string, unknown>, ctx: z.RefinementCtx) {
  for (const [key, value] of Object.entries(values)) {
    const problem = plainJsonProblem(value, EXTENSION_MAX_DEPTH);
    if (problem) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message:
          problem === 'too-deep'
            ? `is nested more than ${EXTENSION_MAX_DEPTH} levels deep.`
            : "holds a value JSON can't represent, such as .inf or .nan.",
      });
    }
  }
}

/** The site document's schemas for one set of parts. */
export function siteSchemas({ object }: SchemaParts) {
  /**
   * The published appearance: four independent axes plus the display mode.
   * Registries for each axis check the ids, so a selection that parses here
   * can still name something this build doesn't register.
   */
  const AppearanceSelectionSchema = object({
    variant: SelectedVariantSchema,
    designLanguage: RegistryIdSchema,
    colorScheme: RegistryIdSchema,
    typography: RegistryIdSchema,
    displayMode: DisplayModeSchema,
  });

  /** One policy per appearance field; all five are required. */
  const VisitorControlsSchema = object({
    variant: VisitorControlSchema,
    designLanguage: VisitorControlSchema,
    colorScheme: VisitorControlSchema,
    typography: VisitorControlSchema,
    displayMode: VisitorControlSchema,
  });

  /**
   * Input for a generator-backed color scheme: a seed color, or a media asset
   * whose colors seed the scheme, by the portfolio's media id.
   */
  const AppearanceInputSchema = z
    .unknown()
    .superRefine((value, ctx) => {
      // Either shape would call the other's key unknown, which misses the point.
      if (isPlainObject(value) && 'seedColor' in value && 'sourceAsset' in value) {
        ctx.addIssue({
          code: 'custom',
          message: "has both seedColor and sourceAsset, which can't be used together. Keep one.",
        });
      }
    })
    .pipe(
      z.union([
        object({
          seedColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, {
            message: 'must be a six-digit hex color, such as #3366ff.',
          }),
        }),
        object({ sourceAsset: SectionIdSchema }),
      ]),
    );

  const SiteFeaturesSchema = object({
    /** Serve /feed.xml. */
    feed: z.boolean(),
    /** Credit the platform in the page footer. Nothing renders it yet. */
    productAttribution: z.boolean().default(false),
  });

  /**
   * The site document: how the portfolio is presented and which product
   * behavior is on. It carries no deployment authority and no secrets; the
   * profile, canonical origin, Studio, preview origin, and proxy trust come
   * from the environment.
   */
  const SiteSchema = object({
    schemaVersion: z.literal(SITE_SCHEMA_VERSION),
    appearance: AppearanceSelectionSchema,
    visitorControls: VisitorControlsSchema,
    /** Keyed by generator-backed color scheme id. */
    appearanceInputs: z.record(RegistryIdSchema, AppearanceInputSchema).optional(),
    motionPolicy: MotionPolicySchema,
    features: SiteFeaturesSchema,
    /** Keyed by #5 route id. */
    routes: z.record(RegistryIdSchema, object({ enabled: z.boolean() })).optional(),
    /**
     * Keyed by variant id. #5's validators check the values against each
     * manifest, so `values` takes any keys.
     */
    variantControls: z
      .record(
        RegistryIdSchema,
        object({
          version: z.number().finite().int().positive(),
          values: z.record(z.string(), z.unknown()).superRefine(plainJsonValues),
        }),
      )
      .optional(),
    /** Keyed by section id. */
    sections: z.record(SectionIdSchema, object({ hidden: z.boolean().optional() })).optional(),
  });

  return {
    AppearanceSelectionSchema,
    VisitorControlsSchema,
    AppearanceInputSchema,
    SiteFeaturesSchema,
    SiteSchema,
  };
}

type Schemas = ReturnType<typeof siteSchemas>;
export type AppearanceSelection = z.infer<Schemas['AppearanceSelectionSchema']>;
export type AppearanceAxis = Exclude<keyof AppearanceSelection, 'extensions'>;
export type VisitorControls = z.infer<Schemas['VisitorControlsSchema']>;
export type AppearanceInput = z.infer<Schemas['AppearanceInputSchema']>;
export type SiteFeatures = z.infer<Schemas['SiteFeaturesSchema']>;
export type Site = z.infer<Schemas['SiteSchema']>;
