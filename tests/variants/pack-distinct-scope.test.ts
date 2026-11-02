import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyRulings,
  AXES,
  describeRefused,
  describeScope,
  describeUnneeded,
  enforcementFailures,
  judgePair,
  type PackRuling,
  type PackThresholds,
  RULING_KEYS,
  type SchemeMode,
} from './pack-distinct';

// LANG-5c: scoped rulings, built once for 5c and 5e (lead A's ruling). A
// ruling may name a viewport and/or a mode, and one without a scope still
// covers every row. The guard counts the scoped rulings it applied, refuses
// one whose scope matches no scored row, and decides "unneeded" per scope.

interface AxisJson {
  readonly enforced: boolean;
  readonly thresholds: PackThresholds;
  readonly rulings?: readonly PackRuling[];
  readonly packs: readonly { readonly id: string }[];
}
const json = (axis: keyof typeof AXES): AxisJson =>
  JSON.parse(readFileSync(new URL(`./${AXES[axis].file}`, import.meta.url), 'utf8'));
const LANGUAGE = json('designLanguage');
const SCHEME = json('colorScheme');

/** A design-language row: its edges `px` at `viewport`, tokens well apart; scored in no mode. */
const languageRow = (a: string, b: string, viewport: 'desktop' | 'mobile', px: number) =>
  judgePair({ a, b, viewport, px, token: 0.5 }, LANGUAGE.thresholds);

/** A scheme row at desktop: each mode's mean ΔE00, the worse deciding, as schemeDelta() gives them. */
const schemeRow = (a: string, b: string, light: number, dark: number) => {
  const worst: SchemeMode = dark < light ? 'dark' : 'light';
  const mean = Math.min(light, dark);
  return judgePair(
    {
      a,
      b,
      viewport: 'desktop',
      px: 0.5,
      token: 0.5,
      de: Math.round(Math.min(1, mean / 50) * 1000) / 1000,
      deMean: mean,
      deModes: { light, dark },
      deWorst: worst,
      deRoles: {},
      near: [],
    },
    SCHEME.thresholds,
  );
};

const IDS = ['a', 'b', 'c', 'd'];

test('a viewport-scoped ruling rules its viewport only; an unscoped one still rules every row', () => {
  // a/b fail at both viewports (under 0.113 and 0.273).
  const rows = [languageRow('a', 'b', 'desktop', 0.06), languageRow('a', 'b', 'mobile', 0.146)];
  assert.deepEqual(
    rows.map((row) => row.fail),
    [true, true],
  );
  const mobile = applyRulings(
    rows,
    [{ pairs: [['a', 'b']], scope: { viewport: 'mobile' }, ruling: 'R-390' }],
    IDS,
  );
  assert.deepEqual(
    mobile.ruled.map(({ outcome, ruling }) => [outcome.viewport, ruling]),
    [['mobile', 'R-390']],
  );
  assert.deepEqual(
    mobile.failures.map((row) => row.viewport),
    ['desktop'],
  );
  assert.equal(mobile.scopedApplied, 1);
  assert.deepEqual(mobile.unneeded, []);
  assert.deepEqual(mobile.refused, []);
  const whole = applyRulings(rows, [{ pairs: [['b', 'a']], ruling: 'kept' }], IDS);
  assert.deepEqual(
    whole.ruled.map(({ outcome }) => outcome.viewport),
    ['desktop', 'mobile'],
  );
  assert.deepEqual(whole.failures, []);
  assert.equal(whole.scopedApplied, 0);
  // Both scopes, desktop and mobile, together rule both rows: two scoped rulings applied.
  const both = applyRulings(
    rows,
    [
      { pairs: [['a', 'b']], scope: { viewport: 'desktop' }, ruling: 'wide' },
      { pairs: [['a', 'b']], scope: { viewport: 'mobile' }, ruling: 'narrow' },
    ],
    IDS,
  );
  assert.deepEqual(both.failures, []);
  assert.equal(both.scopedApplied, 2);
});

