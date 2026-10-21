import { z } from 'zod';
import { makeExtensionsSchema, type ExtensionRegistry, type Extensions } from '../extensions';
import {
  isLanguageTag,
  RESERVED_SECTION_IDS,
  SECTION_ID_MAX_LENGTH,
  SECTION_ID_PATTERN,
} from '../ids';
import { isAllowedUrl } from '../url';

// The building blocks every schema shares. Leaf schemas (dates, ids, URLs)
// are fixed. Objects come from makeParts(), once per set of registered
// extensions: every object is strict, rejecting unknown keys, and accepts an
// `extensions` field checked against those extensions.

/** Every url and *Url field. See ../url.ts. */
export const UrlSchema = z.string().refine((value) => isAllowedUrl(value), {
  message: 'must be an https, http, mailto, or tel URL, a relative path, or a #fragment.',
});

/** An image `src`: what UrlSchema allows, plus data:image URLs in raster formats. */
export const ImageSourceSchema = z
  .string()
  .refine((value) => isAllowedUrl(value, { dataImages: true }), {
    message:
      'must be an https, http, mailto, or tel URL, a relative path, a #fragment, or a data:image URL (png, jpeg, gif, webp, or avif).',
  });

const MONTH_NAMES = new Set([
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]);

function isLooseDate(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (/^(?:present|now|current)$/i.test(trimmed)) return true;
  if (/^\d{4}$/.test(trimmed)) return true;

  const iso = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(trimmed);
  if (iso) {
    const month = Number(iso[2]);
    const day = iso[3] !== undefined ? Number(iso[3]) : 1;
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;
    const padded = `${iso[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const parsed = new Date(`${padded}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime());
  }

  const monthYear = /^([A-Za-z]+)\s+\d{4}$/.exec(trimmed);
  if (monthYear) return MONTH_NAMES.has(monthYear[1]!.toLowerCase());

  return false;
}

export const LooseDateSchema = z.string().refine(isLooseDate, {
  message: `isn't a date. Use YYYY, YYYY-MM, YYYY-MM-DD, "Month YYYY", or "present".`,
});

/** Whether a period ends no earlier than it starts, as far as its loose dates tell. */
function inOrder({ start, end }: { start: string; end?: string }): boolean {
  if (!end) return true;
  const startN = looseDateOrder(start);
  const endN = looseDateOrder(end);
  if (startN == null || endN == null) return true;
  return endN >= startN;
}

/** Coarse comparator for date strings — used only for ordering in PeriodSchema. */
function looseDateOrder(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^(?:present|now|current)$/i.test(trimmed)) return Number.POSITIVE_INFINITY;
  const iso = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(trimmed);
  if (iso) {
    const y = Number(iso[1]);
    const m = iso[2] ? Number(iso[2]) : 1;
    const d = iso[3] ? Number(iso[3]) : 1;
    return y * 10000 + m * 100 + d;
  }
  const monthYear = /^([A-Za-z]+)\s+(\d{4})$/.exec(trimmed);
  if (monthYear) {
    const months = [
      'jan',
      'feb',
      'mar',
      'apr',
      'may',
      'jun',
      'jul',
      'aug',
      'sep',
      'oct',
      'nov',
      'dec',
    ];
    const m = months.indexOf(monthYear[1]!.toLowerCase().slice(0, 3));
    if (m < 0) return null;
    return Number(monthYear[2]) * 10000 + (m + 1) * 100 + 1;
  }
  return null;
}

/** A section id. The rules are in ../ids.ts. */
export const SectionIdSchema = z
  .string()
  .max(SECTION_ID_MAX_LENGTH)
  .regex(SECTION_ID_PATTERN, {
    message:
      'must be lowercase letters and digits in hyphen-separated words, such as get-in-touch.',
  })
  .refine((id) => !RESERVED_SECTION_IDS.includes(id), {
    message: "can't be main, which every variant uses for its <main> element.",
  });

/** A BCP 47 language tag, such as `en` or `pt-BR`. */
export const LanguageTagSchema = z.string().refine(isLanguageTag, {
  message: "isn't a BCP 47 language tag, such as en or pt-BR.",
});

/**
 * Text shown as a heading or a name, such as a section's title. Blank text
 * would show as an empty heading, so it's refused: an optional one is left
 * out instead, and the default shows.
 */
export const LabelSchema = z.string().refine((value) => value.trim() !== '', {
  message: 'is blank, so nothing would show. Leave it out instead.',
});

/** The fields every section has, core or extension. */
export const sectionBase = {
  /** Required and unique within the portfolio. See SECTION_ID_PATTERN. */
  id: SectionIdSchema,
  title: LabelSchema.optional(),
  subtitle: LabelSchema.optional(),
  /** The section's language when it differs from the portfolio's `locale`. */
  lang: LanguageTagSchema.optional(),
};

type ExtensionsField = {
  extensions: z.ZodOptional<z.ZodType<Extensions, z.ZodTypeDef, unknown>>;
};

/** A strict object schema that may also carry `extensions`. */
export type ContentObject<T extends z.ZodRawShape> = z.ZodObject<T & ExtensionsField, 'strict'>;

/** The object schemas for one set of registered content extensions. */
export function makeParts(registry: ExtensionRegistry) {
  const extensions = makeExtensionsSchema(registry);

  function object<T extends z.ZodRawShape>(shape: T): ContentObject<T> {
    return z.object({ ...shape, extensions: extensions.optional() }).strict() as ContentObject<T>;
  }

  function section<K extends string, T extends z.ZodRawShape>(kind: K, shape: T) {
    return object({ kind: z.literal(kind), ...sectionBase, ...shape });
  }

  const Link = object({
    platform: z.string().optional(),
    url: UrlSchema,
    label: z.string().optional(),
  });

  const Image = object({
    src: ImageSourceSchema,
    alt: z.string().optional(),
    width: z.number().finite().int().positive().optional(),
    height: z.number().finite().int().positive().optional(),
    credit: z.string().optional(),
    focalPoint: object({
      x: z.number().finite().min(0).max(1),
      y: z.number().finite().min(0).max(1),
    }).optional(),
  });

  const Period = object({ start: LooseDateSchema, end: LooseDateSchema.optional() }).refine(
    inOrder,
    { message: 'ends before it starts: end must not precede start.' },
  );

  return { registry, extensions, object, section, Link, Image, Period };
}

export type SchemaParts = ReturnType<typeof makeParts>;
export type Link = z.infer<SchemaParts['Link']>;
export type Image = z.infer<SchemaParts['Image']>;
export type Period = z.infer<SchemaParts['Period']>;
