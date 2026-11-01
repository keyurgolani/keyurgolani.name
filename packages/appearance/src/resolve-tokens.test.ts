import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anchorV1,
  anchorV2,
  highContrastV1,
  contrast,
  DERIVED_ROLES,
  FOCUS_TARGETS,
  GENERATOR_V1_FOCUS_TARGETS,
  highContrastV2,
  onColor,
  resolveTokens,
  withDerivedRoles,
  type ColorTokens,
} from './index';
import {
  DARK_ONLY,
  HUMANIST_UI,
  PACKS,
  PLATFORM_NEUTRAL,
  testRegistry,
  WARM_PARCHMENT,
} from './test-support/packs';
import type { MetaPack } from './registry';

const registry = testRegistry();
const FALLBACKS = {
  designLanguage: 'platform-neutral',
  colorScheme: 'warm-parchment',
  typography: 'humanist-ui',
};
// warm-parchment derives with anchor-v2 (#20 PR 2c); the fixture schemes stay on anchor-v1.
const LIGHT = anchorV2(WARM_PARCHMENT.anchors!.light!, 'light');
const DARK = anchorV2(WARM_PARCHMENT.anchors!.dark!, 'dark');

test("it gives the packs' typed values for a polarity", () => {
  const tokens = resolveTokens(registry, { ...FALLBACKS, polarity: 'dark' });
  assert.deepEqual(tokens.packs, FALLBACKS);
  assert.deepEqual(tokens.fallbackAxes, []);
  assert.equal(tokens.polarity, 'dark');
  assert.equal(tokens.highContrast, false);
  assert.deepEqual(tokens.color, DARK);
  assert.equal(tokens.language, PLATFORM_NEUTRAL.tokens);
  assert.equal(tokens.typography, HUMANIST_UI.roles);
  assert.equal(tokens.typography.body['font-size'], '1rem');
  assert.equal(tokens.typography.body['line-height'], 1.65);
  assert.deepEqual(tokens.measures, { body: '68ch', compact: '52ch' });
  assert.deepEqual(resolveTokens(registry, { ...FALLBACKS, polarity: 'light' }).color, LIGHT);
});

test('a single-mode scheme gives its native mode whichever polarity is asked', () => {
  const tokens = resolveTokens(registry, {
    ...FALLBACKS,
    colorScheme: 'fixture-dark-only',
    polarity: 'light',
  });
  assert.equal(tokens.polarity, 'dark');
  assert.deepEqual(tokens.color, anchorV1(DARK_ONLY.anchors!.dark!, 'dark'));
});

test('high contrast gives the derived set of the polarity, or the authored one', () => {
  const derived = resolveTokens(registry, { ...FALLBACKS, polarity: 'light', highContrast: true });
  assert.equal(derived.highContrast, true);
  assert.deepEqual(derived.color, highContrastV2({ light: LIGHT, dark: DARK }, 'light'));
  // Asked twice, the derived set is the same one.
  assert.equal(
    resolveTokens(registry, { ...FALLBACKS, polarity: 'light', highContrast: true }).color,
    derived.color,
  );

  const authored: ColorTokens = { ...highContrastV1({ dark: DARK }, 'dark'), accent: '#ffd700' };
  const packs = PACKS.map((pack) =>
    pack.manifest.id === 'fixture-dark-only'
      ? ({ ...pack, manifest: { ...DARK_ONLY, highContrast: { dark: authored } } } as MetaPack)
      : pack,
  );
  const withAuthored = resolveTokens(testRegistry(packs), {
    ...FALLBACKS,
    colorScheme: 'fixture-dark-only',
    polarity: 'light',
    highContrast: true,
  });
  assert.equal(withAuthored.polarity, 'dark');
  assert.equal(withAuthored.color, authored);
});

test('an unregistered pack, or a generator scheme with nothing generated, gives its axis fallback', () => {
  const tokens = resolveTokens(registry, {
    designLanguage: 'missing-pack',
    colorScheme: 'fixture-seed',
    typography: 'multilingual-system',
    polarity: 'light',
  });
  assert.deepEqual(tokens.packs, { ...FALLBACKS, typography: 'multilingual-system' });
  assert.deepEqual(tokens.fallbackAxes, ['designLanguage', 'colorScheme']);
  assert.deepEqual(tokens.color, LIGHT);

  const light = { ...LIGHT, accent: '#123456' };
  const generated = resolveTokens(
    registry,
    { ...FALLBACKS, colorScheme: 'fixture-seed', polarity: 'light' },
    { generated: { 'fixture-seed': { light, dark: DARK } } },
  );
  assert.deepEqual(generated.fallbackAxes, []);
  assert.equal(generated.color, light);
  const contrast = resolveTokens(
    registry,
    { ...FALLBACKS, colorScheme: 'fixture-seed', polarity: 'dark', highContrast: true },
    { generated: { 'fixture-seed': { light, dark: DARK } } },
  );
  // A generated scheme's high-contrast set is high-contrast-v1's, whatever its values.
  assert.deepEqual(contrast.color, highContrastV1({ light, dark: DARK }, 'dark'));
});

test("#22's social image: system takes the light values, high-contrast the light high-contrast set or the native one", () => {
  const image = (colorScheme: string, displayMode: 'system' | 'light' | 'dark' | 'high-contrast') =>
    resolveTokens(registry, {
      ...FALLBACKS,
      colorScheme,
      polarity: displayMode === 'dark' ? 'dark' : 'light',
      highContrast: displayMode === 'high-contrast',
    }).color.canvas;
  assert.equal(image('warm-parchment', 'system'), LIGHT.canvas);
  assert.equal(image('warm-parchment', 'dark'), DARK.canvas);
  assert.equal(image('warm-parchment', 'high-contrast'), '#ffffff');
  assert.equal(image('fixture-dark-only', 'system'), DARK_ONLY.anchors!.dark!.canvas);
  assert.equal(image('fixture-dark-only', 'high-contrast'), '#000000');
});

test('a stored generated scheme from before K-2 renders with the three roles K-2 added, worked out from its others as its generator at version 1 does', () => {
  const v1 = (set: ColorTokens) =>
    Object.fromEntries(
      Object.entries(set).filter(([role]) => !(DERIVED_ROLES as readonly string[]).includes(role)),
    ) as unknown as ColorTokens;
  const light = { ...v1(LIGHT), accent: '#123456' };
  const tokens = resolveTokens(
    registry,
    { ...FALLBACKS, colorScheme: 'fixture-seed', polarity: 'light' },
    { generated: { 'fixture-seed': { light, dark: v1(DARK) } } },
  );
  assert.deepEqual(tokens.color, withDerivedRoles(light, false, GENERATOR_V1_FOCUS_TARGETS));
  // focus-inverse at version 1's 3.5:1, not a scheme pack's 4.5:1: here they differ.
  assert.notDeepEqual(tokens.color, withDerivedRoles(light, false, FOCUS_TARGETS));
  const inverse = contrast(tokens.color['focus-inverse'], light['text-primary']);
  assert.ok(inverse >= 3.5 && inverse < 4.5, `focus-inverse ${inverse}`);
  assert.equal(tokens.color['on-emphasis'], onColor(light.emphasis));
  assert.ok(DERIVED_ROLES.every((role) => tokens.color[role] !== undefined));
});
