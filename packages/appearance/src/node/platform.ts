// The platform stylesheet (#19, Slice 2, item 3): the reset, utilities, and
// accessibility layers every boundary shares. Accessibility rules override
// tokens, not rules: they set --color-* and --ui-* values on the boundary,
// so every primitive and language that reads the tokens follows, and the
// accessibility layer, last in LAYER_ORDER, wins over every pack.
//
// - OS reduced motion and data-motion="reduced": motion-fast feedback stays;
//   movement stops, entrances and exits fade, emphasis stops, and whatever
//   runs at motion-standard or motion-slow runs at motion-fast, which the
//   pack gate holds to quality/thresholds.json's reduced-motion limit (#11).
//   data-motion="static" (#6's pause) stops everything.
// - Forced colors: every color role maps to a system color, and shadows,
//   blur, translucency, texture, and glow drop.
// - Reduced transparency, and a browser without backdrop-filter: opaque
//   surfaces and no blur.
// - High contrast (the mode, data-contrast="more", or prefers-contrast:
//   more): the signature fill is solid text-primary, emphasis-glow none, and
//   no texture, since every high-contrast set draws border-subtle in the
//   text color and a texture's ink would stripe the text's own ground (#11).
// - Print: opaque, still, and untextured. Each scheme's stylesheet prints its
//   light set or its light high-contrast set, since only it has the values.
// - Focus (Slice 3): every focusable [data-ui-slot] part draws its ring here,
//   from the focus tokens and --color-focus, so no language stylesheet can
//   remove or hide it. A language shapes the ring through --ui-focus-*
//   alone, and forced colors map its color to Highlight.
//
// The shared primitives' rules (Slice 3, ../primitives/styles.css) join the
// reset and utilities layers here, so they read the same tokens and every
// setting above reaches them.

import { readFileSync } from 'node:fs';
import { LAYER_ORDER } from '../layers';
import type { ColorRole } from '../tokens';
import { packFile, type PackFile } from './compile';

/**
 * The shared primitives' stylesheet (#19, Slice 3), whose reset and
 * utilities rules join the platform's, so every boundary links one file and
 * the accessibility layer, last in LAYER_ORDER, overrides them too.
 */
const PRIMITIVES = readFileSync(new URL('../primitives/styles.css', import.meta.url), 'utf8');

/**
 * The rules of a stylesheet's `@layer <name> { ... }` block, one indent
 * less, for wrap() to put back inside the platform's own block. It throws
 * when the stylesheet has no such block.
 */
export function layerRules(css: string, layer: 'reset' | 'utilities'): string {
  // Comments blanked to spaces, so a brace in one can't end the block.
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  const opening = `\n@layer ${layer} {\n`;
  const start = text.indexOf(opening);
  if (start < 0) throw new Error(`The stylesheet has no @layer ${layer} block.`);
  let depth = 1;
  let index = start + opening.length;
  for (; index < text.length && depth > 0; index += 1) {
    if (text[index] === '{') depth += 1;
    else if (text[index] === '}') depth -= 1;
  }
  if (depth !== 0) throw new Error(`The stylesheet's @layer ${layer} block never closes.`);
  return `${css
    .slice(start + opening.length, index - 1)
    .split('\n')
    .map((line) => (line.startsWith('  ') ? line.slice(2) : line))
    .join('\n')
    .trim()}\n`;
}

const BOUNDARY = '[data-appearance-boundary]';

/** What can take focus: links, form controls, summaries, frames, and anything with a tabindex. */
const FOCUSABLE =
  'a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]';

