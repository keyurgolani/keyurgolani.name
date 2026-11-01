// The shared scales the redesigned compositions build on (redesign dossier
// G1, G3, G4, G6, T2 to T4, M2, M3): one fluid space scale, the section
// rhythm on it, fluid type steps, named layout widths and grid tokens, and
// the motion slots. The platform stylesheet declares them on every boundary
// (./node/platform), so a composition reads them and never writes a length,
// a size, or a duration of its own. The kit's shared renderers read the
// space scale, the rhythm, and the text width; each composition adopts the
// rest in its redesign.
//
// Who may change what:
// - `--space-*`, `--rhythm-*`, and `--type-step-*` are the platform's
//   alone. A variant declares --layout-* properties only, and a typography pack its role
//   fields only, so there's one space scale and one step scale.
// - `--layout-grid-*`, `--layout-width-*`, `--layout-measure-scale`, and
//   `--layout-motion-*` are defaults in the reset layer. A composition's own
//   declaration, in the variant-layout layer, wins, so each one sets its
//   columns, gutter, margin, widths, measure scale, house curve, and
//   durations, in its root rule alone (the source audit holds that), so
//   they compute on the boundary, where a profile's measures read the scale.
// - `--motion-*` is what a composition's rules read for motion: the
//   platform's, from the composition's slots, the language, and the
//   visitor's reduced-motion setting.
// - `--type-<role>-fluid-size` and `--type-<role>-size-adjust` put each
//   typography role on a step. The roles' own --type-<role>-font-size, which
//   the profiles set, still sizes every page today. A typography pack may
//   set a role's size-adjust within SIZE_ADJUST_RANGE, in its own layer,
//   which wins over the platform's SIZE_ADJUST.
//
// Every fluid value is a clamp() between two rem lengths, preferred
// `<rem> + <vw>`: never vw alone, so zooming grows it (WCAG 1.4.4). Its
// largest is at most 2.5 times its smallest, so whatever the window, 500%
// zoom takes it past twice its size. scales.test.ts holds that, and the
// zoom at which each step first doubles at a 1280 px window.

import type { TypographyRole } from './roles';

// The motion slots' bands are the variant contract's (K-5 round 5), so the third-party CSS
// audit checks a slot against the same numbers this package's source audit does.
export { MOTION_BANDS } from '@portfolio/variant-contract';

/** The window widths, in CSS px, over which every fluid value grows from its smallest to its largest. */
export const FLUID_RANGE = Object.freeze({ min: 360, max: 1240 });

/** The root font size the rem lengths assume, in CSS px. */
const ROOT_PX = 16;

/** Step 0 of the space and type scales, in CSS px: at FLUID_RANGE.min and at FLUID_RANGE.max. */
export const BASE = Object.freeze({ min: 18, max: 20 });

/** A fluid value's two ends, in CSS px: at FLUID_RANGE.min and at FLUID_RANGE.max. */
export interface FluidPx {
  readonly min: number;
  readonly max: number;
}

/** Rounded to four places, without trailing zeros. */
function round(value: number): string {
  const text = value.toFixed(4).replace(/\.?0+$/, '');
  return text === '-0' ? '0' : text;
}

/**
 * The clamp() that grows linearly from `min` px at FLUID_RANGE.min to `max`
 * px at FLUID_RANGE.max and holds either end beyond them: rem bounds, and a
 * preferred term of rem plus vw.
 */
export function fluid({ min, max }: FluidPx): string {
  const slope = (max - min) / (FLUID_RANGE.max - FLUID_RANGE.min);
  const intercept = min - slope * FLUID_RANGE.min;
  const low = Math.min(min, max) / ROOT_PX;
  const high = Math.max(min, max) / ROOT_PX;
  if (slope === 0) return `${round(low)}rem`;
  const sign = slope < 0 ? '-' : '+';
  return `clamp(${round(low)}rem, ${round(intercept / ROOT_PX)}rem ${sign} ${round(Math.abs(slope * 100))}vw, ${round(high)}rem)`;
}

/** The space steps, smallest first, each a multiple of BASE (G3). */
export const SPACE_STEPS = Object.freeze([
  ['3xs', 0.25],
  ['2xs', 0.5],
  ['xs', 0.75],
  ['s', 1],
  ['m', 1.5],
  ['l', 2],
  ['xl', 3],
  ['2xl', 4],
  ['3xl', 6],
] as const);
export type SpaceStep = (typeof SPACE_STEPS)[number][0];