test('a mode-scoped ruling rules a scheme row only when it covers every mode the row fails in', () => {
  // Dark alike (3.0 under 3.8), light apart (9.0).
  const darkOnly = schemeRow('a', 'b', 9, 3);
  assert.deepEqual(darkOnly.failModes, ['dark']);
  const ruled = applyRulings(
    [darkOnly],
    [{ pairs: [['a', 'b']], scope: { mode: 'dark' }, ruling: 'dark kept' }],
    IDS,
  );
  assert.equal(ruled.ruled.length, 1);
  assert.equal(ruled.scopedApplied, 1);
  // A light ruling on a dark failure rules nothing, and is unneeded: the pair doesn't fail in light.
  const wrong = applyRulings(
    [darkOnly],
    [{ pairs: [['a', 'b']], scope: { mode: 'light' }, ruling: 'light kept' }],
    IDS,
  );
  assert.equal(wrong.failures.length, 1);
  assert.equal(wrong.scopedApplied, 0);
  assert.deepEqual(wrong.unneeded, [
    { pair: ['a', 'b'], ruling: 'light kept', scope: { mode: 'light' } },
  ]);
  assert.deepEqual(wrong.refused, []);
  // Alike in both modes: a dark ruling alone leaves the light failure unruled; both modes rule it.
  const bothModes = schemeRow('a', 'b', 3.5, 3);
  assert.deepEqual(bothModes.failModes, ['light', 'dark']);
  assert.equal(
    applyRulings(
      [bothModes],
      [{ pairs: [['a', 'b']], scope: { mode: 'dark' }, ruling: 'dark kept' }],
      IDS,
    ).failures.length,
    1,
  );
  const covered = applyRulings(
    [bothModes],
    [
      { pairs: [['a', 'b']], scope: { mode: 'dark' }, ruling: 'dark kept' },
      { pairs: [['a', 'b']], scope: { mode: 'light' }, ruling: 'light kept' },
    ],
    IDS,
  );
  assert.deepEqual(
    covered.ruled.map(({ ruling }) => ruling),
    ['dark kept; light kept'],
  );
  // A viewport and a mode together: desktop in dark holds on this desktop row.
  assert.equal(
    applyRulings(
      [darkOnly],
      [{ pairs: [['a', 'b']], scope: { viewport: 'desktop', mode: 'dark' }, ruling: 'x' }],
      IDS,
    ).ruled.length,
    1,
  );
  // A passing scheme row fails in no mode.
  assert.deepEqual(schemeRow('a', 'b', 9, 8).failModes, []);
});

test('the guard refuses a scoped ruling whose scope matches no scored row, and an unreadable scope', () => {
  const rows = [languageRow('a', 'b', 'desktop', 0.06), languageRow('a', 'b', 'mobile', 0.146)];
  // A design-language row is scored in no mode, so a mode scope can never match it.
  const modeOnLanguage = applyRulings(
    rows,
    [{ pairs: [['a', 'b']], scope: { mode: 'dark' }, ruling: 'dark only' }],
    IDS,
  );
  assert.deepEqual(modeOnLanguage.refused, [
    { pair: ['a', 'b'], ruling: 'dark only', scope: { mode: 'dark' } },
  ]);
  assert.deepEqual(modeOnLanguage.unneeded, [], 'a refused ruling is named once, as refused');
  assert.equal(modeOnLanguage.failures.length, 2);
  assert.match(
    describeRefused(modeOnLanguage.refused[0]!),
    /the ruling "dark only" for a and b is scoped in dark, which matches no row the guard scored/,
  );
  // A viewport the run didn't score for the pair (only desktop rows here).
  const unscored = applyRulings(
    [rows[0]!],
    [{ pairs: [['a', 'b']], scope: { viewport: 'mobile' }, ruling: 'R-390' }],
    IDS,
  );
  assert.equal(unscored.refused.length, 1);
  // An unscoped ruling is never refused: with no rows it's unneeded, as before.
  const plain = applyRulings([], [{ pairs: [['a', 'b']], ruling: 'kept' }], IDS);
  assert.deepEqual(plain.refused, []);
  assert.equal(plain.unneeded.length, 1);
  // Scopes the guard can't read are problems.
  assert.deepEqual(
    applyRulings(
      rows,
      [
        { pairs: [['a', 'b']], scope: { viewport: 'tablet' as never }, ruling: 'x' },
        { pairs: [['a', 'c']], scope: { mode: 'dim' as never }, ruling: 'y' },
        { pairs: [['a', 'd']], scope: { width: 390 } as never, ruling: 'z' },
        { pairs: [['b', 'c']], scope: {}, ruling: 'w' },
      ],
      IDS,
    ).problems,
    [
      'the ruling for a and b scopes viewport "tablet", which isn\'t desktop or mobile',
      'the ruling for a and c scopes mode "dim", which isn\'t light or dark',
      "the ruling for a and d scopes width, which isn't viewport or mode",
      'the ruling for b and c has an empty scope: leave scope out to rule every row',
    ],
  );
});