/** Each role in forced colors: actions as buttons, focus and selection as highlights, the rest as canvas and text. */
const FORCED_COLORS: Readonly<Record<ColorRole, string>> = {
  canvas: 'Canvas',
  'surface-subtle': 'Canvas',
  'surface-default': 'Canvas',
  'surface-prominent': 'Canvas',
  'surface-overlay': 'Canvas',
  'text-primary': 'CanvasText',
  'text-secondary': 'CanvasText',
  'text-muted': 'CanvasText',
  'text-inverse': 'Canvas',
  'border-subtle': 'CanvasText',
  'border-default': 'CanvasText',
  'border-strong': 'CanvasText',
  accent: 'ButtonText',
  'accent-hover': 'ButtonText',
  'accent-active': 'ButtonText',
  'accent-text': 'LinkText',
  'on-accent': 'ButtonFace',
  focus: 'Highlight',
  selection: 'Highlight',
  positive: 'CanvasText',
  warning: 'CanvasText',
  danger: 'CanvasText',
  information: 'CanvasText',
  'on-status': 'Canvas',
  'data-categorical-1': 'CanvasText',
  'data-categorical-2': 'CanvasText',
  'data-categorical-3': 'CanvasText',
  'data-categorical-4': 'CanvasText',
  'data-categorical-5': 'CanvasText',
  'data-categorical-6': 'CanvasText',
  'data-sequential-start': 'CanvasText',
  'data-sequential-middle': 'CanvasText',
  'data-sequential-end': 'CanvasText',
  'signature-start': 'CanvasText',
  'signature-end': 'CanvasText',
  emphasis: 'Highlight',
  scrim: 'Canvas',
  'on-scrim': 'CanvasText',
  shadow: 'CanvasText',
};

const SOLID_TEXT = 'linear-gradient(var(--color-text-primary), var(--color-text-primary))';

/** The focus ring: the language's focus geometry, in the scheme's focus color. */
const FOCUS_RING = {
  outline: 'var(--ui-focus-width) var(--ui-focus-style) var(--color-focus)',
  'outline-offset': 'var(--ui-focus-offset)',
};

/**
 * Reduced motion: feedback stays, movement stops, entrances and exits fade,
 * and every duration is the language's fast one, so a toast's or a dialog's
 * fade, or a variant's standard transition, is as short as feedback (#11).
 */
export const REDUCED_MOTION: Readonly<Record<string, string>> = Object.freeze({
  '--ui-state-hover-transform': 'none',
  '--ui-state-active-transform': 'none',
  '--ui-motion-enter': 'fade',
  '--ui-motion-exit': 'fade',
  '--ui-motion-emphasis': 'none',
  '--ui-motion-standard': 'var(--ui-motion-fast)',
  '--ui-motion-slow': 'var(--ui-motion-fast)',
});

/** Paused: nothing moves or fades. */
const STATIC = {
  '--ui-motion-fast': '0s',
  '--ui-motion-standard': '0s',
  '--ui-motion-slow': '0s',
  '--ui-state-hover-transform': 'none',
  '--ui-state-active-transform': 'none',
  '--ui-motion-enter': 'none',
  '--ui-motion-exit': 'none',
  '--ui-motion-emphasis': 'none',
};

const OPAQUE = {
  '--ui-surface-opacity': '100%',
  '--ui-backdrop-blur': '0px',
};

const HIGH_CONTRAST = {
  '--ui-signature-fill': SOLID_TEXT,
  '--ui-emphasis-glow': 'none',
  '--ui-texture': 'none',
};

const FORCED_EFFECTS = {
  ...OPAQUE,
  '--ui-surface-material':
    'linear-gradient(var(--color-surface-default), var(--color-surface-default))',
  '--ui-shadow-card': 'none',
  '--ui-shadow-overlay': 'none',
  '--ui-shadow-raised': 'none',
  '--ui-shadow-inset': 'none',
  // HIGH_CONTRAST drops the texture too.
  ...HIGH_CONTRAST,
};

function block(
  selectors: readonly string[],
  declarations: Readonly<Record<string, string>>,
): string {
  return `${selectors.join(',\n')} {\n${Object.entries(declarations)
    .map(([property, value]) => `  ${property}: ${value};\n`)
    .join('')}}\n`;
}

function wrap(prelude: string, body: string): string {
  return `${prelude} {\n${body
    .split('\n')
    .map((line) => (line === '' ? line : `  ${line}`))
    .join('\n')}}\n`;
}

