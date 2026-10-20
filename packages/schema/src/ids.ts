// Id, language-tag, and extension-kind rules, kept free of zod and yaml so
// the kit and the variants can use them without bundling the schemas.

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

/**
 * An npm package name, scoped or not, as npm accepts it for new packages. A
 * content extension's package name is its namespace, both as the key of its
 * `extensions` entries and as the first part of its section kinds.
 */
export const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9-][a-z0-9._-]*\/)?[a-z0-9-][a-z0-9._-]*$/;
export const PACKAGE_NAME_MAX_LENGTH = 214;

export function isPackageName(value: string): boolean {
  return value.length <= PACKAGE_NAME_MAX_LENGTH && PACKAGE_NAME_PATTERN.test(value);
}

/** The name in an extension section kind, after the package name. */
export const EXTENSION_SECTION_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Splits an extension section kind, `<package name>/<name>` such as
 * `@acme/portfolio-photography/exhibitions`, or returns null for any other
 * string, the core kinds included.
 */
export function parseExtensionKind(kind: string): { namespace: string; name: string } | null {
  const slash = kind.lastIndexOf('/');
  if (slash <= 0) return null;
  const namespace = kind.slice(0, slash);
  const name = kind.slice(slash + 1);
  return isPackageName(namespace) && EXTENSION_SECTION_NAME_PATTERN.test(name)
    ? { namespace, name }
    : null;
}

/** Whether a section comes from a content extension rather than the core kinds. */
export function isExtensionSection<S extends { readonly kind: string }>(
  section: S,
): section is Extract<S, { readonly kind: `${string}/${string}` }> {
  return parseExtensionKind(section.kind) !== null;
}
