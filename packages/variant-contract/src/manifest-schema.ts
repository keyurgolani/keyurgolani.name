// Manifest v2's shape (#5, Slice 1, item 1): the `manifest.json` a variant
// package names in `package.json` `portfolio.manifest`. Every object is
// strict, so a key contract 2.0 doesn't define is reported, never dropped.
// validateManifest() checks the rules the shape can't, such as ids and ranges.

import { z } from 'zod';
import { ALL_SECTION_KINDS, parseExtensionKind, REGISTRY_ID_PATTERN } from '@portfolio/schema';

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const MARKUP = /[<>]/;

/** Plain text on one line: no markup, no control characters, no padding. */
function plainText(max: number) {
  return z.string().superRefine((value, ctx) => {
    if (value.trim().length === 0) {
      ctx.addIssue({ code: 'custom', message: 'must not be empty.' });
      return;
    }
    if (value.trim() !== value) {
      ctx.addIssue({ code: 'custom', message: 'must not start or end with whitespace.' });
    }
    if (value.length > max) {
      ctx.addIssue({ code: 'custom', message: `must be at most ${max} characters.` });
    }
    if (MARKUP.test(value)) {
      ctx.addIssue({ code: 'custom', message: 'must be plain text, with no < or >.' });
    }
    if (CONTROL_CHARACTER.test(value)) {
      ctx.addIssue({ code: 'custom', message: 'must be one line, with no control characters.' });
    }
  });
}

/** More than one sentence: a stop, then more text. */
const SECOND_SENTENCE = /[.!?]\s+\S/;

const RegistryId = z.string().regex(REGISTRY_ID_PATTERN, {
  message:
    'must start with a lowercase letter, then 1 to 47 lowercase letters, digits, or hyphens, such as editorial-evidence.',
});

/** A slot or region id. */
const LocalId = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/, {
  message: 'must start with a lowercase letter, then lowercase letters, digits, or hyphens.',
});

/** A control id: the key its value takes in `variantControls.<id>.values`. */
export const CONTROL_ID_PATTERN = /^[a-z][a-zA-Z0-9]{0,47}$/;
const ControlId = z.string().regex(CONTROL_ID_PATTERN, {
  message: 'must be camelCase: a lowercase letter, then letters or digits, such as heroLayout.',
});

/** An enum control's value. */
const ControlValue = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
  message: 'must be lowercase words joined by hyphens, such as wide.',
});

const CORE_KINDS: readonly string[] = ALL_SECTION_KINDS;

/** A core section kind, or an extension's `<package name>/<name>`. */
const Kind = z.string().refine((kind) => CORE_KINDS.includes(kind) || !!parseExtensionKind(kind), {
  message: 'must be a core section kind, such as gallery, or an extension kind, <package>/<name>.',
});

const Https = z
  .string()
  .max(2048)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.username === '' && url.password === '';
      } catch {
        return false;
      }
    },
    { message: 'must be an https URL with no credentials.' },
  );

const SchemaRange = z
  .object({ min: z.number().int().positive(), max: z.number().int().positive() })
  .strict();

export const COMPOSITION_FAMILIES = [
  'monograph',
  'kinetic',
  'gallery',
  'bento',
  'sequence',
  'document',
  'custom',
] as const;
export const MOTION_INTENTS = ['still', 'subtle', 'kinetic', 'adaptive', 'directed'] as const;
export const PERFORMANCE_TIERS = ['light', 'medium', 'heavy'] as const;
export const SLOT_LEVELS = ['required', 'recommended', 'optional'] as const;
export const DISPOSITIONS = [
  'preserved',
  'folded-into-pack',
  'reused-interaction',
  'retired',
] as const;
export const PLACEMENTS = ['header', 'navigation', 'footer'] as const;
export const REQUIREMENT_FLAGS = ['webgl2', 'fine-pointer', 'motion-allowed'] as const;

/** A JSON pointer into the portfolio, where `*` matches any array index. */
export const FIELD_POINTER = /^(?:\/(?:[^/~]|~[01])*)+$/;

const ContentSlot = z
  .object({
    id: LocalId,
    label: plainText(60),
    select: z.union([
      z.object({ kind: Kind }).strict(),
      z.object({ control: ControlId }).strict(),
      z
        .object({
          field: z.string().regex(FIELD_POINTER, {
            message: 'must be a JSON pointer into the portfolio, such as /identity/avatar.',
          }),
        })
        .strict(),
    ]),
    level: z.enum(SLOT_LEVELS),
    min: z.number().int().nonnegative(),
    max: z.number().int().positive().optional(),
    whenEmpty: z.object({ mode: z.enum(['omit', 'keep']), note: plainText(300) }).strict(),
  })
  .strict();

const View = z
  .object({
    id: RegistryId,
    under: z.enum(['home', 'work']),
    type: z.enum(['path', 'fragment']),
    segment: z.string().min(1).max(200),
  })
  .strict();

const Routes = z
  .object({
    home: z.enum(['bespoke', 'shared']),
    work: z.enum(['bespoke', 'shared']),
    views: z.array(View).max(16),
  })
  .strict();

const controlBase = { id: ControlId, label: plainText(60), description: plainText(300) };

const ControlItem = z.discriminatedUnion('type', [
  z.object({ type: z.literal('boolean'), ...controlBase, default: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('enum'),
      ...controlBase,
      options: z
        .array(z.object({ value: ControlValue, label: plainText(60) }).strict())
        .min(2)
        .max(24),
      default: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('integer'),
      ...controlBase,
      min: z.number().int(),
      max: z.number().int(),
      step: z.number().int().positive(),
      default: z.number().int(),
    })
    .strict(),
  z
    .object({
      type: z.literal('contentRef'),
      ...controlBase,
      kinds: z.array(Kind).min(1).max(28).optional(),
      default: z.null(),
    })
    .strict(),
  z
    .object({
      type: z.literal('contentRefList'),
      ...controlBase,
      kinds: z.array(Kind).min(1).max(28).optional(),
      min: z.number().int().nonnegative(),
      max: z.number().int().positive(),
      default: z.array(z.never()).max(0),
    })
    .strict(),
]);

