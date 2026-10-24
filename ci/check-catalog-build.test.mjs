import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  APPEARANCE_MARKERS,
  carriesRegistry,
  heldRecords,
  researchInBuild,
  researchRecords,
} from './check-catalog-build.mjs';

// #20: the production build check. A Research record or id fails it in the
// metadata module, ASSET_MANIFEST, any .next/static chunk, or the build
// output the image ships, and a build without one passes.

const RECORDS = [
  {
    id: 'nord',
    reason: 'Its upstream license has not been verified.',
    file: 'x/research/nord.json',
  },
  {
    id: 'horizon',
    reason: 'A common word, which a library may well hold.',
    file: 'x/research/horizon.json',
  },
  {
    id: 'art-deco',
    held: true,
    reason: 'It fails check:appearance with 25 of 25 color schemes.',
    file: 'x/held/art-deco',
  },
];

/** What a chunk that carries the registry's data holds: a platform default pack as a registry key. */
const REGISTRY_CHUNK = 'var p=[{id:"warm-parchment",kind:"color-scheme"}];';

/** A scratch apps/web with a clean build in it, and the files `extra` adds. */
function build(extra = {}) {
  const web = mkdtempSync(path.join(tmpdir(), 'portfolio-catalog-build-'));
  const files = {
    'src/lib/generated/registry.meta.ts':
      'export const PACKS = [{"manifest":{"id":"warm-parchment"}}];',
    'src/lib/generated/asset-manifest.json': '{"units":[{"id":"warm-parchment"}]}',
    '.next/static/chunks/app.js': 'self.x=1;',
    '.next/standalone/apps/web/server.js': 'module.exports = {};',
    // A library's own string that happens to be a Research id is not a registry key.
    '.next/standalone/node_modules/highlighter/themes.js': 'module.exports = ["nord", "dracula"];',
    '.next/static/chunks/vendor.js': 'var themes=["nord"];',
    'public/third-party-notices.txt': 'No pack in this build ships third-party material.',
    ...extra,
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(web, file)), { recursive: true });
    writeFileSync(path.join(web, file), text);
  }
  return web;
}

function findings(extra) {
  const web = build(extra);
  try {
    return researchInBuild(web, RECORDS).map(({ id, file, where }) => [id, file, where]);
  } finally {
    rmSync(web, { recursive: true, force: true });
  }
}

test('a build with no Research record in it passes, a library string of the same word included', () => {
  assert.deepEqual(findings(), []);
  const web = build({ 'src/lib/generated/registry.meta.ts': '{"id":"nord"}' });
  try {
    // With no Research record, there's nothing to find.
    assert.deepEqual(researchInBuild(web, []), []);
  } finally {
    rmSync(web, { recursive: true, force: true });
  }
});

test('a Research id in the metadata module or ASSET_MANIFEST fails', () => {
  assert.deepEqual(
    findings({
      'src/lib/generated/registry.meta.ts': 'export const PACKS = [{"manifest":{"id":"nord"}}];',
    }),
    [['nord', 'src/lib/generated/registry.meta.ts', 'the generated modules']],
  );
  assert.deepEqual(
    findings({ 'src/lib/generated/asset-manifest.json': '{"units":[{"id":"nord"}]}' }),
    [['nord', 'src/lib/generated/asset-manifest.json', 'the generated modules']],
  );
  // Any quoted form, a bare key, or an array item: each is a finding there.
  for (const probe of [
    'const x = "nord";',
    "const x = 'nord';",
    'const x = `nord`;',
    'const x = "{\\"nord\\":1}";',
    'export const EXCLUDED_PACKS = {"nord": {}};',
    'export const EXCLUDED_PACKS = {nord: {}};',
    'export const IDS = ["warm-parchment", "nord"];',
    "export const RECIPES = [{ scheme: 'horizon' }];",
    'export const HELD = ["art-deco"];',
  ]) {
    assert.equal(
      findings({ 'src/lib/generated/excluded-packs.ts': probe }).length,
      1,
      `a finding in ${probe}`,
    );
  }
  // The word inside another doesn't count: nordic and a horizontal rule aren't the ids.
  assert.deepEqual(
    findings({ 'src/lib/generated/excluded-packs.ts': 'const x = ["nordic", "horizontal"];' }),
    [],
  );
});

