import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrast, deltaE, lightness, mix, withLightness } from './color';
import {
  ANCHOR_V2_TARGETS,
  anchorV2,
  anchorV2Adjustments,
  CATEGORICAL_DELTA,
  categoricalWalk,
  walkCategorical,
  fillStops,
  HIGH_CONTRAST_V2_TARGETS,
  highContrastV2,
  solveSignature,
  type SolveTargets,
} from './anchor-v2';
import { anchorV1, HEADROOM, highContrastV1, passesOn, type Anchors } from './derive';
import { GATE_TARGETS, gateSet, NEUTRAL_LANGUAGE } from './gate';
import type { ColorRole, ColorTokens } from './roles';
import type { ColorSetName } from './sets';
import { pick, randomHex, seeded } from './test-support/packs';

// anchor-v2 (#20 PR 2c): anchor-v1's set, re-solved to the targets a
// textured language sets. These hold the solver's properties: every target
// met, the fewest roles moved by the least step, monotonic in its targets,
// and deterministic.

const GROUNDS = [
  'canvas',
  'surface-subtle',
  'surface-default',
  'surface-prominent',
  'surface-overlay',
] as const satisfies readonly ColorRole[];
/** The roles anchor-v2 re-solves; every other role is anchor-v1's. */
const SOLVED: readonly ColorRole[] = [
  'text-secondary',
  'text-muted',
  'border-strong',
  'accent-text',
  'focus',
  'data-categorical-1',
  'data-categorical-2',
  'data-categorical-3',
  'data-categorical-4',
  'data-categorical-5',
  'data-categorical-6',
  'signature-start',
  'signature-end',
];
/** The roles that move toward text in 2% steps, each with the target it solves to. */
const TOWARD_TEXT = [
  ['text-muted', 'text'],
  ['accent-text', 'text'],
  ['focus', 'nonText'],
  ['border-strong', 'nonText'],
] as const;
const CATEGORICAL = [1, 2, 3, 4, 5, 6].map((index) => `data-categorical-${index}` as ColorRole);

const TEXTURED = { ...NEUTRAL_LANGUAGE, textured: true };
const LARGE = { largeSignature: true };

const groundsOf = (set: ColorTokens) => GROUNDS.map((role) => set[role]);
const worst = (set: ColorTokens, color: string) =>
  Math.min(...groundsOf(set).map((ground) => contrast(color, ground)));
const fillWorst = (set: ColorTokens, start: string, end: string) =>
  Math.min(...fillStops(start, end).map((color) => worst(set, color)));

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMES = path.resolve(here, '../../appearance-schemes/packs');
/** Every shipping scheme's anchors, from its manifest. */
const SHIPPING = fs
  .readdirSync(SCHEMES)
  .sort()
  .map((id) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(SCHEMES, id, 'manifest.json'), 'utf8'));
    return { id, manifest, anchors: manifest.anchors as { light?: Anchors; dark?: Anchors } };
  });

/** Random anchors whose text reads at the raised target on every ground, the one role anchor-v2 can't move. */
function randomAnchors(random: () => number, mode: 'light' | 'dark'): Anchors {
  for (;;) {
    const anchors = {
      canvas: randomHex(random),
      text: randomHex(random),
      accent: randomHex(random),
      secondary: randomHex(random),
    };
    const set = anchorV1(anchors, mode);
    if (worst(set, set['text-primary']) >= ANCHOR_V2_TARGETS.text) return anchors;
  }
}

/** Each corpus case: shipping schemes' modes first, then 300 random ones. */
function corpus(): { label: string; anchors: Anchors; mode: 'light' | 'dark' }[] {
  const cases = SHIPPING.flatMap(({ id, anchors }) =>
    (['light', 'dark'] as const).flatMap((mode) =>
      anchors[mode] ? [{ label: `${id} ${mode}`, anchors: anchors[mode]!, mode }] : [],
    ),
  );
  const random = seeded(2020);
  for (let index = 0; index < 300; index += 1) {
    const mode = pick(random, ['light', 'dark'] as const);
    const anchors = randomAnchors(random, mode);
    cases.push({ label: `${mode} ${JSON.stringify(anchors)}`, anchors, mode });
  }
  return cases;
}
const CORPUS = corpus();

/** Every failing gate pair of `set` with a textured opaque language and large signature text. */
const failing = (set: ColorTokens, name: ColorSetName) =>
  gateSet(set, name, TEXTURED, LARGE).filter((pair) => !pair.passes);

