import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LITERAL_SEGMENT, RESERVED_SEGMENTS } from '../segments';
import { readRegistry, type RegistryDiagnostic } from './registry';
import {
  extensionPackage,
  FALLBACK,
  manifestFor,
  removeTestHosts,
  testHost,
  variantPackage,
  type PackageSpec,
} from './test-hosts';

test.after(removeTestHosts);

// Registry generation (#5, Slice 3, item 1): every dependency that declares
// a portfolio kind is registered or reported, never skipped, and each record
// names its package, version, file, pointer, and code.

async function read(packages: readonly PackageSpec[], dependencies?: readonly string[]) {
  return readRegistry({ hostDir: testHost(packages, dependencies) });
}

/** The records as [package, file, pointer, code]. */
const where = (diagnostics: readonly RegistryDiagnostic[]) =>
  diagnostics.map((record) => [record.package, record.manifestPath, record.pointer, record.code]);

const OCEAN = variantPackage('@acme/ocean', 'acme-ocean');
const OCEAN_FILE = 'node_modules/@acme/ocean/package.json';
const OCEAN_MANIFEST = 'node_modules/@acme/ocean/manifest.json';

test('a host with the fallback and a valid variant registers both, sorted by id, and nothing else', async () => {
  const plain: PackageSpec = { name: 'left-pad', packageJson: { version: '1.3.0' } };
  const result = await read([plain, FALLBACK, OCEAN]);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.variants.map(({ manifest, packageName, version }) => [
      manifest.id,
      packageName,
      version,
    ]),
    [
      ['acme-ocean', '@acme/ocean', '1.0.0'],
      ['fallback', '@portfolio/fallback-composition', '1.0.0'],
    ],
  );
  assert.deepEqual(result.extensions, []);
});

test('a dependency that is not installed is reported where the host lists it', async () => {
  const result = await read([FALLBACK], ['@portfolio/fallback-composition', '@acme/ocean']);
  assert.equal(result.ok, false);
  assert.deepEqual(where(result.diagnostics), [
    ['@acme/ocean', 'package.json', '/dependencies/@acme~1ocean', 'registry.package-missing'],
  ]);
  assert.match(
    result.diagnostics[0]!.remedy,
    /pnpm install, or uninstall it: pnpm --filter @portfolio\/web remove @acme\/ocean/,
  );
});

test('a portfolio field with no kind, or a kind no host reads, is reported, not skipped', async () => {
  const v1 = variantPackage('@acme/ocean', 'acme-ocean', {
    packageJson: { portfolio: { variant: true, slug: 'ocean' } },
  });
  const typo = variantPackage('@acme/reef', 'acme-reef', {
    packageJson: { portfolio: { kind: 'varient', manifest: './manifest.json' } },
  });
  const result = await read([FALLBACK, v1, typo]);
  assert.deepEqual(where(result.diagnostics), [
    ['@acme/ocean', OCEAN_FILE, '/portfolio/kind', 'registry.kind-unknown'],
    [
      '@acme/reef',
      'node_modules/@acme/reef/package.json',
      '/portfolio/kind',
      'registry.kind-unknown',
    ],
  ]);
  const [missing, unknown] = result.diagnostics;
  assert.equal(missing!.actual, undefined);
  assert.equal(unknown!.actual, 'varient');
  assert.equal(
    unknown!.expected,
    'variant | design-language | color-scheme | typography | content-extension',
  );
  assert.deepEqual(
    result.variants.map(({ manifest }) => manifest.id),
    ['fallback'],
  );
});

test("without #19's pack checks, which the host passes in, a pack package is reported, not registered", async () => {
  const kinds = ['design-language', 'color-scheme', 'typography'];
  const packs = kinds.map((kind) => ({
    name: `@acme/${kind}`,
    packageJson: { version: '1.0.0', portfolio: { kind } },
  }));
  const result = await read([FALLBACK, ...packs]);
  assert.deepEqual(
    where(result.diagnostics),
    kinds
      .sort()
      .map((kind) => [
        `@acme/${kind}`,
        `node_modules/@acme/${kind}/package.json`,
        '/portfolio/kind',
        'registry.no-validator',
      ]),
  );
  assert.deepEqual(
    result.diagnostics.map(({ version }) => version),
    ['1.0.0', '1.0.0', '1.0.0'],
  );
});

