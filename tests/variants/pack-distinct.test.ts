import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { LANGUAGE_KEYS } from '../../packages/appearance/src/roles';
import { packDirLookDigest } from '../../packages/variant-contract/src/node/pack-look';
import {
  AXES,
  chooseComposition,
  borderComponents,
  calibrateAxis,
  CLONE_RESOLUTION,
  componentDistance,
  csv,
  describePackOutcome,
  describeReportOnlyScore,
  durationScale,
  easingComponents,
  familyPairControls,
  genericFamily,
  gradientComponents,
  groupDistances,
  guardAxis,
  detectMaterial,
  judgePacks,
  judgePair,
  LANGUAGE_GROUPS,
  LANGUAGE_INFORMATIONAL_GROUPS,
  languageGroupSplit,
  languageStaticGroups,
  languageVector,
  lengthPx,
  linear,
  logLength,
  materialMode,
  matrixRows,
  MIN_SURFACE_SHARE,
  nudgeComponents,
  pairTokens,
  radiusComponents,
  rankPairs,
  reportOnlyCompositions,
  scoreShots,
  schemeVector,
  shadowComponents,
  signedLogLength,
  splitTop,
  tokenDistance,
  typographyVector,
  vectorDistance,
  sheetHtml,
  surfaceShare,
  thumbnail,
  unionArea,
  type PackControl,
  type PackPairScore,
  type SurfaceProbe,
  type PackThresholds,
  type EdgeThresholds,
} from './pack-distinct';

const PACKS = new URL('../../packages/appearance-languages/packs/', import.meta.url);
/** LANG-1's retired packs, moved out of packs/ byte-identical. */
const RETIRED = new URL('../../packages/appearance-languages/retired/', import.meta.url);
const tokensOf = (id: string): Record<string, string> => {
  const dir = existsSync(new URL(`${id}/manifest.json`, PACKS)) ? PACKS : RETIRED;
  return JSON.parse(readFileSync(new URL(`${id}/manifest.json`, dir), 'utf8')).tokens;
};

const near = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, message ?? `${actual} is not ${expected}`);

test('lengths read px, rem at 16px, a bare 0, and the border keywords', () => {
  assert.equal(lengthPx('4px'), 4);
  assert.equal(lengthPx('0.5rem'), 8);
  assert.equal(lengthPx('0'), 0);
  assert.equal(lengthPx('thin'), 1);
  assert.equal(lengthPx('medium'), 3);
  assert.equal(lengthPx('thick'), 5);
  assert.equal(lengthPx('-2px'), -2);
});

test('a length scales by log1p over its grammar cap, from 0 to 1', () => {
  assert.equal(logLength(0), 0);
  near(logLength(64), 1);
  near(logLength(640), 1, 'over the cap clamps');
  near(logLength(4, 999), Math.log1p(4) / Math.log1p(999));
  assert.ok(logLength(4) - logLength(0) > logLength(64) - logLength(60), 'small steps count more');
  near(signedLogLength(0), 0.5);
  near(signedLogLength(64), 1);
  near(signedLogLength(-64), 0);
});

test('bounded numbers scale linearly, and durations by log up to 2s', () => {
  near(linear(0.65, 0.3, 1), 0.5);
  assert.equal(linear(2, 0, 1), 1);
  assert.equal(linear(-1, 0, 1), 0);
  assert.equal(durationScale('0ms'), 0);
  near(durationScale('2s'), 1);
  near(durationScale('2000ms'), 1);
  near(durationScale('0.16s'), durationScale('160ms'));
});

test('splitTop splits on top-level commas, or spaces, never inside parentheses', () => {
  assert.deepEqual(splitTop('a(b, c), d'), ['a(b, c)', 'd']);
  assert.deepEqual(splitTop('1px solid var(--x, y)', true), ['1px', 'solid', 'var(--x, y)']);
});

test('a radius expands to its four corners as the shorthand does', () => {
  const corners = (value: string) => radiusComponents(value).values.map((v) => Math.round(v * 1e6));
  assert.deepEqual(corners('8px'), corners('8px 8px 8px 8px'));
  assert.deepEqual(corners('0 10px'), corners('0 10px 0 10px'));
  assert.deepEqual(corners('2px 4px 6px'), corners('2px 4px 6px 4px'));
  assert.deepEqual(corners('8px / 2px'), corners('8px'), 'the horizontal radii only');
  assert.equal(componentDistance(radiusComponents('0'), radiusComponents('999px')), 1);
});

test('a border reads its width, line style, and color role; none and 0 draw nothing', () => {
  assert.deepEqual(borderComponents('none'), borderComponents('0 solid'));
  assert.deepEqual(borderComponents('1px solid').words, ['solid', 'inherit']);
  assert.deepEqual(borderComponents('3px double var(--color-border-strong)').words, [
    'double',
    'border-strong',
  ]);
  assert.equal(componentDistance(borderComponents('1px solid'), borderComponents('1px solid')), 0);
  // Same width, another style: one of three components differs fully.
  near(componentDistance(borderComponents('1px solid'), borderComponents('1px dashed')), 1 / 3);
});

