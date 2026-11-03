import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { composite, contrast } from './color';
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
  MARK_MAX_PX,
  SHADOW_KEY_PEAK,
  shadowKey,
  textureLayers,
  type GateLanguage,
  type GatePair,
} from './gate';
import { schemeSets } from './sets';
import type { LanguageTokens } from './tokens';
import {
  HUMANIST_UI,
  PACKAGES_DIR,
  packDir,
  PLATFORM_NEUTRAL,
  shippingSchemeSets,
  WARM_PARCHMENT,
} from './test-support/packs';

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
      textureRaise: 1.1,
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
    // 4 text roles on 5 grounds, 9 fills, 5 signature, focus and border-strong on 5, text-primary
    // on surface-lit, focus-inverse on text-primary, and the lit surface's order (K-2), 6
    // categorical, and focus-width; and text-secondary on 5 beside each of its 2 shadow keys.
    assert.equal(pairs.length, 20 + 9 + 5 + 10 + 3 + 6 + 1 + 10);
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
    language({ texture: 'linear-gradient(var(--color-border-subtle) 1px, transparent 1px)' }),
    SMALL_SIGNATURE,
  );
  assert.equal(find(high, 'text-primary', 'canvas').target, 7.7);
  assert.equal(find(high, 'focus', 'canvas').target, 4.95);
  assert.equal(find(high, 'on-accent', 'accent').target, 7);
});

/** A ratio rounded down to two places, as the gate reports one. */
const floor = (value: number) => Math.floor(value * 100) / 100;
const mix = (role: string, percent: number) =>
  `color-mix(in srgb, var(--color-${role}) ${percent}%, transparent)`;
const wash = (role: string, percent: number) =>
  `linear-gradient(${mix(role, percent)}, ${mix(role, percent)})`;
const GRAIN =
  'radial-gradient(circle, color-mix(in srgb, var(--color-text-primary) 12%, transparent) 0 0.5px, transparent 0.75px)';
const read = (texture: string) => {
  const layers = textureLayers(texture);
  assert.deepEqual(layers.problems, [], texture);
  return { washes: layers.washes, marks: layers.marks };
};