test('a package.json that is broken, renamed, or unversioned is reported at its pointer', async () => {
  const broken: PackageSpec = { name: '@acme/broken', packageText: '{ "name": ' };
  const aliased = variantPackage('@acme/alias', 'acme-alias', {
    packageJson: { name: '@acme/real' },
  });
  const unversioned = variantPackage('@acme/bare', 'acme-bare', { packageJson: { version: '' } });
  const escaping = variantPackage('@acme/out', 'acme-out', {
    packageJson: { portfolio: { kind: 'variant', manifest: '../elsewhere.json' } },
  });
  const result = await read([FALLBACK, broken, aliased, unversioned, escaping]);
  assert.deepEqual(where(result.diagnostics), [
    ['@acme/alias', 'node_modules/@acme/alias/package.json', '/name', 'registry.package-invalid'],
    ['@acme/bare', 'node_modules/@acme/bare/package.json', '/version', 'registry.package-invalid'],
    ['@acme/broken', 'node_modules/@acme/broken/package.json', '', 'registry.package-invalid'],
    [
      '@acme/out',
      'node_modules/@acme/out/package.json',
      '/portfolio/manifest',
      'registry.package-invalid',
    ],
  ]);
  assert.deepEqual(
    [result.diagnostics[0]!.expected, result.diagnostics[0]!.actual],
    ['@acme/alias', '@acme/real'],
  );
});

test('a variant without its manifest, or with one that is not JSON, is reported', async () => {
  const unnamed = variantPackage('@acme/ocean', 'acme-ocean', {
    packageJson: { portfolio: { kind: 'variant' } },
  });
  const absent = variantPackage('@acme/reef', 'acme-reef', {
    packageJson: { portfolio: { kind: 'variant', manifest: './missing.json' } },
  });
  const garbled = variantPackage('@acme/tide', 'acme-tide');
  const result = await read([
    FALLBACK,
    unnamed,
    absent,
    { ...garbled, files: { ...garbled.files, 'manifest.json': '{ "id": ' } },
  ]);
  assert.deepEqual(where(result.diagnostics), [
    ['@acme/ocean', OCEAN_FILE, '/portfolio/manifest', 'registry.manifest-missing'],
    [
      '@acme/reef',
      'node_modules/@acme/reef/package.json',
      '/portfolio/manifest',
      'registry.file-missing',
    ],
    ['@acme/tide', 'node_modules/@acme/tide/manifest.json', '', 'registry.manifest-syntax'],
  ]);
  assert.equal(result.diagnostics[1]!.actual, './missing.json');
});

test('a variant needs its component and stylesheet exports, and each file they name', async () => {
  const noStyles = variantPackage('@acme/ocean', 'acme-ocean', {
    packageJson: { exports: { '.': './index.js' } },
  });
  const lost = variantPackage('@acme/reef', 'acme-reef', {
    packageJson: { exports: { '.': './index.js', './styles.css': './gone.css' } },
  });
  const result = await read([FALLBACK, noStyles, lost]);
  assert.deepEqual(where(result.diagnostics), [
    ['@acme/ocean', OCEAN_FILE, '/exports', 'registry.export-missing'],
    [
      '@acme/reef',
      'node_modules/@acme/reef/package.json',
      '/exports/.~1styles.css',
      'registry.file-missing',
    ],
  ]);
  assert.equal(result.diagnostics[0]!.expected, './styles.css');
  assert.equal(result.diagnostics[1]!.actual, './gone.css');
});

test('a declared enhancement needs its export and its file', async () => {
  const enhancements = [{ id: 'tide', export: './enhancements/tide', requires: [] }];
  const missingExport = variantPackage('@acme/ocean', 'acme-ocean', {
    manifest: manifestFor('acme-ocean', { enhancements }),
  });
  const missingFile = variantPackage('@acme/reef', 'acme-reef', {
    manifest: manifestFor('acme-reef', { enhancements }),
    packageJson: {
      exports: {
        '.': './index.js',
        './styles.css': './styles.css',
        './enhancements/tide': './tide.js',
      },
    },
  });
  const result = await read([FALLBACK, missingExport, missingFile]);
  assert.deepEqual(where(result.diagnostics), [
    [
      '@acme/ocean',
      OCEAN_MANIFEST,
      '/enhancements/0/export',
      'manifest.enhancement-missing-export',
    ],
    [
      '@acme/reef',
      'node_modules/@acme/reef/package.json',
      '/exports/.~1enhancements~1tide',
      'registry.file-missing',
    ],
  ]);
  // With the file there, it registers, with the specifier and file the host loads.
  const complete = variantPackage('@acme/reef', 'acme-reef', {
    manifest: manifestFor('acme-reef', { enhancements }),
    packageJson: missingFile.packageJson,
    files: { 'tide.js': 'export default () => null;\n' },
  });
  const ok = await read([FALLBACK, complete]);
  assert.deepEqual(ok.diagnostics, []);
  assert.deepEqual(ok.variants[0]!.enhancements, [
    { id: 'tide', specifier: '@acme/reef/enhancements/tide', file: 'tide.js' },
  ]);
});