test("a shadow reads its first layer's offsets, blur, spread, and opacity", () => {
  const soft = shadowComponents(
    '0 2px 8px color-mix(in srgb, var(--color-text-primary) 12%, transparent)',
  );
  near(soft.values[4]!, 0.12, 'the color-mix percentage is its opacity');
  assert.deepEqual(soft.words, ['drawn', 'outset']);
  const hard = shadowComponents('5px 5px 0 var(--color-border-strong)');
  near(hard.values[4]!, 1, 'a plain color is opaque');
  near(hard.values[2]!, 0, 'no blur');
  const inset = shadowComponents(
    'inset 2px 2px 5px color-mix(in srgb, var(--color-text-primary) 16%, transparent)',
  );
  assert.equal(inset.words[1], 'inset');
  near(inset.values[0]!, signedLogLength(2));
  assert.deepEqual(shadowComponents('none').words, ['none', 'outset']);
  assert.ok(componentDistance(soft, hard) > 0);
  assert.equal(componentDistance(soft, soft), 0);
  const two = shadowComponents('0 1px 0 var(--color-a), 0 2px 4px var(--color-b)');
  near(two.values[5]!, 0.5, 'two layers of four');
});

test('a nudge reads translate, scale, and rotate within their grammar; none is the middle', () => {
  for (const value of nudgeComponents('none').values) near(value, 0.5);
  near(nudgeComponents('translateY(-8px)').values[1]!, 0);
  near(nudgeComponents('translate(4px, 4px)').values[0]!, 0.75);
  near(nudgeComponents('scale(0.98)').values[2]!, 0.4);
  near(nudgeComponents('translateY(-2px) scale(1.01)').values[2]!, 0.55);
  near(nudgeComponents('rotate(10deg)').values[3]!, 1);
});

test('an easing reads as control points, with steps a kind of its own', () => {
  assert.deepEqual(easingComponents('linear'), easingComponents('cubic-bezier(0, 0, 1, 1)'));
  assert.deepEqual(easingComponents('steps(4, end)').words, ['steps']);
  assert.equal(
    componentDistance(easingComponents('steps(4, end)'), easingComponents('linear')),
    0.2,
  );
  near(easingComponents('cubic-bezier(0.16, 1, 0.3, 1)').values[1]!, 2 / 3);
});

test('gradients read their shape, layers, and the most transparent color-mix', () => {
  assert.deepEqual(gradientComponents('none').words, ['none']);
  assert.deepEqual(
    gradientComponents(
      'linear-gradient(var(--color-surface-default), var(--color-surface-default))',
    ).words,
    ['solid'],
  );
  const glass = gradientComponents(
    'linear-gradient(145deg, color-mix(in srgb, var(--color-surface-prominent) 52%, transparent), color-mix(in srgb, var(--color-surface-default) 74%, transparent))',
  );
  assert.deepEqual(glass.words, ['linear-gradient']);
  near(glass.values[1]!, 0.52);
  const grid = gradientComponents(
    'linear-gradient(var(--color-border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--color-border-subtle) 1px, transparent 1px)',
  );
  near(grid.values[0]!, 0.5);
  assert.deepEqual(
    gradientComponents(
      'radial-gradient(circle, var(--color-a) 0 1px, transparent 1px), repeating-linear-gradient(0deg, transparent 0 3px, var(--color-b) 3px 4px)',
    ).words,
    ['radial-gradient+repeating-linear-gradient'],
  );
});

test('componentDistance is a mean of differences, and 1 for components of other shapes', () => {
  assert.equal(componentDistance({ values: [], words: [] }, { values: [], words: [] }), 0);
  near(
    componentDistance({ values: [0, 1], words: ['a'] }, { values: [0.5, 1], words: ['b'] }),
    0.5,
  );
  assert.equal(componentDistance({ values: [0], words: [] }, { values: [0, 0], words: [] }), 1);
});

test('the language groups, scored and informational, cover every token once', () => {
  const grouped = [
    ...Object.values(LANGUAGE_GROUPS),
    ...Object.values(LANGUAGE_INFORMATIONAL_GROUPS),
  ].flat();
  assert.equal(grouped.length, LANGUAGE_KEYS.length);
  assert.deepEqual(new Set(grouped), new Set(LANGUAGE_KEYS));
});

test('every shipped language reads with every component in 0..1', () => {
  for (const id of readdirSync(PACKS)) {
    const vector = languageVector(tokensOf(id));
    for (const [key, components] of Object.entries(vector.tokens)) {
      for (const value of components.values) {
        assert.ok(value >= 0 && value <= 1 && Number.isFinite(value), `${id} ${key}: ${value}`);
      }
    }
  }
});

test('the token score: 0 for the same tokens, each group weighted alike, symmetric', () => {
  const neutral = languageVector(tokensOf('platform-neutral'));
  assert.equal(vectorDistance(neutral, neutral), 0);
  const brutal = languageVector(tokensOf('neobrutalist'));
  const there = vectorDistance(neutral, brutal);
  assert.ok(there > 0 && there <= 1);
  near(vectorDistance(brutal, neutral), there);
  const groups = groupDistances(neutral, brutal);
  near(
    there,
    Object.values(groups).reduce((sum, value) => sum + value, 0) / Object.keys(groups).length,
  );
  // One token at the far end of its grammar moves its group by 1 / its size, the score by 1 / the group count of that.
  const card = languageVector({ ...tokensOf('platform-neutral'), 'border-card': '1px solid' });
  const cardNone = languageVector({ ...tokensOf('platform-neutral'), 'border-card': 'none' });
  const borders = componentDistance(borderComponents('1px solid'), borderComponents('none'));
  near(vectorDistance(card, cardNone), borders / 3 / Object.keys(LANGUAGE_GROUPS).length);
});

