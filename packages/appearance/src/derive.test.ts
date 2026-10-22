import test from 'node:test';
import assert from 'node:assert/strict';
import { contrast, deltaE, isHex, mix } from './color';
import {
  ACCENT_DELTA,
  anchorV1,
  DISTINCT_PAIRS,
  highContrastV1,
  QUIET_TEXT_DELTA,
  type Anchors,
} from './derive';
import { COLOR_ROLES, type ColorTokens } from './tokens';
import { WARM_PARCHMENT, pick, randomHex, seeded } from './test-support/packs';
import { anchorStops, assertStops, highContrastStops } from './test-support/stops';

const LIGHT = WARM_PARCHMENT.anchors!.light!;
const DARK = WARM_PARCHMENT.anchors!.dark!;
const GROUNDS = [
  'canvas',
  'surface-subtle',
  'surface-default',
  'surface-prominent',
  'surface-overlay',
] as const;

const worst = (
  set: ColorTokens,
  role: keyof ColorTokens,
  grounds: readonly (keyof ColorTokens)[] = GROUNDS,
) => Math.min(...grounds.map((ground) => contrast(set[role], set[ground])));

/** Every gate pair anchor-v1 solves, at the gate's own limits. */
function assertGate(set: ColorTokens, label: string, text = 4.5, nonText = 3) {
  for (const role of ['text-primary', 'text-secondary', 'text-muted', 'accent-text'] as const) {
    assert.ok(worst(set, role) >= text, `${label}: ${role}`);
  }
  for (const state of ['accent-hover', 'accent-active'] as const) {
    assert.ok(contrast(set['on-accent'], set[state]) >= text, `${label}: on-accent on ${state}`);
  }
  for (const status of ['positive', 'warning', 'danger', 'information'] as const) {
    assert.ok(contrast(set['on-status'], set[status]) >= text, `${label}: on-status on ${status}`);
  }
  for (const role of ['focus', 'border-strong'] as const) {
    assert.ok(worst(set, role) >= nonText, `${label}: ${role}`);
  }
  for (const index of [1, 2, 3, 4, 5, 6] as const) {
    const role = `data-categorical-${index}` as const;
    assert.ok(worst(set, role, ['surface-default']) >= nonText, `${label}: ${role}`);
  }
  assert.ok(contrast(set['on-scrim'], set.scrim) >= text, `${label}: on-scrim`);
}

test('anchor-v1 gives every role as concrete hex, in contract order', () => {
  for (const [anchors, mode] of [
    [LIGHT, 'light'],
    [DARK, 'dark'],
  ] as const) {
    const set = anchorV1(anchors, mode);
    assert.deepEqual(Object.keys(set), [...COLOR_ROLES]);
    for (const role of COLOR_ROLES) assert.ok(isHex(set[role]), `${mode} ${role}: ${set[role]}`);
  }
});

test('anchor-v1 mixes in the refined body percentages and never moves an anchor', () => {
  for (const [anchors, mode, surfaces, borders] of [
    [LIGHT, 'light', [3, 6, 10, 2], [12, 24]],
    [DARK, 'dark', [6, 10, 16, 12], [18, 30]],
  ] as const) {
    const set = anchorV1(anchors, mode);
    const { canvas, text, accent, secondary } = anchors;
    assert.equal(set.canvas, canvas);
    assert.equal(set['text-primary'], text);
    assert.equal(set.accent, accent);
    assert.equal(set['text-inverse'], canvas);
    ['surface-subtle', 'surface-default', 'surface-prominent', 'surface-overlay'].forEach(
      (role, index) =>
        assert.equal(
          set[role as keyof ColorTokens],
          mix(canvas, text, surfaces[index]!),
          `${mode} ${role}`,
        ),
    );
    assert.equal(set['border-subtle'], mix(canvas, text, borders[0]));
    assert.equal(set['border-default'], mix(canvas, text, borders[1]));
    assert.equal(set.selection, mix(canvas, accent, 34));
    assert.equal(set['data-sequential-start'], mix(canvas, accent, 28));
    assert.equal(set['data-sequential-middle'], mix(canvas, accent, 58));
    assert.equal(set['data-sequential-end'], mix(canvas, accent, 88));
    assert.equal(set['signature-start'], accent);
    assert.equal(set['signature-end'], secondary);
    assert.equal(set.emphasis, accent);
    assert.equal(set.scrim, '#000000');
    assert.equal(set.shadow, '#000000');
    assert.equal(set['on-scrim'], '#ffffff');
    assert.equal(set['on-status'], mode === 'light' ? '#ffffff' : '#000000');
  }
});

