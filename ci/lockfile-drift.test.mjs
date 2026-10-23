import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LOCKFILE_MODIFIED,
  lockfileDrift,
  normalisePeers,
  removalLeftovers,
} from './lib/lockfile-drift.mjs';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/lockfile-drift/${name}.yaml`, import.meta.url), 'utf8');

/** An excerpt of next's pnpm-lock.yaml: the eslint-plugin-import cycle, and react. */
const BEFORE = fixture('before');
/** BEFORE as #82's remove wrote it back: three lines, one cyclic peer suffix cut short. */
const PEER_REWRITE = fixture('peer-rewrite');

/** `text` with `from` replaced by `to`, which must be there exactly once. */
function edit(text, from, to) {
  assert.equal(text.split(from).length, 2, `the fixture holds ${JSON.stringify(from)} once`);
  return text.replace(from, to);
}

/** `text` with `lines` after the line `anchor`. */
const insertAfter = (text, anchor, lines) =>
  edit(text, `\n${anchor}\n`, `\n${anchor}\n${lines.join('\n')}\n`);

const REFERENCE_VERSION =
  'file:../pack/acme-reference-1.0.0.tgz(react-dom@19.2.5(react@19.2.5))(react@19.2.5)';

test('normalisePeers keeps each peer and drops the peers own suffixes', () => {
  assert.equal(normalisePeers('react@19.2.5'), 'react@19.2.5');
  assert.equal(normalisePeers('19.2.5(react@19.2.5)'), '19.2.5(react@19.2.5)');
  assert.equal(
    normalisePeers('react-use-measure@2.1.7(react-dom@19.2.5(react@19.2.5))(react@19.2.5)'),
    'react-use-measure@2.1.7(react-dom@19.2.5)(react@19.2.5)',
  );
  assert.equal(normalisePeers('link:../../packages/kit'), 'link:../../packages/kit');
  // Both of #82's spellings of the cycle come out the same.
  const long =
    '2.32.0(@typescript-eslint/parser@8.72.0(eslint@9.39.5)(typescript@5.9.3))(eslint-import-resolver-typescript@3.10.1(eslint-plugin-import@2.32.0(@typescript-eslint/parser@8.72.0(eslint@9.39.5)(typescript@5.9.3))(eslint@9.39.5))(eslint@9.39.5))(eslint@9.39.5)';
  const short =
    '2.32.0(@typescript-eslint/parser@8.72.0(eslint@9.39.5)(typescript@5.9.3))(eslint-import-resolver-typescript@3.10.1)(eslint@9.39.5)';
  assert.equal(normalisePeers(long), normalisePeers(short));
  assert.equal(
    normalisePeers(short),
    '2.32.0(@typescript-eslint/parser@8.72.0)(eslint-import-resolver-typescript@3.10.1)(eslint@9.39.5)',
  );
});

test('normalisePeers leaves a suffix it cannot read as it is, so it compares exactly', () => {
  for (const odd of ['a@1.0.0(b@2.0.0', 'a@1.0.0(b@2.0.0))', 'a@1.0.0(b@2.0.0)x', 'a@1.0.0_3f2a']) {
    assert.equal(normalisePeers(odd), odd);
  }
});

test("#82's rewrite is no drift: only a cyclic peer suffix changed", () => {
  assert.notEqual(PEER_REWRITE, BEFORE, 'the fixture is rewritten');
  const changed = BEFORE.split('\n').filter((line, i) => line !== PEER_REWRITE.split('\n')[i]);
  assert.equal(changed.length, 3, "#82's three lines");
  assert.deepEqual(lockfileDrift(BEFORE, PEER_REWRITE), []);
  assert.deepEqual(
    removalLeftovers({ status: [LOCKFILE_MODIFIED], before: BEFORE, after: PEER_REWRITE }),
    { problems: [], rewritten: true },
  );
});

test('an unchanged lockfile and a clean status leave nothing', () => {
  assert.deepEqual(lockfileDrift(BEFORE, BEFORE), []);
  assert.deepEqual(removalLeftovers({ status: [], before: BEFORE, after: BEFORE }), {
    problems: [],
    rewritten: false,
  });
});

test('the reference variant left behind after the remove fails, even beside a peer rewrite', () => {
  let after = edit(
    PEER_REWRITE,
    '  apps/web:\n    dependencies:\n',
    [
      '  apps/web:',
      '    dependencies:',
      "      '@acme/reference':",
      '        specifier: file:../pack/acme-reference-1.0.0.tgz',
      `        version: ${REFERENCE_VERSION}`,
      '',
    ].join('\n'),
  );
  after = edit(
    after,
    '\npackages:\n\n',
    [
      '',
      'packages:',
      '',
      "  '@acme/reference@file:../pack/acme-reference-1.0.0.tgz':",
      '    resolution: {integrity: sha512-aaaa, tarball: file:../pack/acme-reference-1.0.0.tgz}',
      '    peerDependencies:',
      '      react: ^19.0.0',
      '',
      '',
    ].join('\n'),
  );
  after = edit(
    after,
    '\nsnapshots:\n\n',
    [
      '',
      'snapshots:',
      '',
      `  '@acme/reference@${REFERENCE_VERSION}':`,
      '    dependencies:',
      '      react: 19.2.5',
      '',
      '',
    ].join('\n'),
  );
  const drift = lockfileDrift(BEFORE, after);
  assert.deepEqual(drift, [
    'lockfile.importers["apps/web"].dependencies["@acme/reference"]: added',
    'lockfile.packages["@acme/reference@file:../pack/acme-reference-1.0.0.tgz"]: added',
    'lockfile.snapshots["@acme/reference@file:../pack/acme-reference-1.0.0.tgz(react-dom@19.2.5)(react@19.2.5)"]: added',
  ]);
  const { problems } = removalLeftovers({ status: [LOCKFILE_MODIFIED], before: BEFORE, after });
  assert.deepEqual(problems, drift);
});

test('an importer change fails: a specifier, a version, or a dependency gone', () => {
  const specifier = edit(
    BEFORE,
    '        specifier: ^19.0.0\n        version: 19.2.5\n',
    '        specifier: ^19.2.0\n        version: 19.2.5\n',
  );
  assert.deepEqual(lockfileDrift(BEFORE, specifier), [
    'lockfile.importers["apps/web"].dependencies.react.specifier: "^19.0.0" before, "^19.2.0" after',
  ]);
  const version = edit(
    BEFORE,
    '        version: 19.2.5(react@19.2.5)\n',
    '        version: 19.2.4(react@19.2.5)\n',
  );
  assert.deepEqual(lockfileDrift(BEFORE, version), [
    'lockfile.importers["apps/web"].dependencies["react-dom"].version: "19.2.5(react@19.2.5)" before, "19.2.4(react@19.2.5)" after',
  ]);
  const gone = edit(
    BEFORE,
    '      eslint:\n        specifier: ^9.39.5\n        version: 9.39.5\n',
    '',
  );
  assert.deepEqual(lockfileDrift(BEFORE, gone), [
    'lockfile.importers["."].devDependencies.eslint: removed',
  ]);
});

test('a package or version added or removed fails', () => {
  const added = insertAfter(BEFORE, "    engines: {node: '>=0.10.0'}", [
    '',
    '  react@19.3.0:',
    '    resolution: {integrity: sha512-bbbb}',
  ]);
  assert.deepEqual(lockfileDrift(BEFORE, added), ['lockfile.packages["react@19.3.0"]: added']);
  const removed = edit(
    BEFORE,
    '  scheduler@0.27.0:\n    resolution: {integrity: sha512-eNv+WrVbKu1f3vbYJT/xtiF5syA5HPIMtf9IgY/nKg0sWqzAUEvqY/xm7OcZc/qafLx/iO9FgOmeSAp4v5ti/Q==}\n',
    '',
  );
  assert.deepEqual(lockfileDrift(BEFORE, removed), [
    'lockfile.packages["scheduler@0.27.0"]: removed',
  ]);
});

test('a changed integrity fails', () => {
  const after = edit(BEFORE, 'sha512-eNv+WrVbKu1f3vbYJT', 'sha512-eNv+WrVbKu1f3vbYJX');
  const drift = lockfileDrift(BEFORE, after);
  assert.equal(drift.length, 1);
  assert.match(drift[0], /^lockfile\.packages\["scheduler@0\.27\.0"\]\.resolution\.integrity: /);
});

test('a new snapshot fails, even one that only differs from another in a nested suffix', () => {
  const plain = insertAfter(BEFORE, '  react@19.2.5: {}', ['', '  react@19.3.0: {}']);
  assert.deepEqual(lockfileDrift(BEFORE, plain), ['lockfile.snapshots["react@19.3.0"]: added']);
  // The cut-short spelling beside the long one: two snapshots now, not one.
  const plugin = PEER_REWRITE.split('\n').find((line) =>
    line.startsWith('  eslint-plugin-import@2.32.0('),
  );
  const twin = insertAfter(BEFORE, '  react@19.2.5: {}', [
    '',
    plugin,
    '    dependencies:',
    '      eslint: 9.39.5',
  ]);
  assert.deepEqual(lockfileDrift(BEFORE, twin), [
    'lockfile.snapshots["eslint-plugin-import@2.32.0(@typescript-eslint/parser@8.72.0)(eslint-import-resolver-typescript@3.10.1)(eslint@9.39.5)"]: 1 before, 2 after',
  ]);
});

test("a peer's own version changing in a key or a reference fails", () => {
  const key = edit(
    BEFORE,
    '  react-dom@19.2.5(react@19.2.5):',
    '  react-dom@19.2.5(react@19.3.0):',
  );
  assert.deepEqual(lockfileDrift(BEFORE, key), [
    'lockfile.snapshots["react-dom@19.2.5(react@19.2.5)"]: removed',
    'lockfile.snapshots["react-dom@19.2.5(react@19.3.0)"]: added',
  ]);
  const reference = edit(
    BEFORE,
    '      eslint-plugin-react: 7.37.5(eslint@9.39.5)\n',
    '      eslint-plugin-react: 7.37.5(eslint@9.40.0)\n',
  );
  assert.deepEqual(lockfileDrift(BEFORE, reference), [
    'lockfile.snapshots["eslint-config-next@16.2.4(@typescript-eslint/parser@8.72.0)(eslint@9.39.5)(typescript@5.9.3)"][0].dependencies[\"eslint-plugin-react\"]: "7.37.5(eslint@9.39.5)" before, "7.37.5(eslint@9.40.0)" after',
  ]);
});

test('any change outside the lockfile fails, whatever the lockfile says', () => {
  const { problems } = removalLeftovers({
    status: [' M apps/web/package.json', LOCKFILE_MODIFIED, '?? apps/web/acme.txt'],
    before: BEFORE,
    after: PEER_REWRITE,
  });
  assert.deepEqual(problems, [' M apps/web/package.json', '?? apps/web/acme.txt']);
});