test('the catalog finding: ant and primer, radix and spectrum-2, atlassian and utility-dense score 0 while the survivor looks as it did at the merge', () => {
  const at = (a: string, b: string) =>
    vectorDistance(languageVector(tokensOf(a)), languageVector(tokensOf(b)));
  // A survivor may evolve after the merge (LANG-2), and its retired record
  // pins its look then: the finding holds while the survivor still has
  // that look, and once it has moved, the alias's old tokens score apart.
  const unchanged = (retired: string) => {
    const record = JSON.parse(
      readFileSync(new URL(`${retired}/retired.json`, RETIRED), 'utf8'),
    ) as { aliasOf: string; survivorDigest: string };
    return (
      packDirLookDigest(fileURLToPath(new URL(`${record.aliasOf}/`, PACKS))) ===
      record.survivorDigest
    );
  };
  for (const [retired, survivor] of [
    ['ant-inspired', 'primer-inspired'],
    ['radix-inspired', 'spectrum-2-inspired'],
    ['atlassian-inspired', 'utility-dense'],
  ] as const) {
    if (unchanged(retired)) assert.equal(at(retired, survivor), 0, retired);
    else assert.ok(at(retired, survivor) > 0, `${survivor} has moved since the merge`);
  }
  assert.equal(
    at('polaris-inspired', 'radix-inspired'),
    0,
    'polaris differs only in its icon stroke, which never scores',
  );
});

test('a scheme compares role by role in OKLab, scaled by black to white', () => {
  const light = { canvas: '#ffffff', 'text-primary': '#000000' };
  const a = schemeVector({ light });
  const b = schemeVector({ light: { canvas: '#000000', 'text-primary': '#000000' } });
  assert.equal(vectorDistance(a, a), 0);
  near(tokenDistance(a.tokens['light:canvas']!, b.tokens['light:canvas']!), 1);
  assert.deepEqual(Object.keys(a.groups).sort(), ['light:canvas', 'light:text']);
  // A generator scheme has no sets until it's generated: every role it lacks is as far as can be.
  assert.equal(vectorDistance(a, schemeVector({})), 1);
  near(vectorDistance(a, schemeVector({ light: { canvas: '#ffffff' } })), 0.5);
});

test('a typography compares faces as words and numbers over their bounds', () => {
  const role = (family: string, size: string) => ({
    'font-family': family,
    'font-size': size,
    'font-weight': 400,
    'line-height': 1.5,
    'letter-spacing': '0em',
    'font-variation-settings': 'normal',
  });
  const serif = typographyVector({ body: role('"Georgia", serif', '1rem') });
  const sans = typographyVector({ body: role('"Inter", sans-serif', '1rem') });
  assert.equal(vectorDistance(serif, serif), 0);
  assert.equal(
    tokenDistance(serif.tokens['body:font-family']!, sans.tokens['body:font-family']!),
    1,
  );
  assert.equal(genericFamily('"Inter", system-ui, sans-serif'), 'sans-serif');
  assert.equal(genericFamily('"Fira Code", monospace'), 'monospace');
  assert.equal(genericFamily('"Odd"'), 'other');
});

test('the "different" controls: each family pair’s lower-median cross pair, never a pair within one family', () => {
  const packs = [
    { id: 'a1', family: 'A' },
    { id: 'a2', family: 'A' },
    { id: 'b1', family: 'B' },
    { id: 'b2', family: 'B' },
    { id: 'c1', family: 'C' },
  ];
  const values: Record<string, number> = {
    'a1 b1': 0.1,
    'a1 b2': 0.4,
    'a2 b1': 0.3,
    'a2 b2': 0.2,
    'a1 c1': 0.9,
    'a2 c1': 0.5,
    'b1 c1': 0.6,
    'b2 c1': 0.7,
    'a1 a2': 0,
    'b1 b2': 0,
  };
  const controls = familyPairControls(packs, (a, b) => values[`${a} ${b}`]);
  assert.deepEqual(
    controls.map(({ families, a, b, value, pairs }) => [families.join(''), a, b, value, pairs]),
    [
      ['AB', 'a2', 'b2', 0.2, 4],
      ['AC', 'a2', 'c1', 0.5, 2],
      ['BC', 'b1', 'c1', 0.6, 2],
    ],
  );
});

const LINES: EdgeThresholds = {
  px: { alike: { desktop: 0.2, mobile: 0.3 }, clone: { desktop: 0.05, mobile: 0.06 } },
  token: { alike: { desktop: 0.06, mobile: 0.06 }, clone: { desktop: 0.001, mobile: 0.001 } },
};

test('the fail rule: alike pixels, or either score under its clone floor', () => {
  const pair = (px: number, token: number, viewport: 'desktop' | 'mobile' = 'desktop') =>
    judgePair({ a: 'x', b: 'y', viewport, px, token }, LINES);
  assert.equal(pair(0.5, 0.5).fail, false);
  assert.deepEqual(pair(0.1, 0.03).reasons, ['alike:px']);
  assert.equal(pair(0.5, 0.03).fail, false, 'tokens alone saying alike passes');
  assert.equal(pair(0.5, 0.03).decidedBy, 'px', 'the pixels decide whenever they vote');
  assert.deepEqual(pair(0.5, 0).reasons, ['clone:token']);
  assert.deepEqual(pair(0.01, 0).reasons, ['clone:px', 'clone:token', 'alike:px']);
  assert.equal(pair(0.25, 0.5, 'mobile').fail, true, 'each viewport its own line');
  assert.equal(pair(0.25, 0.5, 'desktop').fail, false);
  near(pair(0.1, 0.03).alikeness, 0.5);
  near(pair(0.3, 0.03).alikeness, 1.5);
  near(pair(0.1, 0.5).alikeness, 0.5, 'the deciding score ranks, never the tokens');
});

