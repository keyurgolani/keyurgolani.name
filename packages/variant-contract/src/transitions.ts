// K-4 (a): cross-document view transitions, a manifest opt-in (contract 2.1).
// A variant declares `transitions: { crossDocument: true, names: [...] }`.
// The host then writes `@view-transition { navigation: auto; }` into that
// variant's compiled stylesheet, outside every cascade layer, and into no
// other variant's: the compiled stylesheet is linked only on the pages that
// variant renders, never in Studio's chrome. A variant never writes
// @view-transition itself, which the at-rule list refuses (./at-rules).
//
// The host's rules come in three motions, all unlayered, so they win over
// the variant's own, every one of which is in variant-layout, and the audit
// refuses !important:
// - Full motion: the page's own root crossfade, ::view-transition-group(root),
//   -old(root) and -new(root), runs at the language's --ui-motion-fast (the
//   group too, so the overlay that holds pointer input ends with the fade), and each named
//   group moves as the variant's stylesheet animates it.
// - Reduced, under `prefers-reduced-motion: reduce` or the document
//   boundary's data-motion `reduced` (the site's reduce policy, or a
//   preview's): nothing moves or resizes. Every group and image pair runs no
//   animation, and every old and new image, root or named, fades by opacity
//   alone over --ui-motion-fast, in the host's own keyframes, which take the
//   place of whatever the variant gave them, such as a wipe or a clip-path.
// - Static, under data-motion `static` (the pause): no pseudo-element runs
//   an animation, so the transition ends on its first frame, an instant cut.
//
// The host's keyframes start with HOST_KEYFRAMES_PREFIX, `_portfolio-vt-`,
// which no variant's keyframes can (they start with the variant's id, a
// lowercase letter), and the audit refuses a variant that names them.
//
// `names` are the view-transition-name values the variant's stylesheet may
// give its elements and the names its ::view-transition-group(),
// -image-pair(), -old(), and -new() rules may target: each `<id>-` and a
// lowercase name, unique, and at most MAX_TRANSITION_NAMES of them, since
// every named element is a snapshot the browser takes on each navigation.

/** The contract minor that adds `transitions`: 2.1. */
export const TRANSITIONS_MINOR = 1;

/** The most names a manifest's `transitions.names` holds. */
export const MAX_TRANSITION_NAMES = 8;

/** The longest a transition name may be, its `<id>-` prefix included. */
export const MAX_TRANSITION_NAME_LENGTH = 64;

/**
 * A transition name's shape: a CSS ident of lowercase letters, digits, and
 * hyphens, starting with a letter, with no escape, so it reads one way to
 * the audit and to a browser. A prefixed name is never `none`, `auto`,
 * `match-element`, or `root`, the keywords and the name the browser gives
 * the document's root.
 */
export const TRANSITION_NAME_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;

/** The view-transition pseudo-elements a variant's stylesheet may target, by one of its names. */
export const TRANSITION_PSEUDO_ELEMENTS = [
  'view-transition-group',
  'view-transition-image-pair',
  'view-transition-old',
  'view-transition-new',
] as const;

/** What's wrong with a transition name for the variant `id`, or undefined when it's fine. */
export function transitionNameProblem(id: string, name: string): string | undefined {
  if (!TRANSITION_NAME_PATTERN.test(name)) {
    return 'must be lowercase letters, digits, and hyphens, starting with a letter and ending with a letter or a digit, such as <id>-hero.';
  }
  if (!name.startsWith(`${id}-`) || name.length === id.length + 1) {
    return `must start with ${id}- and name something after it, such as ${id}-hero, so no other stylesheet on the page shares it.`;
  }
  if (name.length > MAX_TRANSITION_NAME_LENGTH) {
    return `must be at most ${MAX_TRANSITION_NAME_LENGTH} characters.`;
  }
  return undefined;
}

/**
 * The names a manifest opts in to, or null when it doesn't opt in to
 * cross-document view transitions: no `transitions`, or crossDocument false.
 */
export function transitionNames(manifest: {
  readonly transitions?: { readonly crossDocument: boolean; readonly names: readonly string[] };
}): readonly string[] | null {
  const transitions = manifest.transitions;
  return transitions?.crossDocument === true ? transitions.names : null;
}

/** The prefix of the host's own keyframes, which no variant's id, a lowercase letter first, can start. */
export const HOST_KEYFRAMES_PREFIX = '_portfolio-vt-';

/** The host's opacity fades, which every old and new image runs under reduced motion. */
export const HOST_KEYFRAMES = {
  fadeOut: `${HOST_KEYFRAMES_PREFIX}fade-out`,
  fadeIn: `${HOST_KEYFRAMES_PREFIX}fade-in`,
} as const;

/** The document boundary under the site's reduce policy, or a reduced preview. */
const REDUCED_DOCUMENT = ':root:has([data-appearance-boundary="document"][data-motion="reduced"])';
/** The document boundary under the pause. */
const STATIC_DOCUMENT = ':root:has([data-appearance-boundary="document"][data-motion="static"])';

/** Each of `pseudos`, of any name, after `root`, one to a line. */
const every = (root: string, pseudos: readonly string[]) =>
  pseudos.map((pseudo) => `${root}::${pseudo}(*)`).join(',\n');

/** The reduced rules after `root`, indented by `pad`: opacity alone, over the language's fast duration. */
const reduced = (root: string, pad: string) =>
  [
    `${every(root, ['view-transition-group', 'view-transition-image-pair'])} {`,
    '  animation: none;',
    '}',
    `${root}::view-transition-old(*) {`,
    `  animation: var(--ui-motion-fast) ease both ${HOST_KEYFRAMES.fadeOut};`,
    '}',
    `${root}::view-transition-new(*) {`,
    `  animation: var(--ui-motion-fast) ease both ${HOST_KEYFRAMES.fadeIn};`,
    '}',
  ]
    .join('\n')
    .split('\n')
    .map((line) => `${pad}${line}`)
    .join('\n');

/**
 * What the host writes after an opted-in variant's layered rules: the
 * @view-transition rule, the root crossfade at --ui-motion-fast, the host's
 * two fades, the opacity-only crossfade under reduced motion, and the
 * instant cut under the pause, in that order.
 */
export const HOST_VIEW_TRANSITION_CSS = [
  '@view-transition {',
  '  navigation: auto;',
  '}',
  '::view-transition-group(root),',
  '::view-transition-old(root),',
  '::view-transition-new(root) {',
  '  animation-duration: var(--ui-motion-fast);',
  '}',
  `@keyframes ${HOST_KEYFRAMES.fadeOut} {`,
  '  to {',
  '    opacity: 0;',
  '  }',
  '}',
  `@keyframes ${HOST_KEYFRAMES.fadeIn} {`,
  '  from {',
  '    opacity: 0;',
  '  }',
  '}',
  '@media (prefers-reduced-motion: reduce) {',
  reduced('', '  '),
  '}',
  reduced(REDUCED_DOCUMENT, ''),
  `${every(STATIC_DOCUMENT, TRANSITION_PSEUDO_ELEMENTS)} {`,
  '  animation: none;',
  '}',
].join('\n');
