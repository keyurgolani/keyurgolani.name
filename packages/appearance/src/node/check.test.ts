import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAYER_ORDER } from '../layers';
import { GATE_TARGETS } from '../gate';
import { DERIVED_ROLES, withDerivedRoles } from '../derived-roles';
import { createAppearanceRegistry, findPack, type MetaPack } from '../registry';
import { schemeSets } from '../sets';
import { anchorV1 } from '../derive';
import { FIXTURE_SEED } from '../generators/index';
import {
  DARK_ONLY,
  HUMANIST_UI,
  LIGHT_ONLY,
  PACKS,
  PLATFORM_NEUTRAL,
  VARIANTS,
  WARM_PARCHMENT,
} from '../test-support/packs';
import {
  checkAppearance,
  hierarchyFailures,
  KNOWN_BAD_DIR,
  knownBadNames,
  layerOrderProblems,
  readKnownBadFixture,
  runKnownBad,
  setsForMode,
  SHADOW_KEY_KNOWN_FAILURES,
  stylesheetsUnder,
  unmetExpectations,
} from './check';
import { LINT_RULES } from './stylesheet';
import { validatePackManifest } from '../validate-pack';

// `pnpm check:appearance` (#19, Slice 2, item 8): the computed gate over every
// registered combination, the hierarchy check, the layer-order check, and
// the known-bad inputs it must fail on, each for the reason it names.

const FALLBACKS = PACKS.slice(0, 3);
const META = { VARIANTS, PACKS: FALLBACKS };

test('the fallback trio passes in every display mode', () => {
  const check = checkAppearance(createAppearanceRegistry(META));
  assert.equal(check.ok, true, JSON.stringify(check.failures.slice(0, 3)));
  // One language, one scheme, one typography, in system, light, dark, and high-contrast.
  assert.equal(check.combinations, 4);
  assert.ok(check.pairs > 0);
  assert.deepEqual(check.skipped, []);
});

test('fixture packs are skipped, and a generator scheme is left to its own report', () => {
  const fixtures = PACKS.map((pack) =>
    pack.packageName.includes('fixtures') ? ({ ...pack, fixture: true } as MetaPack) : pack,
  );
  const check = checkAppearance(createAppearanceRegistry({ VARIANTS, PACKS: fixtures }));
  assert.equal(check.ok, true);
  assert.deepEqual(
    check.skipped.map(({ axis, id }) => `${axis}:${id}`),
    [
      'designLanguage:fixture-translucent',
      'colorScheme:fixture-asset',
      'colorScheme:fixture-dark-only',
      'colorScheme:fixture-light-only',
      'colorScheme:fixture-seed',
    ],
  );
  // multilingual-system is a test pack, not a fixture: it's gated with the trio.
  assert.equal(check.combinations, 2 * 4);
});

test('a generator scheme with generated sets is gated with them, as an authored scheme is (#20 PR 3)', () => {
  const registry = createAppearanceRegistry({ VARIANTS, PACKS });
  const without = checkAppearance(registry);
  assert.ok(without.skipped.some(({ id }) => id === 'fixture-seed'));
  const generated = { 'fixture-seed': FIXTURE_SEED.generate({ seedColor: '#3366ff' }) };
  const gated = checkAppearance(registry, { generated });
  assert.ok(!gated.skipped.some(({ id }) => id === 'fixture-seed'));
  assert.ok(gated.combinations > without.combinations);
  // fixture-seed is anchor-v1's, so only a translucent fixture language's backdrops fail it.
  assert.deepEqual(
    gated.failures.filter(({ scheme, pair }) => scheme === 'fixture-seed' && !pair.backdrop),
    [],
  );
  // Sets that fail are its failures.
  const { light, dark } = generated['fixture-seed'];
  const unreadable = { light: { ...light, 'text-muted': light.canvas }, dark };
  const failing = checkAppearance(registry, { generated: { 'fixture-seed': unreadable } });
  assert.ok(
    failing.failures.some(
      ({ scheme, pair }) => scheme === 'fixture-seed' && pair.foreground === 'text-muted',
    ),
  );
});