/**
 * The fluid pairs: from the first step's smallest to the second's largest,
 * for gutters (s-l) and section padding (l-2xl, xl-3xl), which need to
 * grow more than one step does.
 */
export const SPACE_PAIRS = Object.freeze([
  ['s', 'l'],
  ['l', '2xl'],
  ['xl', '3xl'],
] as const);

const factorOf = (step: SpaceStep): number => SPACE_STEPS.find(([name]) => name === step)![1];

/** A space step's ends, in CSS px. */
export function spacePx(step: SpaceStep): FluidPx {
  const factor = factorOf(step);
  return { min: BASE.min * factor, max: BASE.max * factor };
}

/** A pair's ends, in CSS px: the first step's smallest and the second's largest. */
export function pairPx(from: SpaceStep, to: SpaceStep): FluidPx {
  return { min: spacePx(from).min, max: spacePx(to).max };
}

export const spaceProperty = (step: SpaceStep) => `--space-${step}` as const;
export const pairProperty = (from: SpaceStep, to: SpaceStep) => `--space-${from}-${to}` as const;

/**
 * The section rhythm (G4): the space a page puts between its parts, by the
 * part's role, as multiples of BASE at the narrow end and the wide one. A
 * chapter opens a region (the work, the proof, the history, a way to get in
 * touch); a section follows another in the same region; a group is a
 * section that belongs with the one before it, such as Now and what the
 * owner is focused on; an item is one entry in a list; and head is the
 * space below a heading. Adjacent roles are at least 25% apart at every
 * width, and the space above a section's heading is more than twice the
 * head below it. The parent stack sets them, never the part itself.
 */
export const RHYTHM_ROLES = Object.freeze([
  ['chapter', 7, 9.6],
  ['section', 4.5, 6.4],
  ['group', 2.25, 3.2],
  ['item', 4 / 3, 2],
  ['head', 1, 1],
] as const);
export type RhythmRole = (typeof RHYTHM_ROLES)[number][0];

/** A rhythm role's ends, in CSS px: 126 to 192 for a chapter, 18 to 20 for head. */
export function rhythmPx(role: RhythmRole): FluidPx {
  const [, min, max] = RHYTHM_ROLES.find(([name]) => name === role)!;
  return { min: BASE.min * min, max: BASE.max * max };
}

export const rhythmProperty = (role: RhythmRole) => `--rhythm-${role}` as const;

/**
 * The type steps, a modular scale on BASE: each step is the last times 1.175
 * at the narrow end and 1.25 at the wide one, so headings close up on a
 * phone and open out on a wide screen. Step 7, the display step, tops out
 * under DISPLAY_CEILING; steps stop at -1, since anything smaller falls
 * under 13 px (T5).
 */
export const TYPE_STEPS = Object.freeze([-1, 0, 1, 2, 3, 4, 5, 6, 7] as const);
export type TypeStep = (typeof TYPE_STEPS)[number];
export const TYPE_RATIO = Object.freeze({ min: 1.175, max: 1.25 });

/** The largest display size, in CSS px: 6rem (T3). */
export const DISPLAY_CEILING_PX = 96;

/** A type step's ends, in CSS px. */
export function stepPx(step: TypeStep): FluidPx {
  return {
    min: BASE.min * TYPE_RATIO.min ** step,
    max: Math.min(BASE.max * TYPE_RATIO.max ** step, DISPLAY_CEILING_PX),
  };
}

/** `--type-step-0`, `--type-step-7`, and `--type-step--1` for step -1. */
export const stepProperty = (step: TypeStep) => `--type-step-${step}` as const;

/**
 * The step each typography role sits on. Display is at least 4.5 times
 * body at the wide end, the contrast regime's floor (T1).
 */
export const ROLE_STEPS = Object.freeze({
  display: 7,
  headline: 3,
  title: 1,
  body: 0,
  'body-compact': -1,
  label: -1,
  caption: -1,
  quote: 1,
  code: -1,
  numeric: -1,
} as const satisfies Readonly<Record<string, TypeStep>>);

/**
 * The aspect every role's font-size-adjust holds, so a family swapped in at
 * runtime keeps the x-height the layout was set with (T2).
 */
export const SIZE_ADJUST = 0.5;