test('a score without an alike line doesn’t vote; with none voting, only clones fail', () => {
  const pxOnly: PackThresholds = { ...LINES, token: { ...LINES.token, alike: null } };
  const pair = judgePair({ a: 'x', b: 'y', viewport: 'desktop', px: 0.1, token: 0.5 }, pxOnly);
  assert.equal(pair.tokenAlike, null);
  assert.deepEqual(pair.reasons, ['alike:px']);
  const none: PackThresholds = {
    px: { ...LINES.px, alike: null },
    token: { ...LINES.token, alike: null },
  };
  assert.equal(
    judgePair({ a: 'x', b: 'y', viewport: 'desktop', px: 0.1, token: 0.01 }, none).fail,
    false,
  );
  assert.equal(
    judgePair({ a: 'x', b: 'y', viewport: 'desktop', px: 0.01, token: 0.01 }, none).fail,
    true,
  );
});

test('judgePacks covers every pair at every viewport, either way round, and names a missing one', () => {
  const scores = [
    { a: 'b', b: 'a', viewport: 'desktop' as const, px: 0.5, token: 0.5 },
    { a: 'a', b: 'b', viewport: 'mobile' as const, px: 0.01, token: 0.5 },
  ];
  const verdict = judgePacks({ ids: ['a', 'b'], scores, thresholds: LINES });
  assert.equal(verdict.outcomes.length, 2);
  assert.equal(verdict.outcomes[0]!.a, 'a', 'reported in id order');
  assert.deepEqual(
    verdict.failures.map(({ viewport }) => viewport),
    ['mobile'],
  );
  assert.deepEqual(judgePacks({ ids: ['a', 'b', 'c'], scores, thresholds: LINES }).problems, [
    'no score for a and c at desktop',
    'no score for b and c at desktop',
    'no score for a and c at mobile',
    'no score for b and c at mobile',
  ]);
});

test('the ranked list puts failures first, clones before alike, then the most alike', () => {
  const at = (a: string, px: number, token: number) =>
    judgePair({ a, b: 'z', viewport: 'desktop', px, token }, LINES);
  const ranked = rankPairs([
    at('pass-far', 0.9, 0.9),
    at('alike', 0.15, 0.05),
    at('clone', 0.01, 0.5),
    at('pass-near', 0.21, 0.02),
    at('alike-closer', 0.05, 0.01),
  ]);
  assert.deepEqual(
    ranked.map(({ a }) => a),
    ['clone', 'alike-closer', 'alike', 'pass-near', 'pass-far'],
  );
  assert.match(
    describePackOutcome(ranked[0]!, LINES),
    /^clone and z at desktop: FAIL clone:px, alike:px; pixels 0\.010 \(decides: alike < 0\.2; clone floor 0\.05\), tokens 0\.500 \(reported, no vote: apart >= 0\.06; clone floor 0\.001\)$/,
  );
});

test('calibration takes distinct’s procedure for each score, by each control’s role', () => {
  const control = (
    viewport: 'desktop' | 'mobile',
    roles: PackControl['roles'],
    px: number,
    token: number,
  ): PackControl => ({ a: 'a', b: 'b', control: 'c', viewport, roles, px, token });
  const controls: PackControl[] = [];
  for (const viewport of ['desktop', 'mobile'] as const) {
    controls.push(control(viewport, { px: 'same', token: 'same' }, 0.05, 0));
    controls.push(control(viewport, { px: 'same', token: 'same' }, 0.08, 0));
    controls.push(control(viewport, { px: 'different' }, 0.4, 0.01));
    controls.push(control(viewport, { px: 'different' }, 0.5, 0.02));
    controls.push(control(viewport, { token: 'different' }, 0.02, 0.12));
    controls.push(control(viewport, { px: 'informational', token: 'informational' }, 0, 0));
  }
  const { calibration, thresholds } = calibrateAxis(controls);
  assert.deepEqual(calibration.px.alike.desktop, {
    same: 0.08,
    different: 0.4,
    gap: 0.32,
    threshold: 0.24,
  });
  assert.deepEqual(thresholds.px.clone, { desktop: 0.16, mobile: 0.16 });
  assert.deepEqual(thresholds.token.alike, { desktop: 0.06, mobile: 0.06 });
  assert.deepEqual(thresholds.token.clone, { desktop: CLONE_RESOLUTION, mobile: CLONE_RESOLUTION });
  // A gap under 0.1 at one viewport: that score doesn't vote at all.
  const thin = controls.map((each) =>
    each.viewport === 'mobile' && each.roles.token === 'different'
      ? { ...each, token: 0.05 }
      : each,
  );
  assert.equal(calibrateAxis(thin).thresholds.token.alike, null);
  assert.deepEqual(calibrateAxis(thin).thresholds.px.alike, { desktop: 0.24, mobile: 0.24 });
});

test('matrices and CSV', () => {
  const rows = matrixRows(['a', 'b'], (x, y) => `${x}${y}`);
  assert.deepEqual(rows, [
    ['', 'a', 'b'],
    ['a', '', 'ab'],
    ['b', 'ba', ''],
  ]);
  assert.equal(csv([['a', 'b,c', 'd"e']]), 'a,"b,c","d""e"\n');
});

