import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AMBIENT_PAUSED,
  BASE,
  DISPLAY_CEILING_PX,
  FLUID_RANGE,
  fluid,
  LAYOUT_GRID,
  LAYOUT_WIDTHS,
  MOTION_BANDS,
  MOTION_SLOTS,
  MOTION_TOKENS,
  propertyRules,
  REDUCED_MOTION_TOKENS,
  REGISTERED,
  RHYTHM_ROLES,
  rhythmProperty,
  ROLE_STEPS,
  scaleDeclarations,
  SPACE_PAIRS,
  SPACE_STEPS,
  STATIC_MOTION_TOKENS,
  STILL_FACTOR,
  TYPE_STEPS,
  pairProperty,
  spaceProperty,
  stepProperty,
} from './scales';
import { TOKEN_PROPERTIES, TYPOGRAPHY_ROLES } from './tokens';

// The shared scales (redesign dossier G1, G3, G6, T2 to T4, M2, M3). These
// read the CSS the platform stylesheet declares, not the numbers it's made
// from, so a rounding or a sign the builder gets wrong shows here.

const declared = scaleDeclarations();

/** A fluid value as the platform writes it: rem, or clamp(rem, rem ± vw, rem). */
const CLAMP = /^clamp\((-?[\d.]+)rem, (-?[\d.]+)rem ([+-]) ([\d.]+)vw, (-?[\d.]+)rem\)$/;

/**
 * What `value` comes to, in CSS px, in a window `width` CSS px wide with a
 * `root` px root font size: the browser's own arithmetic for these forms.
 */
function resolve(value: string, width: number, root = 16): number {
  const fixed = /^(-?[\d.]+)rem$/.exec(value);
  if (fixed) return Number(fixed[1]) * root;
  const match = CLAMP.exec(value);
  assert.ok(match, `${value} is neither rem nor clamp(rem, rem ± vw, rem)`);
  const [, low, intercept, sign, slope, high] = match;
  const preferred =
    Number(intercept) * root + (sign === '-' ? -1 : 1) * (Number(slope) / 100) * width;
  return Math.min(Math.max(preferred, Number(low) * root), Number(high) * root);
}

/** Whether two px values agree to a hundredth of a px, which four places of rem hold. */
const near = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) < 0.01, `${what}: ${actual} px, not ${expected} px`);

const spaces = SPACE_STEPS.map(([step, factor]) => ({
  step,
  factor,
  css: declared[spaceProperty(step)]!,
}));
const steps = TYPE_STEPS.map((step) => ({ step, css: declared[stepProperty(step)]! }));
const pairs = SPACE_PAIRS.map(([from, to]) => ({
  from,
  to,
  css: declared[pairProperty(from, to)]!,
}));
const rhythms = RHYTHM_ROLES.map(([role, min, max]) => ({
  role,
  min,
  max,
  css: declared[rhythmProperty(role)]!,
}));
const fluidValues = [
  ...spaces.map(({ step, css }) => [spaceProperty(step), css] as const),
  ...pairs.map(({ from, to, css }) => [pairProperty(from, to), css] as const),
  ...rhythms.map(({ role, css }) => [rhythmProperty(role), css] as const),
  ...steps.map(({ step, css }) => [stepProperty(step), css] as const),
];
/** Window widths across and past the fluid range. */
const WIDTHS = [320, 360, 390, 600, 768, 1024, 1240, 1280, 1440, 2560];

test('every fluid value is a clamp() between rem lengths with a rem plus vw preferred term, never vw alone (T4)', () => {
  for (const [name, css] of fluidValues) {
    const match = CLAMP.exec(css);
    assert.ok(match, `${name}: ${css}`);
    assert.notEqual(Number(match[2]), 0, `${name} has no rem in its preferred term`);
    assert.ok(Number(match[4]) > 0, `${name} doesn't grow with the window`);
  }
});

test('the space steps are the base times 0.25 to 6, from 18 px at 360 px to 20 px at 1240 px, held beyond (G3)', () => {
  assert.deepEqual(
    SPACE_STEPS.map(([step]) => step),
    ['3xs', '2xs', 'xs', 's', 'm', 'l', 'xl', '2xl', '3xl'],
  );
  for (const { step, factor, css } of spaces) {
    near(resolve(css, FLUID_RANGE.min), BASE.min * factor, `${step} at 360`);
    near(resolve(css, FLUID_RANGE.max), BASE.max * factor, `${step} at 1240`);
    near(resolve(css, 320), BASE.min * factor, `${step} at 320`);
    near(resolve(css, 2560), BASE.max * factor, `${step} at 2560`);
  }
  near(resolve(declared['--space-s']!, 360), 18, 's at 360');
  near(resolve(declared['--space-s']!, 1240), 20, 's at 1240');
});

