/**
 * Serializes a JSON-LD block for an inline <script type="application/ld+json">.
 * It writes `<`, `>`, and `&` as the JSON unicode escapes for U+003C, U+003E,
 * and U+0026, so no portfolio text can close the script element or open a
 * comment in it, and JSON.parse still returns the same value.
 */
export function jsonLdScript(block: object): string {
  return JSON.stringify(block)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