test('the axis is a parameter, the design language by default, each with its own JSON', () => {
  assert.equal(guardAxis(undefined), 'designLanguage');
  assert.equal(guardAxis('colorScheme'), 'colorScheme');
  assert.throws(() => guardAxis('variant'), /must be one of/);
  assert.equal(AXES.designLanguage.file, 'languages-distinct.json');
  for (const spec of Object.values(AXES)) {
    assert.ok(spec.same.length >= 2, `${spec.axis} has two "same" controls`);
    assert.ok(
      spec.same.every((control) => control.axis !== spec.axis),
      'each changes another axis',
    );
  }
  // Controls that move geometry don't set the pixel floor; a scheme change does, for languages.
  const role = (axis: keyof typeof AXES, name: string) =>
    AXES[axis].same.find((control) => control.name === name)?.px ?? 'same';
  assert.equal(role('designLanguage', 'scheme'), 'same');
  assert.equal(role('designLanguage', 'typography'), 'informational');
  assert.equal(role('colorScheme', 'language'), 'informational');
  assert.equal(role('typography', 'scheme'), 'same');
  const committed = JSON.parse(
    readFileSync(new URL('./languages-distinct.json', import.meta.url), 'utf8'),
  );
  assert.equal(committed.axis, 'designLanguage');
  assert.equal(typeof committed.enforced, 'boolean');
  for (const score of ['px', 'token']) {
    assert.ok(committed.thresholds[score].clone.desktop >= CLONE_RESOLUTION);
    assert.ok(committed.thresholds[score].clone.mobile >= CLONE_RESOLUTION);
  }
});

test('a thumbnail averages the pixels each one covers', () => {
  const png = new PNG({ width: 4, height: 2 });
  for (let i = 0; i < 8; i++) {
    const v = i % 2 === 0 ? 0 : 200;
    png.data.set([v, v, v, 255], i * 4);
  }
  const small = PNG.sync.read(thumbnail(PNG.sync.write(png), 2));
  assert.equal(small.width, 2);
  assert.equal(small.height, 1);
  assert.equal(small.data[0], 100);
});

test('a specimen sheet escapes its captions', () => {
  const html = sheetHtml('t<', [[{ file: 'tiles/a.png', caption: ['<b>', 'x&y'] }]], 100);
  assert.match(html, /<h1>t&lt;<\/h1>/);
  assert.match(html, /<b>&lt;b&gt;<\/b><br>x&amp;y/);
});

// LANG-3b, lead A's ruling: the verdict's tokens are the groups a static
// render shows, and alike pixels fail whatever the tokens say.

test('LANG-3b: the token score reads only the groups a static render shows', () => {
  assert.deepEqual(Object.keys(LANGUAGE_GROUPS), ['corners', 'depth', 'borders', 'density']);
  assert.deepEqual(Object.keys(LANGUAGE_INFORMATIONAL_GROUPS), [
    'surface',
    'focus',
    'motion',
    'states',
    'icons',
    'texture',
  ]);
  assert.deepEqual(new Set(languageStaticGroups()), new Set(Object.keys(LANGUAGE_GROUPS)));
  // The flag adds the material and nothing else; the texture never scores.
  const withMaterial = languageGroupSplit(true);
  assert.deepEqual(Object.keys(withMaterial.groups), [
    'corners',
    'depth',
    'borders',
    'density',
    'surface',
  ]);
  assert.deepEqual(new Set(languageStaticGroups(true)), new Set(Object.keys(withMaterial.groups)));
  assert.ok(
    !withMaterial.groups.surface!.includes('texture'),
    'an unrendered texture never scores',
  );
  assert.deepEqual(
    [...Object.values(withMaterial.groups), ...Object.values(withMaterial.informational)]
      .flat()
      .sort(),
    [...LANGUAGE_KEYS].sort(),
  );
  // Every informational token from a far language, every scored one kept: the same score as none moved.
  const neutral = tokensOf('platform-neutral');
  const brutal = tokensOf('neobrutalist');
  const informational = new Set<string>(Object.values(LANGUAGE_INFORMATIONAL_GROUPS).flat());
  const moved = Object.fromEntries(
    Object.entries(neutral).map(([key, value]) => [
      key,
      informational.has(key) ? (brutal[key] ?? value) : value,
    ]),
  );
  assert.notDeepEqual(moved, neutral);
  assert.equal(vectorDistance(languageVector(neutral), languageVector(moved)), 0);
  assert.ok(vectorDistance(languageVector(neutral), languageVector(brutal)) > 0);
  // With the flag on, a material that differs scores.
  const glass = { ...neutral, 'surface-material': tokensOf('glassmorphism')['surface-material']! };
  assert.notEqual(glass['surface-material'], neutral['surface-material']);
  assert.equal(vectorDistance(languageVector(neutral), languageVector(glass)), 0);
  assert.ok(vectorDistance(languageVector(neutral, true), languageVector(glass, true)) > 0);
});

test('LANG-3b: alike pixels fail whatever the tokens say, and tokens never rescue them', () => {
  for (const viewport of ['desktop', 'mobile'] as const) {
    const pixels = LINES.px.alike![viewport] / 2;
    for (const token of [LINES.token.alike![viewport] * 2, 0.5, 1]) {
      const outcome = judgePair({ a: 'x', b: 'y', viewport, px: pixels, token }, LINES);
      assert.equal(outcome.tokenAlike, false, 'the tokens say apart');
      assert.equal(outcome.fail, true, `pixels ${pixels} and tokens ${token} at ${viewport}`);
      assert.deepEqual(outcome.reasons, ['alike:px']);
      assert.equal(outcome.decidedBy, 'px');
    }
  }
  // A real pair: platform-neutral against neobrutalist's tokens, far apart, on alike pixels.
  const { token } = pairTokens(
    languageVector(tokensOf('platform-neutral')),
    languageVector(tokensOf('neobrutalist')),
  );
  assert.ok(token > LINES.token.alike!.desktop);
  assert.equal(
    judgePair({ a: 'x', b: 'y', viewport: 'desktop', px: 0.1, token }, LINES).fail,
    true,
  );
  // Pixels apart pass, whatever the tokens say, short of a clone.
  assert.equal(
    judgePair({ a: 'x', b: 'y', viewport: 'desktop', px: 0.5, token: 0.03 }, LINES).fail,
    false,
  );
});