test('adjacent space steps are at least 25% apart at every width (G3)', () => {
  for (const width of WIDTHS) {
    for (let i = 1; i < spaces.length; i++) {
      const smaller = resolve(spaces[i - 1]!.css, width);
      const larger = resolve(spaces[i]!.css, width);
      assert.ok(
        larger / smaller >= 1.25 - 1e-9,
        `${spaces[i - 1]!.step} and ${spaces[i]!.step} at ${width}: ${smaller} and ${larger} px`,
      );
    }
  }
});

test('the fluid pairs run from the first step at 360 px to the second at 1240 px: s-l, l-2xl, xl-3xl (G3)', () => {
  assert.deepEqual(
    pairs.map(({ from, to }) => `${from}-${to}`),
    ['s-l', 'l-2xl', 'xl-3xl'],
  );
  const factor = Object.fromEntries(SPACE_STEPS);
  for (const { from, to, css } of pairs) {
    near(resolve(css, FLUID_RANGE.min), BASE.min * factor[from]!, `${from}-${to} at 360`);
    near(resolve(css, FLUID_RANGE.max), BASE.max * factor[to]!, `${from}-${to} at 1240`);
  }
  near(resolve(declared['--space-s-l']!, 360), 18, 's-l at 360');
  near(resolve(declared['--space-s-l']!, 1240), 40, 's-l at 1240');
});

test('the section rhythm runs chapter, section, group, item, and head, as multiples of the base (G4)', () => {
  assert.deepEqual(
    rhythms.map(({ role }) => role),
    ['chapter', 'section', 'group', 'item', 'head'],
  );
  for (const { role, min, max, css } of rhythms) {
    near(resolve(css, FLUID_RANGE.min), BASE.min * min, `${role} at 360`);
    near(resolve(css, FLUID_RANGE.max), BASE.max * max, `${role} at 1240`);
  }
  // The audit's ladder: 192, 128, 64, and 40 px on a wide screen, 20 below a heading.
  near(resolve(declared['--rhythm-chapter']!, 1440), 192, 'chapter at 1440');
  near(resolve(declared['--rhythm-section']!, 1440), 128, 'section at 1440');
  near(resolve(declared['--rhythm-group']!, 1440), 64, 'group at 1440');
  near(resolve(declared['--rhythm-item']!, 1440), 40, 'item at 1440');
  assert.equal(declared['--rhythm-head'], declared['--space-s']);
});

test('adjacent rhythm roles are at least 25% apart, and a section opens with more than twice the head below its heading, at every width (G4)', () => {
  for (const width of WIDTHS) {
    for (let i = 1; i < rhythms.length; i++) {
      const larger = resolve(rhythms[i - 1]!.css, width);
      const smaller = resolve(rhythms[i]!.css, width);
      assert.ok(
        larger / smaller >= 1.25 - 1e-9,
        `${rhythms[i - 1]!.role} and ${rhythms[i]!.role} at ${width}: ${larger} and ${smaller} px`,
      );
    }
    const head = resolve(declared['--rhythm-head']!, width);
    assert.ok(resolve(declared['--rhythm-group']!, width) >= 2 * head, `group at ${width}`);
  }
});

test('every value grows with the window and never shrinks (no step crosses another)', () => {
  for (const [name, css] of fluidValues) {
    for (let i = 1; i < WIDTHS.length; i++) {
      assert.ok(
        resolve(css, WIDTHS[i]!) >= resolve(css, WIDTHS[i - 1]!) - 1e-9,
        `${name} shrinks from ${WIDTHS[i - 1]} to ${WIDTHS[i]}`,
      );
    }
  }
  for (const width of WIDTHS) {
    for (let i = 1; i < steps.length; i++) {
      assert.ok(resolve(steps[i]!.css, width) > resolve(steps[i - 1]!.css, width));
    }
  }
});

test('the type steps are a modular scale on the base, 1.175 at 360 px and 1.25 at 1240 px, with display under 6rem (T3)', () => {
  for (const { step, css } of steps) {
    near(resolve(css, 360), 18 * 1.175 ** step, `step ${step} at 360`);
    near(
      resolve(css, 1240),
      Math.min(20 * 1.25 ** step, DISPLAY_CEILING_PX),
      `step ${step} at 1240`,
    );
  }
  const display = declared[stepProperty(ROLE_STEPS.display)]!;
  for (const width of WIDTHS) assert.ok(resolve(display, width) <= 96);
  assert.equal(declared['--type-display-ceiling'], '6rem');
});

test('no step is under 13 px anywhere, and body is at least 16 px (T5)', () => {
  for (const { step, css } of steps) {
    for (const width of WIDTHS) assert.ok(resolve(css, width) >= 13, `step ${step} at ${width}`);
  }
  const body = declared[stepProperty(ROLE_STEPS.body)]!;
  for (const width of WIDTHS) assert.ok(resolve(body, width) >= 16);
});

