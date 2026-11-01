// Focus at 4.5:1 (lead A's ruling, 11-01): every base set a scheme pack
// derives rings at 4.5:1 or better on its worst ground, canvas or a surface,
// and its inverse ring at 4.5:1 or better on text-primary, while #20's
// generators, at version 1, stay frozen at the targets they shipped with,
// 3:1 (3.3:1 once anchor-v2 raises it) and 3.5:1, so their records keep
// their bytes. The numbers below are this file's own copies.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchorV2, type AnchorsV2 } from './anchor-v2';
import { contrast, mix } from './color';
import { coreRoles, withDerivedRoles } from './derived-roles';
import { BRAND_SEED, FIXTURE_SEED, HCT_TONAL } from './generators/index';
import { deriveBaseSet, generatedSchemeSets } from './sets';
import { FOCUS_TARGETS, GENERATOR_V1_FOCUS_TARGETS, type FocusTargets } from './solve';
import type { ColorRole, ColorTokens } from './roles';
import { randomHex, seeded } from './test-support/packs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PACKS = path.resolve(here, '../../appearance-schemes/packs');
const GROUNDS = [
  'canvas',
  'surface-subtle',
  'surface-default',
  'surface-prominent',
  'surface-overlay',
] as const satisfies readonly ColorRole[];
const HEADROOM = 0.1;

const worst = (set: ColorTokens, color: string) =>
  Math.min(...GROUNDS.map((role) => contrast(color, set[role])));

/** Every anchored scheme pack's manifest: the ones whose base sets a derivation makes. */
const ANCHORED = fs
  .readdirSync(PACKS)
  .sort()
  .map((id) => JSON.parse(fs.readFileSync(path.join(PACKS, id, 'manifest.json'), 'utf8')))
  .filter((manifest) => manifest.anchors !== undefined) as {
  id: string;
  derivation: string;
  anchors: { light?: AnchorsV2; dark?: AnchorsV2 };
}[];

/** Each base set's focus or focus-inverse under 4.5:1 where it's read, by scheme and mode. */
function shortfalls(derive: (anchors: AnchorsV2, mode: 'light' | 'dark') => ColorTokens): string[] {
  const out: string[] = [];
  for (const { id, anchors } of ANCHORED) {
    for (const mode of ['light', 'dark'] as const) {
      if (!anchors[mode]) continue;
      const set = derive(anchors[mode]!, mode);
      const ring = worst(set, set.focus);
      if (ring < 4.5) out.push(`${id} ${mode} focus ${ring.toFixed(2)}`);
      const inverse = contrast(set['focus-inverse'], set['text-primary']);
      if (inverse < 4.5) out.push(`${id} ${mode} focus-inverse ${inverse.toFixed(2)}`);
    }
  }
  return out;
}

test('the focus targets: 4.5:1 for a scheme pack, and 3:1 and 3.5:1 frozen for a generator at version 1', () => {
  assert.deepEqual(FOCUS_TARGETS, { focus: 4.5, focusInverse: 4.5 });
  assert.deepEqual(GENERATOR_V1_FOCUS_TARGETS, { focus: 3, focusInverse: 3.5 });
  assert.ok(Object.isFrozen(FOCUS_TARGETS) && Object.isFrozen(GENERATOR_V1_FOCUS_TARGETS));
});

test('every derived base set of every scheme pack rings at 4.5:1 on its worst ground, and its inverse ring at 4.5:1 on text-primary', () => {
  assert.ok(ANCHORED.length >= 30, `${ANCHORED.length} anchored packs`);
  const derivations = new Set(ANCHORED.map((manifest) => manifest.derivation));
  assert.deepEqual([...derivations], ['anchor-v2']);
  assert.deepEqual(
    shortfalls((anchors, mode) => deriveBaseSet('anchor-v2', anchors, mode)),
    [],
  );
});

/** Every authored scheme pack's base sets: no anchors and no generator, each set as its manifest gives it. */
const AUTHORED = fs
  .readdirSync(PACKS)
  .sort()
  .map((id) => JSON.parse(fs.readFileSync(path.join(PACKS, id, 'manifest.json'), 'utf8')))
  .filter((manifest) => manifest.anchors === undefined && manifest.generator === undefined)
  .flatMap((manifest) =>
    (['light', 'dark'] as const)
      .filter((mode) => manifest[mode])
      .map((mode) => ({ label: `${manifest.id} ${mode}`, set: manifest[mode] as ColorTokens })),
  );

test('every authored base set of every scheme pack rings at 4.5:1 too, and its derived inverse ring', () => {
  assert.ok(AUTHORED.length >= 1);
  for (const { label, set: authored } of AUTHORED) {
    // An authored set may leave the roles K-2 added out; rendering works them out to the packs' targets.
    const set = withDerivedRoles(coreRoles(authored), false);
    assert.ok(worst(set, set.focus) >= 4.5, `${label} focus ${worst(set, set.focus)}`);
    const inverse = contrast(set['focus-inverse'], set['text-primary']);
    assert.ok(inverse >= 4.5, `${label} focus-inverse ${inverse}`);
  }
  // The check has teeth: poster-primaries' light focus before its fix, its accent, read 3.83:1 on the yellow.
  const poster = AUTHORED.find(({ label }) => label === 'poster-primaries light')!.set;
  assert.ok(worst(poster, '#2b50ff') < 4.5);
});

