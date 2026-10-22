import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAYER_ORDER } from '../layers';
import { createAppearanceRegistry, type MetaPack } from '../registry';
import { schemeSets } from '../sets';
import { anchorV1 } from '../derive';
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
  stylesheetsUnder,
  unmetExpectations,
} from './check';

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
      'colorScheme:fixture-research',
      'colorScheme:fixture-seed',
    ],
  );
  // multilingual-system is a test pack, not a fixture: it's gated with the trio.
  assert.equal(check.combinations, 2 * 4);
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
        texture: 'linear-gradient(var(--color-border-subtle), transparent)',
      },
    },
  } as MetaPack;
  const check = checkAppearance(
    createAppearanceRegistry({ VARIANTS, PACKS: [...FALLBACKS, textured] }),
  );
  assert.equal(check.ok, false);
  const failure = check.failures.find(
    (item) => item.pair.set === 'light' && item.pair.foreground === 'text-muted',
  )!;
  assert.equal(failure.language, 'acme-grain');
  assert.equal(failure.scheme, 'warm-parchment');
  assert.equal(failure.typography, 'humanist-ui');
  assert.deepEqual(failure.modes, ['system', 'light', 'dark']);
  assert.equal(failure.pair.target, 4.95);
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
  ]) {
    assert.ok(audits.includes(`audit-${vector}`), vector);
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
    ]),
    ['late.css', 'block.css'],
  );
  // The repository's own stylesheets: today none is layered, and each compiled one is.
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const files = stylesheetsUnder(root, ['apps', 'packages']);
  assert.ok(files.some((file) => file.path === 'packages/kit/src/sections/styles.css'));
  assert.ok(files.every((file) => !file.path.includes('node_modules')));
  assert.deepEqual(layerOrderProblems(files), []);
  assert.ok(fs.existsSync(KNOWN_BAD_DIR));
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