test('LANG-3b: the tokens decide only while the pixels have no alike line', () => {
  const tokensOnly: PackThresholds = { ...LINES, px: { ...LINES.px, alike: null } };
  const at = (px: number, token: number) =>
    judgePair({ a: 'x', b: 'y', viewport: 'desktop', px, token }, tokensOnly);
  assert.equal(at(0.5, 0.03).decidedBy, 'token');
  assert.deepEqual(at(0.5, 0.03).reasons, ['alike:token']);
  assert.equal(at(0.5, 0.5).fail, false);
  near(at(0.5, 0.03).alikeness, 0.5);
});

test('LANG-3b: a pair whose only difference is motion, focus, icon stroke, a nudge, texture, or material can’t pass on tokens', () => {
  const base = tokensOf('platform-neutral');
  const differences: Record<string, Record<string, string>> = {
    motion: {
      'motion-fast': '0ms',
      'motion-standard': '2s',
      'motion-slow': '2s',
      'motion-easing': 'steps(4, end)',
      'motion-enter': 'none',
      'motion-exit': 'none',
      'motion-emphasis': 'none',
    },
    focus: { 'focus-width': '6px', 'focus-offset': '-4px', 'focus-style': 'dashed' },
    icons: { 'icon-stroke-width': base['icon-stroke-width'] === '4' ? '0.5' : '4' },
    states: { 'state-hover-transform': 'translateY(-8px)', 'state-active-transform': 'scale(0.9)' },
    texture: {
      texture:
        'radial-gradient(circle, var(--color-border-subtle) 0 1px, transparent 1px), linear-gradient(var(--color-border-subtle) 1px, transparent 1px)',
    },
    surface: { 'surface-material': tokensOf('glassmorphism')['surface-material']! },
  };
  for (const [group, changes] of Object.entries(differences)) {
    const other = { ...base, ...changes };
    assert.notDeepEqual(other, base, `${group} changes a token`);
    const { token, info } = pairTokens(languageVector(base), languageVector(other));
    assert.equal(token, 0, `${group} never enters the token score`);
    assert.ok(info[group]! > 0, `${group} shows on its informational line`);
    // With pixels apart, the tokens sit at 0, under the clone floor: the pair fails, never passes on tokens.
    const outcome = judgePair({ a: 'x', b: 'y', viewport: 'desktop', px: 0.5, token, info }, LINES);
    assert.equal(outcome.tokenAlike, true);
    assert.deepEqual(outcome.reasons, ['clone:token'], group);
  }
});

test('LANG-3b: each pair carries its informational lines, and the report prints them apart from the scores', () => {
  const polaris = languageVector(tokensOf('polaris-inspired'));
  const radix = languageVector(tokensOf('radix-inspired'));
  const { token, info } = pairTokens(polaris, radix);
  assert.equal(token, 0);
  assert.deepEqual(Object.keys(info), Object.keys(LANGUAGE_INFORMATIONAL_GROUPS));
  assert.ok(info.icons! > 0, 'polaris differs in its icon stroke, on the icons line');
  for (const group of ['surface', 'focus', 'motion', 'states', 'texture']) {
    assert.equal(info[group], 0, group);
  }
  const outcome = judgePair(
    { a: 'polaris', b: 'radix', viewport: 'desktop', px: 0.5, token, info },
    LINES,
  );
  const line = describePackOutcome(outcome, LINES);
  assert.match(
    line,
    /; informational, never scored: surface 0\.000, focus 0\.000, motion 0\.000, states 0\.000, icons 0\.\d{3}, texture 0\.000$/,
  );
  assert.match(line, /^polaris and radix at desktop: FAIL clone:token;/);
  // The other axes have no informational groups, and print none.
  const scheme = schemeVector({ light: { canvas: '#ffffff' } });
  assert.deepEqual(pairTokens(scheme, scheme).info, {});
  const plain = judgePair({ a: 'x', b: 'y', viewport: 'desktop', px: 0.5, token: 0.5 }, LINES);
  assert.doesNotMatch(describePackOutcome(plain, LINES), /informational/);
});

test('LANG-3b: both clone floors still fail a pair on their own', () => {
  // Without an alike line on either score, only the clone floors can fail a pair.
  const floorsOnly: PackThresholds = {
    px: { ...LINES.px, alike: null },
    token: { ...LINES.token, alike: null },
  };
  const at = (px: number, token: number, thresholds = floorsOnly) =>
    judgePair({ a: 'x', b: 'y', viewport: 'desktop', px, token }, thresholds);
  assert.deepEqual(at(0.04, 0.5).reasons, ['clone:px']);
  assert.deepEqual(at(0.5, 0).reasons, ['clone:token']);
  assert.deepEqual(at(0.04, 0).reasons, ['clone:px', 'clone:token']);
  assert.equal(at(0.05, 0.001).fail, false, 'at the floor is over it');
  // With the lines calibrated, a token clone on pixels apart still fails.
  assert.deepEqual(at(0.5, 0, LINES).reasons, ['clone:token']);
  // A pixel floor over the alike line still fails what the alike line alone wouldn't.
  const highFloor: PackThresholds = {
    ...LINES,
    px: { alike: LINES.px.alike, clone: { desktop: 0.3, mobile: 0.3 } },
  };
  assert.deepEqual(at(0.25, 0.5, highFloor).reasons, ['clone:px']);
});