test("anchor-v2's targets are the gate's, raised for texture", () => {
  const raise = (target: number) => Math.round(target * GATE_TARGETS.textureRaise * 1000) / 1000;
  assert.deepEqual(ANCHOR_V2_TARGETS, {
    text: raise(GATE_TARGETS.text),
    nonText: raise(GATE_TARGETS.nonText),
    signature: raise(GATE_TARGETS.largeText),
  });
  assert.deepEqual(HIGH_CONTRAST_V2_TARGETS, {
    text: raise(GATE_TARGETS.highContrastText),
    nonText: raise(GATE_TARGETS.highContrastNonText),
    signature: raise(GATE_TARGETS.highContrastLargeText),
  });
});

test('property: every target met, for every shipping scheme and any anchors whose text reads', () => {
  for (const { label, anchors, mode } of CORPUS) {
    const set = anchorV2(anchors, mode);
    assert.deepEqual(failing(set, mode), [], label);
    for (const polarity of ['light', 'dark'] as const) {
      const high = highContrastV2({ [mode]: set }, polarity);
      assert.deepEqual(failing(high, `high-contrast-${polarity}`), [], `${label} to ${polarity}`);
    }
  }
});

test('anchor-v1 fails the raised targets that anchor-v2 meets, so the solver is what passes them', () => {
  const failures = SHIPPING.filter(({ anchors }) =>
    (['light', 'dark'] as const).some(
      (mode) => anchors[mode] && failing(anchorV1(anchors[mode]!, mode), mode).length > 0,
    ),
  );
  assert.ok(failures.length >= 20, `${failures.length} of ${SHIPPING.length}`);
});

test('property: minimal moves: anchors, fills, and every role it does not solve are anchor-v1s', () => {
  for (const { label, anchors, mode } of CORPUS) {
    const before = anchorV1(anchors, mode);
    const after = anchorV2(anchors, mode);
    for (const role of Object.keys(before) as ColorRole[]) {
      if (!SOLVED.includes(role)) assert.equal(after[role], before[role], `${label} ${role}`);
    }
    assert.equal(after.canvas, anchors.canvas);
    assert.equal(after['text-primary'], anchors.text);
    assert.equal(after.accent, anchors.accent);
  }
});

test('property: minimal moves: a role that passes stays, and a moved one stops at its first step past the target', () => {
  for (const { label, anchors, mode } of CORPUS) {
    const before = anchorV1(anchors, mode);
    const after = anchorV2(anchors, mode);
    const text = anchors.text;
    for (const [role, kind] of TOWARD_TEXT) {
      const target = ANCHOR_V2_TARGETS[kind];
      if (worst(before, before[role]) >= target) {
        assert.equal(after[role], before[role], `${label}: ${role} passed, so it stays`);
        continue;
      }
      const percent = [...Array(51).keys()]
        .map((step) => step * 2)
        .find((step) => mix(before[role], text, step) === after[role]);
      assert.ok(percent !== undefined && percent > 0, `${label}: ${role} moves toward text`);
      // No step passing, the role is the text color, which passes the bare target.
      if (after[role] !== text)
        assert.ok(worst(after, after[role]) >= target + HEADROOM, `${label}: ${role}`);
      else assert.ok(worst(after, after[role]) >= target, `${label}: ${role} is the text color`);
      if (percent > 2) {
        const previous = mix(before[role], text, percent - 2);
        assert.ok(worst(after, previous) < target + HEADROOM, `${label}: ${role} one step less`);
      }
    }
  }
});

test('the signature solver moves the start first on a tie, and both ends by the least total, start-light first (#20 PR 2c)', () => {
  const text = '#ffffff';
  const grounds = ['#000000'];
  const passes = (start: string, end: string, target: number) =>
    fillStops(start, end).every((color) => passesOn(color, grounds, target));
  // A tie: moving either end alone first passes at 36%, so the start moves.
  assert.deepEqual(solveSignature('#0040ff', '#c00040', text, grounds, 3), [
    mix('#0040ff', text, 36),
    '#c00040',
  ]);
  assert.ok(
    passes('#0040ff', mix('#c00040', text, 36), 3 + HEADROOM),
    'the end alone passes at 36% too',
  );
  // Neither end alone can pass, so both move: the least total of the two steps,
  // and at that total, the least on the start.
  // #000080 passes at a total of 70 split 36 and 34, or 38 and 32: the start takes the lesser.
  const [start, end] = ['#000000', '#000080'];
  const [solvedStart, solvedEnd] = solveSignature(start, end, text, grounds, 3);
  const step = (from: string, to: string) =>
    [...Array(51).keys()].map((n) => n * 2).find((n) => mix(from, text, n) === to)!;
  const [a, b] = [step(start, solvedStart), step(end, solvedEnd)];
  assert.ok(a > 0 && b > 0, 'both ends move');
  assert.ok(passes(solvedStart, solvedEnd, 3 + HEADROOM));
  assert.deepEqual([a, b], [36, 34]);
  for (let total = 4; total <= a + b; total += 2) {
    for (let first = Math.max(2, total - 100); first <= Math.min(100, total - 2); first += 2) {
      if (total === a + b && first >= a) break;
      assert.equal(
        passes(mix(start, text, first), mix(end, text, total - first), 3 + HEADROOM),
        false,
        `${first}% and ${total - first}% would pass with less`,
      );
    }
  }
});