test("a common-word id counts in any form only where an output carries the registry's data", () => {
  // An unrelated chunk may hold the word: a library's theme list, an option name.
  for (const chunk of [
    'var themes=["nord","horizon"];',
    "var o={horizon:1,direction:'horizon'};",
  ]) {
    assert.deepEqual(findings({ '.next/static/chunks/lib.js': chunk }), [], chunk);
    assert.deepEqual(findings({ 'public/vendor/lib.js': chunk }), [], chunk);
    assert.deepEqual(
      findings({ '.next/standalone/apps/web/.next/server/chunks/lib.js': chunk }),
      [],
      chunk,
    );
  }
  // A chunk that carries the registry fails on the word in any form.
  assert.ok(carriesRegistry(REGISTRY_CHUNK));
  assert.ok(carriesRegistry('var schemes=["warm-parchment"];'), 'a platform pack named, quoted');
  assert.ok(!carriesRegistry('var parchment="warm";'), 'the words alone are no pack');
  for (const form of ['"horizon"', "'horizon'", '{horizon:{}}', '["a","horizon"]']) {
    const chunk = `${REGISTRY_CHUNK}var r=${form};`;
    assert.deepEqual(findings({ '.next/static/chunks/appearance.js': chunk }), [
      ['horizon', '.next/static/chunks/appearance.js', '.next/static'],
    ]);
    assert.deepEqual(findings({ '.next/standalone/apps/web/.next/server/app/page.js': chunk }), [
      ['horizon', '.next/standalone/apps/web/.next/server/app/page.js', 'the image'],
    ]);
  }
  // Every marker is a platform default pack, so every registry holds one.
  const axes = readFileSync(new URL('../packages/appearance/src/axes.ts', import.meta.url), 'utf8');
  const defaults = /export const PLATFORM_DEFAULTS = Object\.freeze\(\{([^}]*)\}/.exec(axes)[1];
  const packDefaults = ['designLanguage', 'colorScheme', 'typography'].map(
    (axis) => new RegExp(`${axis}: '([a-z0-9-]+)'`).exec(defaults)[1],
  );
  assert.deepEqual(APPEARANCE_MARKERS, packDefaults);
});

test('a distinctive id counts in any quoted or attribute form in every output, and a common word only where an output carries the registry', () => {
  const records = [
    ...RECORDS,
    { id: 'fixture-research', reason: 'A test fixture.', file: 'x/research/fixture-research.json' },
  ];
  const at = (files) => {
    const web = build(files);
    try {
      return researchInBuild(web, records).map(({ id, where }) => `${id} ${where}`);
    } finally {
      rmSync(web, { recursive: true, force: true });
    }
  };
  // None of these chunks names a platform default pack, so none carries the registry.
  for (const chunk of [
    'var t={scheme:"nord",language:"fixture-research"};',
    'var t=["nord","fixture-research"];',
    'var t={"fixture-research":1,"nord":2};',
    "var t='fixture-research';",
  ]) {
    assert.ok(!carriesRegistry(chunk));
    assert.deepEqual(
      at({ '.next/static/chunks/a.js': chunk }),
      ['fixture-research .next/static'],
      chunk,
    );
    assert.deepEqual(
      at({ '.next/standalone/apps/web/.next/server/chunks/a.js': chunk }),
      ['fixture-research the image'],
      chunk,
    );
    assert.deepEqual(at({ 'public/vendor/a.js': chunk }), ['fixture-research the image'], chunk);
  }
  // An attribute selector, quoted or not, in a stylesheet.
  for (const css of [
    '[data-color-scheme="fixture-research"]{color:red}',
    "[data-color-scheme='fixture-research' i]{color:red}",
    '[data-color-scheme=fixture-research]{color:red}',
    '[data-design-language="art-deco"]{color:red}',
  ]) {
    const id = css.includes('art-deco') ? 'art-deco' : 'fixture-research';
    assert.deepEqual(at({ '.next/static/css/a.css': css }), [`${id} .next/static`], css);
  }
  // A common word, in the same forms, counts only in a chunk that carries the registry.
  for (const chunk of [
    'var t={scheme:"nord"};',
    'var t=["nord"];',
    'var t={"nord":2};',
    '[data-color-scheme="nord"]{color:red}',
  ]) {
    assert.deepEqual(at({ '.next/static/chunks/b.js': chunk }), [], chunk);
    assert.deepEqual(
      at({ '.next/static/chunks/b.js': `${REGISTRY_CHUNK}${chunk}` }),
      ['nord .next/static'],
      chunk,
    );
  }
  // A longer id that starts with a distinctive one isn't it.
  assert.deepEqual(
    at({ '.next/static/chunks/c.js': 'var t=["fixture-research-2"];[data-x=art-deco-2]' }),
    [],
  );
});