test('every typography role sits on a step, with display at least 4.5 times body at 1240 px (T1, T2)', () => {
  assert.deepEqual(Object.keys(ROLE_STEPS).sort(), [...TYPOGRAPHY_ROLES].sort());
  for (const role of TYPOGRAPHY_ROLES) {
    assert.equal(declared[`--type-${role}-fluid-size`], `var(${stepProperty(ROLE_STEPS[role])})`);
    assert.equal(declared[`--type-${role}-size-adjust`], '0.5');
  }
  const at = (role: keyof typeof ROLE_STEPS) =>
    resolve(declared[stepProperty(ROLE_STEPS[role])]!, 1240);
  assert.ok(at('display') / at('body') >= 4.5, `${at('display')} over ${at('body')}`);
  assert.ok(at('headline') > at('title') && at('title') > at('body'));
  // Mobile display is 0.5 to 0.6 of desktop (T5).
  const display = declared[stepProperty(ROLE_STEPS.display)]!;
  const ratio = resolve(display, 360) / resolve(display, 1240);
  assert.ok(ratio >= 0.5 && ratio <= 0.6, `display drops to ${ratio} on a phone`);
});

/**
 * How large `css` renders, in device px per CSS px of the unzoomed page, in
 * a window `window` px wide at browser zoom `zoom`: the page is window/zoom
 * CSS px wide, rem stays 16 CSS px, and each CSS px is `zoom` device px.
 */
const zoomed = (css: string, window: number, zoom: number) => zoom * resolve(css, window / zoom);

/** The first zoom, in steps of 25%, at which `css` renders at twice its unzoomed size in a `window` px window. */
function doublesAt(css: string, window: number): number {
  const unzoomed = resolve(css, window);
  for (let zoom = 1; zoom <= 5; zoom += 0.25) {
    if (zoomed(css, window, zoom) >= 2 * unzoomed - 1e-9) return zoom;
  }
  return Infinity;
}

test('every fluid value is at most 2.5 times its smallest, so 500% zoom doubles it in any window (WCAG 1.4.4, T4)', () => {
  for (const [name, css] of fluidValues) {
    const match = CLAMP.exec(css)!;
    assert.ok(Number(match[5]) <= 2.5 * Number(match[1]) + 1e-9, `${name}: ${css}`);
    for (const window of WIDTHS) {
      assert.ok(doublesAt(css, window) <= 5, `${name} never doubles in a ${window} px window`);
    }
  }
});

test('at a 1280 px window, body and every space step double by 250% zoom, and every type step by 400% (T4)', () => {
  for (const { step, css } of spaces) assert.ok(doublesAt(css, 1280) <= 2.5, `space ${step}`);
  for (const { step, css } of steps) {
    const at = doublesAt(css, 1280);
    assert.ok(at <= (step <= 0 ? 2.5 : 4), `step ${step} doubles at ${at * 100}%`);
  }
  // What 200% itself gives at 1280 px: the window is 640 CSS px wide, so a
  // value that grows with the window is short of twice. A rem value doubles.
  assert.equal(zoomed('1.25rem', 1280, 2), 2 * resolve('1.25rem', 1280));
  const body = declared[stepProperty(ROLE_STEPS.body)]!;
  assert.ok(zoomed(body, 1280, 2) / resolve(body, 1280) >= 1.85);
});

/** The first text-only zoom, in steps of 25%, a root of 16 px times it, at which `css` is twice its size at a 16 px root. */
function doublesAtRoot(css: string, window: number): number {
  const unzoomed = resolve(css, window);
  for (let zoom = 1; zoom <= 5; zoom += 0.25) {
    if (resolve(css, window, 16 * zoom) >= 2 * unzoomed - 1e-9) return zoom;
  }
  return Infinity;
}

test('text-only zoom, a larger root font size, doubles body and every space step by 250% and every type step by 400% at a 1280 px window', () => {
  for (const { step, css } of spaces) assert.ok(doublesAtRoot(css, 1280) <= 2.5, `space ${step}`);
  for (const { step, css } of steps) {
    const at = doublesAtRoot(css, 1280);
    assert.ok(at <= (step <= 0 ? 2.5 : 4), `step ${step} doubles at a ${at * 100}% root`);
  }
  // The vw term doesn't grow with the root, so a 200% root alone is short of twice.
  const body = declared[stepProperty(ROLE_STEPS.body)]!;
  assert.ok(resolve(body, 1280, 32) / resolve(body, 1280) >= 1.85);
});

