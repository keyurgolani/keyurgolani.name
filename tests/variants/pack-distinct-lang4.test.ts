import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { deltaE00 } from './ciede2000';
import {
  AXES,
  calibrateAxis,
  CLONE_RESOLUTION,
  colorDrift,
  DE00_SCALE,
  MISSING_DE00,
  describePackOutcome,
  describeRoles,
  familyPairControls,
  hexOf,
  judgePacks,
  judgePair,
  NEAR_DE00,
  perceptualOf,
  rankPairs,
  SCHEME_DE_ROLES,
  SCHEME_MODES,
  schemeDelta,
  schemeScore,
  schemeVector,
  withRenderedColors,
  type AxisPack,
  type PackControl,
  type PackPairScore,
  type SchemeSets,
  type SchemeThresholds,
  csv,
  EXCLUDED_LABEL,
  matrixRows,
  UNSCORABLE_LABEL,
  unscoredLines,
  unscoredRows,
} from './pack-distinct';

// LANG-4: the guard on the color schemes and the typographies, report only.

const near = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, message ?? `${actual} is not ${expected}`);

/** A set with every scored role one color, and `overrides` on top. */
const set = (color: string, overrides: Record<string, string> = {}) => ({
  ...Object.fromEntries(SCHEME_DE_ROLES.map((role) => [role, color])),
  ...overrides,
});

test('the scheme score reads the seven roles the lead named, in both base modes', () => {
  assert.deepEqual(
    [...SCHEME_DE_ROLES],
    [
      'canvas',
      'text-primary',
      'text-secondary',
      'accent',
      'surface-default',
      'surface-subtle',
      'surface-prominent',
    ],
  );
  assert.deepEqual([...SCHEME_MODES], ['light', 'dark']);
  assert.equal(AXES.colorScheme.perceptual, 'de');
  assert.equal(AXES.designLanguage.perceptual, 'px');
  assert.equal(AXES.typography.perceptual, 'px');
  assert.equal(AXES.colorScheme.file, 'schemes-distinct.json');
  assert.equal(AXES.typography.file, 'typography-distinct.json');
});

test('schemeDelta: each role’s ΔE00 in each mode, each mode’s mean, the worse mode’s over 50, and the roles under 2 flagged near', () => {
  const a: SchemeSets = { light: set('#ffffff'), dark: set('#000000') };
  assert.deepEqual(schemeDelta(a, a), {
    roles: Object.fromEntries(
      SCHEME_MODES.flatMap((mode) => SCHEME_DE_ROLES.map((role) => [`${mode}:${role}`, 0])),
    ),
    modes: { light: 0, dark: 0 },
    worst: 'light',
    mean: 0,
    score: 0,
    near: SCHEME_MODES.flatMap((mode) => SCHEME_DE_ROLES.map((role) => `${mode}:${role}`)),
  });
  // One role apart, black to white, in light: light's mean is 100 over 7 roles,
  // but dark is identical, and the worse mode decides.
  const b: SchemeSets = { light: set('#ffffff', { accent: '#000000' }), dark: set('#000000') };
  const delta = schemeDelta(a, b);
  assert.equal(Object.keys(delta.roles).length, 14);
  near(delta.roles['light:accent']!, 100);
  near(delta.modes.light!, Math.round((100 / 7) * 100) / 100);
  near(delta.modes.dark!, 0);
  assert.equal(delta.worst, 'dark');
  near(delta.mean, 0);
  near(delta.score, 0);
  assert.equal(delta.near.length, 13);
  assert.ok(!delta.near.includes('light:accent'));
  // Apart in both modes: the lesser mean decides.
  const both: SchemeSets = {
    light: set('#ffffff', { accent: '#000000' }),
    dark: set('#000000', { accent: '#ffffff', canvas: '#ffffff' }),
  };
  const apart = schemeDelta(a, both);
  assert.equal(apart.worst, 'light');
  near(apart.mean, Math.round((100 / 7) * 100) / 100);
  near(apart.score, Math.round((100 / 7 / DE00_SCALE) * 1000) / 1000);
  // A role just under 2 is near; one at 2 or over isn't.
  const c: SchemeSets = { light: set('#808080'), dark: set('#808080') };
  const d: SchemeSets = { light: set('#808080', { canvas: '#848484' }), dark: set('#808080') };
  const step = deltaE00('#808080', '#848484');
  assert.ok(step < NEAR_DE00, `a 4-step gray is ${step}`);
  assert.ok(schemeDelta(c, d).near.includes('light:canvas'));
  const e: SchemeSets = { light: set('#808080', { canvas: '#8c8c8c' }), dark: set('#808080') };
  assert.ok(deltaE00('#808080', '#8c8c8c') >= NEAR_DE00);
  assert.ok(!schemeDelta(c, e).near.includes('light:canvas'));
  // Symmetric.
  assert.deepEqual(schemeDelta(b, a), delta);
});