test('warm-parchment passes every pair anchor-v1 solves, moving only what failed', () => {
  const light = anchorV1(LIGHT, 'light');
  const dark = anchorV1(DARK, 'dark');
  assertGate(light, 'light');
  assertGate(dark, 'dark');
  // text-muted's 44% fails on surface-prominent and moves toward text, onto
  // text-secondary's 28% mix, and stays at its contrast limit; text-secondary
  // then moves further toward text, until it's QUIET_TEXT_DELTA away (Slice 2).
  assert.notEqual(light['text-muted'], mix(LIGHT.text, LIGHT.canvas, 44));
  assert.ok(worst(light, 'text-muted') >= 4.6);
  assert.equal(light['text-muted'], mix(LIGHT.text, LIGHT.canvas, 28));
  assert.notEqual(light['text-secondary'], mix(LIGHT.text, LIGHT.canvas, 28));
  assert.ok(deltaE(light['text-secondary'], light['text-muted']) >= QUIET_TEXT_DELTA);
  assert.ok(deltaE(dark['text-secondary'], dark['text-muted']) >= QUIET_TEXT_DELTA);
  assert.ok(
    contrast(light['text-secondary'], LIGHT.canvas) > contrast(light['text-muted'], LIGHT.canvas),
  );
  // The accent states mix 12% and 22% away from on-accent, black here, so they lighten.
  assert.equal(light['accent-hover'], mix(LIGHT.accent, '#ffffff', 12));
  assert.equal(light['accent-active'], mix(LIGHT.accent, '#ffffff', 22));
  assert.equal(dark['accent-hover'], mix(DARK.accent, '#ffffff', 12));
  assert.equal(dark['accent-active'], mix(DARK.accent, '#ffffff', 22));
  // Statuses that pass keep their starting colors; light positive fails on white and darkens.
  assert.equal(light.warning, '#9b5700');
  assert.equal(light.danger, '#b53143');
  assert.notEqual(light.positive, '#2e8b57');
  assert.ok(contrast('#ffffff', light.positive) >= 4.6);
  assert.deepEqual([dark.positive, dark.warning, dark.danger], ['#78d39b', '#ffc264', '#ff8e9c']);
  // on-accent is whichever of black and white contrasts more with the accent.
  assert.equal(light['on-accent'], '#000000');
  assert.equal(dark['on-accent'], '#000000');
  // Categorical colors: accent, secondary, the solved statuses, and text-secondary.
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((index) => dark[`data-categorical-${index}` as keyof ColorTokens]),
    [DARK.accent, DARK.secondary, dark.positive, dark.warning, dark.danger, dark['text-secondary']],
  );
});

test('anchor-v1 is deterministic', () => {
  assert.deepEqual(anchorV1(LIGHT, 'light'), anchorV1({ ...LIGHT }, 'light'));
  assert.deepEqual(anchorV1(DARK, 'dark'), anchorV1({ ...DARK }, 'dark'));
});

/** Random anchors whose text passes the text gate on every ground, the one thing anchor-v1 can't fix. */
function randomAnchors(random: () => number, mode: 'light' | 'dark'): Anchors {
  for (;;) {
    const anchors = {
      canvas: randomHex(random),
      text: randomHex(random),
      accent: randomHex(random),
      secondary: randomHex(random),
    };
    const set = anchorV1(anchors, mode);
    if (worst(set, 'text-primary') >= 4.5) return anchors;
  }
}

