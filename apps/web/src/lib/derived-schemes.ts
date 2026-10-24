// A mirror of stream B's packages/appearance/src/derived-scheme.ts (#10's
// 10h, kgn/10h-generated-schemes 3c95137b), byte for byte below this
// comment but for its imports, until 10h lands and @portfolio/appearance
// exports it: then document-appearance.ts imports DerivedSchemeSchema,
// DerivedScheme, and readDerivedSchemes from there, and this file goes.

// A generated scheme as #10's draft save stores it (#10, 10h; agreed with
// #20): the draft's derived.schemes[schemeId], frozen with the revision at
// publish as snapshots/schemes.json. The generator that made it, the hash of
// the input it read, and both modes' tokens, each a complete color set, with
// the high-contrast sets when the generator gives them. Browser-safe, like
// the root entry, so the store and the resolver read one shape.

import { z } from 'zod';
import { ColorTokenSetSchema, type ColorTokens, type GeneratedScheme } from '@portfolio/appearance';

const ModesSchema = z.object({ light: ColorTokenSetSchema, dark: ColorTokenSetSchema }).strict();

export const DerivedSchemeSchema = z
  .object({
    /** GeneratorResult.generator: the generator that made the tokens. */
    generator: z.object({ id: z.string().min(1), version: z.number().int().positive() }).strict(),
    /**
     * SHA-256, in lowercase hex, of the canonical input: a seed color
     * lowercased, or an asset by its pixel hash.
     */
    inputsHash: z.string().regex(/^[0-9a-f]{64}$/),
    /**
     * GeneratorResult.tokens: both base modes, every role given, and, when
     * the generator gives them, both high-contrast sets, checked the same way.
     */
    tokens: z
      .object({
        light: ColorTokenSetSchema,
        dark: ColorTokenSetSchema,
        highContrast: ModesSchema.optional(),
      })
      .strict(),
  })
  .strict();

export interface DerivedScheme {
  readonly generator: { readonly id: string; readonly version: number };
  readonly inputsHash: string;
  readonly tokens: GeneratedScheme & {
    readonly highContrast?: { readonly light: ColorTokens; readonly dark: ColorTokens };
  };
}

/** Why `readDerivedSchemes` left an entry out: its scheme id, and what's wrong. */
export interface DerivedSchemeProblem {
  readonly code: 'scheme.invalid';
  readonly schemeId: string;
  readonly message: string;
}

/**
 * The derived schemes in `value`, a draft's derived.schemes or a revision's
 * unit.snapshots.schemes, by scheme id, each checked against
 * DerivedSchemeSchema. It fails closed and never throws: an entry that
 * doesn't check is left out, with a problem naming its scheme, so its axis
 * falls back; anything that isn't an object of entries gives none.
 */
export function readDerivedSchemes(value: unknown): {
  readonly schemes: Readonly<Record<string, DerivedScheme>>;
  readonly problems: readonly DerivedSchemeProblem[];
} {
  const schemes: Record<string, DerivedScheme> = {};
  const problems: DerivedSchemeProblem[] = [];
  if (value === undefined || value === null) return { schemes, problems };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return {
      schemes,
      problems: [
        {
          code: 'scheme.invalid',
          schemeId: '',
          message:
            'The generated schemes are not an object of entries by scheme id, so none renders.',
        },
      ],
    };
  }
  for (const [schemeId, entry] of Object.entries(value)) {
    const parsed = DerivedSchemeSchema.safeParse(entry);
    if (parsed.success) {
      Object.defineProperty(schemes, schemeId, {
        value: parsed.data,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    } else {
      problems.push({
        code: 'scheme.invalid',
        schemeId,
        message: `The generated scheme ${schemeId} doesn't check, so it renders the color scheme fallback.`,
      });
    }
  }
  return { schemes, problems };
}