test('fluid() writes a flat value as rem alone, and a shrinking one with a minus', () => {
  assert.equal(fluid({ min: 20, max: 20 }), '1.25rem');
  const shrinking = fluid({ min: 20, max: 16 });
  assert.match(shrinking, /^clamp\(1rem, [\d.]+rem - [\d.]+vw, 1\.25rem\)$/);
  near(resolve(shrinking, 360), 20, 'at 360');
  near(resolve(shrinking, 1240), 16, 'at 1240');
});

test('the grid, the named widths, and the motion slots are --layout-* defaults a composition can set (G1, G6, M3)', () => {
  assert.deepEqual(Object.keys(LAYOUT_WIDTHS), ['text', 'outset', 'page', 'screen']);
  assert.deepEqual(Object.keys(LAYOUT_GRID), ['columns', 'gutter', 'margin']);
  assert.deepEqual(Object.keys(MOTION_SLOTS), ['curve', 'feedback', 'scene', 'ambient']);
  assert.equal(declared['--layout-grid-gutter'], 'var(--space-s-l)');
  assert.equal(declared['--layout-width-text'], 'var(--type-measure-body)');
  assert.equal(declared['--layout-motion-curve'], 'var(--ui-motion-easing)');
  assert.deepEqual(MOTION_BANDS, {
    feedback: { min: 150, max: 300 },
    scene: { min: 600, max: 1000 },
    ambient: { min: 20_000, max: 60_000 },
  });
  // The defaults sit in their bands.
  assert.equal(declared['--layout-motion-feedback'], '200ms');
  assert.equal(declared['--layout-motion-scene'], '800ms');
  assert.equal(declared['--layout-motion-ambient'], '40s');
});

test("what a composition reads for motion is the platform's: its slots, no longer than a still language allows (M3)", () => {
  assert.equal(STILL_FACTOR, 100);
  for (const name of ['--motion-curve', '--motion-feedback', '--motion-scene'] as const) {
    assert.equal(declared[name], MOTION_TOKENS[name]);
  }
  assert.equal(declared['--motion-curve'], 'var(--layout-motion-curve)');
  assert.equal(
    declared['--motion-scene'],
    'min(var(--layout-motion-scene), calc(var(--ui-motion-fast) * 100))',
  );
  // Reduced motion leaves a short fade, and a pause none (M2); both stop an ambient loop (K-4 b).
  assert.deepEqual(REDUCED_MOTION_TOKENS, {
    '--motion-feedback': 'var(--ui-motion-fast)',
    '--motion-scene': 'var(--ui-motion-fast)',
    '--motion-ambient-state': 'paused',
  });
  assert.deepEqual(STATIC_MOTION_TOKENS, {
    '--motion-feedback': '0s',
    '--motion-scene': '0s',
    '--motion-ambient-state': 'paused',
  });
  assert.deepEqual(AMBIENT_PAUSED, { '--motion-ambient-state': 'paused' });
});

test("an ambient loop's cycle is the slot as set, which no language caps, and it runs until a gate pauses it (K-4 b)", () => {
  assert.equal(declared['--motion-ambient'], 'var(--layout-motion-ambient)');
  assert.equal(declared['--motion-ambient-state'], 'running');
  // A still language's fast duration caps feedback and scene, never the ambient cycle.
  assert.doesNotMatch(MOTION_TOKENS['--motion-ambient'], /--ui-motion-/);
  assert.deepEqual(REGISTERED['--motion-ambient'], { syntax: '<time>', initial: '0s' });
});

test('the widths, the grid, and the durations are registered, so each computes once on the boundary', () => {
  const rules = propertyRules();
  for (const [name, { syntax, initial }] of Object.entries(REGISTERED)) {
    assert.ok(name in declared, `${name} is registered but never declared`);
    assert.ok(
      rules.includes(
        `@property ${name} {\n  syntax: '${syntax}';\n  inherits: true;\n  initial-value: ${initial};\n}\n`,
      ),
      name,
    );
  }
  // A width that can't be worked out is no limit, and a percentage a composition sets stays one.
  for (const width of Object.keys(LAYOUT_WIDTHS)) {
    assert.deepEqual(REGISTERED[`--layout-width-${width}` as keyof typeof REGISTERED], {
      syntax: '<length-percentage>',
      initial: '100%',
    });
  }
  for (const name of Object.keys(declared).filter((one) => /^--layout-(?:width|grid)-/.test(one))) {
    assert.ok(name in REGISTERED, `${name} isn't registered`);
  }
});

test('the scales name no token contract 1 already has, and only the platform prefixes', () => {
  const names = Object.keys(declared);
  const contract = new Set(TOKEN_PROPERTIES);
  for (const name of names) {
    assert.ok(!contract.has(name), `${name} is already a pack's token`);
    assert.match(name, /^--(?:space-|rhythm-|type-|motion-|layout-(?:grid|width|measure|motion)-)/);
  }
  assert.equal(new Set(names).size, names.length);
});