test("each manifest problem keeps the contract's code and pointer, located in its package", async () => {
  const cases: Array<[string, Record<string, unknown>, string, string, string?, string?]> = [
    ['acme-newer', { contract: '2.1' }, '/contract', 'manifest.contract-newer', '2.0', '2.1'],
    ['acme-major', { contract: '3.0' }, '/contract', 'manifest.contract-unsupported', '2.0', '3.0'],
    ['acme-tokens', { tokenContract: 0 }, '/tokenContract', 'manifest.token-contract-mismatch'],
    [
      'acme-schemas',
      { schemas: { portfolio: { min: 3, max: 3 }, site: { min: 2, max: 2 } } },
      '/schemas/portfolio',
      'manifest.schemas-unsupported',
    ],
    [
      'acme-routes',
      {
        routes: {
          home: 'shared',
          work: 'shared',
          views: [{ id: 'api', under: 'home', type: 'path', segment: 'api' }],
        },
      },
      '/routes/views/0/segment',
      'manifest.route-reserved-segment',
    ],
  ];
  for (const [id, extra, pointer, code, expected, actual] of cases) {
    const name = `@acme/${id.slice('acme-'.length)}`;
    const result = await read([
      FALLBACK,
      variantPackage(name, id, { manifest: manifestFor(id, extra) }),
    ]);
    assert.equal(result.ok, false, id);
    const [record] = result.diagnostics.filter((entry) => entry.code === code);
    assert.ok(record, `${id}: ${JSON.stringify(result.diagnostics)}`);
    assert.deepEqual(
      [record.package, record.version, record.manifestPath, record.pointer],
      [name, '1.0.0', `node_modules/${name}/manifest.json`, pointer],
      id,
    );
    if (expected !== undefined) assert.equal(record.expected, expected, id);
    if (actual !== undefined) assert.equal(record.actual, actual, id);
    assert.match(
      record.remedy,
      new RegExp(`Or uninstall it: pnpm --filter @portfolio/web remove ${name}\\.$`),
    );
    assert.deepEqual(
      result.variants.map(({ manifest }) => manifest.id),
      ['fallback'],
      id,
    );
  }
});

test('a path view under any reserved first segment stops generation (#5, Slice 4)', async () => {
  for (const segment of RESERVED_SEGMENTS) {
    const manifest = manifestFor('acme-routes', {
      routes: {
        home: 'shared',
        work: 'shared',
        views: [{ id: 'probe', under: 'home', type: 'path', segment: `${segment}/{page}` }],
      },
    });
    const result = await read([
      FALLBACK,
      variantPackage('@acme/routes', 'acme-routes', { manifest }),
    ]);
    assert.equal(result.ok, false, segment);
    // `_next` and the metadata file names aren't segment words at all.
    const code = LITERAL_SEGMENT.test(segment)
      ? 'manifest.route-reserved-segment'
      : 'manifest.invalid';
    assert.deepEqual(
      where(result.diagnostics),
      [
        [
          '@acme/routes',
          'node_modules/@acme/routes/manifest.json',
          '/routes/views/0/segment',
          code,
        ],
      ],
      segment,
    );
    assert.deepEqual(
      result.variants.map(({ manifest: registered }) => registered.id),
      ['fallback'],
      segment,
    );
  }
});

test("a reserved id, or one without the package's scope, doesn't register", async () => {
  const reserved = variantPackage('@acme/cosmos', 'kinetic-cosmos');
  const unscoped = variantPackage('@acme/tide', 'tide');
  const missing = variantPackage('@acme/missing', 'missing-variant');
  const result = await read([FALLBACK, reserved, unscoped, missing]);
  assert.deepEqual(
    where(result.diagnostics).map(([pkg, , pointer, code]) => [pkg, pointer, code]),
    [
      ['@acme/cosmos', '/id', 'manifest.id-reserved'],
      ['@acme/missing', '/id', 'manifest.id-reserved'],
      ['@acme/tide', '/id', 'manifest.id-prefix'],
    ],
  );
});