test('single-mode schemes render only the modes they have, and print renders light', () => {
  const dark = schemeSets({ dark: anchorV1(DARK_ONLY.anchors!.dark!, 'dark') });
  assert.deepEqual(setsForMode(dark, 'light'), []);
  assert.deepEqual(setsForMode(dark, 'dark'), [
    'dark',
    'high-contrast-light',
    'high-contrast-dark',
  ]);
  assert.deepEqual(setsForMode(dark, 'system'), [
    'dark',
    'high-contrast-light',
    'high-contrast-dark',
  ]);
  assert.deepEqual(setsForMode(dark, 'high-contrast'), [
    'high-contrast-light',
    'high-contrast-dark',
  ]);
  const light = schemeSets({ light: anchorV1(LIGHT_ONLY.anchors!.light!, 'light') });
  assert.deepEqual(setsForMode(light, 'dark'), []);
  assert.deepEqual(setsForMode(light, 'high-contrast'), ['high-contrast-light']);
  // The registry's single-mode fixtures, gated as ordinary packs, render 3 modes each.
  const packs = [...FALLBACKS, ...PACKS.filter(({ manifest }) => manifest.id.endsWith('-only'))];
  const check = checkAppearance(createAppearanceRegistry({ VARIANTS, PACKS: packs }));
  assert.equal(check.combinations, 4 + 3 + 3);
});

test('a failure names its pack on each axis, the set, the pair, and the modes that render it', () => {
  const textured = {
    kind: 'design-language',
    packageName: '@portfolio/appearance',
    version: '0.0.0',
    manifest: {
      ...PLATFORM_NEUTRAL,
      id: 'acme-grain',
      tokens: {
        ...PLATFORM_NEUTRAL.tokens,
        texture: 'linear-gradient(var(--color-border-subtle) 1px, transparent 1px)',
        // The accent itself, which anchor-v2 leaves at anchor-v1's 3:1 on the surfaces.
        'signature-fill': 'linear-gradient(90deg, var(--color-accent), var(--color-signature-end))',
      },
    },
  } as MetaPack;
  const check = checkAppearance(
    createAppearanceRegistry({ VARIANTS, PACKS: [...FALLBACKS, textured] }),
  );
  assert.equal(check.ok, false);
  const failure = check.failures.find(
    (item) => item.pair.set === 'light' && item.pair.foreground === 'accent to signature-end',
  )!;
  assert.equal(failure.language, 'acme-grain');
  assert.equal(failure.scheme, 'warm-parchment');
  assert.equal(failure.typography, 'humanist-ui');
  assert.deepEqual(failure.modes, ['system', 'light', 'dark']);
  assert.equal(failure.pair.kind, 'large-text');
  assert.equal(failure.pair.target, 3.3);
});

test("a language whose focus ring sits over 0 and under 2px off its part fails once, as its own problem, and its pairs still run, while a flush ring is LANG-5c's (cause 4)", () => {
  const near = (id: string, offset: string) =>
    ({
      kind: 'design-language',
      packageName: '@portfolio/appearance',
      version: '0.0.0',
      manifest: {
        ...PLATFORM_NEUTRAL,
        id,
        tokens: { ...PLATFORM_NEUTRAL.tokens, 'focus-offset': offset },
      },
    }) as MetaPack;
  const check = checkAppearance(
    createAppearanceRegistry({
      VARIANTS,
      PACKS: [
        ...FALLBACKS,
        near('acme-near', '1px'),
        near('acme-flush', '0px'),
        near('acme-clear', '2px'),
      ],
    }),
  );
  assert.equal(check.ok, false);
  assert.deepEqual(
    check.problems.map(({ axis, id, message }) => `${axis} ${id}: ${message.split(':')[0]}`),
    ['designLanguage acme-near: focus-offset is 1px, under the 2px a focus ring needs'],
  );
  // A flush ring is exempt (the lead's ruling): no problem of its own; LANG-5c's focus-inside pairs hold it.
  assert.ok(check.problems.every(({ id }) => id !== 'acme-flush'));
  // Its pairs are gated as every language's are: acme-near's are platform-neutral's, all passing.
  assert.ok(check.combinations > 0);
  assert.equal(check.failures.filter(({ language }) => language === 'acme-near').length, 0);
  // At a caller's 1px target, 1px passes.
  const loose = checkAppearance(
    createAppearanceRegistry({ VARIANTS, PACKS: [...FALLBACKS, near('acme-near', '1px')] }),
    { targets: { ...GATE_TARGETS, focusOffset: 1 } },
  );
  assert.deepEqual(loose.problems, []);
});