test('schemeDelta compares the modes both sides carry; a missing role is as far as can be, no shared mode the farthest', () => {
  const both: SchemeSets = { light: set('#ffffff'), dark: set('#000000') };
  const light: SchemeSets = { light: set('#ffffff') };
  const only = schemeDelta(both, light);
  assert.deepEqual(
    Object.keys(only.roles),
    SCHEME_DE_ROLES.map((role) => `light:${role}`),
  );
  assert.equal(only.score, 0, 'a "same" control compares the light mode alone');
  const missing = schemeDelta({ light: set('#ffffff') }, { light: { canvas: '#ffffff' } });
  near(missing.roles['light:accent']!, MISSING_DE00);
  assert.equal(DE00_SCALE, 50);
  assert.deepEqual(only.modes, { light: 0 });
  assert.equal(only.worst, 'light');
  assert.deepEqual(schemeDelta({ light: set('#ffffff') }, { dark: set('#ffffff') }), {
    roles: {},
    modes: {},
    worst: null,
    mean: MISSING_DE00,
    score: 1,
    near: [],
  });
});

test('a dark-only twin fails: its light mode far apart never rescues a dark mode under the line, as the average of the two did', () => {
  // Two schemes alike in dark, every role a step under 2 apart, and far apart in light.
  const darkA = set('#1a2a1a', { 'text-primary': '#e8f0e0', accent: '#80b088' });
  const darkB = set('#1c2c1c', { 'text-primary': '#eaf2e2', accent: '#82b28a' });
  const a: SchemeSets = { light: set('#ffffff', { 'text-primary': '#000000' }), dark: darkA };
  const b: SchemeSets = { light: set('#202060', { 'text-primary': '#ffff00' }), dark: darkB };
  const delta = schemeDelta(a, b);
  assert.equal(delta.worst, 'dark');
  assert.ok(delta.modes.dark! < 3.8, `dark ${delta.modes.dark}`);
  assert.ok(delta.modes.light! > 20, `light ${delta.modes.light}`);
  // Averaged over both modes, as the guard scored before the fix round, it would pass.
  const averaged = (delta.modes.light! + delta.modes.dark!) / 2;
  assert.ok(averaged / DE00_SCALE >= 0.076, `the average ${averaged} clears the line`);
  // Scored per mode, against the committed line, it fails.
  const lines = JSON.parse(
    readFileSync(new URL('./schemes-distinct.json', import.meta.url), 'utf8'),
  ) as { thresholds: SchemeThresholds };
  const outcome = judgePair(
    {
      a: 'x',
      b: 'y',
      viewport: 'desktop',
      px: 0.5,
      token: 0.5,
      ...schemeScore({ colors: a }, { colors: b }),
    },
    lines.thresholds,
  );
  assert.equal(outcome.fail, true);
  assert.deepEqual(outcome.reasons, ['alike:de']);
  assert.equal(outcome.deWorst, 'dark');
  // And the same pair with light and dark swapped fails the same way.
  const swapped = judgePair(
    {
      a: 'x',
      b: 'y',
      viewport: 'mobile',
      px: 0.5,
      token: 0.5,
      ...schemeScore(
        { colors: { light: a.dark, dark: a.light } },
        { colors: { light: b.dark, dark: b.light } },
      ),
    },
    lines.thresholds,
  );
  assert.equal(swapped.fail, true);
  assert.equal(swapped.deWorst, 'light');
});

test('a scheme pair carries its ΔE00 fields only when both packs carry colors', () => {
  const colors: SchemeSets = { light: set('#ffffff'), dark: set('#000000') };
  assert.deepEqual(schemeScore({}, { colors }), {});
  const both = schemeScore({ colors }, { colors });
  assert.equal(both.de, 0);
  assert.equal(both.deMean, 0);
  assert.equal(Object.keys(both.deRoles!).length, 14);
});