test('a Research id as a registry key, or its record, in any .next/static chunk fails', () => {
  for (const chunk of [
    '{"id":"nord","name":"Nord"}',
    '{id:"nord"}',
    "{ id: 'nord' }",
    // The RSC payload escapes its quotes.
    'self.__next_f.push([1,"{\\"id\\":\\"nord\\"}"])',
    'Its upstream license has not been verified.',
  ]) {
    assert.deepEqual(findings({ '.next/static/chunks/page.js': chunk }), [
      ['nord', '.next/static/chunks/page.js', '.next/static'],
    ]);
  }
});

test('a Research record reaching the image fails: its file, or its id as a key in the server output or public/', () => {
  assert.deepEqual(
    findings({
      '.next/standalone/node_modules/@portfolio/appearance-schemes/research/nord.json': '{}',
    }),
    [
      [
        'nord',
        '.next/standalone/node_modules/@portfolio/appearance-schemes/research/nord.json',
        'the image',
      ],
    ],
  );
  assert.deepEqual(
    findings({ '.next/standalone/apps/web/.next/server/app/page.js': '{"id":"nord"}' }),
    [['nord', '.next/standalone/apps/web/.next/server/app/page.js', 'the image']],
  );
  assert.deepEqual(
    findings({ 'public/_portfolio/pack/nord.0123456789ab.css': '[data-color-scheme="nord"] {}' }),
    [['nord', 'public/_portfolio/pack/nord.0123456789ab.css', 'the image']],
  );
  // public/ outside _portfolio: a registry key or the record's reason, and any form where it carries the registry.
  for (const [file, text] of [
    ['public/catalog.json', '{"id":"nord"}'],
    ['public/notes.txt', 'Its upstream license has not been verified.'],
    ['public/data/registry.json', `${REGISTRY_CHUNK} ["nord"]`],
  ]) {
    assert.deepEqual(findings({ [file]: text }), [['nord', file, 'the image']], file);
  }
  // A held pack's directory in the image fails, as a Research file does.
  assert.deepEqual(
    findings({
      '.next/standalone/node_modules/@portfolio/appearance-languages/held/art-deco/manifest.json':
        '{}',
    }),
    [
      [
        'art-deco',
        '.next/standalone/node_modules/@portfolio/appearance-languages/held/art-deco/manifest.json',
        'the image',
      ],
    ],
  );
});

test("the workspace's Research records are read from each pack package's research/", () => {
  const records = researchRecords();
  assert.deepEqual(
    records.map(({ id, file }) => [id, file]),
    [['fixture-research', 'packages/appearance-fixtures-schemes/research/fixture-research.json']],
  );
  assert.ok(records[0].reason);
});

test("a pack package's held/<id>/ packs are read as records, each with its gate's reason", () => {
  const root = mkdtempSync(path.join(tmpdir(), 'portfolio-catalog-held-'));
  try {
    const write = (file, text) => {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    };
    write(
      'packages/langs/package.json',
      JSON.stringify({ name: '@acme/langs', portfolio: { kind: 'design-language' } }),
    );
    write('packages/langs/held/art-deco/gate.json', JSON.stringify({ reason: 'It fails.' }));
    write('packages/langs/held/art-deco/manifest.json', '{}');
    write('packages/langs/held/no-gate/manifest.json', '{}');
    // The manifest's id is what would register, so a directory named otherwise is read as both.
    write('packages/langs/held/misnamed/manifest.json', JSON.stringify({ id: 'other-id' }));
    // A package that isn't a pack package holds no held packs.
    write('packages/other/package.json', JSON.stringify({ name: '@acme/other' }));
    write('packages/other/held/x/gate.json', '{}');
    assert.deepEqual(heldRecords(root), [
      { id: 'art-deco', held: true, reason: 'It fails.', file: 'packages/langs/held/art-deco' },
      { id: 'other-id', held: true, reason: null, file: 'packages/langs/held/misnamed' },
      { id: 'misnamed', held: true, reason: null, file: 'packages/langs/held/misnamed' },
      { id: 'no-gate', held: true, reason: null, file: 'packages/langs/held/no-gate' },
    ]);
    // And a held id is held to what a Research id is.
    const web = build({ 'src/lib/generated/registry.meta.ts': '[{"id":"art-deco"}]' });
    try {
      assert.deepEqual(
        researchInBuild(web, heldRecords(root)).map(({ id, where }) => [id, where]),
        [['art-deco', 'the generated modules']],
      );
    } finally {
      rmSync(web, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  // This checkout holds none yet.
  assert.deepEqual(heldRecords(), []);
});
