// What the composition's own pieces share: its own ids, and the language
// of the words it adds. Browser-safe, so the controller reads the same ids
// the server writes.

/**
 * The id of one of the composition's own elements. Two hyphens: no content
 * id has them, so no section or record can take one.
 */
export const ownId = (prefix: string, name: string) => `${prefix}hc--${name}`;

/** `en` when the portfolio isn't in English, for the words the composition adds, such as Index. */
export function uiLang(locale: string): 'en' | undefined {
  return /^en(?:-|$)/i.test(locale) ? undefined : 'en';
}

/** A word or phrase the composition adds, marked English in a portfolio in another language. */
export function Words({ lang, children }: { lang: 'en' | undefined; children: string }) {
  return lang ? <span lang={lang}>{children}</span> : <>{children}</>;
}