test('property: the signature fill moves the fewest ends by the least step', () => {
  for (const { label, anchors, mode } of CORPUS) {
    const set = anchorV1(anchors, mode);
    const target = ANCHOR_V2_TARGETS.signature;
    const [start, end] = [set['signature-start'], set['signature-end']];
    const [solvedStart, solvedEnd] = solveSignature(
      start,
      end,
      anchors.text,
      groundsOf(set),
      target,
    );
    if (fillWorst(set, start, end) >= target) {
      assert.deepEqual([solvedStart, solvedEnd], [start, end], `${label} passed, so it stays`);
      continue;
    }
    assert.ok(fillWorst(set, solvedStart, solvedEnd) >= target + HEADROOM, label);
    const steps = (from: string, to: string) =>
      [...Array(51).keys()]
        .map((step) => step * 2)
        .find((step) => mix(from, anchors.text, step) === to);
    const first = steps(start, solvedStart)!;
    const second = steps(end, solvedEnd)!;
    assert.ok(first !== undefined && second !== undefined, `${label}: both ends move toward text`);
    const single = (percent: number) =>
      fillWorst(set, mix(start, anchors.text, percent), end) >= target + HEADROOM ||
      fillWorst(set, start, mix(end, anchors.text, percent)) >= target + HEADROOM;
    if (first === 0 || second === 0) {
      // One end moved: no smaller step of either end passes.
      const moved = first || second;
      for (let percent = 2; percent < moved; percent += 2)
        assert.ok(!single(percent), `${label}: ${percent}% would do`);
    } else {
      // Both moved: no single end passes at any step.
      for (let percent = 2; percent <= 100; percent += 2)
        assert.ok(!single(percent), `${label}: one end at ${percent}% would do`);
    }
  }
});

test('property: the categorical walk keeps a passing color, and moves a failing one the least lightness that passes and keeps apart', () => {
  for (const { label, anchors, mode } of CORPUS) {
    const before = anchorV1(anchors, mode);
    const after = anchorV2(anchors, mode);
    const starts = [
      anchors.accent,
      anchors.secondary,
      before.positive,
      before.warning,
      before.danger,
      after['text-secondary'],
    ];
    const ground = after['surface-default'];
    const target = ANCHOR_V2_TARGETS.nonText;
    const solved = CATEGORICAL.map((role) => after[role]);
    solved.forEach((color, index) => {
      const earlier = solved.slice(0, index);
      const keeps = (candidate: string, limit: number) =>
        contrast(candidate, ground) >= limit &&
        earlier.every((other) => deltaE(candidate, other) >= CATEGORICAL_DELTA);
      const start = starts[index]!;
      if (keeps(start, target)) {
        assert.equal(color, start, `${label}: categorical ${index + 1} passed, so it stays`);
        return;
      }
      if (color === anchors.text) return; // No lightness step passed.
      assert.ok(keeps(color, target + HEADROOM), `${label}: categorical ${index + 1}`);
      const moved = Math.round(Math.abs(lightness(color) - lightness(start)) / 0.02);
      for (let step = 1; step < moved; step += 1) {
        for (const direction of [-1, 1]) {
          const value = lightness(start) + direction * 0.02 * step;
          if (value < 0 || value > 1) continue;
          assert.ok(
            !keeps(withLightness(start, value), target + HEADROOM),
            `${label}: categorical ${index + 1} at ${step} steps would do`,
          );
        }
      }
    });
    assert.deepEqual(categoricalWalk(starts, ground, target, anchors.text), solved, label);
  }
});