/**
 * The aspects a typography pack may set a role's font-size-adjust to, in
 * place of SIZE_ADJUST (packs-plan 7.5): a face with a small x-height, such
 * as Newsreader's 0.426, would otherwise render 1.174 times its size. The
 * range keeps a pack's x-height between 0.9 and 1.12 times the one the
 * layout was set with.
 */
export const SIZE_ADJUST_RANGE = Object.freeze({ min: 0.45, max: 0.56 });

/** `--type-body-size-adjust`, the aspect a role's font-size-adjust reads. */
export const sizeAdjustProperty = (role: TypographyRole) => `--type-${role}-size-adjust` as const;

/**
 * The body face's own aspect, its x-height per em, which a typography
 * profile sets where its compiler knows it (R11.1): Newsreader's 0.426,
 * Inter's 0.5459.
 */
export const BODY_ASPECT = '--type-body-aspect';

/**
 * What a profile's measures are multiplied by, 1 unless the composition
 * says otherwise (R11.1). The measures count characters of the body face
 * at its font-size; a composition that applies font-size-adjust renders
 * that face at its aspect over the face's own, so it sets this, in its
 * root rule, to `calc(var(--type-body-size-adjust) / var(--type-body-aspect))`,
 * and the measures count characters as they render.
 */
export const MEASURE_SCALE = '--layout-measure-scale';

/** The named widths a composition sets an element to, narrowest first (G6). */
export const LAYOUT_WIDTHS = Object.freeze({
  /** Running text: the typography profile's body measure, its characters of the boundary's own body text. */
  text: 'var(--type-measure-body)',
  /** Figures and pull quotes that stand out past the text on either side. */
  outset: 'calc(var(--layout-width-text) + 2 * var(--space-2xl))',
  /** Everything else on the page. */
  page: '80rem',
  /** The whole width of whatever holds the element. */
  screen: '100%',
} as const);
export type LayoutWidth = keyof typeof LAYOUT_WIDTHS;

/** The grid a composition puts its chrome, headings, and media on (G1). */
export const LAYOUT_GRID = Object.freeze({
  columns: '12',
  gutter: 'var(--space-s-l)',
  margin: 'var(--space-s-l)',
} as const);

/**
 * A composition's motion (M3): one house curve, feedback (hover, press,
 * toggle) in a 150 to 300 ms band, and scene (an entrance, a reveal, a
 * transition between views) in a 600 to 1000 ms band. Ambient (K-4 b) is
 * one cycle of a loop that runs while the page shows, such as a sky's
 * drift, a bead's travel, or blobs that merge, in a 20 to 60 s band: slow
 * enough to read as weather, not as an event. A composition sets these to
 * say what it wants; it reads --motion-* (MOTION_TOKENS), which the
 * platform works out from them.
 */
export const MOTION_SLOTS = Object.freeze({
  curve: 'var(--ui-motion-easing)',
  feedback: '200ms',
  scene: '800ms',
  ambient: '40s',
} as const);
export type MotionSlot = keyof typeof MOTION_SLOTS;

/**
 * How many times a design language's fast duration a composition's
 * duration may run. A language that moves has a fast duration of 80 ms or
 * more, so this never binds; a still one has 0.01 ms, so its compositions
 * stay still too, at 1 ms.
 */
export const STILL_FACTOR = 100;

/**
 * What a composition's rules read for motion, which the platform declares
 * on the boundary from the composition's slots and the language: the
 * curve as set, and each duration no longer than STILL_FACTOR times the
 * language's fast one. Being worked out on the boundary, a slot a
 * composition sets anywhere but its root reaches none of them.
 *
 * The ambient cycle is the slot as set, with no such cap: a loop's cycle
 * is never a language's duration, so only the pause, reduced motion, and
 * a static page gate it, through --motion-ambient-state, which a loop
 * reads as its animation-play-state. Running by default; paused under
 * them, holding the loop's first frame, which is its still.
 */
export const MOTION_TOKENS = Object.freeze({
  '--motion-curve': 'var(--layout-motion-curve)',
  '--motion-feedback': `min(var(--layout-motion-feedback), calc(var(--ui-motion-fast) * ${STILL_FACTOR}))`,
  '--motion-scene': `min(var(--layout-motion-scene), calc(var(--ui-motion-fast) * ${STILL_FACTOR}))`,
  '--motion-ambient': 'var(--layout-motion-ambient)',
  '--motion-ambient-state': 'running',
});

