import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { researchInBuild, researchRecords } from './check-catalog-build.mjs';

// #20: the production build check. A Research record or id fails it in the
// metadata module, ASSET_MANIFEST, any .next/static chunk, or the build
// output the image ships, and a build without one passes.

const RECORDS = [
  {
    id: 'nord',
    reason: 'Its upstream license has not been verified.',
    file: 'x/research/nord.json',
  },
];

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
  // Quoted any way: a single-quoted JS string too.
  assert.equal(findings({ 'src/lib/generated/excluded-packs.ts': "const x = 'nord';" }).length, 1);
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
});

test("the workspace's Research records are read from each pack package's research/", () => {
  const records = researchRecords();
  assert.deepEqual(
    records.map(({ id, file }) => [id, file]),
    [['fixture-research', 'packages/appearance-fixtures-schemes/research/fixture-research.json']],
  );
  assert.ok(records[0].reason);
});
