// The contract's own versions (#5, Slice 1). A host accepts manifests of its
// major up to its own minor, and additive fields bump the minor.

/**
 * The variant contract this package defines. 2.1 (K-4) adds the render
 * input's resolved appearance packs, `input.appearance`, and K-4's motion
 * slots; a 2.0 manifest still registers. K-4 (a) and (d), and K-5's
 * kitLayout, add manifest fields under 2.1 too, which a 2.1 host built
 * before them refuses, and so does K-3: the periodList and recordPlacement
 * control types, which a 2.1 host built before K-3 refuses as a schema
 * error on the control, and K-8: a contentRef of kinds ["media"], which one
 * built before K-8 refuses. K-5 also tightens the CSS audit under 2.1: a radius
 * or a shadow reads only a token the platform defines (PLATFORM_TOKENS in
 * ./tokens), a stylesheet declares nothing in the platform's namespaces,
 * and vendor-prefixed shadows and radii and named colors in image values
 * are held as their plain forms are. A third-party variant that read a
 * radius through a property of its own fails registration under the same
 * contract. K-5's third round tightens it again: a name written with a CSS
 * escape, `!important`, a stylesheet with a string, comment, or url() left
 * open, a duration of the variant's own, a font family that isn't a type
 * token or a generic family, and attr() outside a plain one in `content` are
 * refused. Its fifth reads a third party's CSS with PostCSS on a strict
 * grammar: no backslash anywhere, strings and url()s in a few quoted forms,
 * slots in their bands, system colors under forced colors, and no infinite
 * loop on a scaled UI token. Its sixth refuses a comment in a third party's
 * selector or at-rule prelude, reads every scope with comments out, and
 * refuses `~`, `+`, and a :has() starting with one on the scope's compound.
 * Its seventh takes six at-rules alone, @media, @supports, @layer,
 * @container, @keyframes, and @import (./at-rules), and a @supports
 * selector() of one pseudo compound.
 */
export const CONTRACT_VERSION = '2.1';
export const CONTRACT_MAJOR = 2;
export const CONTRACT_MINOR: number = 1;

/**
 * The appearance token contract a variant or appearance pack builds against.
 * @portfolio/appearance defines #19's tokens and re-exports this constant.
 */
export const TOKEN_CONTRACT_VERSION = 1;

/** `major.minor`, or null when the text isn't one. */
export function parseContractVersion(value: string): { major: number; minor: number } | null {
  const match = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/.exec(value);
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}