test('a texture reads as washes and marks, failing closed (LANG-5c round 2)', () => {
  // Material 3's tonal tint: one flat wash.
  assert.deepEqual(read(wash('accent', 4)), { washes: [{ role: 'accent', percent: 4 }], marks: 0 });
  // Fluent's acrylic: a sheen from the top edge, a wash, over the grain, a mark.
  assert.deepEqual(read(`linear-gradient(${mix('canvas', 28)}, transparent 2.5rem), ${GRAIN}`), {
    washes: [{ role: 'canvas', percent: 28 }],
    marks: 1,
  });
  // The same wash however it's written: a direction, another color space, the share on the
  // transparent side, no share at all (50%), a first stop at 0, case and spacing.
  for (const [texture, percent] of [
    [`linear-gradient(to bottom, ${mix('accent', 8)}, ${mix('accent', 8)})`, 8],
    [`linear-gradient(180deg, ${mix('accent', 8)}, transparent)`, 8],
    ['linear-gradient(color-mix(in oklab, var(--color-accent) 8%, transparent), transparent)', 8],
    ['linear-gradient(color-mix(in srgb, var(--color-accent), transparent 92%), transparent)', 8],
    ['linear-gradient(color-mix(in srgb, transparent 92%, var(--color-accent)), transparent)', 8],
    ['linear-gradient(color-mix(in srgb, var(--color-accent), transparent), transparent)', 50],
    [`linear-gradient(${mix('accent', 8)} 0%, transparent)`, 8],
    [`linear-gradient(${mix('accent', 8)} 0, transparent 50%)`, 8],
    ['LINEAR-GRADIENT( Color-Mix(in srgb,var(--color-accent)  8% ,transparent) , transparent )', 8],
  ] as const) {
    assert.deepEqual(read(texture), { washes: [{ role: 'accent', percent }], marks: 0 }, texture);
  }
  // The strongest stop is the wash: a faint top over an opaque foot is an opaque wash.
  assert.deepEqual(read(`linear-gradient(${mix('accent', 4)}, var(--color-accent))`).washes, [
    { role: 'accent', percent: 100 },
  ]);
  // A band and a vignette are washes: the held iridescent sweep lays two roles.
  assert.deepEqual(
    read(
      `linear-gradient(120deg, ${mix('accent', 18)}, transparent 32%, ${mix('information', 16)} 68%, transparent)`,
    ).washes,
    [
      { role: 'accent', percent: 18 },
      { role: 'information', percent: 16 },
    ],
  );
  assert.deepEqual(read(`radial-gradient(${mix('accent', 30)}, transparent)`).washes, [
    { role: 'accent', percent: 30 },
  ]);
  // A circle sized in percent grows with the surface: a wash.
  assert.deepEqual(
    read(`radial-gradient(circle at 18% 22%, ${mix('accent', 18)} 0 8%, transparent 9%)`).washes,
    [{ role: 'accent', percent: 18 }],
  );
  // Every mark the shipping packs draw, and a band out at the mark bound.
  for (const mark of [
    GRAIN,
    'radial-gradient(circle at 8px 8px, var(--color-border-strong) 0 1px, transparent 1.5px)',
    'linear-gradient(var(--color-border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--color-border-subtle) 1px, transparent 1px)',
    `repeating-linear-gradient(0deg, transparent 0 3px, ${mix('border-subtle', 35)} 3px 4px)`,
    `repeating-linear-gradient(135deg, transparent 0 5px, ${mix('border-subtle', 50)} 5px 6px)`,
    `repeating-linear-gradient(90deg, ${mix('accent', 18)} 0 1px, transparent 1px 64px)`,
    `linear-gradient(135deg, ${mix('accent', 12)} 0 20px, transparent 20px), radial-gradient(circle at 75% 100%, ${mix('information', 10)} 0 14px, transparent 15px)`,
    `radial-gradient(circle at 25% 0, ${mix('accent', 20)} 0 14px, transparent 15px)`,
    `linear-gradient(${mix('accent', 12)} 0 1.5rem, transparent 1.5rem)`,
  ]) {
    const layers = read(mark);
    assert.deepEqual(layers.washes, [], mark);
    assert.ok(layers.marks > 0, mark);
  }
  // Past the bound, a band is a wash.
  assert.deepEqual(read(`linear-gradient(${mix('accent', 12)} 0 25px, transparent 25px)`).washes, [
    { role: 'accent', percent: 12 },
  ]);
  assert.equal(MARK_MAX_PX, 24);
  assert.deepEqual(textureLayers('none'), { washes: [], marks: 0, problems: [] });
  // What the gate can't read fails the gate, never passing as a mark.
  for (const unreadable of [
    wash('no-such-role', 4),
    'linear-gradient(red, transparent)',
    // An unreadable stop between readable ones is no direction to skip.
    'linear-gradient(var(--color-accent) 1px, red 1px, transparent 2px)',
    'linear-gradient(currentcolor 1px, transparent 1px)',
    'linear-gradient(color-mix(in srgb, var(--color-accent) 8%, var(--color-canvas)), transparent)',
    'url(grain.png)',
  ]) {
    assert.equal(textureLayers(unreadable).problems.length, 1, unreadable);
    const gate = gateLanguage({ ...PLATFORM_NEUTRAL.tokens, texture: unreadable });
    assert.equal(gate.ok, false, unreadable);
    assert.match(gate.ok ? '' : gate.problems.join('\n'), /can't tell a wash from a mark/);
  }
  assert.equal(language({ texture: wash('accent', 4) }).textured, false);
  assert.deepEqual(language({ texture: wash('accent', 4) }).washes, [
    { role: 'accent', percent: 4 },
  ]);
  // A texture with both: a mark raises, and the wash is still read.
  const both = language({ texture: `${wash('accent', 4)}, ${GRAIN}` });
  assert.equal(both.textured, true);
  assert.deepEqual(both.washes, [{ role: 'accent', percent: 4 }]);
});

test('a wash is composited over each surface, never the canvas, and its pairs keep their plain targets; a mark beside it raises them, the wash still composited', () => {
  const set = SETS.light!;
  const washed = gateSet(set, 'light', language({ texture: wash('text-primary', 60) }), {
    largeSignature: true,
  });
  const muted = find(washed, 'text-muted', 'surface-default');
  assert.equal(muted.target, 4.5);
  assert.equal(muted.passes, false);
  assert.equal(muted.wash, 'the 60% text-primary wash');
  assert.equal(muted.backdrop, undefined);
  assert.ok(muted.ratio < floor(contrast(set['text-muted'], set['surface-default'])));
  // The canvas takes no wash, and its pairs read as they did.
  const canvas = find(washed, 'text-muted', 'canvas');
  assert.equal(canvas.ratio, floor(contrast(set['text-muted'], set.canvas)));
  assert.equal(canvas.wash, undefined);
  // A wash with a mark: raised, and still composited.
  const both = gateSet(
    set,
    'light',
    language({ texture: `${wash('text-primary', 60)}, ${GRAIN}` }),
    SMALL_SIGNATURE,
  );
  const bothMuted = find(both, 'text-muted', 'surface-default');
  assert.equal(bothMuted.target, 4.95);
  assert.equal(bothMuted.passes, false);
  assert.equal(bothMuted.wash, 'the 60% text-primary wash');
  // A wash that lifts contrast leaves the bare surface below it to be read: the worst stays bare.
  const lifting = gateSet(set, 'light', language({ texture: wash('surface-default', 50) }), {
    largeSignature: true,
  });
  const bare = find(lifting, 'text-muted', 'surface-prominent');
  assert.equal(bare.ratio, floor(contrast(set['text-muted'], set['surface-prominent'])));
  // On a translucent surface the wash lies over the composite, over each backdrop.
  const glassy = gateSet(
    set,
    'light',
    language({ 'surface-opacity': '72%', texture: wash('text-primary', 60) }),
    { largeSignature: true },
  );
  const over = find(glassy, 'text-muted', 'surface-default');
  assert.ok(over.backdrop !== undefined && over.wash === 'the 60% text-primary wash');
  // A high-contrast set never paints the texture, so it isn't washed.
  const high = gateSet(
    SETS['high-contrast-light']!,
    'high-contrast-light',
    language({ texture: wash('text-primary', 60) }),
    SMALL_SIGNATURE,
  );
  assert.ok(high.every((pair) => pair.wash === undefined));
  // A faint wash passes where the surface alone does.
  const faint = gateSet(set, 'light', language({ texture: wash('accent', 4) }), SMALL_SIGNATURE);
  assert.ok(faint.some((pair) => pair.wash === 'the 4% accent wash'));
  assert.ok(
    faint
      .filter((pair) => pair.kind === 'text' && pair.ground === 'surface-default')
      .every((pair) => pair.target === 4.5),
  );
});

test("what the gate reads from a language, and what it can't compute fails", () => {
  assert.deepEqual(language(), {
    surfaceOpacity: 1,
    textured: false,
    washes: [],
    borderControl: 'border-strong',
    focusWidth: 2,
    focusOffset: 2,
    signature: ['signature-start', 'signature-end'],
    shadowKeys: [
      { tokens: ['shadow-raised'], percent: 16 },
      { tokens: ['shadow-card'], percent: 12 },
    ],
  });
  assert.equal(language({ 'focus-offset': '0px' }).focusOffset, 0);
  assert.equal(language({ 'focus-offset': '-0.125rem' }).focusOffset, -2);
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
    ['focus-offset', 'auto', /focus-offset must be a length/],
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

test('a flush focus ring is held to 3:1 against each fill it touches; one offset outward reads on the ground (LANG-5c)', () => {
  const insideOf = (pairs: readonly GatePair[]) =>
    pairs.filter((pair) => pair.kind === 'focus-inside');
  // The planted flush ring: offset 0, and focus the accent itself, so on the primary Action it reads 1:1.
  const flushOnAccent = { ...SETS.light!, focus: SETS.light!.accent };
  const flush = gateSet(
    flushOnAccent,
    'light',
    language({ 'focus-offset': '0px' }),
    SMALL_SIGNATURE,
  );
  assert.deepEqual(
    insideOf(flush).map((pair) => pair.ground),
    [
      'accent',
      'accent-hover',
      'accent-active',
      'surface-default',
      'surface-subtle',
      'surface-prominent',
    ],
  );
  const onAccent = find(insideOf(flush), 'focus', 'accent');
  assert.equal(onAccent.ratio, 1);
  assert.equal(onAccent.target, 3);
  assert.equal(onAccent.passes, false);
  // The mutant: measured on the grounds alone, as before, the planted ring passes.
  assert.ok(
    flush
      .filter((pair) => pair.kind !== 'focus-inside' && pair.foreground === 'focus')
      .every((pair) => pair.passes),
  );
  // An inward ring touches the fill too.
  const inward = gateSet(
    flushOnAccent,
    'light',
    language({ 'focus-offset': '-2px' }),
    SMALL_SIGNATURE,
  );
  assert.equal(find(insideOf(inward), 'focus', 'accent').passes, false);
  // Offset 1px or more, the ground shows between ring and fill: the focus-on-ground pairs decide.
  for (const offset of ['1px', '2px', '0.125rem']) {
    const apart = gateSet(
      flushOnAccent,
      'light',
      language({ 'focus-offset': offset }),
      SMALL_SIGNATURE,
    );
    assert.deepEqual(insideOf(apart), [], offset);
    assert.equal(find(apart, 'focus', 'canvas').passes, true, offset);
  }
  // High contrast holds a flush ring to the high-contrast non-text target.
  const high = gateSet(
    SETS['high-contrast-light']!,
    'high-contrast-light',
    language({ 'focus-offset': '0px' }),
    SMALL_SIGNATURE,
  );
  assert.equal(find(insideOf(high), 'focus', 'surface-default').target, 4.5);
  // The neutral language, a scheme's own report, rings 2px out: it adds no focus-inside pair.
  assert.deepEqual(
    insideOf(gateSet(flushOnAccent, 'light', NEUTRAL_LANGUAGE, SMALL_SIGNATURE)),
    [],
  );
});

test('a flush focus ring is measured in its own color against each fill: one scheme passes on some fills and fails on others, in high contrast too (LANG-5c review P1-1)', () => {
  const insideOf = (pairs: readonly GatePair[]) =>
    pairs.filter((pair) => pair.kind === 'focus-inside');
  // Focus is not the accent here, so a gate that measures the accent, or returns one
  // ratio for every fill, gets these wrong.
  const fills = {
    focus: '#000000',
    accent: '#ffffff',
    'accent-hover': '#ffffff',
    'accent-active': '#ffffff',
    'surface-default': '#111111',
    'surface-subtle': '#666666',
    'surface-prominent': '#ffffff',
  } as const;
  const expected = (fill: string) => Math.floor(contrast(fills.focus, fill) * 100) / 100;
  const flush = language({ 'focus-offset': '0px' });

  const light = insideOf(gateSet({ ...SETS.light!, ...fills }, 'light', flush, SMALL_SIGNATURE));
  const onAccent = find(light, 'focus', 'accent');
  assert.equal(onAccent.ratio, expected(fills.accent));
  assert.ok(onAccent.ratio > 20);
  assert.equal(onAccent.target, 3);
  assert.equal(onAccent.passes, true);
  const onDefault = find(light, 'focus', 'surface-default');
  assert.equal(onDefault.ratio, expected(fills['surface-default']));
  assert.ok(onDefault.ratio < 1.5);
  assert.equal(onDefault.passes, false);
  // #666666 on black is about 3.65:1, over the 3:1 target.
  const onSubtle = find(light, 'focus', 'surface-subtle');
  assert.equal(onSubtle.ratio, expected(fills['surface-subtle']));
  assert.ok(onSubtle.ratio > 3 && onSubtle.ratio < 4.5);
  assert.equal(onSubtle.passes, true);
  assert.deepEqual(
    light.filter((pair) => !pair.passes).map((pair) => pair.ground),
    ['surface-default'],
  );
  // A ring that stands apart from every fill passes every focus-inside pair, each at its own ratio.
  const apart = insideOf(
    gateSet(
      { ...SETS.light!, ...fills, 'surface-default': '#ffffff', 'surface-subtle': '#ffffff' },
      'light',
      flush,
      SMALL_SIGNATURE,
    ),
  );
  assert.equal(apart.length, 6);
  for (const pair of apart) {
    assert.equal(pair.passes, true, pair.ground);
    assert.equal(pair.ratio, expected('#ffffff'), pair.ground);
  }
  // Focus planted as surface-default's own color: 1:1 there, and well apart on the accent.
  const asSurface = insideOf(
    gateSet(
      { ...SETS.light!, ...fills, focus: fills['surface-default'] },
      'light',
      flush,
      SMALL_SIGNATURE,
    ),
  );
  assert.equal(find(asSurface, 'focus', 'surface-default').ratio, 1);
  assert.equal(find(asSurface, 'focus', 'surface-default').passes, false);
  assert.equal(find(asSurface, 'focus', 'accent').passes, true);
  assert.ok(find(asSurface, 'focus', 'accent').ratio > 18);

  // High contrast: the same ratios, held to 4.5:1, so the 3.65:1 fill now fails.
  const high = insideOf(
    gateSet(
      { ...SETS['high-contrast-light']!, ...fills },
      'high-contrast-light',
      flush,
      SMALL_SIGNATURE,
    ),
  );
  const highSubtle = find(high, 'focus', 'surface-subtle');
  assert.equal(highSubtle.ratio, expected(fills['surface-subtle']));
  assert.equal(highSubtle.target, 4.5);
  assert.equal(highSubtle.passes, false);
  const highAccent = find(high, 'focus', 'accent');
  assert.equal(highAccent.ratio, expected(fills.accent));
  assert.equal(highAccent.target, 4.5);
  assert.equal(highAccent.passes, true);
  assert.deepEqual(
    high.filter((pair) => !pair.passes).map((pair) => pair.ground),
    ['surface-default', 'surface-subtle'],
  );
});

// The shadow key (B, 2026-11-02): CI run 41510373684 found OA's captions,
// text-secondary at the label role's size, at 4.00:1 32px below a raised
// object under fluent-2-inspired, whose shadow64 key layer was 36% black.

const layer = (shadow: string) => (role: string, percent: number) =>
  `${shadow} color-mix(in srgb, var(--color-${role}) ${percent}%, transparent)`;
const ambient = layer('0 0 8px');
const shadow64 = layer('0 32px 64px');
const shadow28 = layer('0 14px 28px');

test("a shadow's key layer is its outer blurred layer that reaches furthest past its object, failing closed", () => {
  const key = (value: string) => shadowKey('shadow-raised', value);
  // Fluent's ambient-then-key pair: the key, not the ambient.
  assert.deepEqual(key(`${ambient('shadow', 12)}, ${shadow64('shadow', 14)}`), {
    key: { percent: 14 },
    problems: [],
  });
  // One layer is its own key, in any role.
  assert.deepEqual(key(layer('0 10px 28px')('text-primary', 16)).key, { percent: 16 });
  // A wide soft layer over a tight contact one: the reach, not the strength, picks it.
  assert.deepEqual(
    key(`${layer('0 2px 3px')('shadow', 35)}, ${layer('0 14px 28px -6px')('shadow', 30)}`).key,
    { percent: 30 },
  );
  // A tie in reach below goes to the stronger; a bare role is all of it; rem reads at 16px.
  assert.deepEqual(
    key(`${layer('0 1rem 1rem')('shadow', 10)}, 16px 16px 16px var(--color-accent)`).key,
    { percent: 100 },
  );
  // A layer cast up and back reaches less far below: neumorphic's highlight isn't its key.
  assert.deepEqual(
    key(`${layer('8px 8px 16px')('text-primary', 16)}, ${layer('-8px -8px 16px')('canvas', 85)}`)
      .key,
    { percent: 16 },
  );
  // Nothing casts: none, inset layers, rings and hard offsets with no blur, transparent.
  for (const none of [
    'none',
    'inset 0 -12px 0 var(--color-accent)',
    `inset 0 1px 0 ${layer('')('canvas', 80).trim()}`,
    '0 0 0 3px var(--color-canvas), 0 0 0 4px var(--color-accent)',
    '8px 8px 0 var(--color-shadow)',
    '0 4px 12px transparent',
  ]) {
    assert.deepEqual(key(none), { key: null, problems: [] }, none);
  }
  // A layer the gate can't read fails, never passes as no shadow.
  for (const unreadable of [
    '0 2px 8px rgba(0, 0, 0, 0.2)',
    '0 2px 8px red',
    '2px var(--color-shadow)',
    '0 2px 8px var(--color-no-such-role)',
    `0 2px 8px color-mix(in srgb, var(--color-shadow) 12%, var(--color-canvas))`,
  ]) {
    const read = key(unreadable);
    assert.equal(read.key, null, unreadable);
    assert.equal(read.problems.length, 1, unreadable);
    const gate = gateLanguage({ ...PLATFORM_NEUTRAL.tokens, 'shadow-card': unreadable });
    assert.equal(gate.ok, false, unreadable);
    assert.match(
      gate.ok ? '' : gate.problems.join('\n'),
      /^shadow-card layer 1 .* isn't a shadow the gate reads/,
    );
  }
  // The language reads raised and card, and one key both cast once.
  assert.deepEqual(
    language({
      'shadow-raised': `${ambient('shadow', 12)}, ${shadow64('shadow', 14)}`,
      'shadow-card': `${ambient('shadow', 12)}, ${shadow28('shadow', 14)}`,
    }).shadowKeys,
    [{ tokens: ['shadow-raised', 'shadow-card'], percent: 14 }],
  );
  assert.deepEqual(language({ 'shadow-raised': 'none', 'shadow-card': 'none' }).shadowKeys, []);
});

test("the darkest point is half the key layer, Phi(0) at its own box edge, which gives C's probe of OA x fluent-2-inspired to the pixel", () => {
  assert.equal(SHADOW_KEY_PEAK, 0.5);
  const parchment = shippingSchemeSets().find(({ id }) => id === 'warm-parchment')!.sets.light!;
  // shadow64 at 36% black, 32px below its object: C read (185, 178, 164) there, 4.00:1, and 6.02:1 bare.
  const darkest = composite(
    parchment.shadow,
    parchment['surface-prominent'],
    0.36 * SHADOW_KEY_PEAK,
  );
  const channels = [1, 3, 5].map((at) => Number.parseInt(darkest.slice(at, at + 2), 16));
  [185, 178, 164].forEach((probed, index) => assert.ok(Math.abs(channels[index]! - probed) <= 1));
  assert.equal(floor(contrast(parchment['text-secondary'], darkest)), 4.0);
  assert.equal(floor(contrast(parchment['text-secondary'], parchment['surface-prominent'])), 6.02);
});

test('text-secondary keeps 4.5:1 beside each shadow key, on the canvas and every surface, in every set', () => {
  const raised = `${ambient('shadow', 16)}, ${shadow64('shadow', 36)}`;
  const dark = language({ 'shadow-raised': raised, 'shadow-card': 'none' });
  for (const name of ['light', 'dark', 'high-contrast-light', 'high-contrast-dark'] as const) {
    const set = SETS[name]!;
    const pairs = gateSet(set, name, dark, SMALL_SIGNATURE).filter(({ shadow }) => shadow);
    assert.deepEqual(
      pairs.map(({ ground }) => ground),
      ['canvas', 'surface-subtle', 'surface-default', 'surface-prominent', 'surface-overlay'],
      name,
    );
    for (const pair of pairs) {
      assert.equal(pair.kind, 'text');
      assert.equal(pair.foreground, 'text-secondary');
      assert.equal(pair.shadow, 'the shadow-raised key layer at 36%');
      // 4.5:1, in a high-contrast set too: the label's size, not the set, sets it.
      assert.equal(pair.target, 4.5);
      const shaded = composite(set.shadow, set[pair.ground as 'canvas'], 0.36 * SHADOW_KEY_PEAK);
      assert.equal(
        pair.ratio,
        floor(contrast(set['text-secondary'], shaded)),
        `${name} ${pair.ground}`,
      );
    }
  }
  // In light, surface-prominent goes under, as OA's captions did, where the bare pair passes.
  const light = gateSet(SETS.light!, 'light', dark, SMALL_SIGNATURE);
  assert.equal(
    light.find((pair) => pair.shadow && pair.ground === 'surface-prominent')!.passes,
    false,
  );
  assert.equal(find(light, 'text-secondary', 'surface-prominent').shadow, undefined);
  assert.equal(find(light, 'text-secondary', 'surface-prominent').passes, true);
  // A key written in another role darkens in --color-shadow at its alpha, as the lead ruled.
  const written = language({
    'shadow-raised': shadow64('text-primary', 36),
    'shadow-card': 'none',
  });
  assert.deepEqual(
    gateSet(SETS.dark!, 'dark', written, SMALL_SIGNATURE).filter(({ shadow }) => shadow),
    gateSet(SETS.dark!, 'dark', dark, SMALL_SIGNATURE).filter(({ shadow }) => shadow),
  );
  // No key, no pair; a translucent surface is read over each backdrop under it.
  const flat = language({ 'shadow-raised': 'none', 'shadow-card': 'none' });
  assert.equal(
    gateSet(SETS.light!, 'light', flat, SMALL_SIGNATURE).filter(({ shadow }) => shadow).length,
    0,
  );
  const glassy = gateSet(
    SETS.light!,
    'light',
    language({ 'surface-opacity': '72%', 'shadow-raised': raised, 'shadow-card': 'none' }),
    SMALL_SIGNATURE,
  ).filter(({ shadow }) => shadow);
  assert.ok(glassy.some(({ backdrop }) => backdrop !== undefined));
});

test("fluent-2-inspired keeps text-secondary at 4.5:1 beside its key layers in every shipping scheme and set at Fluent 2's source shadows (19i; 1.1.5's 36% key went to 3.90:1, CI run 41510373684's OA cells)", () => {
  const manifest = JSON.parse(
    fs.readFileSync(
      new URL('manifest.json', packDir('appearance-languages', 'fluent-2-inspired')),
      'utf8',
    ),
  ) as { version: string; tokens: LanguageTokens };
  assert.notEqual(manifest.version, '1.1.5');
  const read = gateLanguage(manifest.tokens);
  assert.ok(read.ok);
  assert.ok((read.language.shadowKeys ?? []).length > 0);
  const failing = shippingSchemeSets().flatMap(({ id, sets }) =>
    (Object.keys(sets) as (keyof typeof sets)[]).flatMap((name) =>
      gateSet(sets[name]!, name, read.language, SMALL_SIGNATURE)
        .filter(({ shadow, passes }) => shadow && !passes)
        .map(({ ground, ratio }) => `${id} ${name} ${ground} ${ratio}:1`),
    ),
  );
  assert.deepEqual(failing.slice(0, 5), [], `${failing.length} pairs under 4.5:1`);
});

test("gateLanguage, the draft-save gate's runtime read, reads every shipping language's shadows and fails closed on one it can't read", () => {
  const dir = new URL('appearance-languages/packs/', PACKAGES_DIR);
  const ids = fs
    .readdirSync(dir)
    .filter((id) => fs.existsSync(new URL(`${id}/manifest.json`, dir)));
  assert.equal(ids.length, 33);
  for (const id of ids) {
    const { tokens } = JSON.parse(
      fs.readFileSync(new URL('manifest.json', packDir('appearance-languages', id)), 'utf8'),
    ) as { tokens: LanguageTokens };
    const read = gateLanguage(tokens);
    assert.ok(read.ok, `${id}: ${read.ok ? '' : read.problems.join('; ')}`);
    assert.ok(Array.isArray(read.language.shadowKeys), id);
    // The same language with a shadow the gate can't read is a problem, never a pass.
    for (const token of ['shadow-raised', 'shadow-card'] as const) {
      const broken = gateLanguage({ ...tokens, [token]: '0 2px 8px rgba(0, 0, 0, 0.2)' });
      assert.equal(broken.ok, false, `${id} ${token}`);
      assert.match(
        broken.ok ? '' : broken.problems.join('\n'),
        new RegExp(`^${token} layer 1 `, 'm'),
      );
    }
  }
});
