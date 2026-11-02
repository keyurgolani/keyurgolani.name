import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { deriveBaseSet, schemeSets } from '../../packages/appearance/src/sets';
import {
  alphaOf,
  applyRulings,
  AXES,
  DERIVED_BOUND,
  derivedShifts,
  enforcementFailures,
  judgePacks,
  judgePair,
  PAINTED_REPORT_UNDER,
  PAINTED_WEIGHTS,
  paintedDelta,
  pairTokens,
  renderedRoleColors,
  SCHEME_DE_ROLES,
  schemeScore,
  schemeVector,
  SCORED_COLOR_ROLES,
  typographyVector,
  type PackPairScore,
  type PackRuling,
  type PackThresholds,
  type SchemeSets,
} from './pack-distinct';

// The LANG-5 enforcement commit: the scheme and type guards enforce, read
// their rulings, refuse a translucent scored role, and print a report-only
// painted score; a planted clone of a real pack fails each enforced axis.

interface AxisJson {
  readonly enforced: boolean;
  readonly thresholds: PackThresholds;
  readonly rulings: readonly PackRuling[];
  readonly packs: readonly { readonly id: string }[];
}
const json = (axis: 'colorScheme' | 'typography'): AxisJson =>
  JSON.parse(readFileSync(new URL(`./${AXES[axis].file}`, import.meta.url), 'utf8'));
