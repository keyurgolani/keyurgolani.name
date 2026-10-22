// The contract's own versions (#5, Slice 1). A host accepts manifests of its
// major up to its own minor, and additive fields bump the minor.

/** The variant contract this package defines. */
export const CONTRACT_VERSION = '2.0';
export const CONTRACT_MAJOR = 2;
export const CONTRACT_MINOR = 0;

/**
 * The appearance token contract a variant or appearance pack builds against:
 * #19's tokens, which @portfolio/appearance defines and re-exports this from.
 */
export const TOKEN_CONTRACT_VERSION = 1;

/** `major.minor`, or null when the text isn't one. */
export function parseContractVersion(value: string): { major: number; minor: number } | null {
  const match = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/.exec(value);
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}