// The material scores only where the scored composition renders the Surface
// primitive, as the page shows it (lead A's ruling on LANG-2's finding).

/** A composition's first viewport at desktop or mobile, its Surfaces' boxes as surfaceProbe() reads them. */
const probe = (
  viewport: 'desktop' | 'mobile',
  elements: SurfaceProbe['elements'],
): SurfaceProbe => ({
  ...(viewport === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 }),
  elements,
});
/** A composition that sets its work on Surfaces: a column of cards at each viewport. */
const WITH_SURFACE = {
  desktop: probe('desktop', [
    { x: 80, y: 200, width: 400, height: 300, visible: true },
    { x: 520, y: 200, width: 400, height: 300, visible: true },
  ]),
  mobile: probe('mobile', [{ x: 16, y: 300, width: 358, height: 240, visible: true }]),
};
/** One without: no Surface at desktop, and at mobile only a hidden one, one past the fold, and a badge. */
const WITHOUT_SURFACE = {
  desktop: probe('desktop', []),
  mobile: probe('mobile', [
    { x: 0, y: 0, width: 390, height: 844, visible: false },
    { x: 0, y: 900, width: 390, height: 400, visible: true },
    { x: 10, y: 10, width: 40, height: 20, visible: true },
  ]),
};

test('LANG-3b: a union of boxes counts overlaps once, and a share clips to the first viewport', () => {
  assert.equal(unionArea([]), 0);
  assert.equal(unionArea([[0, 0, 10, 10]]), 100);
  assert.equal(
    unionArea([
      [0, 0, 10, 10],
      [5, 5, 15, 15],
    ]),
    175,
  );
  assert.equal(
    unionArea([
      [0, 0, 10, 10],
      [2, 2, 4, 4],
    ]),
    100,
    'a nested Surface adds nothing',
  );
  assert.equal(
    surfaceShare(probe('mobile', [{ x: -100, y: 800, width: 590, height: 400, visible: true }])),
    Math.round(((390 * 44) / (390 * 844)) * 1000) / 1000,
  );
  assert.equal(
    surfaceShare(probe('desktop', [{ x: 0, y: 0, width: 1440, height: 900, visible: false }])),
    0,
  );
});

test('LANG-3b: a composition with a visible Surface scores its material, and one without doesn’t', () => {
  const on = detectMaterial(WITH_SURFACE);
  assert.equal(on.mode, 'detected');
  assert.equal(on.scored, true);
  assert.ok(on.shares.desktop! >= MIN_SURFACE_SHARE && on.shares.mobile! >= MIN_SURFACE_SHARE);
  assert.match(on.reason, /the material scores$/);
  const off = detectMaterial(WITHOUT_SURFACE);
  assert.equal(off.scored, false);
  assert.deepEqual(off.shares, { desktop: 0, mobile: 0.002 });
  assert.match(
    off.reason,
    /visible Surfaces cover 0 at desktop and 0\.002 at mobile, under 0\.02 .*the material is informational$/,
  );
  // A Surface at one viewport only, or no probe at all, doesn't count.
  assert.equal(
    detectMaterial({ desktop: WITH_SURFACE.desktop, mobile: WITHOUT_SURFACE.mobile }).scored,
    false,
  );
  assert.equal(detectMaterial({}).scored, false);
  // Just over and just under the share.
  const share = (fraction: number) =>
    detectMaterial({
      desktop: probe('desktop', [
        { x: 0, y: 0, width: 1440, height: 900 * fraction, visible: true },
      ]),
    }).scored;
  assert.equal(share(MIN_SURFACE_SHARE), true);
  assert.equal(share(MIN_SURFACE_SHARE / 2), false);
  // The scored groups follow: the material scores on the first, and is a line of its own on the second.
  const neutral = tokensOf('platform-neutral');
  const glass = { ...neutral, 'surface-material': tokensOf('glassmorphism')['surface-material']! };
  const score = (detection: ReturnType<typeof detectMaterial>) =>
    pairTokens(languageVector(neutral, detection.scored), languageVector(glass, detection.scored));
  assert.ok(score(on).token > 0);
  assert.equal(score(on).info.surface, undefined);
  assert.equal(score(off).token, 0);
  assert.ok(score(off).info.surface! > 0);
});

test('LANG-3b: the material override defaults to detected, and forces either way while recording the shares', () => {
  assert.equal(materialMode(undefined), 'detected');
  assert.equal(materialMode('on'), 'on');
  assert.throws(() => materialMode('always'), /must be one of/);
  const forcedOn = detectMaterial(WITHOUT_SURFACE, 'on');
  assert.equal(forcedOn.scored, true);
  assert.deepEqual(forcedOn.shares, { desktop: 0, mobile: 0.002 });
  assert.match(
    forcedOn.reason,
    /^PORTFOLIO_PACK_DISTINCT_MATERIAL=on forces the material to score/,
  );
  assert.equal(detectMaterial(WITH_SURFACE, 'off').scored, false);
  // A language vector leaves the material out unless it's asked in.
  assert.ok('surface' in languageVector(tokensOf('platform-neutral')).informational!);
});