const manifest = (kind: 'schemes' | 'typography', id: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../packages/appearance-${kind}/packs/${id}/manifest.json`, import.meta.url),
      'utf8',
    ),
  );

/** A real scheme's two base sets, as the compiler derives them. */
function schemeOf(id: string): SchemeSets {
  const m = manifest('schemes', id);
  const base = Object.fromEntries(
    (['light', 'dark'] as const).map((mode) => [
      mode,
      deriveBaseSet(m.derivation, m.anchors[mode], mode),
    ]),
  );
  const sets = schemeSets(base as never, m.highContrast, m.derivation, m.anchors) as never as {
    light: Record<string, string>;
    dark: Record<string, string>;
  };
  return { light: sets.light, dark: sets.dark };
}

test('a rendered color names its alpha: rgba(), the slash form, a percentage, eight- and four-digit hex, transparent', () => {
  assert.equal(alphaOf('#a1b2c3'), 1);
  assert.equal(alphaOf('rgb(1, 2, 3)'), 1);
  assert.equal(alphaOf('rgba(1, 2, 3, 0.5)'), 0.5);
  assert.equal(alphaOf('rgb(1 2 3 / 40%)'), 0.4);
  assert.equal(alphaOf('rgb(1 2 3 / 1)'), 1);
  assert.equal(alphaOf('#a1b2c380'), 0x80 / 255);
  assert.equal(alphaOf('#abc8'), 0x88 / 255);
  assert.equal(alphaOf('transparent'), 0);
});

test('a translucent scored role is a capture problem, never scored as opaque; an unscored one keeps its old reading', () => {
  assert.deepEqual([...SCORED_COLOR_ROLES], [...SCHEME_DE_ROLES, 'accent-text']);
  const { colors, problems } = renderedRoleColors({
    canvas: 'rgba(240, 240, 240, 0.6)',
    'text-primary': '#111111',
    scrim: 'rgba(0, 0, 0, 0.5)',
  });
  assert.equal(colors.canvas, undefined, 'the translucent canvas is never scored');
  assert.equal(colors['text-primary'], '#111111');
  assert.equal(colors.scrim, '#000000', 'an unscored role reads as before');
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /--color-canvas computes rgba\(240, 240, 240, 0\.6\), alpha 0\.6/);
  // An opaque render has none.
  assert.deepEqual(renderedRoleColors({ canvas: 'rgb(240, 240, 240)' }).problems, []);
});

/** A judged pair-viewport, from a perceptual value and a token value. */
const outcomeOf = (
  a: string,
  b: string,
  de: number,
  token: number,
  viewport: 'desktop' | 'mobile' = 'desktop',
) =>
  judgePair(
    { a, b, viewport, px: 0.5, token, de, deMean: de * 50, deRoles: {}, near: [] },
    json('colorScheme').thresholds,
  );

test('the rulings: a failing pair a ruling names passes, a clone never does, and a ruling that rules nothing failing is unneeded', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const outcomes = [
    outcomeOf('a', 'b', 0.05, 0.5), // alike, ruled
    outcomeOf('a', 'c', 0.05, 0.5), // alike, unruled
    outcomeOf('c', 'd', 0, 0.5), // a clone, ruled
    outcomeOf('b', 'd', 0.3, 0.5), // apart, ruled: unneeded
  ];
  const rulings: PackRuling[] = [
    { pairs: [['b', 'a']], ruling: 'kept' },
    { pairs: [['c', 'd']], ruling: 'kept too' },
    { pairs: [['b', 'd']], ruling: 'stale' },
    { pack: 'a', pairs: [], ruling: 'a record' },
  ];
  const ruled = applyRulings(outcomes, rulings, ids);
  assert.deepEqual(
    ruled.ruled.map(({ outcome, ruling }) => [outcome.a, outcome.b, ruling]),
    [['a', 'b', 'kept']],
  );
  assert.deepEqual(
    ruled.failures.map(({ a, b }) => [a, b]),
    [
      ['a', 'c'],
      ['c', 'd'],
    ],
  );
  assert.deepEqual(ruled.unneeded, [{ pair: ['b', 'd'], ruling: 'stale' }]);
  assert.deepEqual(ruled.problems, []);
  // A ruling naming a pack the guard doesn't score, or not a pair, is a problem.
  assert.deepEqual(
    applyRulings(outcomes, [{ pairs: [['a', 'z'], ['a']], ruling: 'x' }], ids).problems,
    [
      'a ruling names a and z, and the guard scores no z',
      'a ruling names ["a"], which isn\'t a pair of two packs',
    ],
  );
});

test("every committed ruling's pair is two packs the axis JSON lists", () => {
  for (const axis of ['colorScheme', 'typography'] as const) {
    const committed = json(axis);
    const ids = committed.packs.map(({ id }) => id);
    assert.deepEqual(applyRulings([], committed.rulings, ids).problems, [], axis);
  }
});

test('a planted clone of a real scheme, in both modes, fails the enforced scheme guard; enforcement off lets it through', () => {
  const committed = json('colorScheme');
  assert.equal(committed.enforced, true);
  const real = schemeOf('forest-moss');
  const clone: SchemeSets = { light: { ...real.light }, dark: { ...real.dark } };
  const scores: PackPairScore[] = (['desktop', 'mobile'] as const).map((viewport) => ({
    a: 'forest-moss',
    b: 'forest-moss-clone',
    viewport,
    px: 0,
    ...pairTokens(schemeVector(real), schemeVector(clone)),
    ...schemeScore({ colors: real }, { colors: clone }),
  }));
  const verdict = judgePacks({
    ids: ['forest-moss', 'forest-moss-clone'],
    scores,
    thresholds: committed.thresholds,
  });
  // A ruling can't excuse it: a clone is never ruled.
  const ruled = applyRulings(
    verdict.outcomes,
    [{ pairs: [['forest-moss', 'forest-moss-clone']], ruling: 'planted' }],
    ['forest-moss', 'forest-moss-clone'],
  );
  assert.equal(ruled.failures.length, 2);
  for (const outcome of ruled.failures) {
    assert.ok(outcome.reasons.includes('clone:de'), outcome.reasons.join(', '));
    assert.equal(outcome.deModes?.light, 0);
    assert.equal(outcome.deModes?.dark, 0);
  }
  assert.equal(enforcementFailures(committed, ruled, committed.thresholds).length, 2);
  // The mutant: with enforcement off, the clone passes the run.
  assert.deepEqual(
    enforcementFailures({ ...committed, enforced: false }, ruled, committed.thresholds),
    [],
  );
});

test('a planted clone of a real type pack fails the enforced type guard; enforcement off lets it through', () => {
  const committed = json('typography');
  assert.equal(committed.enforced, true);
  const roles = manifest('typography', 'technical-sans-mono').roles;
  const vector = typographyVector(roles);
  const scores: PackPairScore[] = (['desktop', 'mobile'] as const).map((viewport) => ({
    a: 'technical-sans-mono',
    b: 'technical-sans-mono-clone',
    viewport,
    // A clone renders the same first viewport, so its edges are 0 apart.
    px: 0,
    ...pairTokens(vector, typographyVector(structuredClone(roles))),
  }));
  const verdict = judgePacks({
    ids: ['technical-sans-mono', 'technical-sans-mono-clone'],
    scores,
    thresholds: committed.thresholds,
  });
  const ruled = applyRulings(
    verdict.outcomes,
    [],
    ['technical-sans-mono', 'technical-sans-mono-clone'],
  );
  assert.equal(ruled.failures.length, 2);
  for (const outcome of ruled.failures) {
    assert.ok(outcome.reasons.includes('clone:px'), outcome.reasons.join(', '));
    assert.ok(outcome.reasons.includes('clone:token'), outcome.reasons.join(', '));
  }
  assert.equal(enforcementFailures(committed, ruled, committed.thresholds).length, 2);
  assert.deepEqual(
    enforcementFailures({ ...committed, enforced: false }, ruled, committed.thresholds),
    [],
  );
});

test('the painted score weights each composition by the area it paints, and never votes', () => {
  for (const weights of Object.values(PAINTED_WEIGHTS)) {
    const sum = Object.values(weights).reduce((total, weight) => total + weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}`);
  }
  assert.equal(PAINTED_REPORT_UNDER, 5);
  const a = schemeOf('cool-color-safe');
  const b = schemeOf('neutral-slate');
  const painted = paintedDelta(a, b);
  assert.ok(painted.modes.light && painted.modes.dark);
  assert.equal(
    painted.least,
    Math.min(
      painted.modes.light['spatial-bento'],
      painted.modes.light['editorial-evidence'],
      painted.modes.dark['spatial-bento'],
      painted.modes.dark['editorial-evidence'],
    ),
  );
  // Only the page changed: Editorial Evidence, almost all page, reads it nearly whole.
  const page = { ...a.light!, canvas: '#000000' };
  const pageOnly = paintedDelta({ light: a.light }, { light: page });
  assert.ok(pageOnly.modes.light!['editorial-evidence'] > pageOnly.modes.light!['spatial-bento']);
  // Report only: the verdict is the same whatever the painted score says.
  const base = {
    a: 'x',
    b: 'y',
    viewport: 'desktop' as const,
    px: 0.5,
    token: 0.5,
    ...schemeScore({ colors: a }, { colors: b }),
  };
  const thresholds = json('colorScheme').thresholds;
  const strip = (outcome: ReturnType<typeof judgePair>) => {
    const rest: Record<string, unknown> = { ...outcome };
    delete rest.painted;
    return rest;
  };
  const near = judgePair({ ...base, painted: { modes: {}, least: 0 } }, thresholds);
  const far = judgePair({ ...base, painted: { modes: {}, least: 100 } }, thresholds);
  assert.deepEqual(strip(near), strip(far));
  assert.deepEqual(strip(near), strip(judgePair({ ...base, painted: undefined }, thresholds)));
});