test('rendered colors read as hex: hex as is, three digits expanded, rgb() and rgba() rounded, anything else null', () => {
  assert.equal(hexOf('#A1B2C3'), '#a1b2c3');
  assert.equal(hexOf(' #abc '), '#aabbcc');
  assert.equal(hexOf('rgb(255, 0, 16)'), '#ff0010');
  assert.equal(hexOf('rgba(1.6, 2, 3, 0.5)'), '#020203');
  assert.equal(hexOf('rgb(10 20 30)'), '#0a141e');
  assert.equal(hexOf('color-mix(in srgb, red, blue)'), null);
  assert.equal(hexOf(''), null);
});

test('a scheme scores what it renders: rendered colors replace the registered ones, and a missing render or role is a problem', () => {
  const pack = (id: string): AxisPack => ({
    id,
    family: 'neutral',
    vector: schemeVector({}),
  });
  const rendered = {
    seeded: { light: set('#ffffff'), dark: set('#000000') },
    half: { light: { canvas: '#ffffff' }, dark: set('#000000') },
  };
  const { packs, problems } = withRenderedColors(
    [pack('seeded'), pack('half'), pack('none')],
    rendered,
  );
  assert.deepEqual(packs[0]!.colors, rendered.seeded);
  assert.ok(Object.keys(packs[0]!.vector.tokens).length > 0, 'its token vector reads the render');
  assert.equal(packs[2]!.colors, undefined);
  assert.deepEqual(problems, [
    `half light computed no ${SCHEME_DE_ROLES.filter((role) => role !== 'canvas').join(', ')}`,
    'none rendered no colors',
  ]);
  assert.deepEqual(
    colorDrift(
      { light: { canvas: '#ffffff', accent: '#000000' } },
      { light: { canvas: '#ffffff', accent: '#111111' } },
    ),
    { 'light:accent': ['#000000', '#111111'] },
  );
});

const DE_LINES: SchemeThresholds = {
  de: { alike: { desktop: 0.1, mobile: 0.1 }, clone: { desktop: 0.01, mobile: 0.01 } },
  token: { alike: { desktop: 0.05, mobile: 0.05 }, clone: { desktop: 0.001, mobile: 0.001 } },
};

const deScore = (de: number, token: number, px = 0): PackPairScore => ({
  a: 'x',
  b: 'y',
  viewport: 'desktop',
  px,
  token,
  de,
  deMean: de * 100,
  deRoles: { 'light:canvas': de * 100 },
  near: de * 100 < NEAR_DE00 ? ['light:canvas'] : [],
});

test('on a scheme the ΔE00 score takes the edges’ place: it decides, and the edges are never judged', () => {
  assert.equal(perceptualOf(DE_LINES), 'de');
  // Identical edges never fail a scheme pair, and different edges never pass one.
  const apart = judgePair(deScore(0.3, 0.2, 0), DE_LINES);
  assert.equal(apart.fail, false);
  assert.equal(apart.pxAlike, null);
  assert.equal(apart.pxClone, false);
  assert.equal(apart.decidedBy, 'de');
  const alike = judgePair(deScore(0.05, 0.2, 0.9), DE_LINES);
  assert.deepEqual(alike.reasons, ['alike:de']);
  assert.equal(alike.deAlike, true);
  near(alike.alikeness, 0.5);
  assert.deepEqual(judgePair(deScore(0.005, 0.0005), DE_LINES).reasons, [
    'clone:de',
    'clone:token',
    'alike:de',
  ]);
  assert.equal(
    judgePair(deScore(0.3, 0.01), DE_LINES).fail,
    false,
    'tokens alone saying alike pass, as with the edges',
  );
  // Tokens decide only while ΔE00 has no alike line.
  const tokenOnly: SchemeThresholds = { ...DE_LINES, de: { ...DE_LINES.de, alike: null } };
  const byTokens = judgePair(deScore(0.3, 0.01), tokenOnly);
  assert.equal(byTokens.decidedBy, 'token');
  assert.deepEqual(byTokens.reasons, ['alike:token']);
  // A scheme pair with no ΔE00 under ΔE00 lines is a broken input, not a pass.
  assert.throws(
    () => judgePair({ a: 'x', b: 'y', viewport: 'desktop', px: 0, token: 0.5 }, DE_LINES),
    /no ΔE00 score/,
  );
});