test('the scored composition is pinned: a composition registered later with more coverage never moves it (LANG-2)', () => {
  const ranked = [
    { variant: 'aurora-glass', coverage: 5.618 },
    { variant: 'spatial-bento', coverage: 3.113 },
    { variant: 'editorial-evidence', coverage: 2.704 },
  ];
  const pinned = chooseComposition({ ranked, pinned: 'spatial-bento' });
  assert.equal(pinned.composition, 'spatial-bento');
  assert.equal(pinned.by, 'pinned');
  assert.deepEqual(pinned.procedure, { variant: 'aurora-glass', coverage: 5.618 });
  assert.equal(pinned.scoredCoverage, 3.113);
  assert.match(
    pinned.line,
    /spatial-bento \(pinned\), coverage 3\.113; the coverage procedure would pick aurora-glass, coverage 5\.618/,
  );
  // Registering a composition with still more coverage changes the procedure's pick, never the scored one.
  const later = chooseComposition({
    ranked: [...ranked, { variant: 'acme-later', coverage: 9 }],
    pinned: 'spatial-bento',
  });
  assert.equal(later.composition, 'spatial-bento');
  assert.equal(later.procedure?.variant, 'acme-later');
  // Unpinned, the procedure picks; forced, the force wins over the pin.
  assert.equal(chooseComposition({ ranked }).composition, 'aurora-glass');
  assert.equal(chooseComposition({ ranked }).by, 'coverage');
  assert.equal(
    chooseComposition({ ranked, pinned: 'spatial-bento', forced: 'editorial-evidence' })
      .composition,
    'editorial-evidence',
  );
  // The committed design-language JSON pins Spatial Bento.
  const committed = JSON.parse(
    readFileSync(new URL('./languages-distinct.json', import.meta.url), 'utf8'),
  ) as { composition: string; pinned?: boolean };
  assert.equal(committed.composition, 'spatial-bento');
  assert.equal(committed.pinned, true);
});

test('report-only compositions: Editorial Evidence beside the scored one, never the scored one itself (LANG-2)', () => {
  assert.deepEqual(reportOnlyCompositions('designLanguage', 'spatial-bento'), [
    'editorial-evidence',
  ]);
  assert.deepEqual(reportOnlyCompositions('designLanguage', 'editorial-evidence'), []);
  assert.deepEqual(reportOnlyCompositions('colorScheme', 'spatial-bento'), []);
  assert.deepEqual(reportOnlyCompositions('typography', 'spatial-bento'), []);
});

test("a report-only composition's shots can't move the verdict: the scores read the scored composition alone, with their informational lines (LANG-2)", () => {
  const ids = ['platform-neutral', 'neobrutalist', 'claymorphic'];
  const packs = ids.map((id) => ({ id, family: 'test', vector: languageVector(tokensOf(id)) }));
  const lookOf = (id: string) => `pack-${id}`;
  // On the scored composition each pack draws its own edges; on the
  // report-only one every pack draws the same, so there they'd all be clones.
  const grid = (seed: number, viewport: 'desktop' | 'mobile') => {
    const width = viewport === 'desktop' ? 96 : 40;
    const height = viewport === 'desktop' ? 60 : 86;
    const data = new Float64Array(width * height);
    for (let index = 0; index < data.length; index += 1)
      data[index] = ((index * (seed + 3)) % 17) / 16;
    return { width, height, data };
  };
  const shots = (variant: string, seedOf: (index: number) => number) =>
    ids.flatMap((id, index) =>
      (['desktop', 'mobile'] as const).map((viewport) => ({
        variant,
        look: lookOf(id),
        viewport,
        grid: grid(seedOf(index), viewport),
      })),
    );
  const scored = shots('spatial-bento', (index) => index * 5);
  const reportOnly = shots('editorial-evidence', () => 0);
  const alone = scoreShots(packs, scored, lookOf, 'spatial-bento');
  // Report-only shots first, so a reader that took the first match would take them.
  const mixed = scoreShots(packs, [...reportOnly, ...scored], lookOf, 'spatial-bento');
  assert.deepEqual(mixed, alone);
  // The informational lines come through pairTokens(), as the scored report's do.
  for (const score of alone) {
    const a = packs.find(({ id }) => id === score.a)!;
    const b = packs.find(({ id }) => id === score.b)!;
    const { token, info } = pairTokens(a.vector, b.vector);
    assert.equal(score.token, token);
    assert.deepEqual(score.info, info);
    assert.ok(Object.keys(score.info ?? {}).length > 0, 'informational lines present');
  }
  const thresholds: PackThresholds = {
    px: { alike: { desktop: 0.158, mobile: 0.274 }, clone: { desktop: 0.04, mobile: 0.01 } },
    token: { alike: { desktop: 0.081, mobile: 0.081 }, clone: { desktop: 0.001, mobile: 0.001 } },
  };
  const verdict = (scores: PackPairScore[]) =>
    judgePacks({ ids, scores, thresholds }).outcomes.map(({ a, b, viewport, fail }) => [
      a,
      b,
      viewport,
      fail,
    ]);
  assert.deepEqual(verdict(mixed), verdict(alone));
  // Scored on its own, the report-only composition would fail every pair as a pixel clone.
  const own = scoreShots(packs, reportOnly, lookOf, 'editorial-evidence');
  assert.ok(
    judgePacks({ ids, scores: own, thresholds }).outcomes.every(
      (outcome) => outcome.fail && outcome.pxClone,
    ),
  );
  assert.throws(() => scoreShots(packs, reportOnly, lookOf, 'spatial-bento'), /No capture/);
  // Its report line names no verdict and says it never votes.
  const line = describeReportOnlyScore(own[0]!, 'editorial-evidence');
  assert.match(line, /on editorial-evidence, report only, never votes: pixels 0\.000/);
  assert.match(line, /informational: /);
  assert.doesNotMatch(line, /FAIL|pass/);
});
