import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  COLOR_SET_NAMES,
  contrast,
  FOCUS_INVERSE_TARGETS,
  GATE_TARGETS,
  isHighContrastSet,
  luminance,
  schemeSets,
  type ColorSchemeManifest,
} from '@portfolio/appearance';
import { catalogPacks, packPackages, schemeBaseSets } from '@portfolio/appearance/node';
import { generatedEntries, referenceSets } from './catalog-generated';

// The surface pairings a composition may place a band on (the redesign
// brief's F1 and F2), in every shipping color scheme and every set it
// renders: the matte pair, on-scrim on scrim, and the inverse pair, a ground
// of text-primary with text-inverse ink. Both reach the text target, 4.5:1,
// and 7:1 in a high-contrast set. check:appearance already gates the matte
// pair; text-inverse is the canvas, so the inverse pair follows from
// text-primary on the canvas. This test pins both by name, so a scheme that
// changes either role can't quietly drop one.
//
// K-2 adds the pairs its surface hook and its three roles
// promise, in the same sets: on-accent on accent at body size, 4.5:1,
// authored schemes included; on-emphasis on emphasis at 4.58:1;
// focus-inverse on text-primary at 3.5:1, and 4.5:1 in high contrast; and
// text-primary on surface-lit at 4.95:1, surface-lit lighter than
// surface-prominent in a base set and the canvas in a high-contrast one.

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function shippingSchemes() {
  const packages = packPackages(ROOT).filter((pkg) => !pkg.fixture);
  const generated = referenceSets(generatedEntries(ROOT, packages).entries);
  const schemes = [];
  for (const pack of catalogPacks(ROOT, packages)) {
    if (pack.axis !== 'colorScheme' || !pack.manifest) continue;
    const manifest = pack.manifest as unknown as ColorSchemeManifest;
    const base = schemeBaseSets(manifest);
    if (base) {
      schemes.push({
        id: pack.id,
        sets: schemeSets(base, manifest.highContrast, manifest.derivation, manifest.anchors),
      });
      continue;
    }
    // A generator scheme ships with its reference record's sets, as check:appearance gates it.
    const record = generated[pack.id];
    if (record) schemes.push({ id: pack.id, sets: schemeSets(record, record.highContrast) });
  }
  return schemes;
}

test('every shipping scheme holds the matte and the inverse pair at the text target in every set it renders', () => {
  const schemes = shippingSchemes();
  assert.ok(schemes.length >= 25, `${schemes.length} shipping schemes`);
  const failures: string[] = [];
  let checked = 0;
  for (const { id, sets } of schemes) {
    for (const name of COLOR_SET_NAMES) {
      const set = sets[name];
      if (!set) continue;
      const target = isHighContrastSet(name) ? GATE_TARGETS.highContrastText : GATE_TARGETS.text;
      const pairs = [
        ['matte', set['on-scrim'], set.scrim],
        ['inverse', set['text-inverse'], set['text-primary']],
      ] as const;
      for (const [pair, ink, ground] of pairs) {
        checked++;
        const ratio = contrast(ink, ground);
        if (ratio < target)
          failures.push(`${id} ${name} ${pair}: ${ratio.toFixed(2)}:1 < ${target}`);
      }
    }
  }
  assert.deepEqual(failures, []);
  assert.ok(checked > 100, `${checked} pairs checked`);
});

test('every shipping scheme holds the pairs of the roles K-2 added in every set it renders', () => {
  const schemes = shippingSchemes();
  const failures: string[] = [];
  let checked = 0;
  for (const { id, sets } of schemes) {
    for (const name of COLOR_SET_NAMES) {
      const set = sets[name];
      if (!set) continue;
      const high = isHighContrastSet(name);
      const pairs = [
        ['on-accent on accent', set['on-accent'], set.accent, 4.5],
        ['on-emphasis on emphasis', set['on-emphasis'], set.emphasis, 4.58],
        [
          'focus-inverse on text-primary',
          set['focus-inverse'],
          set['text-primary'],
          high ? FOCUS_INVERSE_TARGETS.highContrast : FOCUS_INVERSE_TARGETS.base,
        ],
        ['text-primary on surface-lit', set['text-primary'], set['surface-lit'], 4.95],
      ] as const;
      for (const [pair, ink, ground, target] of pairs) {
        checked++;
        const ratio = contrast(ink, ground);
        if (ratio < target)
          failures.push(`${id} ${name} ${pair}: ${ratio.toFixed(2)}:1 < ${target}`);
      }
      if (high && set['surface-lit'] !== set.canvas)
        failures.push(`${id} ${name}: surface-lit isn't the canvas`);
      if (!high && luminance(set['surface-lit']) <= luminance(set['surface-prominent']))
        failures.push(`${id} ${name}: surface-lit isn't lighter than surface-prominent`);
    }
  }
  assert.deepEqual(failures, []);
  assert.ok(checked > 200, `${checked} pairs checked`);
  // The brief's measure: warm-parchment's light on-accent, 4.75:1 to two places.
  const warm = schemes.find(({ id }) => id === 'warm-parchment')!.sets.light!;
  assert.equal(contrast(warm['on-accent'], warm.accent).toFixed(2), '4.75');
});