test('derived roles: a role that moved with its own anchor fixed is measured against 2.0 ΔE00 and 5° of hue; one whose anchor moved is not listed', () => {
  assert.deepEqual(DERIVED_BOUND, { de: 2, hue: 5 });
  const anchors = {
    light: { canvas: '#ffffff', text: '#111111', accent: '#3366cc', secondary: '#cc6633' },
  };
  const shifts = derivedShifts(
    {
      anchors,
      sets: {
        light: { 'accent-text': '#3366cc', 'surface-default': '#eeeeee', information: '#cc6633' },
      },
    },
    {
      anchors: { light: { ...anchors.light, canvas: '#f0f0f0' } },
      sets: {
        light: { 'accent-text': '#3264ca', 'surface-default': '#e0e0e0', information: '#33cc66' },
      },
    },
  );
  // surface-default is the canvas's own family; information moved far, its secondary anchor fixed.
  assert.deepEqual(
    shifts.map(({ role, within }) => [role, within]),
    [
      ['accent-text', true],
      ['information', false],
    ],
  );
  // Under 2.0 ΔE00 but 7.3° of hue is beyond the bound too.
  const turned = derivedShifts(
    { anchors, sets: { light: { 'signature-end': '#7d8696' } } },
    { anchors, sets: { light: { 'signature-end': '#7c8795' } } },
  );
  assert.equal(turned.length, 1);
  assert.ok(
    turned[0]!.de <= DERIVED_BOUND.de && turned[0]!.hue > DERIVED_BOUND.hue,
    JSON.stringify(turned[0]),
  );
  assert.equal(turned[0]!.within, false);
  // A high-contrast set's emphasis is its accent (high-contrast-v1): with the accent anchor moved
  // and the emphasis anchor fixed, it moved with its own source and isn't listed.
  const withEmphasis = { light: { ...anchors.light, emphasis: '#3a6db5' } };
  assert.deepEqual(
    derivedShifts(
      { anchors: withEmphasis, sets: { 'high-contrast-light': { emphasis: '#07456c' } } },
      {
        anchors: { light: { ...withEmphasis.light, accent: '#00739a' } },
        sets: { 'high-contrast-light': { emphasis: '#004b64' } },
      },
    ),
    [],
  );
  // With the accent anchor moved too, accent-text moved with it and isn't listed.
  const moved = derivedShifts(
    { anchors, sets: { light: { 'accent-text': '#3366cc' } } },
    {
      anchors: { light: { ...anchors.light, accent: '#cc3366' } },
      sets: { light: { 'accent-text': '#cc3366' } },
    },
  );
  assert.deepEqual(moved, []);
});
