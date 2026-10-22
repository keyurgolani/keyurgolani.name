import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorV1 } from './derive';
import {
  contrastReport,
  GATE_TARGETS,
  gateLanguage,
  gateSet,
  gateTypography,
  isLargeText,
  NEUTRAL_LANGUAGE,
  SMALL_SIGNATURE,
  type GateLanguage,
  type GatePair,
} from './gate';
import { schemeSets } from './sets';
import type { LanguageTokens } from './tokens';
import { HUMANIST_UI, PLATFORM_NEUTRAL, WARM_PARCHMENT } from './test-support/packs';

// The computed gate (#19, Slice 2, items 2 and 8): the pairs, the targets,
// compositing at surface-opacity over the worst backdrop, and the texture
// raise, by the refined body.

const SETS = schemeSets({
  light: anchorV1(WARM_PARCHMENT.anchors!.light!, 'light'),
  dark: anchorV1(WARM_PARCHMENT.anchors!.dark!, 'dark'),
});

function language(tokens: Partial<LanguageTokens> = {}): GateLanguage {
  const read = gateLanguage({ ...PLATFORM_NEUTRAL.tokens, ...tokens });
  assert.ok(read.ok, JSON.stringify(read.ok ? null : read.problems));
  return read.language;
}

const find = (pairs: readonly GatePair[], foreground: string, ground: string) =>
  pairs.find((pair) => pair.foreground === foreground && pair.ground === ground)!;

test('the targets are the refined body and #11 targets', () => {
  assert.deepEqual(
    { ...GATE_TARGETS },
    {
      text: 4.5,
      largeText: 3,
      nonText: 3,
      highContrastText: 7,
      highContrastLargeText: 4.5,
      highContrastNonText: 4.5,
      textureRaise: 1.1,
      focusWidth: 2,
    },
  );
});

test('the fallback trio passes every pair in every set it renders', () => {
  const typography = gateTypography(HUMANIST_UI.roles);
  assert.equal(typography.largeSignature, true);
  for (const [name, set] of Object.entries(SETS)) {
    const pairs = gateSet(set!, name as never, language(), typography);
    assert.deepEqual(
      pairs.filter((pair) => !pair.passes),
      [],
      name,
    );
    // 4 text roles on 5 grounds, 8 fills, 5 signature, focus and border-strong on 5, 6 categorical, and focus-width.
    assert.equal(pairs.length, 20 + 8 + 5 + 10 + 6 + 1);
  }
});

test('the pairs and their targets, base and high-contrast', () => {
  const light = gateSet(SETS.light!, 'light', language(), SMALL_SIGNATURE);
  assert.equal(find(light, 'text-muted', 'surface-prominent').target, 4.5);
  assert.equal(find(light, 'on-accent', 'accent-hover').target, 4.5);
  assert.equal(find(light, 'on-status', 'information').target, 4.5);
  assert.equal(find(light, 'on-scrim', 'scrim').target, 4.5);
  assert.equal(find(light, 'focus', 'canvas').target, 3);
  assert.equal(find(light, 'border-strong', 'surface-default').target, 3);
  assert.equal(find(light, 'data-categorical-4', 'surface-default').target, 3);
  assert.equal(find(light, 'signature-start to signature-end', 'canvas').target, 4.5);
  assert.equal(find(light, 'focus-width', '').target, 2);
  const high = gateSet(
    SETS['high-contrast-dark']!,
    'high-contrast-dark',
    language(),
    gateTypography(HUMANIST_UI.roles),
  );
  assert.equal(find(high, 'text-primary', 'canvas').target, 7);
  assert.equal(find(high, 'on-accent', 'accent').target, 7);
  assert.equal(find(high, 'focus', 'surface-subtle').target, 4.5);
  // High contrast paints the signature fill solid text-primary, as large text here.
  assert.equal(find(high, 'text-primary', 'canvas').kind, 'text');
  const signature = high.find((pair) => pair.kind === 'large-text')!;
  assert.equal(signature.foreground, 'text-primary');
  assert.equal(signature.target, 4.5);
});

test('signature text needs 3:1 only when display and headline are both large text', () => {
  const small = {
    ...HUMANIST_UI.roles,
    headline: { ...HUMANIST_UI.roles.headline, 'font-size': '1rem' },
  };
  assert.equal(gateTypography(small).largeSignature, false);
  assert.equal(
    isLargeText({ ...HUMANIST_UI.roles.body, 'font-size': '1.5rem', 'font-weight': 400 }),
    true,
  );
  assert.equal(
    isLargeText({ ...HUMANIST_UI.roles.body, 'font-size': '1.1667rem', 'font-weight': 700 }),
    true,
  );
  assert.equal(
    isLargeText({ ...HUMANIST_UI.roles.body, 'font-size': '1.1667rem', 'font-weight': 650 }),
    false,
  );
  assert.equal(
    isLargeText({ ...HUMANIST_UI.roles.body, 'font-size': '1.1rem', 'font-weight': 700 }),
    false,
  );
  const large = gateSet(SETS.light!, 'light', language(), { largeSignature: true });
  assert.equal(find(large, 'signature-start to signature-end', 'canvas').target, 3);
  assert.equal(find(large, 'signature-start to signature-end', 'canvas').kind, 'large-text');
});