test('a mutant that puts focus back at 3:1 and focus-inverse at 3.5:1 fails the 4.5:1 check, warm-parchment light among them', () => {
  const mutant = (targets: FocusTargets) => (anchors: AnchorsV2, mode: 'light' | 'dark') =>
    anchorV2(anchors, mode, undefined, targets);
  const found = shortfalls(mutant({ focus: 3, focusInverse: 3.5 }));
  // The 32 derived base sets whose ring 4.5:1 moved, and the 54 whose inverse ring it moved
  // (the bound report's 55 less poster-primaries, whose authored light set has no anchors).
  assert.equal(found.filter((each) => each.includes(' focus ')).length, 32);
  assert.equal(found.filter((each) => each.includes(' focus-inverse ')).length, 54);
  // warm-parchment light's ring, the one Flux's review measured, at 3.42:1 on surface-prominent.
  assert.ok(found.includes('warm-parchment light focus 3.42'), found.join('\n'));
  // Each target alone has teeth: either one put back fails its own role and only it.
  assert.ok(
    shortfalls(mutant({ focus: 3, focusInverse: 4.5 })).every((each) => each.includes(' focus ')),
  );
  assert.ok(
    shortfalls(mutant({ focus: 4.5, focusInverse: 3.5 })).every((each) =>
      each.includes(' focus-inverse '),
    ),
  );
});

/** focus as version 1 solves it: the accent mixed toward text in 2% steps to 3:1, then on to 3.3:1, each plus the headroom. */
function v1Focus(set: ColorTokens, accent: string, raised: boolean): string {
  const text = set['text-primary'];
  const solve = (start: string, limit: number) => {
    if (worst(set, start) >= limit) return start;
    for (let percent = 2; percent <= 100; percent += 2) {
      const candidate = mix(start, text, percent);
      if (worst(set, candidate) >= limit + HEADROOM) return candidate;
    }
    return text;
  };
  const first = solve(accent, 3);
  return raised ? solve(first, 3.3) : first;
}

/** focus-inverse as version 1 derives it: the accent mixed toward the canvas in 2% steps to 3.5:1 on text-primary, plus the headroom. */
function v1FocusInverse(set: ColorTokens): string {
  const on = set['text-primary'];
  if (contrast(set.accent, on) >= 3.5) return set.accent;
  for (let percent = 2; percent <= 100; percent += 2) {
    const candidate = mix(set.accent, set.canvas, percent);
    if (contrast(candidate, on) >= 3.5 + HEADROOM) return candidate;
  }
  return set.canvas;
}

test('the generators at version 1 stay frozen at 3:1 and 3.5:1: what they make, and what a stored record renders', () => {
  const random = seeded(4545);
  const seeds = [
    '#5b5bd6',
    '#b95f32',
    '#0f9f88',
    ...Array.from({ length: 40 }, () => randomHex(random)),
  ];
  let differs = 0;
  for (const generator of [FIXTURE_SEED, BRAND_SEED, HCT_TONAL]) {
    assert.equal(generator.version, 1, generator.id);
    for (const seed of seeds) {
      const tokens = generator.generate({ seedColor: seed });
      // A record stores the sets without the roles K-2 added; rendering works them out again.
      const rendered = generatedSchemeSets({
        light: coreRoles(tokens.light),
        dark: coreRoles(tokens.dark),
        ...(tokens.highContrast && {
          highContrast: {
            light: coreRoles(tokens.highContrast.light),
            dark: coreRoles(tokens.highContrast.dark),
          },
        }),
      });
      for (const mode of ['light', 'dark'] as const) {
        const set = tokens[mode];
        const label = `${generator.id} ${seed} ${mode}`;
        // fixture-seed solves with anchor-v1 alone; the #20 generators with anchor-v2 on top.
        const raised = generator.id !== FIXTURE_SEED.id;
        assert.equal(set.focus, v1Focus(set, set.accent, raised), `${label} focus`);
        assert.equal(set['focus-inverse'], v1FocusInverse(set), `${label} focus-inverse`);
        assert.equal(rendered[mode]!['focus-inverse'], set['focus-inverse'], `${label} rendered`);
        if (
          worst(set, set.focus) < 4.5 ||
          contrast(set['focus-inverse'], set['text-primary']) < 4.5
        )
          differs += 1;
      }
    }
  }
  // Frozen, not coincidentally equal: plenty of these sets sit under the packs' 4.5:1.
  assert.ok(differs > 20, `${differs} generated sets under 4.5:1`);
});
