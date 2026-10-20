// Id and language-tag rules, kept free of zod and yaml so client code (the
// kit's section ids) can use them without bundling the schemas.

/**
 * Section ids: lowercase letters and digits in hyphen-separated words, at most
 * 64 characters, unique within the portfolio. The id is the rendered section's
 * DOM id and the anchor navigation links to, so it can't be `main`, which every
 * variant gives its `<main>` element.
 */
export const SECTION_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SECTION_ID_MAX_LENGTH = 64;
export const RESERVED_SECTION_IDS: readonly string[] = ['main'];

export function isSectionId(value: string): boolean {
  return (
    value.length <= SECTION_ID_MAX_LENGTH &&
    SECTION_ID_PATTERN.test(value) &&
    !RESERVED_SECTION_IDS.includes(value)
  );
}

/** A BCP 47 language tag, such as `en` or `pt-BR`: one Intl.getCanonicalLocales accepts. */
export function isLanguageTag(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}
