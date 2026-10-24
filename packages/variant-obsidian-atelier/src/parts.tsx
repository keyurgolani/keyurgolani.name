import type { VariantRenderInput } from '@portfolio/variant-contract';

// What the composition's own pieces share: its own ids, and the language
// of the words it adds.

/**
 * The id of one of the composition's own elements. Two hyphens: no content
 * id has them, so no section or record can take one.
 */
export const ownId = (input: Pick<VariantRenderInput, 'ids'>, name: string) =>
  `${input.ids.prefix}oa--${name}`;

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
