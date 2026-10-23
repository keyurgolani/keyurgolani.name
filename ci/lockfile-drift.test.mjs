import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canonicalLockfileProblem,
  LOCKFILE_MODIFIED,
  LOCKFILE_REFRESH,
  lockfileDrift,
  normalisePeers,
  removalProblem,
} from './lib/lockfile-drift.mjs';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/lockfile-drift/${name}.yaml`, import.meta.url), 'utf8');

/** An excerpt of next's pnpm-lock.yaml: the eslint-plugin-import cycle, and react. */
const BEFORE = fixture('before');
/** BEFORE as #82's remove wrote it back: three lines, one cyclic peer suffix cut short. */
const PEER_REWRITE = fixture('peer-rewrite');

const RACE = /Only nested peer suffixes moved in pnpm-lock\.yaml; possibly pnpm's cyclic peer/;
const NOT_CANONICAL = /^pnpm-lock\.yaml isn't what pnpm writes: run pnpm install and commit it\. /;

/** `text` with `from` replaced by `to`, which must be there exactly once. */
function edit(text, from, to) {
  assert.equal(text.split(from).length, 2, `the fixture holds ${JSON.stringify(from)} once`);
  return text.replace(from, to);
}

const REFERENCE_VERSION =
  'file:../pack/acme-reference-1.0.0.tgz(react-dom@19.2.5(react@19.2.5))(react@19.2.5)';

/** PEER_REWRITE with the reference variant still in it: importer, package, and snapshot. */
function withReference(text) {
  let after = edit(
    text,
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
      '',
      '',
    ].join('\n'),
  );
  return edit(
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
}

test('normalisePeers keeps each peer and drops the peers own suffixes', () => {
  assert.equal(normalisePeers('react@19.2.5'), 'react@19.2.5');
  assert.equal(normalisePeers('19.2.5(react@19.2.5)'), '19.2.5(react@19.2.5)');
  assert.equal(
    normalisePeers('react-use-measure@2.1.7(react-dom@19.2.5(react@19.2.5))(react@19.2.5)'),
    'react-use-measure@2.1.7(react-dom@19.2.5)(react@19.2.5)',
  );
  for (const odd of ['a@1.0.0(b@2.0.0', 'a@1.0.0(b@2.0.0))', 'a@1.0.0(b@2.0.0)x', 'a@1.0.0_3f2a']) {
    assert.equal(normalisePeers(odd), odd, 'what it cannot read compares exactly');
  }
});

test('a real leftover after the remove fails, and names what was left, not the race', () => {
  const after = withReference(PEER_REWRITE);
  assert.deepEqual(lockfileDrift(BEFORE, after), [
    'lockfile.importers["apps/web"].dependencies["@acme/reference"]: added',
    'lockfile.packages["@acme/reference@file:../pack/acme-reference-1.0.0.tgz"]: added',
    'lockfile.snapshots["@acme/reference@file:../pack/acme-reference-1.0.0.tgz(react-dom@19.2.5)(react@19.2.5)"]: added',
  ]);
  const problem = removalProblem({ status: [LOCKFILE_MODIFIED], before: BEFORE, after });
  assert.match(
    problem,
    /^the remove leaves nothing changed, but git status shows M pnpm-lock\.yaml\. /,
  );
  assert.match(problem, /dependencies\["@acme\/reference"\]: added/);
  assert.doesNotMatch(problem, RACE);
  // A path outside the lockfile fails on its own.
  assert.match(
    removalProblem({ status: [' M apps/web/package.json'], before: BEFORE, after: BEFORE }),
    /git status shows M apps\/web\/package\.json$/,
  );
});

test("a key that was only rewritten (#82's shape) still fails, and says it may be the race", () => {
  const changed = BEFORE.split('\n').filter((line, i) => line !== PEER_REWRITE.split('\n')[i]);
  assert.equal(changed.length, 3, "#82's three lines");
  assert.deepEqual(lockfileDrift(BEFORE, PEER_REWRITE), []);
  const problem = removalProblem({
    status: [LOCKFILE_MODIFIED],
    before: BEFORE,
    after: PEER_REWRITE,
  });
  assert.match(problem, /^the remove leaves nothing changed, but /);
  assert.match(problem, RACE);
  assert.match(problem, /Re-run, and if it persists, run pnpm install and commit pnpm-lock\.yaml$/);
});

test('a committed lockfile pnpm does not write fails early, with the cause', () => {
  // #85: committed with a peer key pnpm no longer resolves; the refresh writes another.
  const stale = canonicalLockfileProblem({
    status: [LOCKFILE_MODIFIED],
    before: PEER_REWRITE,
    after: BEFORE,
  });
  assert.match(stale, NOT_CANONICAL);
  assert.match(stale, RACE);
  assert.doesNotMatch(stale, /the remove/);
  // Any other change the refresh makes is named.
  const missing = canonicalLockfileProblem({
    status: [LOCKFILE_MODIFIED],
    before: BEFORE,
    after: edit(BEFORE, 'sha512-eNv+WrVbKu1f3vbYJT', 'sha512-eNv+WrVbKu1f3vbYJX'),
  });
  assert.match(missing, NOT_CANONICAL);
  assert.match(missing, /packages\["scheduler@0\.27\.0"\]\.resolution\.integrity: /);
  assert.doesNotMatch(missing, RACE);
  assert.equal(canonicalLockfileProblem({ status: [], before: BEFORE, after: BEFORE }), null);
  assert.equal(removalProblem({ status: [], before: BEFORE, after: BEFORE }), null);
});

test('the refresh re-resolves: --no-prefer-frozen-lockfile, never --offline or frozen', () => {
  assert.equal(LOCKFILE_REFRESH[0], 'install');
  assert.ok(LOCKFILE_REFRESH.includes('--lockfile-only'), 'installs nothing');
  assert.ok(
    LOCKFILE_REFRESH.includes('--no-prefer-frozen-lockfile'),
    'without it, an up-to-date lockfile is written back as read',
  );
  assert.ok(LOCKFILE_REFRESH.includes('--prefer-offline'));
  for (const flag of ['--offline', '--frozen-lockfile']) {
    assert.ok(!LOCKFILE_REFRESH.includes(flag), `${flag} can't re-resolve on CI`);
  }
});