/**
 * Under reduced motion only a short fade is left (M2): both durations are
 * the language's fast one, which the pack gate holds to
 * quality/thresholds.json's reduced-motion limit, and a paused or printed
 * page has none. Ambient loops stop under all three. The accessibility
 * layer declares them, over the reset's, and pauses ambient loops in a
 * runtime root that isn't active (the visitor's pause, a hidden tab, or
 * offscreen) with AMBIENT_PAUSED.
 */
export const REDUCED_MOTION_TOKENS = Object.freeze({
  '--motion-feedback': 'var(--ui-motion-fast)',
  '--motion-scene': 'var(--ui-motion-fast)',
  '--motion-ambient-state': 'paused',
});
export const STATIC_MOTION_TOKENS = Object.freeze({
  '--motion-feedback': '0s',
  '--motion-scene': '0s',
  '--motion-ambient-state': 'paused',
});
export const AMBIENT_PAUSED = Object.freeze({ '--motion-ambient-state': 'paused' });

/**
 * The scale properties registered with @property, so each computes once,
 * on the boundary, and inherits as a length or a time: a width in em, as
 * the compiler resolves a measure, is the boundary's body text's, whatever
 * text reads it. A width that can't
 * be worked out, such as a measure no profile sets, is 100%, no limit, as
 * before there was one; a percentage a composition sets stays one.
 */
export const REGISTERED = Object.freeze({
  '--layout-width-text': { syntax: '<length-percentage>', initial: '100%' },
  '--layout-width-outset': { syntax: '<length-percentage>', initial: '100%' },
  '--layout-width-page': { syntax: '<length-percentage>', initial: '100%' },
  '--layout-width-screen': { syntax: '<length-percentage>', initial: '100%' },
  '--layout-grid-columns': { syntax: '<integer>', initial: '12' },
  '--layout-grid-gutter': { syntax: '<length-percentage>', initial: '0px' },
  '--layout-grid-margin': { syntax: '<length-percentage>', initial: '0px' },
  '--layout-measure-scale': { syntax: '<number>', initial: '1' },
  '--motion-feedback': { syntax: '<time>', initial: '0s' },
  '--motion-scene': { syntax: '<time>', initial: '0s' },
  '--motion-ambient': { syntax: '<time>', initial: '0s' },
} as const);

/** The @property rules for REGISTERED. */
export function propertyRules(): string {
  return Object.entries(REGISTERED)
    .map(
      ([name, { syntax, initial }]) =>
        `@property ${name} {\n  syntax: '${syntax}';\n  inherits: true;\n  initial-value: ${initial};\n}\n`,
    )
    .join('');
}

/** The custom properties a composition may set in its root rule alone: the grid, the widths, the measure scale, and the motion slots. */
export const ROOT_ONLY = /^--layout-(?:grid|width|measure|motion)-/;

/** Every custom property the scales declare, by name, with its value, in declaration order. */
export function scaleDeclarations(): Readonly<Record<string, string>> {
  const declarations: Record<string, string> = {};
  for (const [step] of SPACE_STEPS) declarations[spaceProperty(step)] = fluid(spacePx(step));
  for (const [from, to] of SPACE_PAIRS)
    declarations[pairProperty(from, to)] = fluid(pairPx(from, to));
  for (const [role] of RHYTHM_ROLES) declarations[rhythmProperty(role)] = fluid(rhythmPx(role));
  for (const step of TYPE_STEPS) declarations[stepProperty(step)] = fluid(stepPx(step));
  declarations['--type-display-ceiling'] = `${DISPLAY_CEILING_PX / ROOT_PX}rem`;
  for (const [role, step] of Object.entries(ROLE_STEPS)) {
    declarations[`--type-${role}-fluid-size`] = `var(${stepProperty(step)})`;
    declarations[sizeAdjustProperty(role as TypographyRole)] = String(SIZE_ADJUST);
  }
  for (const [name, value] of Object.entries(LAYOUT_GRID))
    declarations[`--layout-grid-${name}`] = value;
  for (const [name, value] of Object.entries(LAYOUT_WIDTHS))
    declarations[`--layout-width-${name}`] = value;
  declarations[MEASURE_SCALE] = '1';
  for (const [name, value] of Object.entries(MOTION_SLOTS))
    declarations[`--layout-motion-${name}`] = value;
  Object.assign(declarations, MOTION_TOKENS);
  return declarations;
}
