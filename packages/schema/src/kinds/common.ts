import { z } from 'zod';
import {
  isLanguageTag,
  RESERVED_SECTION_IDS,
  SECTION_ID_MAX_LENGTH,
  SECTION_ID_PATTERN,
} from '../ids';

export const LinkSchema = z.object({
  platform: z.string().optional(),
  url: z.string(),
  label: z.string().optional(),
});
export type Link = z.infer<typeof LinkSchema>;

export const ImageSchema = z.object({
  src: z.string(),
  alt: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  credit: z.string().optional(),
  focalPoint: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
});
export type Image = z.infer<typeof ImageSchema>;

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

export const PeriodSchema = z
  .object({
    start: LooseDateSchema,
    end: LooseDateSchema.optional(),
  })
  .refine(
    ({ start, end }) => {
      if (!end) return true;
      const startN = looseDateOrder(start);
      const endN = looseDateOrder(end);
      if (startN == null || endN == null) return true;
      return endN >= startN;
    },
    { message: 'ends before it starts: end must not precede start.' },
  );
export type Period = z.infer<typeof PeriodSchema>;

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

const SectionBase = {
  /** Required and unique within the portfolio. See SECTION_ID_PATTERN. */
  id: SectionIdSchema,
  title: z.string().optional(),
  subtitle: z.string().optional(),
  /** The section's language when it differs from the portfolio's `locale`. */
  lang: LanguageTagSchema.optional(),
  /** Until hiding moves to the site document's `sections.<id>.hidden`. */
  hidden: z.boolean().optional(),
};

export { SectionBase };