test('the report line names ΔE00 and its mean, each role with the near ones marked, and the dropped edges', () => {
  const outcome = judgePair(deScore(0.015, 0.2, 0.004), DE_LINES);
  const line = describePackOutcome(outcome, DE_LINES);
  assert.match(
    line,
    /^x and y at desktop: FAIL alike:de; ΔE00 0\.015 \(mean ΔE00 1\.50\) \(decides: alike < 0\.1/,
  );
  assert.match(line, /edges 0\.004 \(dropped on this axis, never scored\)/);
  assert.match(line, /per-role ΔE00: light:canvas 1\.50 \(near\)/);
  assert.match(line, /near \(under 2\): light:canvas/);
  assert.equal(describeRoles({ deRoles: { 'dark:accent': 3 }, near: [] }), 'dark:accent 3.00');
});

test('the ranked list puts ΔE00 clones first, then the most alike, then the nearest colors', () => {
  const scores = [
    { ...deScore(0.08, 0.2), a: 'p', b: 'q' },
    { ...deScore(0.005, 0.2), a: 'r', b: 's' },
    { ...deScore(0.04, 0.2), a: 't', b: 'u' },
    { ...deScore(0.5, 0.2), a: 'v', b: 'w' },
  ];
  const verdict = judgePacks({
    ids: ['p', 'q'],
    scores,
    thresholds: DE_LINES,
  });
  assert.equal(verdict.outcomes.length, 1, 'judgePacks reads only the pairs of its ids');
  const ranked = rankPairs(scores.map((score) => judgePair(score, DE_LINES)));
  assert.deepEqual(
    ranked.map(({ a }) => a),
    ['r', 't', 'p', 'v'],
  );
});

test('a scheme calibrates ΔE00 and the tokens by distinct’s procedure, with no edge line at all', () => {
  const control = (
    viewport: 'desktop' | 'mobile',
    roles: PackControl['roles'],
    de: number,
    token: number,
  ): PackControl => ({ a: 'a', b: 'b', control: 'c', viewport, roles, px: 0.9, de, token });
  const controls: PackControl[] = [];
  for (const viewport of ['desktop', 'mobile'] as const) {
    controls.push(control(viewport, { px: 'informational', de: 'same', token: 'same' }, 0, 0));
    controls.push(
      control(viewport, { px: 'informational', de: 'same', token: 'same' }, 0.004, 0.002),
    );
    controls.push(control(viewport, { de: 'different' }, 0.2, 0.01));
    controls.push(control(viewport, { de: 'different' }, 0.3, 0.02));
    controls.push(control(viewport, { token: 'different' }, 0.01, 0.15));
  }
  const { calibration, thresholds } = calibrateAxis(controls, 'de');
  assert.ok(!('px' in thresholds), 'no edge line');
  assert.deepEqual(calibration.de.alike.desktop, {
    same: 0.004,
    different: 0.2,
    gap: 0.196,
    threshold: 0.102,
  });
  assert.deepEqual(thresholds.de.clone, { desktop: 0.008, mobile: 0.008 });
  assert.deepEqual(thresholds.token.alike, { desktop: 0.076, mobile: 0.076 });
  assert.deepEqual(thresholds.token.clone, { desktop: 0.004, mobile: 0.004 });
  // A control with a ΔE00 role and no ΔE00 score is a broken input.
  assert.throws(
    () =>
      calibrateAxis(
        [
          {
            a: 'a',
            b: 'b',
            control: 'c',
            viewport: 'desktop',
            roles: { de: 'same' },
            px: 0,
            token: 0,
          },
        ],
        'de',
      ),
    /has a de role and no de score/,
  );
  // The edges' calibration is unchanged when the axis names none.
  const edges = calibrateAxis(
    controls.map((each) => ({
      ...each,
      roles: { px: each.roles.de, token: each.roles.token },
      px: each.de!,
    })),
  );
  assert.deepEqual(edges.thresholds.px.alike, { desktop: 0.102, mobile: 0.102 });
  assert.ok(edges.thresholds.px.clone.desktop >= CLONE_RESOLUTION);
});

test('the "different" controls on ΔE00 are each family pair’s median cross pair, as for the other scores', () => {
  const packs = [
    { id: 'a1', family: 'earthy' },
    { id: 'a2', family: 'earthy' },
    { id: 'b1', family: 'vivid' },
    { id: 'b2', family: 'vivid' },
  ];
  const de: Record<string, number> = { 'a1 b1': 0.1, 'a1 b2': 0.4, 'a2 b1': 0.2, 'a2 b2': 0.3 };
  const controls = familyPairControls(packs, (a, b) => de[`${a} ${b}`]);
  assert.deepEqual(controls, [
    { families: ['earthy', 'vivid'], a: 'a2', b: 'b1', value: 0.2, pairs: 4 },
  ]);
});

test('the scheme and typography JSONs pin Spatial Bento and enforce (the LANG-5 enforcement commit), and the design languages still only report', () => {
  for (const axis of ['colorScheme', 'typography'] as const) {
    const json = JSON.parse(readFileSync(new URL(`./${AXES[axis].file}`, import.meta.url), 'utf8'));
    assert.equal(json.axis, axis);
    assert.equal(json.enforced, true, `${axis} enforces`);
    assert.equal(json.composition, 'spatial-bento');
    assert.equal(json.pinned, true);
    const perceptual = AXES[axis].perceptual;
    assert.ok(json.thresholds[perceptual], `${axis} carries its ${perceptual} line`);
    assert.equal(json.thresholds[perceptual === 'de' ? 'px' : 'de'], undefined);
    for (const score of [perceptual, 'token']) {
      assert.ok(json.thresholds[score].clone.desktop >= CLONE_RESOLUTION);
      assert.ok(json.thresholds[score].clone.mobile >= CLONE_RESOLUTION);
    }
  }
  // designLanguage stays report only until LANG-5c.
  const languages = JSON.parse(
    readFileSync(new URL(`./${AXES.designLanguage.file}`, import.meta.url), 'utf8'),
  );
  assert.equal(languages.enforced, false);
});

test('unscorable and left-out packs are named in every matrix and ranked list, never as distinct', () => {
  const unscorable = [{ id: 'brand-seed', reason: 'a generator scheme' }];
  const excluded = [{ id: 'profile-image', reason: 'waits for the owner' }];
  assert.equal(UNSCORABLE_LABEL, "unscorable: needs the owner's input");
  assert.equal(EXCLUDED_LABEL, 'not in this build');
  const rows = [...matrixRows(['a', 'b'], () => '0.500'), ...unscoredRows(unscorable, excluded)];
  assert.deepEqual(rows.slice(-2), [
    ['brand-seed', "unscorable: needs the owner's input"],
    ['profile-image', 'not in this build'],
  ]);
  assert.match(
    csv(rows),
    /\nbrand-seed,unscorable: needs the owner's input\nprofile-image,not in this build\n$/,
  );
  assert.deepEqual(unscoredLines(unscorable, excluded), [
    "brand-seed: unscorable: needs the owner's input. Never scored, never counted as distinct (a generator scheme).",
    'profile-image: not in this build. Never scored (waits for the owner).',
  ]);
  assert.equal(
    unscoredLines([], [{ id: 'x', reason: 'ends here.' }])[0],
    'x: not in this build. Never scored (ends here).',
  );
  assert.deepEqual(unscoredRows([], []), []);
  assert.deepEqual(unscoredLines([], []), []);
});

test('the scheme JSON records the scale decision, the unscorable generators, and the scheme left out of the build', () => {
  const json = JSON.parse(
    readFileSync(new URL('./schemes-distinct.json', import.meta.url), 'utf8'),
  );
  assert.match(json.note, /The ΔE00 scale of 50 was chosen so the controls' gap can vote/);
  assert.match(json.note, /alike under a mean ΔE00 of 3\.8, is the decision/);
  near(json.thresholds.de.alike.desktop * DE00_SCALE, 3.8);
  assert.deepEqual(
    json.skipped.map(({ id }: { id: string }) => id),
    ['brand-seed', 'hct-tonal', 'portfolio-artwork'],
  );
  assert.deepEqual(
    json.excluded.map(({ id }: { id: string }) => id),
    ['profile-image'],
  );
  const scored = new Set(json.packs.map(({ id }: { id: string }) => id));
  for (const id of ['brand-seed', 'hct-tonal', 'portfolio-artwork', 'profile-image']) {
    assert.ok(!scored.has(id), `${id} is never scored`);
  }
});
