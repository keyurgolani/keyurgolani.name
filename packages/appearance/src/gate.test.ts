import test from 'node:test';
import assert from 'node:assert/strict';
import { contrast, mix } from './color';
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
// compositing at surface-opacity over the worst backdrop, and text read
// over a texture's worst pixel (#20 PR 2b), by the refined body.

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

// apps/web/scripts/appearance-targets.test.ts holds these to quality/thresholds.json.
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
      focusWidth: 2,
      largeTextPt: 18,
      largeBoldTextPt: 14,
      largeBoldWeight: 700,
    },
  );
});

test('a caller can pass targets of its own, as check:appearance passes the thresholds file', () => {
  const strict = { ...GATE_TARGETS, text: 21 };
  const light = gateSet(SETS.light!, 'light', language(), SMALL_SIGNATURE, strict);
  assert.equal(find(light, 'text-primary', 'canvas').target, 21);
  assert.equal(find(light, 'text-primary', 'canvas').passes, false);
  assert.equal(find(light, 'focus', 'canvas').target, GATE_TARGETS.nonText);
  // Large text is the targets' too: 1.25rem (15pt) is large once 15pt is.
  const role = { ...HUMANIST_UI.roles.body, 'font-size': '1.25rem', 'font-weight': 400 };
  assert.equal(isLargeText(role), false);
  assert.equal(isLargeText(role, { ...GATE_TARGETS, largeTextPt: 15 }), true);
  const report = contrastReport(SETS, NEUTRAL_LANGUAGE, SMALL_SIGNATURE, strict);
  assert.equal(report.passes, false);
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

const MEMPHIS =
  'radial-gradient(circle at 25% 25%, color-mix(in srgb, var(--color-accent) 20%, transparent) 0 8%, transparent 9%), radial-gradient(circle at 75% 70%, color-mix(in srgb, var(--color-information) 18%, transparent) 0 10%, transparent 11%)';
const SCANLINES =
  'repeating-linear-gradient(0deg, transparent 0 3px, color-mix(in srgb, var(--color-text-primary) 10%, transparent) 3px 4px)';
const GEOMETRIC =
  'conic-gradient(from 45deg, color-mix(in srgb, var(--color-accent) 12%, transparent) 0 25%, transparent 0 50%, color-mix(in srgb, var(--color-information) 10%, transparent) 0 75%, transparent 0)';
const HALFTONE = 'radial-gradient(circle, var(--color-border-strong) 0 1px, transparent 1.5px)';
const GRID =
  'linear-gradient(var(--color-border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--color-border-subtle) 1px, transparent 1px)';

test("a texture keeps every target; its surfaces are read under it, and the canvas and fills aren't", () => {
  const pairs = gateSet(SETS.light!, 'light', language({ texture: SCANLINES }), {
    largeSignature: true,
  });
  assert.equal(find(pairs, 'text-muted', 'canvas').target, 4.5);
  assert.equal(find(pairs, 'text-muted', 'canvas').texture, undefined);
  assert.equal(find(pairs, 'text-muted', 'surface-prominent').target, 4.5);
  assert.equal(find(pairs, 'text-muted', 'surface-prominent').texture, true);
  assert.equal(find(pairs, 'focus', 'surface-subtle').target, 3);
  assert.equal(find(pairs, 'data-categorical-1', 'surface-default').target, 3);
  assert.equal(find(pairs, 'signature-start to signature-end', 'canvas').target, 3);
  for (const [foreground, ground] of [
    ['on-accent', 'accent'],
    ['on-status', 'warning'],
    ['on-scrim', 'scrim'],
  ] as const) {
    assert.equal(find(pairs, foreground, ground).target, 4.5);
    assert.equal(find(pairs, foreground, ground).texture, undefined);
  }
  const high = gateSet(
    SETS['high-contrast-light']!,
    'high-contrast-light',
    language({ texture: SCANLINES }),
    SMALL_SIGNATURE,
  );
  assert.equal(find(high, 'text-primary', 'canvas').target, 7);
  assert.equal(find(high, 'focus', 'canvas').target, 4.5);
  assert.equal(find(high, 'on-accent', 'accent').target, 7);
});

// The flat raise this replaces held a textured language's text to 4.95:1 on
// the plain surface. A texture can cost more than that 10%: memphis's 20%
// accent dot does. A mutant that raises flat again passes this pair.
test("text is held to 4.5:1 over the texture's worst pixel, which a flat 10% raise misses", () => {
  const prominent = SETS.light!['surface-prominent'];
  let muted = SETS.light!['text-muted'];
  for (let percent = 2; contrast(muted, prominent) < 4.95; percent += 2) {
    muted = mix(SETS.light!['text-muted'], SETS.light!['text-primary'], percent);
  }
  const flat = contrast(muted, prominent);
  assert.ok(flat >= 4.95 && flat < 5.4, `flat ${flat}`);
  const set = { ...SETS.light!, 'text-muted': muted };
  const plain = find(
    gateSet(set, 'light', language(), SMALL_SIGNATURE),
    'text-muted',
    'surface-prominent',
  );
  assert.equal(plain.passes, true);
  const memphis = find(
    gateSet(set, 'light', language({ texture: MEMPHIS }), SMALL_SIGNATURE),
    'text-muted',
    'surface-prominent',
  );
  assert.equal(memphis.texture, true);
  assert.equal(memphis.target, 4.5);
  assert.equal(memphis.passes, false, `${memphis.ratio} over memphis's dot`);
  assert.ok(memphis.ratio < flat / 1.1, `${memphis.ratio} costs more than 10% of ${flat}`);
});

// What the quality cells' contrast sampler read, run 40157257841 and again
// locally, on warm-parchment's anchor-v2 light set: obsidian-atelier's room
// label (accent-text) and editorial-evidence's writing summary
// (text-primary), each over its surface's worst pixel. The gate reads each
// at or under the browser's number, so it never passes what the cells fail.
test("the gate reads a texture's worst pixel at or under the browser's contrast sampler", () => {
  const set = {
    ...SETS.light!,
    'surface-prominent': '#e2d9c9',
    'surface-default': '#eae1d0',
    'text-primary': '#2b241c',
    'accent-text': '#84492a',
    accent: '#b95f32',
    information: '#5f7653',
    'border-strong': '#797165',
  };
  for (const [texture, foreground, ground, browser] of [
    [GEOMETRIC, 'accent-text', 'surface-prominent', 4.41],
    [MEMPHIS, 'accent-text', 'surface-prominent', 4.04],
    [SCANLINES, 'accent-text', 'surface-prominent', 4.14],
    [HALFTONE, 'text-primary', 'surface-default', 3.18],
  ] as const) {
    const pair = find(
      gateSet(set, 'light', language({ texture }), SMALL_SIGNATURE),
      foreground,
      ground,
    );
    assert.equal(pair.texture, true, texture);
    assert.ok(
      pair.ratio <= browser,
      `${pair.ratio} over ${texture}, where the browser read ${browser}`,
    );
    assert.ok(
      pair.ratio >= browser - 0.1,
      `${pair.ratio} over ${texture}, near the browser's ${browser}`,
    );
  }
});

test('a texture drawn only where no text sits, such as a grid at the padding edge, adds no pixel', () => {
  assert.deepEqual(language({ texture: GRID }).texture, []);
  const pairs = gateSet(SETS.light!, 'light', language({ texture: GRID }), SMALL_SIGNATURE);
  assert.ok(pairs.every((pair) => pair.texture === undefined));
});

test("what the gate reads from a language, and what it can't compute fails", () => {
  assert.deepEqual(language(), {
    surfaceOpacity: 1,
    texture: [],
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
    [
      'texture',
      'linear-gradient(rgb(0 0 0 / 10%), transparent)',
      /--ui-texture has a color the gate can't measure/,
    ],
    [
      'texture',
      'radial-gradient(40px 20px, var(--color-accent), transparent)',
      /a radial size the gate can't read/,
    ],
    ['space-surface-block', 'auto', /space-surface-block and space-surface-inline must be lengths/],
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