test('two packages with one id both fail, each naming the other', async () => {
  const first = variantPackage('@acme/ocean', 'acme-ocean');
  const second = variantPackage('@acme/ocean-two', 'acme-ocean');
  const result = await read([FALLBACK, first, second]);
  assert.deepEqual(where(result.diagnostics), [
    ['@acme/ocean', OCEAN_MANIFEST, '/id', 'registry.duplicate-id'],
    [
      '@acme/ocean-two',
      'node_modules/@acme/ocean-two/manifest.json',
      '/id',
      'registry.duplicate-id',
    ],
  ]);
  assert.match(result.diagnostics[0]!.message, /@acme\/ocean-two also registers/);
  assert.match(result.diagnostics[1]!.message, /@acme\/ocean also registers/);
  assert.deepEqual(
    result.variants.map(({ manifest }) => manifest.id),
    ['fallback'],
  );
});

test('generation fails without the fallback composition', async () => {
  const result = await read([OCEAN]);
  assert.deepEqual(where(result.diagnostics), [
    ['@portfolio/web', 'package.json', '/dependencies', 'registry.fallback-missing'],
  ]);
  assert.match(result.diagnostics[0]!.remedy, /add @portfolio\/fallback-composition@workspace:\*/);
});

test('a host with no readable package.json is reported, not thrown', async () => {
  const result = await readRegistry({ hostDir: '/nonexistent/kgn-host' });
  assert.deepEqual(where(result.diagnostics), [
    ['@portfolio/web', 'package.json', '', 'registry.host-unreadable'],
  ]);
});

test('a content extension registers when its default export is a valid definition under its own name', async () => {
  const photos = extensionPackage('@acme/portfolio-photography', {
    packageJson: { exports: { '.': './index.mjs', './renderers': './renderers.mjs' } },
    files: { 'renderers.mjs': 'export default {};\n' },
  });
  const notes = extensionPackage('@acme/portfolio-notes');
  const result = await read([FALLBACK, photos, notes]);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.extensions.map(({ packageName, version, renderers, renderedKinds }) => [
      packageName,
      version,
      renderers,
      renderedKinds,
    ]),
    [
      ['@acme/portfolio-notes', '2.0.0', false, []],
      ['@acme/portfolio-photography', '2.0.0', true, []],
    ],
  );
});

test('a content extension that fails to load, or whose definition is wrong, is reported', async () => {
  const name = (suffix: string) => `@acme/portfolio-${suffix}`;
  const packages = [
    extensionPackage(name('throws'), { entry: "throw new Error('broken');\n" }),
    extensionPackage(name('empty'), { entry: 'export const value = 1;\n' }),
    extensionPackage(name('renamed'), { entry: "export default { namespace: '@acme/other' };\n" }),
    extensionPackage(name('sections'), {
      entry: `export default { namespace: '${name('sections')}', sections: { 'Bad Name': {} } };\n`,
    }),
    extensionPackage(name('nofile'), { packageJson: { exports: { '.': './gone.mjs' } } }),
    extensionPackage(name('noexport'), { packageJson: { exports: { './renderers': './r.mjs' } } }),
  ];
  const result = await read([FALLBACK, ...packages]);
  assert.deepEqual(where(result.diagnostics), [
    [
      name('empty'),
      'node_modules/@acme/portfolio-empty/index.mjs',
      '',
      'registry.extension-invalid',
    ],
    [
      name('noexport'),
      'node_modules/@acme/portfolio-noexport/package.json',
      '/exports',
      'registry.export-missing',
    ],
    [
      name('nofile'),
      'node_modules/@acme/portfolio-nofile/package.json',
      '/exports/.',
      'registry.file-missing',
    ],
    [
      name('renamed'),
      'node_modules/@acme/portfolio-renamed/index.mjs',
      '/namespace',
      'registry.extension-invalid',
    ],
    [
      name('sections'),
      'node_modules/@acme/portfolio-sections/index.mjs',
      '',
      'registry.extension-invalid',
    ],
    [
      name('throws'),
      'node_modules/@acme/portfolio-throws/index.mjs',
      '',
      'registry.extension-invalid',
    ],
  ]);
  const renamed = result.diagnostics.find((record) => record.package === name('renamed'))!;
  assert.deepEqual([renamed.expected, renamed.actual], [name('renamed'), '@acme/other']);
  assert.match(
    result.diagnostics.find((record) => record.package === name('sections'))!.message,
    /defineContentExtension\(\) refuses it: .*section names are lowercase words/,
  );
  // What the import threw says why it didn't load.
  assert.equal(
    result.diagnostics.find((record) => record.package === name('throws'))!.actual,
    'broken',
  );
});

