import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cyclonedx, productionPackages, purl, snapshotKey, splitKey } from './prod-deps.mjs';

const LOCKFILE = readFileSync(new URL('./fixtures/lockfile.yaml', import.meta.url), 'utf8');
const names = (packages) => packages.map(({ name, version }) => `${name}@${version}`);

test("the inventory is apps/web's run-time tree: linked packages' own dependencies in, dev dependencies out", () => {
  assert.deepEqual(names(productionPackages(LOCKFILE)), [
    '@swc/helpers@0.5.15',
    'ansi-regex@5.0.1',
    'next@16.2.4',
    'react@19.2.5',
    'server-only@0.0.1',
    'sharp@0.34.5',
    'string-width@4.2.3',
    'strip-ansi@6.0.1',
    'zod@3.25.76',
  ]);
});

test('an optional peer met only by a dev dependency stays out; a required peer stays in', () => {
  const packages = names(productionPackages(LOCKFILE));
  // next lists @playwright/test, an optional peer, and react, a required one.
  assert.ok(!packages.includes('@playwright/test@1.58.2'));
  assert.ok(packages.includes('react@19.2.5'));
  // Neither the root's dev tools, a linked package's devDependencies, nor an
  // importer apps/web never links.
  for (const out of ['prettier@3.9.10', 'typescript@5.9.3', 'left-pad@1.3.0']) {
    assert.ok(!packages.includes(out), out);
  }
});

test("the repository's own lockfile reads, and its inventory has no dev tooling", () => {
  const packages = names(
    productionPackages(readFileSync(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8')),
  );
  assert.ok(packages.some((p) => p.startsWith('next@')));
  for (const dev of ['eslint@', 'prettier@', '@playwright/test@', 'dependency-cruiser@', 'tsx@']) {
    assert.ok(!packages.some((p) => p.startsWith(dev)), dev);
  }
});

test('an unreadable lockfile is refused', () => {
  assert.throws(() => productionPackages(''), /empty/);
  assert.throws(() => productionPackages("lockfileVersion: '6.0'\n"), /not 9\.x/);
  assert.throws(() => productionPackages("lockfileVersion: '9.0'\nimporters: {}\n"), /no importer apps\/web/);
  assert.throws(
    () =>
      productionPackages(
        "lockfileVersion: '9.0'\nimporters:\n  apps/web:\n    dependencies:\n      a:\n        specifier: workspace:*\n        version: link:../gone\n",
      ),
    /links to apps\/gone, which has no importer/,
  );
});

test('snapshot keys drop peer suffixes and follow npm aliases', () => {
  assert.deepEqual(splitKey('next@16.2.4(react@19.2.5)'), { name: 'next', version: '16.2.4' });
  assert.deepEqual(splitKey('@swc/helpers@0.5.15'), { name: '@swc/helpers', version: '0.5.15' });
  assert.equal(splitKey('nope'), null);
  assert.equal(snapshotKey('react-dom', '19.2.5(react@19.2.5)'), 'react-dom@19.2.5(react@19.2.5)');
  assert.equal(snapshotKey('string-width-cjs', 'string-width@4.2.3'), 'string-width@4.2.3');
  assert.equal(snapshotKey('x', '@scope/real@1.0.0'), '@scope/real@1.0.0');
});

test('the SBOM is CycloneDX with an npm purl per package', () => {
  assert.equal(purl({ name: '@swc/helpers', version: '0.5.15' }), 'pkg:npm/%40swc/helpers@0.5.15');
  const bom = cyclonedx([{ name: 'next', version: '16.2.4' }]);
  assert.equal(bom.bomFormat, 'CycloneDX');
  assert.equal(bom.specVersion, '1.5');
  assert.deepEqual(bom.components, [
    {
      type: 'library',
      'bom-ref': 'pkg:npm/next@16.2.4',
      name: 'next',
      version: '16.2.4',
      purl: 'pkg:npm/next@16.2.4',
    },
  ]);
});