test('the hierarchy check holds the accent states and the quieter text roles apart', () => {
  const sets = schemeSets({
    light: anchorV1(WARM_PARCHMENT.anchors!.light!, 'light'),
    dark: anchorV1(WARM_PARCHMENT.anchors!.dark!, 'dark'),
  });
  assert.deepEqual(hierarchyFailures('warm-parchment', sets), []);
  const collapsed = {
    ...sets,
    light: { ...sets.light!, 'text-muted': sets.light!['text-secondary'] },
  };
  assert.deepEqual(hierarchyFailures('acme', collapsed), [
    { scheme: 'acme', set: 'light', first: 'text-secondary', second: 'text-muted', distance: 0 },
  ]);
  // A high-contrast set's text roles are all the text color by design; only its accent states count.
  assert.deepEqual(
    hierarchyFailures('acme', { 'high-contrast-dark': sets['high-contrast-dark']! }),
    [],
  );
});

test('every known-bad input fails the check, for the reason it names', () => {
  const registry = createAppearanceRegistry(META);
  const names = knownBadNames();
  assert.ok(names.length >= 30, names.join(', '));
  assert.ok(names.includes('bad-contrast'));
  for (const name of names) {
    const read = readKnownBadFixture(name, registry);
    assert.ok(read.ok, read.ok ? '' : read.problem);
    const { fixture } = read;
    assert.ok(fixture.expect.length > 0, `${name} names what it expects`);
    const run = runKnownBad(fixture, META);
    const caught = run.problems.length > 0 || (run.check !== undefined && !run.check.ok);
    assert.ok(caught, `${name} passed the check`);
    assert.deepEqual(
      unmetExpectations(fixture, run),
      [],
      `${name}: ${JSON.stringify(run.check?.failures.slice(0, 2) ?? run.problems)}`,
    );
  }
});

test("a known-bad input's run gates only the combinations that hold its pack, and finds what the whole run finds for it (#20)", () => {
  const registry = createAppearanceRegistry(META);
  const base = checkAppearance(registry).combinations;
  for (const name of ['bad-contrast', 'bad-texture']) {
    const read = readKnownBadFixture(name, registry);
    assert.ok(read.ok, name);
    const run = runKnownBad(read.fixture, META);
    const validated = validatePackManifest(read.fixture.manifest, {
      kind: read.fixture.kind,
      packageName: '@portfolio/appearance',
    });
    assert.ok(validated.ok, name);
    const pack = {
      kind: read.fixture.kind,
      packageName: '@portfolio/appearance',
      version: '0.0.0',
      manifest: validated.manifest,
    } as MetaPack;
    const whole = checkAppearance(
      createAppearanceRegistry({ ...META, PACKS: [...META.PACKS, pack] }),
    );
    assert.ok(run.check && run.check.combinations > 0, name);
    assert.equal(run.check.combinations, whole.combinations - base, name);
    assert.deepEqual(
      run.check.failures,
      whole.failures.filter((failure) =>
        [failure.language, failure.scheme, failure.typography].includes(read.fixture.name),
      ),
      name,
    );
  }
});

test('bad-texture fails only for its texture: the same fill untextured passes on anchor-v2 schemes (#20 PR 2c)', () => {
  const read = readKnownBadFixture('bad-texture', createAppearanceRegistry(META));
  assert.ok(read.ok);
  const manifest = read.fixture.manifest as { tokens: Record<string, string> };
  const untextured = {
    ...read.fixture,
    manifest: { ...manifest, tokens: { ...manifest.tokens, texture: 'none' } },
  };
  const run = runKnownBad(untextured, META);
  assert.deepEqual(run.check?.failures ?? run.problems, []);
});

