// A scaffold's placeholder copy, which check:variants refuses (A2): a
// manifest whose promise or description still starts with "Replace this
// with" would put the scaffold's own instruction in Studio's picker and the
// catalog. new-variant.mjs writes it on purpose, so a fresh third-party
// scaffold fails until it's filled in; register-variant writes the promise
// and description it's given instead.

/** How new-variant.mjs's placeholder copy starts. */
export const PLACEHOLDER = 'Replace this with';

/** The manifest fields the rule reads. */
export const PLACEHOLDER_FIELDS = ['promise', 'description'] as const;

/** Each of the manifest's promise and description that still starts with the placeholder. */
export function placeholderFields(manifest: {
  readonly promise?: unknown;
  readonly description?: unknown;
}): (typeof PLACEHOLDER_FIELDS)[number][] {
  return PLACEHOLDER_FIELDS.filter((field) => {
    const value = manifest[field];
    return typeof value === 'string' && value.trimStart().startsWith(PLACEHOLDER);
  });
}