test('the race diagnosis needs the lockfile otherwise the same', () => {
  const changes = {
    'a specifier': [
      '        specifier: ^19.0.0\n        version: 19.2.5\n',
      '        specifier: ^19.2.0\n        version: 19.2.5\n',
    ],
    'an importer version': [
      '        version: 19.2.5(react@19.2.5)\n',
      '        version: 19.2.4(react@19.2.5)\n',
    ],
    'a removed importer dependency': [
      '      eslint:\n        specifier: ^9.39.5\n        version: 9.39.5\n',
      '',
    ],
    'an added package': [
      "    engines: {node: '>=0.10.0'}\n",
      "    engines: {node: '>=0.10.0'}\n\n  react@19.3.0:\n    resolution: {integrity: sha512-bbbb}\n",
    ],
    'a new snapshot': ['  react@19.2.5: {}\n', '  react@19.2.5: {}\n\n  react@19.3.0: {}\n'],
    "a peer's own version in a key": [
      '  react-dom@19.2.5(react@19.2.5):',
      '  react-dom@19.2.5(react@19.3.0):',
    ],
    "a peer's own version in a reference": [
      '      eslint-plugin-react: 7.37.5(eslint@9.39.5)\n',
      '      eslint-plugin-react: 7.37.5(eslint@9.40.0)\n',
    ],
  };
  for (const [name, [from, to]] of Object.entries(changes)) {
    const after = edit(PEER_REWRITE, from, to);
    assert.notDeepEqual(lockfileDrift(BEFORE, after), [], name);
    assert.doesNotMatch(
      removalProblem({ status: [LOCKFILE_MODIFIED], before: BEFORE, after }),
      RACE,
      name,
    );
  }
  // A second snapshot whose key differs from one in a nested suffix alone is one more, not the same.
  const plugin = PEER_REWRITE.split('\n').find((line) =>
    line.startsWith('  eslint-plugin-import@2.32.0('),
  );
  const twin = edit(
    BEFORE,
    '  react@19.2.5: {}\n',
    `  react@19.2.5: {}\n\n${plugin}\n    dependencies:\n      eslint: 9.39.5\n`,
  );
  assert.match(lockfileDrift(BEFORE, twin).join('\n'), /: 1 before, 2 after$/);
});
