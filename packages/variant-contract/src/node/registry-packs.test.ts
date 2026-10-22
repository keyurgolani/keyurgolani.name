import test from 'node:test';
import assert from 'node:assert/strict';
import { readRegistry, type FixtureGate, type RegistryDiagnostic } from './registry';
import {
  FALLBACK,
  manifestFor,
  packPackage,
  removeTestHosts,
  TEST_FALLBACK_PACKS,
  TEST_PACK_HOOKS,
  testHost,
  variantPackage,
  type PackageSpec,
} from './test-hosts';

test.after(removeTestHosts);

// Appearance packs (#19, Slice 2): with the pack checks the host passes in,
// every pack in a pack package is validated, compiled, and registered or
// reported, never skipped; and the fixture gate (#7, item 10) decides when a
// `portfolio.fixture: true` package registers.

const BASE = [FALLBACK, ...TEST_FALLBACK_PACKS];

async function read(packages: readonly PackageSpec[], fixtures?: FixtureGate) {
  return readRegistry({
    hostDir: testHost([...BASE, ...packages]),
    packs: TEST_PACK_HOOKS,
    ...(fixtures ? { fixtures } : {}),
  });
}

/** The records as [package, file, pointer, code]. */
const where = (diagnostics: readonly RegistryDiagnostic[]) =>
  diagnostics.map((record) => [record.package, record.manifestPath, record.pointer, record.code]);

const at = (name: string, file: string) => `node_modules/${name}/${file}`;

/** A gate that maps the @acme/fixtures-* packages to APPEARANCE_FIXTURES, admitted or not. */
const gate =
  (admitted: boolean): FixtureGate =>
  ({ name }) =>
    name.startsWith('@acme/fixtures-')
      ? { mapped: true, flag: 'APPEARANCE_FIXTURES', admitted }
      : { mapped: false };

const fixturePackage = (name: string, packs: Record<string, unknown>) =>
  packPackage(name, 'color-scheme', packs, {
    packageJson: { portfolio: { kind: 'color-scheme', packs: './packs', fixture: true } },
  });

test('every pack registers, sorted by kind and id, with its compiled files and the platform stylesheet', async () => {
  const result = await read([
    packPackage('@acme/schemes', 'color-scheme', {
      'acme-dusk': { id: 'acme-dusk' },
      'acme-dawn': { id: 'acme-dawn' },
    }),
    packPackage('@acme/type', 'typography', { 'acme-serif': { id: 'acme-serif', font: true } }),
  ]);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.packs.map(({ kind, manifest, packageName, version, fixture }) => [
      kind,
      manifest.id,
      packageName,
      version,
      fixture,
    ]),
    [
      ['color-scheme', 'acme-dawn', '@acme/schemes', '1.0.0', false],
      ['color-scheme', 'acme-dusk', '@acme/schemes', '1.0.0', false],
      ['color-scheme', 'test-scheme', '@portfolio/test-schemes', '1.0.0', false],
      ['design-language', 'test-language', '@portfolio/test-languages', '1.0.0', false],
      ['typography', 'acme-serif', '@acme/type', '1.0.0', false],
      ['typography', 'test-type', '@portfolio/test-typography', '1.0.0', false],
    ],
  );
  const serif = result.packs.find(({ manifest }) => manifest.id === 'acme-serif')!;
  assert.match(serif.stylesheet!.url, /^\/_portfolio\/pack\/acme-serif\.[0-9a-f]{12}\.css$/);
  assert.deepEqual(
    serif.assets.map(({ name }) => name.replace(/[0-9a-f]{12}/, '<hash>')),
    ['acme-serif.<hash>.woff2'],
  );
  assert.match(serif.dir, /node_modules\/@acme\/type\/packs\/acme-serif$/);
  assert.match(result.platform!.name, /^_platform\.[0-9a-f]{12}\.css$/);
  assert.deepEqual(result.fixtures, []);
});