test('property: for any anchors whose text passes, every role anchor-v1 solves passes too', () => {
  const random = seeded(1919);
  for (let index = 0; index < 400; index += 1) {
    const mode = pick(random, ['light', 'dark'] as const);
    const anchors = randomAnchors(random, mode);
    const set = anchorV1(anchors, mode);
    const label = `${mode} ${JSON.stringify(anchors)}`;
    assertGate(set, label);
    // Each role that moved stopped at the first step past its limit plus 0.1, or, for
    // text-secondary and the accent states, at the first step that keeps them apart (Slice 2).
    assertStops(set, anchorStops(anchors, mode, set), label);
    assertDistinct(set, label);
  }
});

/**
 * The hierarchy holds: each pair DISTINCT_PAIRS names is its least distance
 * apart, unless the role that moves to make room has nowhere left to go
 * (text-secondary became the text color, or a state became black or white).
 */
function assertDistinct(set: ColorTokens, label: string) {
  const away = set['on-accent'] === '#000000' ? '#ffffff' : '#000000';
  for (const [first, second, least] of DISTINCT_PAIRS) {
    const distance = deltaE(set[first], set[second]);
    if (distance >= least) continue;
    const saturated =
      second === 'text-muted'
        ? set['text-secondary'] === set['text-primary']
        : set[second] === away;
    assert.ok(saturated, `${label}: ${first} and ${second} are ${distance.toFixed(4)} apart`);
  }
}

test("each threshold sits under the prototype's own closest pair, and secondary keeps clear of muted", () => {
  // The prototype's formulas (appearance-catalog.js, deriveColorTokens): the
  // states mix the accent 12% and 22% toward text, and secondary and muted
  // mix text 28% and, in dark, 34% toward canvas.
  const prototype = (canvas: string, text: string, accent: string) => ({
    hover: mix(accent, text, 12),
    active: mix(accent, text, 22),
    secondary: mix(text, canvas, 28),
    muted: mix(text, canvas, 34),
  });
  // Its closest accent states: material-hct's, generated, and oled-black's, single-mode.
  for (const [canvas, text, accent] of [
    ['#1c1b1f', '#e6e1e5', '#d0bcff'],
    ['#000000', '#f5f5f2', '#67e8f9'],
  ] as const) {
    const states = prototype(canvas, text, accent);
    assert.ok(deltaE(states.hover, states.active) >= ACCENT_DELTA, accent);
    // Slice 2's first single threshold, 0.015, refused the prototype's own states.
    assert.ok(deltaE(states.hover, states.active) < 0.015, accent);
  }
  // Its closest quieter text roles: low-stimulus-warm's dark.
  const quiet = prototype('#26231f', '#e8e0d4', '#b89c86');
  assert.ok(deltaE(quiet.secondary, quiet.muted) >= QUIET_TEXT_DELTA);
  // warm-parchment's secondary moves toward text until it clears muted, which stays put.
  for (const [anchors, mode] of [
    [LIGHT, 'light'],
    [DARK, 'dark'],
  ] as const) {
    const set = anchorV1(anchors, mode);
    assert.ok(deltaE(set['text-secondary'], set['text-muted']) >= QUIET_TEXT_DELTA, mode);
    assert.ok(worst(set, 'text-muted') < 4.6 + 0.2, `${mode}: muted sits at its contrast limit`);
  }
});