const Operation = z.discriminatedUnion('op', [
  z.object({ op: z.literal('rename'), from: ControlId, to: ControlId }).strict(),
  z
    .object({
      op: z.literal('mapValue'),
      control: ControlId,
      map: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    })
    .strict(),
  z
    .object({
      op: z.literal('clamp'),
      control: ControlId,
      min: z.number().int().optional(),
      max: z.number().int().optional(),
    })
    .strict(),
  z.object({ op: z.literal('drop'), control: ControlId }).strict(),
]);

const Migration = z
  .object({
    from: z.number().int().positive(),
    to: z.number().int().positive(),
    operations: z.array(Operation).min(1).max(32),
  })
  .strict();

const Controls = z
  .object({
    version: z.number().int().positive(),
    items: z.array(ControlItem).max(32),
    migrations: z.array(Migration).max(64),
  })
  .strict();

const Requirement = z
  .string()
  .refine(
    (value) =>
      (REQUIREMENT_FLAGS as readonly string[]).includes(value) ||
      /^min-width:[1-9]\d{0,3}$/.test(value),
    {
      message:
        'must be webgl2, fine-pointer, motion-allowed, or min-width:<px>, such as min-width:768.',
    },
  );

const Enhancement = z
  .object({
    id: RegistryId,
    export: z.string().regex(/^\.\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/, {
      message: "must be a subpath in the package's exports, such as ./enhancements/orbit.",
    }),
    requires: z.array(Requirement).max(4),
  })
  .strict();

const KeyBinding = z
  .object({
    region: LocalId,
    keys: z.array(z.string().min(1).max(24)).min(1).max(4),
    action: plainText(80),
  })
  .strict();

const Provenance = z
  .object({
    provisional: z.boolean(),
    sources: z
      .array(
        z
          .object({
            source: plainText(120),
            disposition: z.enum(DISPOSITIONS),
            note: plainText(300).optional(),
          })
          .strict(),
      )
      .max(64),
  })
  .strict();

const TextDirection = z
  .array(z.enum(['ltr', 'rtl']))
  .refine((value) => value.join() === 'ltr' || value.join() === 'ltr,rtl', {
    message: 'must be ["ltr"] or ["ltr", "rtl"].',
  });

export const ManifestSchema = z
  .object({
    id: RegistryId,
    name: plainText(60),
    promise: plainText(140).refine((value) => !SECOND_SENTENCE.test(value), {
      message: 'must be one sentence.',
    }),
    description: plainText(1000),
    author: plainText(100).optional(),
    homepage: Https.optional(),
    bestFor: z.array(plainText(60)).min(1).max(8).optional(),
    contract: z.string().regex(/^(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})$/, {
      message: 'must be major.minor, such as 2.0.',
    }),
    schemas: z.object({ portfolio: SchemaRange, site: SchemaRange }).strict(),
    tokenContract: z.number().int().nonnegative(),
    compositionFamily: z.enum(COMPOSITION_FAMILIES),
    motionIntent: z.enum(MOTION_INTENTS),
    performanceTier: z.enum(PERFORMANCE_TIERS),
    renderedKinds: z.array(Kind).max(64),
    unsupportedKinds: z.array(Kind).max(64),
    contentSlots: z.array(ContentSlot).max(32),
    routes: Routes,
    controls: Controls,
    enhancements: z.array(Enhancement).max(8).optional(),
    keyBindings: z.array(KeyBinding).max(16).optional(),
    visitorControl: z.object({ placement: z.enum(PLACEMENTS) }).strict(),
    textDirection: TextDirection,
    provenance: Provenance,
    recommendedAppearance: RegistryId.optional(),
  })
  .strict();

/** A manifest that passed validateManifest(). */
export type VariantManifest = z.infer<typeof ManifestSchema>;
export type ContentSlot = VariantManifest['contentSlots'][number];
export type ViewDeclaration = VariantManifest['routes']['views'][number];
export type ControlDeclaration = VariantManifest['controls']['items'][number];
export type ControlMigration = VariantManifest['controls']['migrations'][number];
export type MigrationOperation = ControlMigration['operations'][number];
export type EnhancementDeclaration = NonNullable<VariantManifest['enhancements']>[number];

/**
 * v1 fields and where each went, for the message when a manifest still has
 * one. `null`: deleted, with the reason.
 */
export const V1_FIELDS: Readonly<
  Record<string, { readonly to: string | null; readonly why?: string }>
> = {
  slug: { to: 'id' },
  tagline: { to: 'promise' },
  aesthetic: { to: 'compositionFamily' },
  motion: { to: 'motionIntent' },
  supportedKinds: { to: 'renderedKinds' },
  version: { to: null, why: "the version comes from the package's package.json" },
  authorUrl: { to: null, why: 'use homepage' },
  density: { to: null, why: 'layout density is the composition itself' },
  typography: { to: null, why: 'typography comes from the appearance system (#19)' },
  themes: { to: null, why: 'themes come from the appearance system (#19)' },
  colorSchemes: { to: null, why: 'color schemes come from the appearance system (#19)' },
  typographyPresets: { to: null, why: 'typography comes from the appearance system (#19)' },
  capabilities: {
    to: null,
    why: "multiPage is routes, rss is the site document's features.feed, and print is a contract fixture mode",
  },
  screenshots: { to: null, why: 'the contract fixtures render the screenshots' },
};
