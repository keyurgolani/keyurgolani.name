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
//   blur, translucency, texture, and glow drop. Every language token that
//   offsets a part, such as a press's translate(), or draws a shadow is
//   none, since a language can't test forced colors itself.
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
//   alone, and forced colors map its color to Highlight. A composition may
//   set --color-focus and --ui-focus-offset on its own bands and parts (row
//   73, COMPOSITION_SETTABLE); under forced colors its color gives way here.
//
// The shared primitives' rules (Slice 3, ../primitives/styles.css) join the
// reset and utilities layers here, so they read the same tokens and every
// setting above reaches them.
//
// The shared scales (../scales: space, type steps, widths, grid, and motion)
// are declared in the reset layer, so a composition's own --layout-grid-*,
// --layout-width-*, and --layout-motion-* values win; the widths, the grid,
// and the --motion-* durations are registered with @property, so each
// computes once on the boundary. Reduced motion and the pause set the
// --motion-* durations a composition reads from the accessibility layer,
// and they, print, and a runtime root that isn't active pause its ambient
// loops through --motion-ambient-state.

import { readFileSync } from 'node:fs';
import { LANGUAGE_GRAMMARS } from '../language-grammar';
import { LAYER_ORDER } from '../layers';
import {
  AMBIENT_PAUSED,
  propertyRules,
  REDUCED_MOTION_TOKENS,
  scaleDeclarations,
  STATIC_MOTION_TOKENS,
} from '../scales';
import { LANGUAGE_KEYS, type ColorRole } from '../tokens';
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

/** The marker a disclosure asks for with data-marker="chevron" (../primitives/styles.css). */
const CHEVRON = "[data-marker='chevron'] > [data-ui-slot='disclosure.summary']::after";

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
  'on-emphasis': 'HighlightText',
  // The ring on an inverse ground, text-primary's CanvasText: the inverse pair's own ink.
  'focus-inverse': 'Canvas',
  'surface-lit': 'Canvas',
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

/**
 * The visitor's Appearance control, its summary and its open panel with the form, actions and
 * status in it, under prefers-contrast: more and prefers-reduced-transparency: reduce (the lead's
 * ruling, 2026-11-01): opaque surface-default, its text the scheme's text-primary, so the text
 * reads at the gate's high-contrast 7:1 and its 4.5:1 there, whatever the composition puts behind
 * it (Aurora's sky measured 2.31:1 and 2.22:1). Every other mode leaves it as it was: where it
 * sits, and on what, is the composition's.
 */
const APPEARANCE_CONTROL = [
  `${BOUNDARY} [data-ui-slot="appearance-control"]`,
  `${BOUNDARY} [data-ui-slot="appearance-control"] [data-ui-slot="disclosure.summary"]`,
];

const CONTROL_SURFACE = {
  'background-color': 'var(--color-surface-default)',
  'background-image': 'none',
  color: 'var(--color-text-primary)',
};

/**
 * The ground's room round the control's parts for their focus rings, which draw outside each
 * part at the language's offset: a ring's width past the ring, so it lies whole on the opaque
 * ground and not on what's behind (Aurora's summary measured a 2px ring's perimeter short there).
 * And the ring in that ground's own ink, its text-primary, which reads on surface-default past
 * the ring's 3:1: a focus color the control inherits from a region round it (K-2's surface hook)
 * is that region's pair, not the plate's (on-accent was white on the plate in Terra Field's
 * accent footer, 0 of 576 changed pixels at 3:1 under prefers-contrast: more).
 */
const CONTROL_RING_ROOM = {
  padding: 'calc(2 * var(--ui-focus-width) + max(0px, var(--ui-focus-offset)))',
  '--color-focus': 'var(--color-text-primary)',
};