test('unneeded works per scope: a scoped ruling is unneeded when its own scope no longer fails', () => {
  // a/b fail at desktop only (0.06; mobile 0.4 is apart).
  const rows = [languageRow('a', 'b', 'desktop', 0.06), languageRow('a', 'b', 'mobile', 0.4)];
  const verdict = applyRulings(
    rows,
    [{ pairs: [['a', 'b']], scope: { viewport: 'mobile' }, ruling: 'R-390' }],
    IDS,
  );
  // The pair still fails, at desktop, which the mobile ruling doesn't rule; and the ruling is stale.
  assert.deepEqual(
    verdict.failures.map((row) => row.viewport),
    ['desktop'],
  );
  assert.deepEqual(verdict.unneeded, [
    { pair: ['a', 'b'], ruling: 'R-390', scope: { viewport: 'mobile' } },
  ]);
  assert.equal(
    describeUnneeded(verdict.unneeded[0]!),
    'a and b fail nowhere at mobile, so the ruling "R-390" is no longer needed: remove it',
  );
  // Enforced, both the unruled desktop row and the stale mobile ruling fail the run.
  const lines = enforcementFailures({ enforced: true }, verdict, LANGUAGE.thresholds);
  assert.equal(lines.length, 2);
  assert.match(lines[1]!, /fail nowhere at mobile/);
  assert.equal(describeScope({ viewport: 'desktop', mode: 'light' }), 'at desktop in light');
  assert.equal(describeScope(undefined), '');
});

test('a clone is never ruled, scoped or not', () => {
  const clone = languageRow('a', 'b', 'mobile', 0);
  assert.ok(clone.reasons.includes('clone:px'));
  const verdict = applyRulings(
    [clone],
    [{ pairs: [['a', 'b']], scope: { viewport: 'mobile' }, ruling: 'R-390' }],
    IDS,
  );
  assert.equal(verdict.failures.length, 1);
  assert.equal(verdict.scopedApplied, 0);
});

test("every committed ruling's scope is one the guard reads", () => {
  for (const axis of ['designLanguage', 'colorScheme', 'typography'] as const) {
    const committed = json(axis);
    const ids = committed.packs.map(({ id }) => id);
    assert.deepEqual(applyRulings([], committed.rulings ?? [], ids).problems, [], axis);
  }
});

