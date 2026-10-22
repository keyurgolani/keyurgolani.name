// Id, language-tag, and extension-kind rules, kept free of zod and yaml so
// the kit and the variants can use them without bundling the schemas.

/**
 * Section ids: lowercase letters and digits in hyphen-separated words, at most
 * 64 characters, unique within the portfolio. The id is the rendered section's
 * DOM id and the anchor navigation links to, so it can't be `main`, which every
 * variant gives its `<main>` element. Record ids, media ids, and slugs follow
 * the same rule, and every id is unique across the whole document.
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

/**
 * What `mintId` makes an id for: a section, one of the records, or a media
 * asset. An untitled one gets `<kind>-<n>`.
 */
export type IdKind = 'section' | 'work' | 'evidence' | 'chronology' | 'media' | 'item';

/**
 * Text as an id's words: accents folded (é to e), lowercased, every run of
 * other characters a hyphen, and no hyphen at either end.
 */
export function slugifyTitle(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * An id for something new (#10, item 3), shared by Studio and the CLI: the
 * slugified title, cut at a hyphen to fit 64 characters, or `<kind>-<n>` when
 * the title has no letter or digit an id can use. It takes the first free
 * `-2`, `-3`, ... suffix when `existingIds` has it, or it's `main`. Ids are
 * minted once, when something is created or migrated, and never at load.
 */
export function mintId(
  kind: IdKind,
  title: string | undefined,
  existingIds: Iterable<string>,
): string {
  const taken = new Set(existingIds);
  const free = (id: string) => !taken.has(id) && !RESERVED_SECTION_IDS.includes(id);
  const base = slugifyTitle(title ?? '');
  if (base === '') {
    for (let n = 1; ; n++) {
      const id = `${kind}-${n}`;
      if (free(id)) return id;
    }
  }
  const first = fitId(base, '');
  if (free(first)) return first;
  for (let n = 2; ; n++) {
    const id = fitId(base, `-${n}`);
    if (free(id)) return id;
  }
}

/** `base` plus `suffix` in 64 characters, cutting `base` at a hyphen when it must. */
export function fitId(base: string, suffix: string): string {
  const room = SECTION_ID_MAX_LENGTH - suffix.length;
  if (base.length <= room) return `${base}${suffix}`;
  const cut = base.slice(0, room + 1).lastIndexOf('-');
  const kept = cut > 0 ? base.slice(0, cut) : base.slice(0, room);
  return `${kept.replace(/-+$/, '')}${suffix}`;
}

/** A work's case-study route. */
export function workPath(slug: string): string {
  return `/work/${slug}`;
}

/**
 * The id of #5's fallback composition, which renders in place of a variant
 * this build doesn't register. The build registers it, but a site can't
 * select it.
 */
export const FALLBACK_VARIANT_ID = 'fallback';

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
