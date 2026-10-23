// Pack manifests (#19, Slice 1, item 2): the strict `packs/<id>/manifest.json`
// a design-language, color-scheme, or typography package holds, one per
// pack. Every object is strict, so a key the contract doesn't define is
// reported, never dropped. validatePackManifest() checks what the shape
// can't. #20 owns the catalog's values; this file owns the fields.

import { z } from 'zod';
import { REGISTRY_ID_PATTERN } from '@portfolio/schema';
import { BudgetsSchema, ManifestSchema } from '@portfolio/variant-contract';
import {
  COLOR_ROLES,
  LANGUAGE_KEYS,
  TYPOGRAPHY_MEASURES,
  TYPOGRAPHY_ROLES,
  type ColorRole,
  type LanguageKey,
  type TypographyMeasure,
  type TypographyRole,
} from './tokens';
import { languageTokenProblem } from './language-grammar';
import {
  CH,
  EM,
  fontStackProblem,
  REM,
  SCRIPT_CODE,
  UNICODE_RANGE,
  VARIATION_SETTINGS,
} from './values';

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const MARKUP = /[<>]/;

/** Plain text on one line, as #5's manifest takes it: no markup, no control characters, no padding. */
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

const PackId = z.string().regex(REGISTRY_ID_PATTERN, {
  message:
    'must start with a lowercase letter, then 1 to 47 lowercase letters, digits, or hyphens, such as warm-parchment.',
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

/** A calendar date, such as 2026-10-17. */
const IsoDate = z.string().refine(
  (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  },
  { message: 'must be a date written YYYY-MM-DD, such as 2026-10-17.' },
);

/** Stable, Extended, and Experimental packs ship; Research packs never reach a production registry. */
export const PACK_TIERS = ['stable', 'extended', 'experimental', 'research'] as const;
export type PackTier = (typeof PACK_TIERS)[number];

const Provenance = z
  .object({
    /** Where the pack comes from: the upstream project, or the platform for a first-party pack. */
    source: z.object({ name: plainText(120), url: Https.optional() }).strict(),
    /** An SPDX expression, or a license state such as first-party. */
    license: plainText(120),
    attribution: plainText(300).optional(),
    researchedAt: IsoDate,
    maintainer: plainText(120),
    /** How a derived pack differs from its source, such as a dark counterpart of a light-only palette. */
    derivation: plainText(300).optional(),
    caveats: z.array(plainText(300)).max(16).optional(),
  })
  .strict();

const common = {
  id: PackId,
  name: plainText(60),
  description: plainText(1000),
  tokenContract: z.number().int().nonnegative(),
  tier: z.enum(PACK_TIERS),
  provenance: Provenance,
  /** Its runtime budgets (#6), each at most its axis's ceiling; one left out is the ceiling. */
  budgets: BudgetsSchema.optional(),
};

const Hex = z.string().regex(/^#[0-9a-f]{6}$/, {
  message: 'must be a six-digit lowercase hex color, such as #2b241c.',
});

function strictRecord<K extends string, T extends z.ZodTypeAny>(keys: readonly K[], value: T) {
  return z.object(Object.fromEntries(keys.map((key) => [key, value])) as Record<K, T>).strict();
}

/** One mode's colors, every role given. */
export const ColorTokenSetSchema = strictRecord<ColorRole, typeof Hex>(COLOR_ROLES, Hex);

/** The four colors `anchor-v1` derives a mode's set from. */
const AnchorsSchema = z.object({ canvas: Hex, text: Hex, accent: Hex, secondary: Hex }).strict();

const Generator = z
  .object({
    /** A generator in @portfolio/appearance/generators (Slice 2), such as fixture-seed. */
    id: PackId,
    version: z.number().int().positive(),
    /** The appearanceInputs entry it reads: seedColor, or a sourceAsset. */
    input: z.enum(['seed-color', 'asset']),
  })
  .strict();

/**
 * A scheme's colors come one of three ways: authored `light` and `dark` sets,
 * per-mode `anchors` that `derivation: "anchor-v1"` derives the sets from,
 * or a `generator`. A scheme with one base mode is single-mode, and that
 * mode is its native one. validatePackManifest() holds a scheme to one way.
 */
export const ColorSchemeManifestSchema = z
  .object({
    ...common,
    light: ColorTokenSetSchema.optional(),
    dark: ColorTokenSetSchema.optional(),
    anchors: z
      .object({ light: AnchorsSchema.optional(), dark: AnchorsSchema.optional() })
      .strict()
      .optional(),
    derivation: z.literal('anchor-v1').optional(),
    generator: Generator.optional(),
    /** Authored high-contrast sets, in place of the ones high-contrast-v1 derives. */
    highContrast: z
      .object({ light: ColorTokenSetSchema.optional(), dark: ColorTokenSetSchema.optional() })
      .strict()
      .optional(),
    /** The colors a picker shows for the scheme. */
    swatches: z.array(Hex).min(1).max(8).optional(),
  })
  .strict();

/** A pack file, such as ./styles.css, inside the pack's directory. */
const PackFile = (extension: string) =>
  z
    .string()
    .regex(new RegExp(`^\\./(?:[a-z0-9][a-z0-9_-]*/)*[a-z0-9][a-z0-9._-]*\\.${extension}$`), {
      message: `must be a .${extension} file in the pack's directory, such as ./styles.${extension}.`,
    });

/** A design-language token: the value rules, then its key's grammar (Slice 2). */
const languageToken = (key: LanguageKey) =>
  z.string().superRefine((value, ctx) => {
    const problem = languageTokenProblem(key, value);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

const LanguageTokensSchema = z
  .object(
    Object.fromEntries(LANGUAGE_KEYS.map((key) => [key, languageToken(key)])) as Record<
      LanguageKey,
      ReturnType<typeof languageToken>
    >,
  )
  .strict();

export const DesignLanguageManifestSchema = z
  .object({
    ...common,
    tokens: LanguageTokensSchema,
    /** The language's stylesheet, compiled into its layer and scope (Slice 2). */
    stylesheet: PackFile('css').optional(),
    /** #5's enhancement declarations, the same shape a variant's are. */
    enhancements: ManifestSchema.shape.enhancements,
  })
  .strict();

const FontStack = z.string().superRefine((value, ctx) => {
  const problem = fontStackProblem(value);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

const Rem = z
  .string()
  .regex(REM, { message: 'must be a rem size, such as 1rem or 0.875rem.' })
  .refine(
    // A size the pattern already refused gets one record, not two.
    (value) => !REM.test(value) || (Number.parseFloat(value) > 0 && Number.parseFloat(value) <= 16),
    { message: 'must be more than 0rem and at most 16rem.' },
  );

const Weight = z.number().int().min(1).max(1000);

const TypeRoleSchema = z
  .object({
    'font-family': FontStack,
    'font-size': Rem,
    'font-weight': Weight,
    'line-height': z.number().positive().max(4),
    'letter-spacing': z.string().regex(EM, {
      message: 'must be normal, 0, or an em length, such as -0.02em.',
    }),
    'font-variation-settings': z.string().regex(VARIATION_SETTINGS, {
      message: 'must be normal or axis settings, such as "wght" 450, "opsz" 32.',
    }),
  })
  .strict();

const FontAsset = z
  .object({
    /** The family name roles list it under. The compiler namespaces it as "<pack id> <family>". */
    family: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$/, {
      message: 'must be a family name of letters, digits, spaces, and . _ -, up to 60 characters.',
    }),
    file: PackFile('woff2'),
    weight: z.union([Weight, z.tuple([Weight, Weight])]),
    style: z.enum(['normal', 'italic']),
    /**
     * The code points the file covers (#6, item 7): a browser downloads it
     * only for text that uses one, so every face declares its subset.
     */
    unicodeRange: z
      .string()
      .regex(UNICODE_RANGE, { message: 'must be a unicode-range, such as U+0000-00FF, U+0131.' }),
  })
  .strict();

export const TypographyManifestSchema = z
  .object({
    ...common,
    roles: strictRecord<TypographyRole, typeof TypeRoleSchema>(TYPOGRAPHY_ROLES, TypeRoleSchema),
    measures: strictRecord<TypographyMeasure, z.ZodString>(
      TYPOGRAPHY_MEASURES,
      z.string().regex(CH, { message: 'must be a width in ch, such as 68ch.' }),
    ),
    /** ISO 15924 codes of the scripts every role covers, such as Latn. */
    scripts: z
      .array(z.string().regex(SCRIPT_CODE, { message: 'must be an ISO 15924 code, such as Latn.' }))
      .min(1)
      .max(64),
    fontAssets: z.array(FontAsset).max(32),
  })
  .strict();

export type ColorTokenSet = z.infer<typeof ColorTokenSetSchema>;
export type ColorSchemeManifest = z.infer<typeof ColorSchemeManifestSchema>;
export type DesignLanguageManifest = z.infer<typeof DesignLanguageManifestSchema>;
export type TypographyManifest = z.infer<typeof TypographyManifestSchema>;
export type FontAssetDeclaration = TypographyManifest['fontAssets'][number];
export type PackProvenance = z.infer<typeof Provenance>;