test('property: monotonic: while a target is reachable, a higher one never lowers a solved role, nor moves it less', () => {
  const ladder: SolveTargets[] = [1, 1.05, 1.1, 1.15, 1.2].map((raise) => ({
    text: GATE_TARGETS.text * raise,
    nonText: GATE_TARGETS.nonText * raise,
    signature: GATE_TARGETS.largeText * raise,
  }));
  for (const { label, anchors, mode } of CORPUS) {
    const before = anchorV1(anchors, mode);
    const sets = ladder.map((targets) => anchorV2(anchors, mode, targets));
    for (let rung = 1; rung < sets.length; rung += 1) {
      const [lower, higher] = [sets[rung - 1]!, sets[rung]!];
      // Past what even the text color reads at, a role is the text color: the target isn't reachable.
      if (worst(higher, anchors.text) < ladder[rung]!.text) break;
      for (const [role] of TOWARD_TEXT) {
        assert.ok(
          worst(higher, higher[role]) >= worst(lower, lower[role]) - 1e-9,
          `${label}: ${role} at rung ${rung}`,
        );
        assert.ok(
          deltaE(before[role], higher[role]) >= deltaE(before[role], lower[role]) - 1e-9,
          `${label}: ${role} moves at least as far at rung ${rung}`,
        );
      }
      assert.ok(
        fillWorst(higher, higher['signature-start'], higher['signature-end']) >=
          Math.min(
            fillWorst(lower, lower['signature-start'], lower['signature-end']),
            ladder[rung]!.signature,
          ) -
            1e-9,
        `${label}: signature at rung ${rung}`,
      );
      for (const role of CATEGORICAL) {
        assert.ok(
          contrast(higher[role], higher['surface-default']) >= ladder[rung]!.nonText,
          label,
        );
      }
    }
  }
});

test('the walk steps away from the ground first: darker under dark text, lighter under light text', () => {
  // A gray on itself fails; one step either way passes a low limit, so the order decides.
  const gray = '#808080';
  const darker = walkCategorical(gray, gray, 1.1, [], '#000000');
  const lighter = walkCategorical(gray, gray, 1.1, [], '#ffffff');
  assert.ok(lightness(darker) < lightness(gray), darker);
  assert.ok(lightness(lighter) > lightness(gray), lighter);
  assert.equal(walkCategorical(gray, '#ffffff', 3, [], '#000000'), gray, 'a passing start stays');
});

test('deterministic: the same anchors give the same sets and the same record, whatever object holds them', () => {
  for (const { anchors } of SHIPPING) {
    for (const mode of ['light', 'dark'] as const) {
      const each = anchors[mode];
      if (!each) continue;
      assert.deepEqual(anchorV2(each, mode), anchorV2({ ...each }, mode));
      assert.deepEqual(anchorV2(each, mode), anchorV2(JSON.parse(JSON.stringify(each)), mode));
    }
    assert.deepEqual(anchorV2Adjustments(anchors), anchorV2Adjustments({ ...anchors }));
  }
});

test('high-contrast-v2 moves accent-text to 7.7:1 plus headroom, and walks the categorical colors at 4.95:1', () => {
  for (const { id, anchors } of SHIPPING) {
    const base = {
      ...(anchors.light ? { light: anchorV2(anchors.light, 'light') } : {}),
      ...(anchors.dark ? { dark: anchorV2(anchors.dark, 'dark') } : {}),
    };
    for (const polarity of ['light', 'dark'] as const) {
      const before = highContrastV1(base, polarity);
      const after = highContrastV2(base, polarity);
      for (const role of Object.keys(before) as ColorRole[]) {
        if (!SOLVED.includes(role)) assert.equal(after[role], before[role], `${id} ${role}`);
      }
      assert.ok(worst(after, after['accent-text']) >= HIGH_CONTRAST_V2_TARGETS.text, id);
      if (worst(before, before['accent-text']) < HIGH_CONTRAST_V2_TARGETS.text)
        assert.ok(worst(after, after['accent-text']) >= HIGH_CONTRAST_V2_TARGETS.text + HEADROOM);
      // The gate paints high contrast's signature text-primary, so the ends stay.
      assert.equal(after['signature-start'], before['signature-start']);
      assert.equal(after['signature-end'], before['signature-end']);
    }
  }
});

test('the record names every move and only moves, set by set', () => {
  for (const { id, anchors } of SHIPPING) {
    const record = anchorV2Adjustments(anchors);
    for (const mode of ['light', 'dark'] as const) {
      const each = anchors[mode];
      if (!each) {
        assert.equal(record[mode], undefined);
        continue;
      }
      const before = anchorV1(each, mode);
      const after = anchorV2(each, mode);
      for (const role of Object.keys(after) as ColorRole[]) {
        const move = record[mode]?.[role];
        if (before[role] === after[role]) assert.equal(move, undefined, `${id} ${mode} ${role}`);
        else assert.deepEqual(move, [before[role], after[role]], `${id} ${mode} ${role}`);
      }
    }
    if (!anchors.dark) assert.equal(record['high-contrast-dark'], undefined, id);
  }
});