/**
 * Every language token that offsets a part or draws a shadow, from the
 * token contract's grammars (../language-grammar): a key whose grammar takes
 * a translate() moves the part, as a press does, and one whose grammar takes
 * a shadow draws one. Both grammars take none, each one's zero. A language
 * can't test forced colors (its stylesheet's lint refuses preference media),
 * so the forced-colors block zeroes them all, and a key added with either
 * grammar is zeroed with no edit here. --ui-focus-offset places the focus
 * ring, not the part, so it stays.
 */
const FORCED_FLAT_KEYS: readonly string[] = Object.freeze(
  LANGUAGE_KEYS.filter((key) =>
    ['translate(1px, 1px)', '1px 1px 0 var(--color-shadow)'].some((sample) =>
      LANGUAGE_GRAMMARS[key].accepts(sample),
    ),
  ),
);

const FORCED_EFFECTS = {
  ...OPAQUE,
  '--ui-surface-material':
    'linear-gradient(var(--color-surface-default), var(--color-surface-default))',
  ...Object.fromEntries(FORCED_FLAT_KEYS.map((key) => [`--ui-${key}`, 'none'])),
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

/**
 * The surface hook (K-2): a region a composition marks
 * data-ui-surface, on a ground other than the canvas and the surfaces, and
 * the pair that reads on that ground: its focus color, and the selection,
 * reversed, the ground's text on that ground's own color. An accent ground
 * takes on-accent, held to 4.5:1 on it; an emphasis ground on-emphasis, 4.58:1
 * at least; and an inverse ground, text-primary, focus-inverse, 3.5:1 (4.5:1 in
 * high contrast), with text-inverse behind its selected text.
 */
export const SURFACE_HOOKS: readonly {
  readonly surface: 'accent' | 'inverse' | 'emphasis';
  readonly focus: ColorRole;
  /** Selected text on the ground: the background, then the text. */
  readonly selection: readonly [ColorRole, ColorRole];
}[] = Object.freeze([
  { surface: 'accent', focus: 'on-accent', selection: ['on-accent', 'accent'] },
  { surface: 'inverse', focus: 'focus-inverse', selection: ['text-inverse', 'text-primary'] },
  { surface: 'emphasis', focus: 'on-emphasis', selection: ['on-emphasis', 'emphasis'] },
]);

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
    block([BOUNDARY], scaleDeclarations()),
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
    // The surface hook: inside a marked region, the focus color and a
    // selection are the region's own pair, so neither falls under its
    // contrast on the fill. Mark the region, not a control: the region's own
    // ring, outside it, takes the pair too.
    ...SURFACE_HOOKS.flatMap(({ surface, focus, selection: [ground, text] }) => {
      const region = `${BOUNDARY} [data-ui-surface='${surface}']`;
      return [
        block([region], { '--color-focus': `var(--color-${focus})` }),
        block([`${region}::selection`, `${region} ::selection`], {
          color: `var(--color-${text})`,
          'background-color': `var(--color-${ground})`,
        }),
      ];
    }),
    // On a status fill the focus color can fall under 3:1 (WCAG 2.4.7, 1.4.11). on-status
    // is held to every status fill, so a control focused inside one rings in it.
    block([`${BOUNDARY} [data-ui-slot='toast'][data-status] [data-ui-slot]:focus-visible`], {
      'outline-color': 'var(--color-on-status)',
    }),
    wrap(
      '@media (prefers-reduced-motion: reduce)',
      block([BOUNDARY], { ...REDUCED_MOTION, ...REDUCED_MOTION_TOKENS }),
    ),
    block([`${BOUNDARY}[data-motion="reduced"]`], { ...REDUCED_MOTION, ...REDUCED_MOTION_TOKENS }),
    block([`${BOUNDARY}[data-motion="static"]`], { ...STATIC, ...STATIC_MOTION_TOKENS }),
    // A runtime root that isn't active (#6: the visitor's pause, a hidden
    // tab, offscreen) pauses the ambient loops inside it too (K-4 b).
    block(
      [`${BOUNDARY}[data-activity="paused"]`, `${BOUNDARY} [data-activity="paused"]`],
      AMBIENT_PAUSED,
    ),
    // A disclosure's chevron turns at the fast duration, which reduced motion
    // keeps for feedback; its turn is movement, so it stops, as hover lifts do.
    wrap(
      '@media (prefers-reduced-motion: reduce)',
      block([`${BOUNDARY} ${CHEVRON}`], { transition: 'none' }),
    ),
    block(
      [
        `${BOUNDARY}[data-motion="reduced"] ${CHEVRON}`,
        `${BOUNDARY}[data-motion="static"] ${CHEVRON}`,
      ],
      {
        transition: 'none',
      },
    ),
    wrap(
      '@media (prefers-reduced-transparency: reduce)',
      block([BOUNDARY], OPAQUE) +
        block(APPEARANCE_CONTROL, CONTROL_SURFACE) +
        block([APPEARANCE_CONTROL[0]!], CONTROL_RING_ROOM),
    ),
    wrap(
      '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))',
      block([BOUNDARY], OPAQUE),
    ),
    block(
      [`${BOUNDARY}[data-display-mode="high-contrast"]`, `${BOUNDARY}[data-contrast="more"]`],
      HIGH_CONTRAST,
    ),
    wrap(
      '@media (prefers-contrast: more)',
      block([BOUNDARY], HIGH_CONTRAST) +
        block(APPEARANCE_CONTROL, CONTROL_SURFACE) +
        block([APPEARANCE_CONTROL[0]!], CONTROL_RING_ROOM),
    ),
    // Under forced colors every element inside a boundary inherits its focus color, so the ring
    // is the system color the boundary maps it to, or a surface hook's or the control plate's
    // (which this rule's selector doesn't outweigh), never a color a composition set on a band
    // or a part in an earlier layer (row 73: COMPOSITION_SETTABLE's --color-focus). It comes
    // first, so a nested boundary's own map, as specific, still wins on that boundary.
    wrap(
      '@media (forced-colors: active)',
      block([`${BOUNDARY} *`], { '--color-focus': 'inherit' }) +
        block([BOUNDARY], { ...forced, ...FORCED_EFFECTS, 'scrollbar-color': 'auto' }) +
        // The scheme's thumb and track give way to the system's, on the root as in a boundary.
        block([':root'], { 'scrollbar-color': 'auto' }),
    ),
    // A Surface's level is a background image, which forced colors drop, over a transparent
    // color: Canvas keeps it opaque, and an overlay's edge shows in CanvasText, since its
    // shadow goes too (EE's Contents sheet found it, C's EE-LANG H1).
    wrap(
      '@media (forced-colors: active)',
      block([`${BOUNDARY} [data-ui-slot="surface"]`], { 'background-color': 'Canvas' }) +
        block([`${BOUNDARY} [data-ui-slot="surface"][data-emphasis="overlay"]`], {
          border: '1px solid CanvasText',
        }),
    ),
    wrap(
      '@media print',
      block([BOUNDARY], {
        ...OPAQUE,
        ...STATIC,
        ...STATIC_MOTION_TOKENS,
        '--ui-texture': 'none',
      }),
    ),
  ].join('');
  return [
    LAYER_ORDER,
    '/* The platform stylesheet, compiled by @portfolio/appearance. */',
    propertyRules().trimEnd(),
    wrap('@layer reset', `${reset}\n${layerRules(PRIMITIVES, 'reset')}`).trimEnd(),
    wrap('@layer utilities', `${utilities}\n${layerRules(PRIMITIVES, 'utilities')}`).trimEnd(),
    wrap('@layer accessibility', accessibility),
  ].join('\n');
}

/** The platform stylesheet as the file registry generation writes: `_platform.<sha256-12>.css`. */
export function compilePlatform(): PackFile {
  return packFile('_platform', 'css', new TextEncoder().encode(platformStylesheet()));
}