test('a ruling with a key it does not carry fails the run, so a misplaced scope cannot rule every row (LANG-5c review)', () => {
  const rows = [languageRow('a', 'b', 'desktop', 0.06), languageRow('a', 'b', 'mobile', 0.146)];
  assert.deepEqual(RULING_KEYS, ['pack', 'pairs', 'ruling', 'why', 'scope', 'evidence', 'scores']);
  // `viewport` at the top, where `scope` was meant: read as unscoped, it would rule desktop too.
  const top = applyRulings(
    rows,
    [{ pairs: [['a', 'b']], viewport: 'mobile', ruling: 'R-390' } as unknown as PackRuling],
    IDS,
  );
  assert.deepEqual(top.problems, [
    `the ruling "R-390" has viewport, which a ruling doesn't carry: it carries pack, pairs, ruling, why, scope, evidence, scores`,
  ]);
  // The ruling rules nothing: both rows fail unruled.
  assert.deepEqual(top.ruled, []);
  assert.equal(top.failures.length, 2);
  const plural = applyRulings(
    rows,
    [
      {
        pairs: [['a', 'b']],
        scopes: { viewport: 'mobile' },
        ruling: 'R-390',
      } as unknown as PackRuling,
    ],
    IDS,
  );
  assert.equal(plural.problems.length, 1);
  assert.match(plural.problems[0]!, /has scopes, which a ruling doesn't carry/);
  assert.equal(plural.failures.length, 2);
  // A standing ruling, no pairs, is held to the keys too.
  const standing = applyRulings(
    [],
    [{ pack: 'a', pairs: [], ruling: 'kept', note: 'x' } as unknown as PackRuling],
    IDS,
  );
  assert.match(standing.problems[0]!, /has note/);
  // Every key a ruling carries reads.
  assert.deepEqual(
    applyRulings(
      rows,
      [
        {
          pack: 'a',
          pairs: [['a', 'b']],
          ruling: 'R-390',
          why: 'w',
          scope: { viewport: 'mobile' },
          evidence: ['shot'],
          scores: { tokens: 0.1 },
        },
      ],
      IDS,
    ).problems,
    [],
  );
});

test('an unscoped and a scoped ruling on one pair are flagged, and what is applied does not turn on the JSON order (LANG-5c review)', () => {
  const rows = [languageRow('a', 'b', 'desktop', 0.06), languageRow('a', 'b', 'mobile', 0.146)];
  const unscoped: PackRuling = { pairs: [['a', 'b']], ruling: 'kept' };
  const mobile: PackRuling = {
    pairs: [['b', 'a']],
    scope: { viewport: 'mobile' },
    ruling: 'R-390',
  };
  const forward = applyRulings(rows, [unscoped, mobile], IDS);
  const backward = applyRulings(rows, [mobile, unscoped], IDS);
  for (const verdict of [forward, backward]) {
    assert.deepEqual(verdict.problems, [
      'the ruling "R-390" for a and b at mobile is redundant: "kept" already rules it everywhere, so remove one',
    ]);
    // The broadest ruling rules each row, so no scoped ruling counts as applied.
    assert.deepEqual(
      verdict.ruled.map(({ outcome, ruling }) => [outcome.viewport, ruling]),
      [
        ['desktop', 'kept'],
        ['mobile', 'kept'],
      ],
    );
    assert.equal(verdict.scopedApplied, 0);
    assert.deepEqual(verdict.failures, []);
  }
  // A viewport-and-mode ruling beside its mode-only one is redundant the same way.
  const dark = schemeRow('a', 'b', 9, 3);
  const modeOnly: PackRuling = { pairs: [['a', 'b']], scope: { mode: 'dark' }, ruling: 'dark' };
  const both: PackRuling = {
    pairs: [['a', 'b']],
    scope: { viewport: 'desktop', mode: 'dark' },
    ruling: 'desktop dark',
  };
  for (const order of [
    [modeOnly, both],
    [both, modeOnly],
  ]) {
    const verdict = applyRulings([dark], order, IDS);
    assert.deepEqual(verdict.problems, [
      'the ruling "desktop dark" for a and b at desktop in dark is redundant: "dark" already rules it in dark, so remove one',
    ]);
    assert.deepEqual(
      verdict.ruled.map(({ ruling }) => ruling),
      ['dark'],
    );
    assert.equal(verdict.scopedApplied, 1);
  }
  // Two rulings with one scope: flagged once, either order.
  const twin: PackRuling = {
    pairs: [['a', 'b']],
    scope: { viewport: 'mobile' },
    ruling: 'R-390b',
  };
  for (const order of [
    [mobile, twin],
    [twin, mobile],
  ]) {
    assert.deepEqual(applyRulings(rows, order, IDS).problems, [
      'the rulings "R-390" and "R-390b" both rule a and b at mobile: keep one',
    ]);
  }
  // Rulings that hold apart, desktop and mobile, or light and dark, are not redundant.
  assert.deepEqual(
    applyRulings(
      rows,
      [
        { pairs: [['a', 'b']], scope: { viewport: 'desktop' }, ruling: 'wide' },
        { pairs: [['a', 'b']], scope: { viewport: 'mobile' }, ruling: 'narrow' },
      ],
      IDS,
    ).problems,
    [],
  );
});