test('every refusal the refined body lists for a language stylesheet has its known-bad input', () => {
  const audits = knownBadNames().filter((name) => name.startsWith('audit-'));
  for (const rule of [
    'display-none',
    'visibility-hidden',
    'content',
    'order',
    'grid-placement',
    'position-fixed',
    'color-literal',
    'import',
    'font-face',
    'root',
    'html',
    'body',
    'important',
  ]) {
    assert.ok(audits.includes(`audit-${rule}`), rule);
  }
});

test('every pack CSS lint rule has a known-bad input that requires that rule, and fails for it (#20)', () => {
  const registry = createAppearanceRegistry(META);
  for (const rule of LINT_RULES) {
    const name = `lint-${rule}`;
    assert.ok(knownBadNames().includes(name), name);
    const read = readKnownBadFixture(name, registry);
    assert.ok(read.ok, name);
    assert.deepEqual(read.fixture.expect, [{ lint: rule }], name);
    const run = runKnownBad(read.fixture, META);
    assert.deepEqual(
      unmetExpectations(read.fixture, run),
      [],
      `${name}: ${run.problems.join(' | ')}`,
    );
    // Its expectation is the rule itself: another rule's wouldn't be met.
    const other = LINT_RULES.find((each) => each !== rule && !(run.rules ?? []).includes(each))!;
    assert.equal(
      unmetExpectations({ ...read.fixture, expect: [{ lint: other }] }, run).length,
      1,
      `${name} against ${other}`,
    );
  }
});

test('every hiding and layout vector the review of PR #57 lists has its known-bad input', () => {
  const audits = knownBadNames().filter((name) => name.startsWith('audit-'));
  for (const vector of [
    'clip-path',
    'mask',
    'zoom',
    'width',
    'height',
    'max-size',
    'overflow',
    'color-transparent',
    'font-size',
    'text-indent',
    // The lengths the caps hold: an outline, a shadow's spread, and padding.
    'outline-length',
    'shadow-viewport',
    'padding-viewport',
    // A surface faded out, a part dimmed without being disabled, and em past the caps.
    'surface-opacity',
    'state-opacity',
    'em-length',
  ]) {
    assert.ok(audits.includes(`audit-${vector}`), vector);
  }
  for (const name of ['bad-token-length', 'bad-surface-opacity-number', 'bad-focus-width-zero']) {
    assert.ok(knownBadNames().includes(name), name);
  }
});

