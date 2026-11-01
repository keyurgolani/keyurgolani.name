import test from 'node:test';
import assert from 'node:assert/strict';
import { packFiles, registryMeta, renderRegistry } from './codegen';
import { packLookDigest } from './pack-look';
import { readRegistry, type RegistryDiagnostic } from './registry';
import {
  FALLBACK,
  packPackage,
  removeTestHosts,
  TEST_FALLBACK_PACKS,
  TEST_PACK_HOOKS,
  testHost,
  type PackageSpec,
} from './test-hosts';

test.after(removeTestHosts);

// Retired packs (LANG-1): a pack package's `retired/<id>/retired.json` keeps
// a retired id as an alias of the pack that replaced it. Generation reads
// that record and nothing else of the retired pack, so its manifest and its
// stylesheet never register, compile, or ship. The rule is the same for
// every pack kind.

const BASE = [FALLBACK, ...TEST_FALLBACK_PACKS];

async function read(packages: readonly PackageSpec[]) {
  return readRegistry({ hostDir: testHost([...BASE, ...packages]), packs: TEST_PACK_HOOKS });
}

const where = (diagnostics: readonly RegistryDiagnostic[]) =>
  diagnostics.map((record) => [record.package, record.manifestPath, record.pointer, record.code]);

const at = (name: string, file: string) => `node_modules/${name}/${file}`;

/** A survivor's manifest: an id and a version, which the look digest leaves out, and its tokens. */
const SURVIVOR = (
  id: string,
  version = '1.0.0',
  tokens: Record<string, string> = { accent: 'teal' },
) => ({
  id,
  version,
  tokens,
});
/** The look of every SURVIVOR() whose tokens are the default: what a record pins at the merge. */
const MERGED = packLookDigest({ tokens: { accent: 'teal' } });

const record = (id: string, aliasOf: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    retiredVersion: 1,
    id,
    kind: 'color-scheme',
    aliasOf,
    reason: 'Its tokens were its survivor’s.',
    change: null,
    survivorVersion: '1.0.0',
    survivorDigest: MERGED,
    retiredAt: '2026-10-28',
    ...extra,
  });

test('a retired pack is an alias of its survivor, and its manifest and stylesheet never register, compile, or ship', async () => {
  // The retired manifest is one the pack checks refuse, and one that would
  // fail to compile: generation never reads it, so neither shows.
  const result = await read([
    packPackage(
      '@acme/schemes',
      'color-scheme',
      { 'acme-dusk': SURVIVOR('acme-dusk') },
      {
        files: {
          'retired/acme-dawn/retired.json': record('acme-dawn', 'acme-dusk', {
            change: 'its accent is a little warmer',
          }),
          'retired/acme-dawn/manifest.json': JSON.stringify({
            id: 'acme-dawn',
            invalid: true,
            broken: 'styles.css',
          }),
          'retired/acme-dawn/styles.css': '[data-color-scheme] { color: red; }',
        },
      },
    ),
  ]);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.aliases.map(({ kind, id, aliasOf, packageName, change }) => [
      kind,
      id,
      aliasOf,
      packageName,
      change,
    ]),
    [['color-scheme', 'acme-dawn', 'acme-dusk', '@acme/schemes', 'its accent is a little warmer']],
  );
  assert.ok(!result.packs.some(({ manifest }) => manifest.id === 'acme-dawn'));
  assert.ok(!packFiles(result).some(({ name }) => name.startsWith('acme-dawn')));
  // The metadata module lists the alias, and no pack or file of the retired one.
  const meta = registryMeta(result);
  assert.deepEqual(meta.PACK_ALIASES, [
    {
      kind: 'color-scheme',
      id: 'acme-dawn',
      aliasOf: 'acme-dusk',
      packageName: '@acme/schemes',
      change: 'its accent is a little warmer',
      changedSinceMerge: false,
    },
  ]);
  assert.ok(!meta.PACKS.some(({ manifest }) => manifest.id === 'acme-dawn'));
  assert.ok(!meta.ASSET_MANIFEST.some(({ id }) => id === 'acme-dawn'));
  const metaModule = renderRegistry(result).get('registry.meta.ts')!;
  assert.match(metaModule, /export const PACK_ALIASES: readonly PackAlias\[\] = \[/);
});

