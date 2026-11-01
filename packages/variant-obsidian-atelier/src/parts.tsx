import type { Period, Work } from '@portfolio/schema';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { mediumLabel, present } from './model';

// What the composition's own pieces share: its own ids, the language of
// the words it adds, and the few phrases a wall label is made of.

/**
 * The id of one of the composition's own elements. Two hyphens: no content
 * id has them, so no section or record can take one.
 */
export const ownId = (input: Pick<VariantRenderInput, 'ids'>, name: string) =>
  `${input.ids.prefix}oa--${name}`;

/**
 * A link to an element of the home page: its fragment on home, and home's
 * address with it on a work's own page, so the chrome, the plan, and the
 * colophon reach the same places from either.
 */
export function homeHref(input: VariantRenderInput, id: string): string {
  if (input.route.route === 'home') return `#${id}`;
  return `${routeHref(input, { route: 'home' })}#${id}`;
}

/** `en` when the portfolio isn't in English, for the words the composition adds, such as Index. */
export function uiLang(input: Pick<VariantRenderInput, 'portfolio'>): 'en' | undefined {
  return /^en(?:-|$)/i.test(input.portfolio.locale) ? undefined : 'en';
}

/** A word or phrase the composition adds, marked English in a portfolio in another language. */
export function Words({
  input,
  children,
}: {
  input: Pick<VariantRenderInput, 'portfolio'>;
  children: string;
}) {
  const lang = uiLang(input);
  return lang ? <span lang={lang}>{children}</span> : <>{children}</>;
}

/** Items joined as English joins them: "A", "A and B", "A, B, and C". */
export function joined(items: readonly string[]): string {
  return new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(items);
}

/** The year a loose date starts with, such as 2022 for 2022-01. */
export function yearOf(raw: string | undefined): string | undefined {
  return raw === undefined ? undefined : /^\d{4}/.exec(raw.trim())?.[0];
}

/** A period by its years: "since 2022", "2019 to 2021", or "2024". */
export function periodWords(period: Period | undefined): string | undefined {
  const start = yearOf(period?.start);
  if (start === undefined) return undefined;
  const end = yearOf(period?.end);
  if (period?.end === undefined || /^present$/i.test(period.end.trim())) return `since ${start}`;
  if (end === undefined || end === start) return start;
  return `${start} to ${end}`;
}

/**
 * A work's medium and when, folded into one line of its wall label, as a
 * gallery writes it: "Software, since 2022", "Writing, 2026".
 */
export function mediumLine(work: Work): string | undefined {
  const medium = mediumLabel(work);
  const when =
    periodWords(work.period) ?? yearOf(work.publishedAt) ?? yearOf(work.releasedAt) ?? undefined;
  const parts = [medium, when].filter(present);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/** An address as a line of text: no scheme, no leading www., no trailing slash. */
export function addressOf(url: string): string {
  return url
    .trim()
    .replace(/^(?:https?:\/\/(?:www\.)?|mailto:|tel:)/i, '')
    .replace(/\/$/, '');
}

/** "No. 4", or "Nos. 4 to 11" for a run. */
export function numbers(first: number, last = first): string {
  if (last <= first) return `No. ${first}`;
  return last === first + 1 ? `Nos. ${first} and ${last}` : `Nos. ${first} to ${last}`;
}