test('a translucent surface composites over the worst of canvas, black, and white', () => {
  const pairs = gateSet(
    SETS.light!,
    'light',
    language({ 'surface-opacity': '0.5' }),
    SMALL_SIGNATURE,
  );
  const muted = find(pairs, 'text-primary', 'surface-default');
  assert.equal(muted.backdrop, '#000000');
  assert.equal(muted.passes, false);
  // The canvas itself is opaque.
  assert.equal(find(pairs, 'text-primary', 'canvas').backdrop, undefined);
  // 100% and 1 composite nothing.
  for (const opacity of ['100%', '1']) {
    const opaque = gateSet(
      SETS.light!,
      'light',
      language({ 'surface-opacity': opacity }),
      SMALL_SIGNATURE,
    );
    assert.equal(find(opaque, 'text-primary', 'surface-default').backdrop, undefined);
  }
});

test('a texture raises the targets on canvas and surfaces by 10%, and fills keep theirs', () => {
  const pairs = gateSet(
    SETS.light!,
    'light',
    language({
      texture: 'radial-gradient(circle, var(--color-text-primary) 0 1px, transparent 1px)',
    }),
    { largeSignature: true },
  );
  assert.equal(find(pairs, 'text-muted', 'canvas').target, 4.95);
  assert.equal(find(pairs, 'focus', 'surface-subtle').target, 3.3);
  assert.equal(find(pairs, 'data-categorical-1', 'surface-default').target, 3.3);
  assert.equal(find(pairs, 'signature-start to signature-end', 'canvas').target, 3.3);
  assert.equal(find(pairs, 'on-accent', 'accent').target, 4.5);
  assert.equal(find(pairs, 'on-status', 'warning').target, 4.5);
  assert.equal(find(pairs, 'on-scrim', 'scrim').target, 4.5);
  const high = gateSet(
    SETS['high-contrast-light']!,
    'high-contrast-light',
    language({ texture: 'linear-gradient(var(--color-border-subtle), transparent)' }),
    SMALL_SIGNATURE,
  );
  assert.equal(find(high, 'text-primary', 'canvas').target, 7.7);
  assert.equal(find(high, 'focus', 'canvas').target, 4.95);
  assert.equal(find(high, 'on-accent', 'accent').target, 7);
});

test("what the gate reads from a language, and what it can't compute fails", () => {
  assert.deepEqual(language(), {
    surfaceOpacity: 1,
    textured: false,
    borderControl: 'border-strong',
    focusWidth: 2,
    signature: ['signature-start', 'signature-end'],
  });
  assert.equal(language({ 'surface-opacity': '72%' }).surfaceOpacity, 0.72);
  assert.equal(language({ 'focus-width': '0.1875rem' }).focusWidth, 3);
  assert.equal(language({ 'border-control': '0 solid' }).borderControl, null);
  assert.equal(language({ 'border-control': '1px solid transparent' }).borderControl, null);
  assert.equal(language({ 'border-control': '1px solid' }).borderControl, 'text-primary');
  assert.deepEqual(language({ 'signature-fill': 'none' }).signature, []);
  for (const [key, value, pattern] of [
    ['surface-opacity', 'calc(1 - 0.2)', /surface-opacity must be a number/],
    ['surface-opacity', '120%', /surface-opacity must be a number/],
    ['focus-width', 'thin', /focus-width must be a length/],
    [
      'border-control',
      '1px solid color-mix(in srgb, var(--color-accent) 50%, transparent)',
      /one var\(--color-<role>\)/,
    ],
    [
      'border-control',
      '1px solid var(--color-accent) var(--color-focus)',
      /one var\(--color-<role>\)/,
    ],
  ] as const) {
    const read = gateLanguage({ ...PLATFORM_NEUTRAL.tokens, [key]: value });
    assert.equal(read.ok, false, `${key}: ${value}`);
    assert.match(read.ok ? '' : read.problems.join('\n'), pattern);
  }
});

test('a focus ring under 2px fails, and a gradient fill is checked along its length', () => {
  const thin = gateSet(SETS.light!, 'light', language({ 'focus-width': '1px' }), SMALL_SIGNATURE);
  assert.equal(find(thin, 'focus-width', '').passes, false);
  assert.equal(find(thin, 'focus-width', '').ratio, 1);
  // A fill from text-primary to the canvas color fades out of contrast partway.
  const fade = gateSet(
    SETS.light!,
    'light',
    language({
      'signature-fill': 'linear-gradient(90deg, var(--color-text-primary), var(--color-canvas))',
    }),
    SMALL_SIGNATURE,
  );
  assert.equal(find(fade, 'text-primary to canvas', 'canvas').passes, false);
});

test("a scheme's own report covers each set with the neutral language and is stable", () => {
  // warm-parchment's signature colors read as large text only, so the strictest reading fails them, and only them.
  const strict = contrastReport(SETS);
  assert.equal(strict.passes, false);
  assert.ok(
    strict.pairs
      .filter((pair) => !pair.passes)
      .every((pair) => pair.foreground === 'signature-start to signature-end'),
  );
  const report = contrastReport(SETS, NEUTRAL_LANGUAGE, { largeSignature: true });
  assert.equal(report.passes, true);
  assert.deepEqual(contrastReport(SETS, NEUTRAL_LANGUAGE, { largeSignature: true }), report);
  assert.deepEqual(
    [...new Set(report.pairs.map((pair) => pair.set))],
    ['dark', 'high-contrast-dark', 'high-contrast-light', 'light'],
  );
  assert.equal(NEUTRAL_LANGUAGE.borderControl, 'border-strong');
  // A reported ratio rounds down, so it passes exactly when the reported number reaches its target.
  for (const pair of [...report.pairs, ...strict.pairs]) {
    assert.equal(pair.passes, pair.ratio >= pair.target, `${pair.foreground} on ${pair.ground}`);
  }
});