test('anchor-v1 keeps the accent states and the two quieter text roles apart', () => {
  for (const [anchors, mode] of [
    [LIGHT, 'light'],
    [DARK, 'dark'],
  ] as const) {
    const set = anchorV1(anchors, mode);
    for (const [first, second, least] of DISTINCT_PAIRS) {
      assert.ok(deltaE(set[first], set[second]) >= least, `${mode} ${first} ${second}`);
    }
  }
  // A white on-accent darkens the states: away from white is toward black.
  const deep = anchorV1({ ...LIGHT, accent: '#1f4fa8' }, 'light');
  assert.equal(deep['on-accent'], '#ffffff');
  assert.equal(deep['accent-hover'], mix('#1f4fa8', '#000000', 12));
  assert.equal(deep['accent-active'], mix('#1f4fa8', '#000000', 22));
});

test('the high-contrast states mix away from on-accent too, and stay apart', () => {
  const sets = { light: anchorV1(LIGHT, 'light'), dark: anchorV1(DARK, 'dark') };
  for (const polarity of ['light', 'dark'] as const) {
    const set = highContrastV1(sets, polarity);
    const text = polarity === 'dark' ? '#ffffff' : '#000000';
    assert.equal(set['accent-hover'], mix(set.accent, text, 12));
    assert.equal(set['accent-active'], mix(set.accent, text, 22));
    assertDistinct(set, `high-contrast ${polarity}`);
  }
});

test('high-contrast-v1 holds its sets to 7:1 text and 4.5:1 non-text', () => {
  const sets = { light: anchorV1(LIGHT, 'light'), dark: anchorV1(DARK, 'dark') };
  for (const polarity of ['light', 'dark'] as const) {
    const set = highContrastV1(sets, polarity);
    assert.deepEqual(Object.keys(set), [...COLOR_ROLES]);
    const [canvas, text] = polarity === 'dark' ? ['#000000', '#ffffff'] : ['#ffffff', '#000000'];
    assert.equal(set.canvas, canvas);
    assert.equal(set['text-primary'], text);
    assert.equal(set['surface-subtle'], mix(canvas, text, 4));
    assert.equal(set['surface-default'], mix(canvas, text, 8));
    assert.equal(set['surface-prominent'], mix(canvas, text, 12));
    assert.equal(set['surface-overlay'], canvas);
    for (const role of [
      'text-secondary',
      'text-muted',
      'border-subtle',
      'border-default',
      'border-strong',
      'focus',
    ] as const) {
      assert.equal(set[role], text, role);
    }
    for (const role of ['text-inverse', 'on-accent', 'on-status'] as const)
      assert.equal(set[role], canvas, role);
    assertGate(set, `high-contrast ${polarity}`, 7, 4.5);
    for (const role of ['accent', 'positive', 'warning', 'danger', 'information'] as const) {
      assert.ok(worst(set, role) >= 7, `${polarity} ${role}`);
    }
    assert.equal(set['data-categorical-6'], text);
  }
  // A dark set that already passes keeps the scheme's dark accent; the light one is solved toward black.
  assert.equal(highContrastV1(sets, 'dark').accent, sets.dark.accent);
  assert.notEqual(highContrastV1(sets, 'light').accent, sets.light.accent);
});

test('high-contrast-v1 starts from the only set a single-mode scheme has', () => {
  const dark = anchorV1(DARK, 'dark');
  const light = highContrastV1({ dark }, 'light');
  assert.equal(light.canvas, '#ffffff');
  assertGate(light, 'derived light from dark', 7, 4.5);
  assert.throws(() => highContrastV1({}, 'dark'), TypeError);
});

test('property: high-contrast-v1 passes its targets from any base set', () => {
  const random = seeded(2020);
  for (let index = 0; index < 200; index += 1) {
    const mode = pick(random, ['light', 'dark'] as const);
    const base = anchorV1(randomAnchors(random, mode), mode);
    for (const polarity of ['light', 'dark'] as const) {
      const set = highContrastV1({ [mode]: base }, polarity);
      assertGate(set, `${mode} to ${polarity}`, 7, 4.5);
      assertStops(set, highContrastStops(base, polarity, set), `${mode} to ${polarity}`);
    }
  }
});
