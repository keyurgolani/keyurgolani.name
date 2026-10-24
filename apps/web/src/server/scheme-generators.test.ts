import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createAppearanceRegistry,
  readDerivedSchemes,
  resolveTokens,
  validatePackManifest,
  type AppearanceRegistry,
} from '@portfolio/appearance';
import { runGenerator } from '@portfolio/appearance/generators';
import { PACKS, VARIANTS } from '~/lib/generated/registry.meta';
import { buildUnitChecks } from './unit-checks';

// The build's scheme generators and the read side (#10, 10h): the store
// runs the generator a registered scheme's manifest declares, through
// runGenerator(), and checks what it made against DerivedSchemeSchema; a
// page reads the revision's frozen tokens, checked the same way, and never
// runs a generator, so a missing or broken entry renders the fallback.

/** This build's registry with fixture-seed, the generated test scheme, registered too. */
function withFixtureSeed(): AppearanceRegistry {
  const raw: unknown = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          '../../../../packages/appearance-fixtures-schemes/packs/fixture-seed/manifest.json',
          import.meta.url,
        ),
      ),
      'utf8',
    ),
  );
  const checked = validatePackManifest(raw, {
    kind: 'color-scheme',
    packageName: '@portfolio/appearance-fixtures-schemes',
  });
  assert.ok(checked.ok, JSON.stringify(checked));
  const others = PACKS.filter((pack) => pack.manifest.id !== 'fixture-seed');
  return createAppearanceRegistry({
    VARIANTS,
    PACKS: [
      ...others,
      {
        kind: 'color-scheme',
        manifest: checked.manifest,
        packageName: '@portfolio/appearance-fixtures-schemes',
        version: '1.0.0',
        fixture: true,
      },
    ] as typeof PACKS,
  });
}

const request = {
  designLanguage: 'platform-neutral',
  colorScheme: 'fixture-seed',
  typography: 'humanist-ui',
  polarity: 'light',
} as const;

test("the build's checks carry the generators each registered scheme declares, run through runGenerator, and check what they make", () => {
  const registry = withFixtureSeed();
  const checks = buildUnitChecks({ registry: VARIANTS, appearance: registry, appVersion: 'test' });
  const generators = checks.schemes;
  assert.ok(generators, 'the build hands the store its generators');
  assert.deepEqual(generators.declared('fixture-seed'), {
    id: 'fixture-seed',
    version: 1,
    input: 'seed-color',
  });
  assert.equal(generators.declared('warm-parchment'), undefined, 'an authored scheme has none');
  assert.equal(generators.declared('no-such-scheme'), undefined);

  const run = generators.run(
    { id: 'fixture-seed', version: 1, input: 'seed-color' },
    { seedColor: '#3366ff' },
  );
  assert.ok(run.ok);
  const expected = runGenerator(
    { id: 'fixture-seed', version: 1, input: 'seed-color' },
    { seedColor: '#3366ff' },
  );
  assert.ok(expected.ok);
  assert.deepEqual(run.ok ? run.tokens : null, expected.result.tokens);
  assert.equal(
    generators.check({
      generator: run.generator,
      inputsHash: 'a'.repeat(64),
      tokens: run.ok ? run.tokens : null,
    }),
    true,
  );
  // Another version, or an asset this generator doesn't take, is a problem, never a throw.
  const later = generators.run(
    { id: 'fixture-seed', version: 2, input: 'seed-color' },
    { seedColor: '#3366ff' },
  );
  assert.equal(later.ok, false);
  assert.match(later.ok ? '' : later.problem, /version 2, and this build has version 1/);
  const asset = generators.run(
    { id: 'fixture-seed', version: 1, input: 'asset' },
    { sourceAsset: 'portrait', bytes: new Uint8Array([1, 2, 3]) },
  );
  assert.equal(asset.ok, false);
  // An incomplete set doesn't check.
  assert.equal(
    generators.check({
      generator: run.generator,
      inputsHash: 'a'.repeat(64),
      tokens: { light: {} },
    }),
    false,
  );
});

/** What resolveTokens() takes in `generated`: each read entry's tokens. */
const generatedOf = (value: unknown) =>
  Object.fromEntries(
    Object.entries(readDerivedSchemes(value).schemes).map(([id, entry]) => [id, entry.tokens]),
  );

test("a page renders the revision's frozen tokens as they are, never generating them again, and an entry missing or broken falls back on the scheme axis", () => {
  const registry = withFixtureSeed();
  // Tokens fixture-seed would never make from the site's seed: what the
  // owner accepted is what renders, whatever the generator says now.
  const made = runGenerator(
    { id: 'fixture-seed', version: 1, input: 'seed-color' },
    { seedColor: '#aa5500' },
  );
  assert.ok(made.ok);
  const entry = {
    generator: { id: 'fixture-seed', version: 1 },
    inputsHash: 'b'.repeat(64),
    tokens: made.result.tokens,
  };
  const resolved = resolveTokens(registry, request, {
    generated: generatedOf({ 'fixture-seed': entry }),
  });
  assert.deepEqual(resolved.fallbackAxes, []);
  assert.deepEqual(resolved.color, made.result.tokens.light);

  const broken = readDerivedSchemes({
    'fixture-seed': { ...entry, tokens: { light: made.result.tokens.light } },
  });
  assert.deepEqual(broken.schemes, {});
  assert.deepEqual(
    broken.problems.map(({ code, schemeId }) => [code, schemeId]),
    [['scheme.invalid', 'fixture-seed']],
  );
  assert.deepEqual(
    resolveTokens(registry, request, { generated: generatedOf(broken.schemes) }).fallbackAxes,
    ['colorScheme'],
  );
  // None at all: the same fallback.
  assert.deepEqual(
    resolveTokens(registry, request, { generated: generatedOf(undefined) }).fallbackAxes,
    ['colorScheme'],
  );
});