/** The platform stylesheet's text. */
export function platformStylesheet(): string {
  const reset = [
    block([BOUNDARY], {
      color: 'var(--color-text-primary)',
      'background-color': 'var(--color-canvas)',
      'accent-color': 'var(--color-accent)',
      'caret-color': 'var(--color-accent-text)',
      'font-family': 'var(--type-body-font-family)',
      'font-size': 'var(--type-body-font-size)',
      'font-weight': 'var(--type-body-font-weight)',
      'line-height': 'var(--type-body-line-height)',
      'letter-spacing': 'var(--type-body-letter-spacing)',
      'font-variation-settings': 'var(--type-body-font-variation-settings)',
      // A plate inside another boundary inherits none of its host's text treatment.
      'font-style': 'normal',
      'text-transform': 'none',
      'word-spacing': 'normal',
      'text-shadow': 'none',
      // A word longer than its line breaks rather than overflowing it (WCAG
      // 1.4.10). break-word leaves min-content sizing alone, so a table still
      // scrolls and a number stays whole wherever it fits.
      'overflow-wrap': 'break-word',
    }),
    block([`${BOUNDARY} ::selection`], {
      color: 'var(--color-text-primary)',
      'background-color': 'var(--color-selection)',
    }),
    // A variant with sticky chrome sets --layout-sticky-offset, so whatever a
    // fragment link or focus brings into view lands below the chrome (#19,
    // Slice 3).
    block([`${BOUNDARY} :is([id], ${FOCUSABLE})`], {
      'scroll-margin-top': 'var(--layout-sticky-offset, 0px)',
    }),
  ].join('');
  // Hidden stays hidden whatever display a variant or language gives the element.
  const utilities = block([`${BOUNDARY} [hidden]:not([hidden="until-found"])`], {
    display: 'none',
  });
  const forced = Object.fromEntries(
    Object.entries(FORCED_COLORS).map(([role, color]) => [`--color-${role}`, color]),
  );
  const accessibility = [
    block([`${BOUNDARY} [data-ui-slot]:focus-visible`], FOCUS_RING),
    // On a status fill the focus color can fall under 3:1 (WCAG 2.4.7, 1.4.11). on-status
    // is held to every status fill, so a control focused inside one rings in it.
    block([`${BOUNDARY} [data-ui-slot='toast'][data-status] [data-ui-slot]:focus-visible`], {
      'outline-color': 'var(--color-on-status)',
    }),
    wrap('@media (prefers-reduced-motion: reduce)', block([BOUNDARY], REDUCED_MOTION)),
    block([`${BOUNDARY}[data-motion="reduced"]`], REDUCED_MOTION),
    block([`${BOUNDARY}[data-motion="static"]`], STATIC),
    wrap('@media (prefers-reduced-transparency: reduce)', block([BOUNDARY], OPAQUE)),
    wrap(
      '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))',
      block([BOUNDARY], OPAQUE),
    ),
    block(
      [`${BOUNDARY}[data-display-mode="high-contrast"]`, `${BOUNDARY}[data-contrast="more"]`],
      HIGH_CONTRAST,
    ),
    wrap('@media (prefers-contrast: more)', block([BOUNDARY], HIGH_CONTRAST)),
    wrap('@media (forced-colors: active)', block([BOUNDARY], { ...forced, ...FORCED_EFFECTS })),
    wrap('@media print', block([BOUNDARY], { ...OPAQUE, ...STATIC, '--ui-texture': 'none' })),
  ].join('');
  return [
    LAYER_ORDER,
    '/* The platform stylesheet, compiled by @portfolio/appearance. */',
    wrap('@layer reset', `${reset}\n${layerRules(PRIMITIVES, 'reset')}`).trimEnd(),
    wrap('@layer utilities', `${utilities}\n${layerRules(PRIMITIVES, 'utilities')}`).trimEnd(),
    wrap('@layer accessibility', accessibility),
  ].join('\n');
}

/** The platform stylesheet as the file registry generation writes: `_platform.<sha256-12>.css`. */
export function compilePlatform(): PackFile {
  return packFile('_platform', 'css', new TextEncoder().encode(platformStylesheet()));
}
