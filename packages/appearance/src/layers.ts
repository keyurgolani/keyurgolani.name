// The cascade layers (#19, Slice 2, item 1). Every layered stylesheet, each
// compiled pack's, the platform stylesheet, #7's experience-base.css, and
// variant stylesheets, starts with LAYER_ORDER, so the first stylesheet a
// page loads fixes the order and loading another can't change it.

/** The layers, lowest first: a later layer's rules win over an earlier one's. */
export const APPEARANCE_LAYERS = [
  'reset',
  'scheme',
  'language',
  'typography',
  'variant-layout',
  'utilities',
  'accessibility',
] as const;
export type AppearanceLayer = (typeof APPEARANCE_LAYERS)[number];

/** The statement every layered stylesheet starts with. */
export const LAYER_ORDER =
  '@layer reset, scheme, language, typography, variant-layout, utilities, accessibility;';

/**
 * Whether `css` starts with LAYER_ORDER: nothing but whitespace and
 * comments comes before it.
 */
export function startsWithLayerOrder(css: string): boolean {
  let index = 0;
  for (;;) {
    while (index < css.length && /\s/.test(css[index]!)) index += 1;
    if (!css.startsWith('/*', index)) break;
    const end = css.indexOf('*/', index + 2);
    if (end < 0) return false;
    index = end + 2;
  }
  return css.startsWith(LAYER_ORDER, index);
}