test('a retired record that does not read, or holds the wrong fields, is reported and left out', async () => {
  const name = '@acme/schemes';
  const result = await read([
    packPackage(
      name,
      'color-scheme',
      { 'acme-dusk': SURVIVOR('acme-dusk') },
      {
        files: {
          'retired/a-missing/manifest.json': '{}',
          'retired/b-syntax/retired.json': '{',
          'retired/c-fields/retired.json': record('other-id', 'c-fields', {
            retiredVersion: 2,
            kind: 'typography',
            change: 'ends with a period.',
            survivorVersion: 'v1',
            survivorDigest: 'sha256-abc',
            reason: '',
            retiredAt: 'yesterday',
          }),
          'retired/README.md': '# Retired',
        },
      },
    ),
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.aliases, []);
  assert.deepEqual(where(result.diagnostics), [
    [name, at(name, 'retired'), '', 'registry.retired-invalid'],
    [name, at(name, 'retired/a-missing/retired.json'), '', 'registry.retired-invalid'],
    [name, at(name, 'retired/b-syntax/retired.json'), '', 'registry.retired-invalid'],
    [name, at(name, 'retired/c-fields/retired.json'), '/aliasOf', 'registry.retired-invalid'],
    [name, at(name, 'retired/c-fields/retired.json'), '/change', 'registry.retired-invalid'],
    [name, at(name, 'retired/c-fields/retired.json'), '/id', 'registry.retired-invalid'],
    [name, at(name, 'retired/c-fields/retired.json'), '/kind', 'registry.retired-invalid'],
    [name, at(name, 'retired/c-fields/retired.json'), '/reason', 'registry.retired-invalid'],
    [name, at(name, 'retired/c-fields/retired.json'), '/retiredAt', 'registry.retired-invalid'],
    [
      name,
      at(name, 'retired/c-fields/retired.json'),
      '/retiredVersion',
      'registry.retired-invalid',
    ],
    [
      name,
      at(name, 'retired/c-fields/retired.json'),
      '/survivorDigest',
      'registry.retired-invalid',
    ],
    [
      name,
      at(name, 'retired/c-fields/retired.json'),
      '/survivorVersion',
      'registry.retired-invalid',
    ],
  ]);
});

test('an alias that is a registered id, retired twice, of a missing survivor, or of another alias fails generation', async () => {
  const a = '@acme/a-schemes';
  const b = '@acme/b-schemes';
  const result = await read([
    packPackage(
      a,
      'color-scheme',
      { 'acme-dusk': SURVIVOR('acme-dusk') },
      {
        files: {
          // Registered: acme-dusk is a pack.
          'retired/acme-dusk/retired.json': record('acme-dusk', 'test-scheme'),
          // Retired twice, here and in the other package.
          'retired/acme-twice/retired.json': record('acme-twice', 'acme-dusk'),
          // A survivor nothing registers.
          'retired/acme-orphan/retired.json': record('acme-orphan', 'acme-gone'),
          // A chain: its survivor is itself retired.
          'retired/acme-chain/retired.json': record('acme-chain', 'acme-ok'),
          'retired/acme-ok/retired.json': record('acme-ok', 'acme-dusk'),
          // A survivor of another kind: test-language is a design language.
          'retired/acme-kind/retired.json': record('acme-kind', 'test-language'),
        },
      },
    ),
    packPackage(
      b,
      'color-scheme',
      { 'acme-noon': SURVIVOR('acme-noon') },
      { files: { 'retired/acme-twice/retired.json': record('acme-twice', 'acme-noon') } },
    ),
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.aliases.map(({ id, aliasOf }) => [id, aliasOf]),
    [['acme-ok', 'acme-dusk']],
  );
  assert.deepEqual(where(result.diagnostics), [
    [a, at(a, 'retired/acme-chain/retired.json'), '/aliasOf', 'registry.retired-survivor'],
    [a, at(a, 'retired/acme-dusk/retired.json'), '/id', 'registry.retired-conflict'],
    [a, at(a, 'retired/acme-kind/retired.json'), '/aliasOf', 'registry.retired-survivor'],
    [a, at(a, 'retired/acme-orphan/retired.json'), '/aliasOf', 'registry.retired-survivor'],
    [a, at(a, 'retired/acme-twice/retired.json'), '/id', 'registry.retired-conflict'],
    [b, at(b, 'retired/acme-twice/retired.json'), '/id', 'registry.retired-conflict'],
  ]);
  const chain = result.diagnostics.find(({ manifestPath }) => manifestPath.includes('acme-chain'))!;
  assert.match(chain.message, /itself retired/);
});

// LANG-2: a survivor may evolve after the merge, and its aliases follow it.
// The record pins the survivor's version and look digest at the merge, and
// generation reads whether the survivor still looks that way.

test('a survivor that changed since the merge, with its version bumped, still serves its alias, which follows its updates', async () => {
  const name = '@acme/schemes';
  const result = await read([
    packPackage(
      name,
      'color-scheme',
      {
        // Its tokens changed after the merge, at a later version.
        'acme-dusk': SURVIVOR('acme-dusk', '1.1.0', { accent: 'plum' }),
        // Only its version moved: the look is the merge's.
        'acme-noon': SURVIVOR('acme-noon', '1.0.1'),
        // A file beside the manifest is part of the look too.
        'acme-dawn': SURVIVOR('acme-dawn', '2.0.0'),
      },
      {
        files: {
          'packs/acme-dawn/styles.css': '[data-color-scheme] { --x: 1; }',
          'retired/acme-dusk-old/retired.json': record('acme-dusk-old', 'acme-dusk'),
          'retired/acme-noon-old/retired.json': record('acme-noon-old', 'acme-noon'),
          'retired/acme-dawn-old/retired.json': record('acme-dawn-old', 'acme-dawn'),
        },
      },
    ),
  ]);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.aliases.map(({ id, aliasOf, changedSinceMerge }) => [id, aliasOf, changedSinceMerge]),
    [
      ['acme-dawn-old', 'acme-dawn', true],
      ['acme-dusk-old', 'acme-dusk', true],
      ['acme-noon-old', 'acme-noon', false],
    ],
  );
  assert.deepEqual(
    registryMeta(result).PACK_ALIASES.map(({ id, changedSinceMerge }) => [id, changedSinceMerge]),
    [
      ['acme-dawn-old', true],
      ['acme-dusk-old', true],
      ['acme-noon-old', false],
    ],
  );
});

test("a survivor that changed at the merge's version, or a merge version ahead of the survivor's, fails generation", async () => {
  const name = '@acme/schemes';
  const result = await read([
    packPackage(
      name,
      'color-scheme',
      {
        // Changed with no version bump since the merge.
        'acme-dusk': SURVIVOR('acme-dusk', '1.0.0', { accent: 'plum' }),
        'acme-noon': SURVIVOR('acme-noon', '1.0.0'),
      },
      {
        files: {
          'retired/acme-dusk-old/retired.json': record('acme-dusk-old', 'acme-dusk'),
          // The record says the merge was at 1.2.0, after the survivor's 1.0.0.
          'retired/acme-noon-old/retired.json': record('acme-noon-old', 'acme-noon', {
            survivorVersion: '1.2.0',
          }),
        },
      },
    ),
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.aliases, []);
  assert.deepEqual(where(result.diagnostics), [
    [
      name,
      at(name, 'retired/acme-dusk-old/retired.json'),
      '/survivorDigest',
      'registry.retired-survivor',
    ],
    [
      name,
      at(name, 'retired/acme-noon-old/retired.json'),
      '/survivorVersion',
      'registry.retired-survivor',
    ],
  ]);
});

test('the look digest leaves out what only describes a pack, and reads its key order as one', () => {
  const look = { tokens: { a: '1', b: '2' }, modes: ['light', 'dark'] };
  assert.equal(
    packLookDigest({ id: 'x', name: 'X', version: '1.0.0', description: 'One.', ...look }),
    packLookDigest({ tokens: { b: '2', a: '1' }, modes: ['light', 'dark'] }),
  );
  assert.notEqual(packLookDigest(look), packLookDigest({ ...look, tokens: { a: '1', b: '3' } }));
  assert.notEqual(packLookDigest(look), packLookDigest(look, { 'styles.css': 'x' }));
  assert.match(packLookDigest(look), /^sha256-[0-9a-f]{64}$/);
});
