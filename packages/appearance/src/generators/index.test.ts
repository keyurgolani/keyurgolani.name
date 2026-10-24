import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deltaE, isHex } from '../color';
import { DISTINCT_PAIRS } from '../derive';
import { COLOR_ROLES } from '../tokens';
import { randomHex, seeded } from '../test-support/packs';
import { FIXTURE_SEED, GENERATORS, runGenerator } from './index';

// The scheme generators (#19, Slice 2, item 5): pure, keyed by generator.id,
// returning tokens and a contrast report, with a deterministic fixture-seed.

const DECLARED = { id: 'fixture-seed', version: 1, input: 'seed-color' } as const;

/** Every module ./generators loads at run time, and every package specifier among them. */
function runtimeImports(entry: string): { modules: string[]; packages: string[] } {
  const modules = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (modules.has(file)) return;
    modules.add(file);
    const source = fs.readFileSync(file, 'utf8');
    // import and export statements, with or without names, but not import type or export type.
    for (const match of source.matchAll(
      /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm,
    )) {
      const specifier = match[1]!;
      if (!specifier.startsWith('.')) {
        packages.add(specifier);
        continue;
      }
      const base = path.resolve(path.dirname(file), specifier);
      visit(fs.existsSync(`${base}.ts`) ? `${base}.ts` : path.join(base, 'index.ts'));
    }
  };
  visit(entry);
  return {
    modules: [...modules].map((file) => path.basename(file)).sort(),
    packages: [...packages],
  };
}

test('./generators loads none of the packages manifests need, so its bundle stays small', () => {
  const { modules, packages } = runtimeImports(
    fileURLToPath(new URL('./index.ts', import.meta.url)),
  );
  // TOKEN_CONTRACT_VERSION would bring @portfolio/variant-contract, @portfolio/schema, and yaml.
  assert.deepEqual(packages, []);
  assert.deepEqual(modules, [
    'anchor-v2.ts',
    'color.ts',
    'compose.ts',
    'derive.ts',
    'gate.ts',
    'hct.ts',
    'index.ts',
    'palette.ts',
    'roles.ts',
    'schemes.ts',
    'sets.ts',
  ]);
});

test('generators are keyed by their id', () => {
  assert.deepEqual(Object.keys(GENERATORS), [
    'fixture-seed',
    'brand-seed',
    'hct-tonal',
    'profile-image',
    'portfolio-artwork',
  ]);
  for (const [id, generator] of Object.entries(GENERATORS)) assert.equal(generator.id, id);
  assert.equal(GENERATORS['fixture-seed'], FIXTURE_SEED);
});

test('fixture-seed is deterministic, and reads a seed in any case', () => {
  const first = runGenerator(DECLARED, { seedColor: '#3366ff' });
  const again = runGenerator(DECLARED, { seedColor: '#3366FF' });
  assert.ok(first.ok && again.ok);
  assert.deepEqual(first.result, again.result);
  assert.deepEqual(first.result.input, { seedColor: '#3366ff' });
  assert.deepEqual(first.result.generator, { id: 'fixture-seed', version: 1 });
  for (const mode of ['light', 'dark'] as const) {
    assert.deepEqual(Object.keys(first.result.tokens[mode]), [...COLOR_ROLES]);
    for (const role of COLOR_ROLES)
      assert.ok(isHex(first.result.tokens[mode][role]), `${mode} ${role}`);
  }
});

test('property: every seed generates a scheme that passes its contrast report and keeps its hierarchy', () => {
  const random = seeded(4242);
  const seeds = ['#000000', '#ffffff', '#808080', '#ffff00', '#00ffff', '#0000ff', '#ff0000'];
  for (let index = 0; index < 300; index += 1) seeds.push(randomHex(random));
  for (const seedColor of seeds) {
    const run = runGenerator(DECLARED, { seedColor });
    assert.ok(run.ok, seedColor);
    const failures = run.result.contrastReport.pairs.filter((pair) => !pair.passes);
    assert.deepEqual(failures, [], seedColor);
    assert.equal(run.result.contrastReport.passes, true);
    // The report covers every set the scheme renders: both modes and both high-contrast sets.
    assert.deepEqual(
      [...new Set(run.result.contrastReport.pairs.map((pair) => pair.set))],
      ['dark', 'high-contrast-dark', 'high-contrast-light', 'light'],
    );
    for (const mode of ['light', 'dark'] as const) {
      const set = run.result.tokens[mode];
      for (const [first, second, least] of DISTINCT_PAIRS) {
        assert.ok(
          deltaE(set[first], set[second]) >= least,
          `${seedColor} ${mode}: ${first} and ${second}`,
        );
      }
    }
  }
});

test('runGenerator refuses what it cannot run, and never throws', () => {
  const problem = (declared: Parameters<typeof runGenerator>[0], input: unknown) => {
    const run = runGenerator(declared, input);
    assert.equal(run.ok, false);
    return run.ok ? '' : run.problem;
  };
  assert.match(
    problem({ ...DECLARED, id: 'acme-seed' }, { seedColor: '#3366ff' }),
    /no generator acme-seed/,
  );
  assert.match(
    problem({ ...DECLARED, version: 2 }, { seedColor: '#3366ff' }),
    /built for fixture-seed version 2/,
  );
  assert.match(
    problem({ ...DECLARED, input: 'asset' }, { sourceAsset: 'hero' }),
    /takes a seed-color input/,
  );
  for (const input of [
    null,
    'seed',
    [],
    {},
    { seedColor: '#36f' },
    { seedColor: 'red' },
    { sourceAsset: 'hero' },
  ]) {
    assert.match(problem(DECLARED, input), /takes \{ seedColor \}/, JSON.stringify(input));
  }
  // A seed the input only inherits isn't its own.
  const inherited = Object.create({ seedColor: '#3366ff' }) as object;
  assert.match(problem(DECLARED, inherited), /takes \{ seedColor \}/);
  assert.throws(() => FIXTURE_SEED.generate({ sourceAsset: 'hero' }), TypeError);
});