test('a known-bad input that names no registered base, or an unknown role, is refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-known-bad-'));
  try {
    const write = (name: string, fixture: unknown) => {
      fs.mkdirSync(path.join(dir, name));
      fs.writeFileSync(path.join(dir, name, 'fixture.json'), JSON.stringify(fixture));
    };
    write('no-base', { kind: 'color-scheme', base: 'gone', description: 'x', expect: [] });
    write('bad-role', {
      kind: 'color-scheme',
      base: 'warm-parchment',
      description: 'x',
      patch: { light: { 'text-tertiary': '#000000' } },
    });
    const registry = createAppearanceRegistry(META);
    const problem = (name: string) => {
      const read = readKnownBadFixture(name, registry, dir);
      assert.equal(read.ok, false);
      return read.ok ? '' : read.problem;
    };
    assert.match(problem('no-base'), /starts from gone, which this build doesn't register/);
    assert.match(problem('bad-role'), /patches text-tertiary, which isn't a color role/);
    assert.match(problem('missing'), /There's no known-bad input missing/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every layered stylesheet must start with the layer order, after nothing but comments', () => {
  assert.deepEqual(
    layerOrderProblems([
      { path: 'ok.css', css: `/* #19 */\n${LAYER_ORDER}\n@layer reset {}` },
      { path: 'unlayered.css', css: '.a { color: red; }' },
      { path: 'late.css', css: `.a {}\n${LAYER_ORDER}` },
      { path: 'block.css', css: '@layer variant-layout { .a {} }' },
      // A browser reads at-rule names in any case, so the check does too.
      { path: 'caps.css', css: '@LAYER variant-layout { .a {} }' },
    ]),
    ['late.css', 'block.css', 'caps.css'],
  );
  // The repository's own stylesheets: today none is layered, and each compiled one is.
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const files = stylesheetsUnder(root, ['apps', 'packages']);
  assert.ok(files.some((file) => file.path === 'packages/kit/src/sections/styles.css'));
  assert.ok(files.every((file) => !file.path.includes('node_modules')));
  assert.deepEqual(layerOrderProblems(files), []);
  assert.ok(fs.existsSync(KNOWN_BAD_DIR));
  // The known-bad inputs never ship, and lint-layer-scope opens a layer of its own on purpose.
  assert.ok(files.every((file) => !file.path.startsWith('packages/appearance/test/fixtures/')));
});

test('the gate reads what HUMANIST_UI declares: its display and headline are large text', () => {
  const check = checkAppearance(createAppearanceRegistry(META));
  // A 1.25rem bold headline is still large text (15pt bold); a 1rem one isn't.
  const small = {
    ...HUMANIST_UI,
    id: 'acme-small',
    roles: {
      ...HUMANIST_UI.roles,
      headline: { ...HUMANIST_UI.roles.headline, 'font-size': '1rem' },
    },
  };
  const smaller = checkAppearance(
    createAppearanceRegistry({
      VARIANTS,
      PACKS: [
        ...FALLBACKS,
        {
          kind: 'typography',
          packageName: '@portfolio/appearance',
          version: '0.0.0',
          manifest: small,
        } as MetaPack,
      ],
    }),
  );
  assert.equal(check.ok, true);
  assert.equal(smaller.ok, false);
  assert.ok(smaller.failures.every((failure) => failure.typography === 'acme-small'));
});

test("a known-bad patch that names none of the roles K-2 added leaves them out, so they're worked out again from what it patches (K-2 review L4)", () => {
  const registry = createAppearanceRegistry(META);
  // bad-high-contrast patches text-primary alone: its set gives none of the three.
  const high = readKnownBadFixture('bad-high-contrast', registry);
  assert.ok(high.ok);
  const authored = (high.fixture.manifest.highContrast as Record<string, Record<string, string>>)
    .dark!;
  for (const role of DERIVED_ROLES) assert.equal(authored[role], undefined, role);
  // A base set's text-primary moves the roles that read it: worked out again, not kept stale.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'known-bad-'));
  const write = (patch: unknown) =>
    fs.writeFileSync(
      path.join(dir, 'patched', 'fixture.json'),
      JSON.stringify({
        kind: 'color-scheme',
        base: 'warm-parchment',
        description: 'warm-parchment, patched.',
        patch,
        expect: [],
      }),
    );
  try {
    fs.mkdirSync(path.join(dir, 'patched'));
    write({ dark: { 'text-primary': '#c9bda8' } });
    const read = readKnownBadFixture('patched', registry, dir);
    assert.ok(read.ok, read.ok ? '' : read.problem);
    const dark = read.fixture.manifest.dark as Record<string, string>;
    for (const role of DERIVED_ROLES) assert.equal(dark[role], undefined, role);
    const registered = findPack(registry, 'colorScheme', 'warm-parchment')!.sets.dark!;
    const rederived = withDerivedRoles(dark as never, false);
    assert.notEqual(rederived['surface-lit'], registered['surface-lit']);
    assert.notEqual(rederived['focus-inverse'], registered['focus-inverse']);
    // A patch that names one keeps the set's other two, as an authored set gives all three.
    write({ dark: { 'surface-lit': '#5c544b' } });
    const own = readKnownBadFixture('patched', registry, dir);
    assert.ok(own.ok);
    const given = own.fixture.manifest.dark as Record<string, string>;
    assert.equal(given['surface-lit'], '#5c544b');
    assert.equal(given['on-emphasis'], registered['on-emphasis']);
    assert.equal(given['focus-inverse'], registered['focus-inverse']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the shadow-key check's known failures are the ones it found when it landed that still fail, worst first, each on botanical-sage light surface-prominent", () => {
  assert.deepEqual(
    SHADOW_KEY_KNOWN_FAILURES.map(({ language, scheme, set, ground, ratio }) =>
      [language, ratio, `${scheme} ${set} ${ground}`].join(' '),
    ),
    [
      'synthwave 3.49 botanical-sage light surface-prominent',
      'skeuomorphic 4.02 botanical-sage light surface-prominent',
      'carbon-inspired 4.21 botanical-sage light surface-prominent',
      'atelier-luxury 4.3 botanical-sage light surface-prominent',
      'glassmorphism 4.33 botanical-sage light surface-prominent',
    ],
  );
});

test('a known shadow-key failure is held to its entry both ways, and the list only shrinks', () => {
  // platform-neutral with fluent-2-inspired 1.1.5's raised shadow fails the shadow-key check.
  const shadowed = {
    kind: 'design-language',
    packageName: '@portfolio/appearance',
    version: '0.0.0',
    manifest: {
      ...PLATFORM_NEUTRAL,
      id: 'acme-shadow',
      tokens: {
        ...PLATFORM_NEUTRAL.tokens,
        'shadow-raised':
          '0 0 8px color-mix(in srgb, var(--color-shadow) 16%, transparent), 0 32px 64px color-mix(in srgb, var(--color-shadow) 36%, transparent)',
      },
    },
  } as MetaPack;
  const registry = createAppearanceRegistry({ VARIANTS, PACKS: [...FALLBACKS, shadowed] });
  const bare = checkAppearance(registry, { knownShadowFailures: [] });
  const mine = bare.failures.filter(
    ({ language, pair }) => language === 'acme-shadow' && pair.shadow,
  );
  assert.ok(mine.length > 0);
  assert.equal(bare.ok, false);
  assert.deepEqual(bare.known, []);
  const worst = [...mine].sort((a, b) => a.pair.ratio - b.pair.ratio)[0]!;
  const entry = {
    language: 'acme-shadow',
    scheme: worst.scheme,
    set: worst.pair.set,
    ground: worst.pair.ground,
    ratio: worst.pair.ratio,
  };
  // Listed at its worst: it passes the run, and the run says what it held.
  const listed = checkAppearance(registry, { knownShadowFailures: [entry] });
  assert.equal(listed.ok, true, JSON.stringify(listed.problems));
  assert.deepEqual(listed.known, [
    {
      entry,
      excused: mine.length,
      worst: { scheme: entry.scheme, set: entry.set, ground: entry.ground, ratio: entry.ratio },
    },
  ]);
  // Only its shadow-key pairs: the same language failing anything else still fails.
  assert.ok(listed.failures.every(({ pair }) => !pair.shadow));
  // Worse than its entry: the pairs under the entry fail, as any pack's do.
  const worse = checkAppearance(registry, {
    knownShadowFailures: [{ ...entry, ratio: entry.ratio + 0.5 }],
  });
  assert.equal(worse.ok, false);
  assert.ok(worse.failures.some(({ language, pair }) => language === 'acme-shadow' && pair.shadow));
  // Better than its entry: the entry must rise to its worst.
  const better = checkAppearance(registry, {
    knownShadowFailures: [{ ...entry, ratio: entry.ratio - 0.5 }],
  });
  assert.equal(better.ok, false);
  assert.match(
    better.problems.map(({ message }) => message).join('\n'),
    new RegExp(`acme-shadow's worst shadow-key pair is ${entry.ratio}:1 now .*raise its entry`),
  );
  // Passing: the entry comes off.
  const passing = checkAppearance(createAppearanceRegistry(META), {
    knownShadowFailures: [{ ...entry, language: 'platform-neutral' }],
  });
  assert.equal(passing.ok, false);
  assert.deepEqual(
    passing.problems.map(({ id, message }) => [
      id,
      /passes the shadow-key check now/.test(message),
    ]),
    [['platform-neutral', true]],
  );
  // A language this run doesn't gate isn't judged: the command checks every entry is registered.
  assert.equal(
    checkAppearance(createAppearanceRegistry(META), { knownShadowFailures: [entry] }).ok,
    true,
  );
  // A slice, as a known-bad input's run gates, holds its pairs to the entry but can't call it stale.
  const slice = checkAppearance(registry, {
    knownShadowFailures: [{ ...entry, ratio: entry.ratio - 0.5 }],
    only: { axis: 'designLanguage', id: 'acme-shadow' },
  });
  assert.equal(slice.ok, true, JSON.stringify(slice.problems));
});