test("an extension's ./renderers default-exports a renderer for each section it declares, and nothing else", async () => {
  const extension = (suffix: string, renderers: string) => {
    const packageName = `@acme/portfolio-${suffix}`;
    return extensionPackage(packageName, {
      entry: `export default { namespace: '${packageName}', sections: { exhibitions: {} } };\n`,
      packageJson: { exports: { '.': './index.mjs', './renderers': './renderers.mjs' } },
      files: { 'renderers.mjs': renderers },
    });
  };
  const result = await read([
    FALLBACK,
    extension('core', 'export default { hero: () => null };\n'),
    extension('other', "export default { '@acme/other/exhibitions': () => null };\n"),
    extension('undeclared', "export default { '@acme/portfolio-undeclared/talks': () => null };\n"),
    extension('named', 'export const exhibitions = () => null;\n'),
    extension('value', "export default { '@acme/portfolio-value/exhibitions': 'Exhibitions' };\n"),
    extension('throws', "throw new Error('the renderers broke');\n"),
    extension('good', "export default { '@acme/portfolio-good/exhibitions': () => null };\n"),
  ]);
  const file = (suffix: string) => `node_modules/@acme/portfolio-${suffix}/renderers.mjs`;
  assert.deepEqual(
    result.diagnostics.map((record) => [
      record.manifestPath,
      record.pointer,
      record.code,
      record.actual,
    ]),
    [
      [file('core'), '/hero', 'registry.extension-invalid', 'hero'],
      [file('named'), '', 'registry.extension-invalid', undefined],
      [
        file('other'),
        '/@acme~1other~1exhibitions',
        'registry.extension-invalid',
        '@acme/other/exhibitions',
      ],
      [file('throws'), '', 'registry.extension-invalid', 'the renderers broke'],
      [
        file('undeclared'),
        '/@acme~1portfolio-undeclared~1talks',
        'registry.extension-invalid',
        '@acme/portfolio-undeclared/talks',
      ],
      [
        file('value'),
        '/@acme~1portfolio-value~1exhibitions',
        'registry.extension-invalid',
        'string',
      ],
    ],
  );
  const core = result.diagnostics.find((record) => record.package === '@acme/portfolio-core')!;
  assert.equal(core.expected, '@acme/portfolio-core/exhibitions');
  // Only the one that's right registers, renderers and all, with the kinds they cover.
  assert.deepEqual(
    result.extensions.map(({ packageName, renderers, renderedKinds }) => [
      packageName,
      renderers,
      renderedKinds,
    ]),
    [['@acme/portfolio-good', true, ['@acme/portfolio-good/exhibitions']]],
  );
});

test("a dependency installed only above the repository's root isn't the host's", async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-outside-'));
  try {
    const write = (file: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(outside, file)), { recursive: true });
      fs.writeFileSync(path.join(outside, file), text);
    };
    // A stray install beside the repository, where Node would also look.
    write('node_modules/@acme/ocean/package.json', JSON.stringify({ name: '@acme/ocean' }));
    write('repo/pnpm-workspace.yaml', "packages: ['apps/*']\n");
    write(
      'repo/apps/web/package.json',
      JSON.stringify({ dependencies: { '@acme/ocean': '1.0.0', [FALLBACK.name]: '1.0.0' } }),
    );
    const fallback = `repo/apps/web/node_modules/${FALLBACK.name}`;
    write(
      `${fallback}/package.json`,
      JSON.stringify({ name: FALLBACK.name, ...FALLBACK.packageJson }),
    );
    for (const [name, text] of Object.entries(FALLBACK.files ?? {}))
      write(`${fallback}/${name}`, text);
    const result = await readRegistry({ hostDir: path.join(outside, 'repo', 'apps', 'web') });
    assert.deepEqual(where(result.diagnostics), [
      ['@acme/ocean', 'package.json', '/dependencies/@acme~1ocean', 'registry.package-missing'],
    ]);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('every record says what to do, and each package error how to uninstall it', async () => {
  const result = await read([
    FALLBACK,
    variantPackage('@acme/ocean', 'acme-ocean', { manifest: [] }),
  ]);
  assert.deepEqual(where(result.diagnostics), [
    ['@acme/ocean', OCEAN_MANIFEST, '', 'manifest.invalid'],
  ]);
  const [record] = result.diagnostics;
  assert.equal(record!.severity, 'error');
  assert.equal(record!.version, '1.0.0');
  assert.match(
    record!.remedy,
    /Or uninstall it: pnpm --filter @portfolio\/web remove @acme\/ocean\.$/,
  );
});