test('a pack package names its packs directory, inside the package, with a directory per pack', async () => {
  const valid = { 'acme-ok': { id: 'acme-ok' } };
  const result = await read([
    {
      name: '@acme/a-unnamed',
      packageJson: { version: '1.0.0', portfolio: { kind: 'typography' } },
    },
    packPackage(
      '@acme/b-outside',
      'typography',
      {},
      {
        packageJson: { portfolio: { kind: 'typography', packs: '../elsewhere' } },
      },
    ),
    packPackage(
      '@acme/c-gone',
      'typography',
      {},
      {
        packageJson: { portfolio: { kind: 'typography', packs: './missing' } },
      },
    ),
    packPackage('@acme/d-empty', 'typography', {}, { files: { 'packs/.keep': '' } }),
    packPackage('@acme/e-stray', 'typography', valid, { files: { 'packs/README.md': '# Packs' } }),
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(where(result.diagnostics), [
    [
      '@acme/a-unnamed',
      at('@acme/a-unnamed', 'package.json'),
      '/portfolio/packs',
      'registry.packs-missing',
    ],
    [
      '@acme/b-outside',
      at('@acme/b-outside', 'package.json'),
      '/portfolio/packs',
      'registry.package-invalid',
    ],
    [
      '@acme/c-gone',
      at('@acme/c-gone', 'package.json'),
      '/portfolio/packs',
      'registry.packs-missing',
    ],
    [
      '@acme/d-empty',
      at('@acme/d-empty', 'package.json'),
      '/portfolio/packs',
      'registry.packs-missing',
    ],
    [
      '@acme/e-stray',
      at('@acme/e-stray', 'package.json'),
      '/portfolio/packs',
      'registry.package-invalid',
    ],
  ]);
  assert.match(result.diagnostics[4]!.message, /holds README\.md, which isn't a directory/);
  // The stray file is reported; the pack beside it is still read, and registers.
  assert.ok(result.packs.some(({ manifest }) => manifest.id === 'acme-ok'));
});

test("each pack's manifest is read and validated where it is, and its directory is its id", async () => {
  const name = '@acme/schemes';
  const result = await read([
    packPackage(
      name,
      'color-scheme',
      {
        'acme-a': { id: 'acme-a' },
        'acme-b': { id: 'acme-other' },
        'acme-c': { id: 'acme-c', invalid: true },
      },
      {
        files: { 'packs/acme-d/notes.txt': 'no manifest', 'packs/acme-e/manifest.json': '{' },
      },
    ),
  ]);
  assert.deepEqual(where(result.diagnostics), [
    [name, at(name, 'packs/acme-b/manifest.json'), '/id', 'registry.pack-id-mismatch'],
    [name, at(name, 'packs/acme-c/manifest.json'), '/invalid', 'manifest.invalid'],
    [name, at(name, 'packs/acme-d/manifest.json'), '', 'registry.manifest-missing'],
    [name, at(name, 'packs/acme-e/manifest.json'), '', 'registry.manifest-syntax'],
  ]);
  const mismatch = result.diagnostics[0]!;
  assert.equal(mismatch.expected, 'acme-b');
  assert.equal(mismatch.actual, 'acme-other');
  assert.equal(mismatch.version, '1.0.0');
  assert.match(
    mismatch.remedy,
    /Or uninstall it: pnpm --filter @portfolio\/web remove @acme\/schemes\.$/,
  );
  assert.deepEqual(
    result.packs
      .filter(({ packageName }) => packageName === name)
      .map(({ manifest }) => manifest.id),
    ['acme-a'],
  );
});

test("a pack that doesn't compile is reported at the file it names", async () => {
  const name = '@acme/languages';
  const result = await read([
    packPackage(name, 'design-language', {
      'acme-x': { id: 'acme-x', broken: 'styles.css' },
      'acme-y': { id: 'acme-y', broken: 'manifest.json' },
    }),
  ]);
  assert.deepEqual(where(result.diagnostics), [
    [name, at(name, 'packs/acme-x/styles.css'), '/stylesheet', 'registry.pack-compile'],
    [name, at(name, 'packs/acme-y/manifest.json'), '/stylesheet', 'registry.pack-compile'],
  ]);
  assert.match(
    result.diagnostics[0]!.message,
    /^\/stylesheet names styles\.css, which can't be read\.$/,
  );
  assert.equal(result.packs.filter(({ packageName }) => packageName === name).length, 0);
});

test('an id names one thing: a pack id that a variant or another pack takes registers neither', async () => {
  const result = await read([
    variantPackage('@acme/ocean', 'acme-ocean'),
    packPackage('@acme/schemes', 'color-scheme', { 'acme-ocean': { id: 'acme-ocean' } }),
    packPackage('@acme/languages', 'design-language', { 'acme-tide': { id: 'acme-tide' } }),
    packPackage('@acme/type', 'typography', { 'acme-tide': { id: 'acme-tide' } }),
  ]);
  assert.deepEqual(where(result.diagnostics).sort(), [
    [
      '@acme/languages',
      at('@acme/languages', 'packs/acme-tide/manifest.json'),
      '/id',
      'registry.duplicate-id',
    ],
    ['@acme/ocean', at('@acme/ocean', 'manifest.json'), '/id', 'registry.duplicate-id'],
    [
      '@acme/schemes',
      at('@acme/schemes', 'packs/acme-ocean/manifest.json'),
      '/id',
      'registry.duplicate-id',
    ],
    [
      '@acme/type',
      at('@acme/type', 'packs/acme-tide/manifest.json'),
      '/id',
      'registry.duplicate-id',
    ],
  ]);
  const ocean = result.diagnostics.find(({ package: name }) => name === '@acme/ocean')!;
  assert.match(ocean.message, /which @acme\/schemes also registers/);
  assert.deepEqual(
    result.variants.map(({ manifest }) => manifest.id),
    ['fallback'],
  );
  assert.ok(
    result.packs.every(({ manifest }) => !['acme-ocean', 'acme-tide'].includes(manifest.id)),
  );
});

test("generation fails without a pack kind's first-party fallback", async () => {
  const result = await readRegistry({
    hostDir: testHost([FALLBACK, TEST_FALLBACK_PACKS[0]!, TEST_FALLBACK_PACKS[2]!]),
    packs: TEST_PACK_HOOKS,
  });
  assert.deepEqual(where(result.diagnostics), [
    ['@portfolio/web', 'package.json', '/dependencies', 'registry.fallback-missing'],
  ]);
  const [record] = result.diagnostics;
  assert.equal(record!.expected, '@portfolio/test-schemes');
  assert.match(record!.message, /test-scheme, the color-scheme pack every axis falls back to/);
  assert.match(
    record!.remedy,
    /pnpm --filter @portfolio\/web add @portfolio\/test-schemes@workspace:\*/,
  );
});

test('a fixture package that no flag maps fails generation, and portfolio.fixture is a boolean', async () => {
  const unmapped = fixturePackage('@acme/stray-fixtures', {
    'fixture-dusk': { id: 'fixture-dusk' },
  });
  const notBoolean = packPackage(
    '@acme/fixtures-maybe',
    'color-scheme',
    {},
    {
      packageJson: { portfolio: { kind: 'color-scheme', packs: './packs', fixture: 'yes' } },
    },
  );
  for (const fixtures of [undefined, gate(true)]) {
    const result = await read([unmapped, notBoolean], fixtures);
    assert.deepEqual(where(result.diagnostics), [
      [
        '@acme/fixtures-maybe',
        at('@acme/fixtures-maybe', 'package.json'),
        '/portfolio/fixture',
        'registry.package-invalid',
      ],
      [
        '@acme/stray-fixtures',
        at('@acme/stray-fixtures', 'package.json'),
        '/portfolio/fixture',
        'registry.fixture-unmapped',
      ],
    ]);
    assert.match(result.diagnostics[1]!.remedy, /apps\/web\/scripts\/fixture-gate\.ts/);
    assert.ok(result.packs.every(({ packageName }) => !packageName.includes('fixtures')));
  }
});

test('a fixture package registers only when its flag admits it, and is checked either way', async () => {
  const fixtures = fixturePackage('@acme/fixtures-schemes', {
    'fixture-dusk': { id: 'fixture-dusk' },
  });
  // An ordinary package never reaches the gate, portfolio.fixture: false included.
  const ordinary = packPackage(
    '@acme/schemes',
    'color-scheme',
    { 'acme-dawn': { id: 'acme-dawn' } },
    {
      packageJson: { portfolio: { kind: 'color-scheme', packs: './packs', fixture: false } },
    },
  );

  const left = await read([fixtures, ordinary], gate(false));
  assert.deepEqual(left.diagnostics, []);
  assert.deepEqual(left.fixtures, [
    {
      packageName: '@acme/fixtures-schemes',
      flag: 'APPEARANCE_FIXTURES',
      admitted: false,
      ids: ['fixture-dusk'],
    },
  ]);
  assert.ok(left.packs.every(({ manifest }) => manifest.id !== 'fixture-dusk'));
  assert.ok(left.packs.some(({ manifest }) => manifest.id === 'acme-dawn'));

  const admitted = await read([fixtures, ordinary], gate(true));
  assert.deepEqual(admitted.diagnostics, []);
  assert.equal(admitted.fixtures[0]!.admitted, true);
  const dusk = admitted.packs.find(({ manifest }) => manifest.id === 'fixture-dusk')!;
  assert.equal(dusk.fixture, true);
  assert.equal(admitted.packs.find(({ manifest }) => manifest.id === 'acme-dawn')!.fixture, false);

  // A broken fixture fails every build, whether or not it would register.
  const broken = fixturePackage('@acme/fixtures-broken', {
    'fixture-x': { id: 'fixture-x', invalid: true },
  });
  for (const admits of [false, true]) {
    const result = await read([broken], gate(admits));
    assert.deepEqual(where(result.diagnostics), [
      [
        '@acme/fixtures-broken',
        at('@acme/fixtures-broken', 'packs/fixture-x/manifest.json'),
        '/invalid',
        'manifest.invalid',
      ],
    ]);
  }
});

test("a build without a fixture's flag fails when the fixture's ids reach the registry another way", async () => {
  const fixtures = fixturePackage('@acme/fixtures-schemes', {
    'fixture-dusk': { id: 'fixture-dusk' },
  });
  const copy = packPackage('@acme/schemes', 'color-scheme', {
    'fixture-dusk': { id: 'fixture-dusk' },
  });
  const fixtureVariant = variantPackage('@acme/fixtures-variant', 'acme-fixture', {
    packageJson: {
      portfolio: { kind: 'variant', manifest: './manifest.json', fixture: true },
    },
  });
  const copiedVariant = variantPackage('@acme/variant', 'acme-fixture', {
    manifest: manifestFor('acme-fixture'),
  });

  const left = await read([fixtures, copy, fixtureVariant, copiedVariant], gate(false));
  assert.deepEqual(where(left.diagnostics), [
    [
      '@acme/schemes',
      at('@acme/schemes', 'packs/fixture-dusk/manifest.json'),
      '/id',
      'registry.fixture-leak',
    ],
    ['@acme/variant', at('@acme/variant', 'manifest.json'), '/id', 'registry.fixture-leak'],
  ]);
  assert.match(
    left.diagnostics[0]!.message,
    /registers fixture-dusk, the id of the fixture @acme\/fixtures-schemes, in a build without APPEARANCE_FIXTURES/,
  );

  // Admitted, the fixture registers, and a second package with its id is a duplicate.
  const admitted = await read([fixtures, copy], gate(true));
  assert.deepEqual(
    where(admitted.diagnostics).map(([name, , , code]) => [name, code]),
    [
      ['@acme/fixtures-schemes', 'registry.duplicate-id'],
      ['@acme/schemes', 'registry.duplicate-id'],
    ],
  );
});
