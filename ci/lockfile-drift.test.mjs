import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parse as parseYaml } from 'yaml';
import {
  canonicalLockfileProblem,
  LOCKFILE_MODIFIED,
  LOCKFILE_REFRESH,
  lockfileDrift,
  normalisePeers,
  peerCycles,
  removalProblem,
} from './lib/lockfile-drift.mjs';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/lockfile-drift/${name}.yaml`, import.meta.url), 'utf8');

/** An excerpt of next's pnpm-lock.yaml before #12: the eslint-plugin-import cycle, and react. */
const BEFORE = fixture('before');
/** BEFORE as #82's remove wrote it back: three lines, one cyclic peer suffix cut short. */
const PEER_REWRITE = fixture('peer-rewrite');

const RACE = /Only nested peer suffixes moved in pnpm-lock\.yaml: the shape of a peer cycle/;
const NOT_CANONICAL = /^pnpm-lock\.yaml isn't what pnpm writes: run pnpm install and commit it\. /;
const require = createRequire(import.meta.url);

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
  assert.match(problem, /^the remove leaves nothing changed\. pnpm-lock\.yaml differs in /);
  assert.match(problem, /dependencies\["@acme\/reference"\]: added/);
  assert.doesNotMatch(problem, RACE);
  assert.equal(problem.match(/git status/g), null, 'expectStatus prints git status, once');
  // A path outside the lockfile fails on its own.
  assert.equal(
    removalProblem({ status: [' M apps/web/package.json'], before: BEFORE, after: BEFORE }),
    'the remove leaves nothing changed',
  );
});

test("a key that was only rewritten (#82's shape) still fails, and says re-run, not commit", () => {
  const changed = BEFORE.split('\n').filter((line, i) => line !== PEER_REWRITE.split('\n')[i]);
  assert.equal(changed.length, 3, "#82's three lines");
  assert.deepEqual(lockfileDrift(BEFORE, PEER_REWRITE), []);
  const problem = removalProblem({
    status: [LOCKFILE_MODIFIED],
    before: BEFORE,
    after: PEER_REWRITE,
  });
  assert.match(problem, /^the remove leaves nothing changed\. Only nested peer suffixes moved/);
  assert.match(problem, /Re-run it$/);
  assert.doesNotMatch(problem, /commit/);
});

test('the peer cycle wording needs git status to show the lockfile alone', () => {
  for (const other of [' M apps/web/package.json', '?? apps/web/acme.txt']) {
    const status = [other, LOCKFILE_MODIFIED];
    const removal = removalProblem({ status, before: BEFORE, after: PEER_REWRITE });
    assert.equal(removal, 'the remove leaves nothing changed', other);
    const refresh = canonicalLockfileProblem({ status, before: PEER_REWRITE, after: BEFORE });
    assert.equal(refresh, 'the lockfile refresh changes nothing but pnpm-lock.yaml', other);
    // A real lockfile change beside it is still named.
    const after = withReference(PEER_REWRITE);
    assert.match(
      removalProblem({ status, before: BEFORE, after }),
      /^the remove leaves nothing changed\. pnpm-lock\.yaml differs in .*@acme\/reference/,
    );
    assert.match(
      canonicalLockfileProblem({ status, before: BEFORE, after }),
      /^the lockfile refresh changes nothing but pnpm-lock\.yaml\. pnpm-lock\.yaml differs in /,
    );
  }
});

test('a committed lockfile pnpm does not write fails early, with the cause', () => {
  // #85's shape: committed with a peer key the refresh writes another way.
  // It opens with re-run, since one run can't tell a stale key from a cycle,
  // and says to commit only if it repeats.
  const stale = canonicalLockfileProblem({
    status: [LOCKFILE_MODIFIED],
    before: PEER_REWRITE,
    after: BEFORE,
  });
  assert.match(
    stale,
    /^Only nested peer suffixes moved in pnpm-lock\.yaml: the shape of a peer cycle/,
  );
  assert.match(
    stale,
    / Re-run\. If it repeats, pnpm-lock\.yaml isn't what pnpm writes: run pnpm install, commit it/,
  );
  assert.doesNotMatch(stale, /the remove/);
  // The refresh changing a path other than the lockfile fails too.
  assert.equal(
    canonicalLockfileProblem({
      status: [' M apps/web/package.json'],
      before: BEFORE,
      after: BEFORE,
    }),
    'the lockfile refresh changes nothing but pnpm-lock.yaml',
  );
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
    'a transitive peer': [
      '      - eslint-import-resolver-webpack\n      - eslint-plugin-import-x\n',
      '      - eslint-import-resolver-webpack\n',
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

test('the committed lockfile has no peer cycle, which pnpm could write two ways', () => {
  // next before #12 had one: eslint-plugin-import and eslint-import-resolver-typescript.
  assert.deepEqual(peerCycles(BEFORE), [
    ['eslint-import-resolver-typescript', 'eslint-plugin-import'],
  ]);
  assert.deepEqual(peerCycles('snapshots:\n  a@1.0.0(a@1.0.0): {}\n'), [['a']]);
  assert.deepEqual(peerCycles('snapshots:\n  a@1.0.0(b@2.0.0): {}\n  b@2.0.0: {}\n'), []);
  const committed = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
  assert.deepEqual(peerCycles(committed), [], 'a new cycle needs a hook like .pnpmfile.cjs has');
});

// .pnpmfile.cjs runs on every install, and pnpm checksums it only while it
// exports hooks, so these pin what it exports and what it changes.
const pnpmfile = require('../.pnpmfile.cjs');
const { readPackage } = pnpmfile.hooks;
const RESOLVER = 'eslint-import-resolver-typescript';

test('.pnpmfile.cjs exports one readPackage hook and one dropped peer, nothing else', () => {
  assert.deepEqual(Object.keys(pnpmfile).sort(), ['DROPPED_PEERS', 'hooks']);
  // Not afterAllResolved, updateConfig (which can turn strictDepBuilds off), or anything new.
  assert.deepEqual(Object.keys(pnpmfile.hooks), ['readPackage']);
  // By name too, so a non-enumerable or inherited hook can't hide: every hook pnpm 10.33 reads.
  for (const name of [
    'readPackage',
    'updateConfig',
    'afterAllResolved',
    'preResolution',
    'importPackage',
    'fetchers',
    'filterLog',
    'beforePacking',
  ]) {
    assert.equal(
      typeof pnpmfile.hooks[name],
      name === 'readPackage' ? 'function' : 'undefined',
      name,
    );
  }
  assert.equal(pnpmfile.finders, undefined);
  assert.deepEqual(pnpmfile.DROPPED_PEERS, [[RESOLVER, 'eslint-plugin-import']]);
});

test(".pnpmfile.cjs leaves every workspace project's package.json as it is", () => {
  // A frozen install hands readPackage the workspace manifests alone, so a
  // change here (a postinstall on the root, say) would run on every install.
  const importers = Object.keys(
    parseYaml(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')).importers,
  );
  assert.ok(importers.includes('.') && importers.includes('apps/web'), importers.join(', '));
  for (const id of importers) {
    const file = new URL(`../${id === '.' ? '' : `${id}/`}package.json`, import.meta.url);
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(readPackage(structuredClone(manifest)), manifest, id);
  }
});

test(".pnpmfile.cjs drops the resolver's optional peer on eslint-plugin-import, and nothing else", () => {
  const resolver = readPackage({
    name: RESOLVER,
    version: '3.10.1',
    dependencies: { 'eslint-plugin-import': '*' },
    peerDependencies: { eslint: '*', 'eslint-plugin-import': '*', 'eslint-plugin-import-x': '*' },
    peerDependenciesMeta: {
      'eslint-plugin-import': { optional: true },
      'eslint-plugin-import-x': { optional: true },
    },
  });
  assert.deepEqual(resolver.peerDependencies, { eslint: '*', 'eslint-plugin-import-x': '*' });
  // pnpm reads an optional peerDependenciesMeta entry as a peer on its own.
  assert.deepEqual(resolver.peerDependenciesMeta, { 'eslint-plugin-import-x': { optional: true } });
  assert.deepEqual(resolver.dependencies, { 'eslint-plugin-import': '*' }, 'dependencies stay');
  // Another package with the same peer keeps it.
  const utils = {
    name: 'eslint-module-utils',
    version: '2.14.0',
    peerDependencies: { [RESOLVER]: '*', 'eslint-plugin-import': '*' },
    peerDependenciesMeta: {
      [RESOLVER]: { optional: true },
      'eslint-plugin-import': { optional: true },
    },
  };
  assert.deepEqual(readPackage(structuredClone(utils)), utils);
});

test('.pnpmfile.cjs stops the install on a resolver version nobody checked', () => {
  for (const version of ['3.10.2', '4.0.0', '3.9.0']) {
    const pkg = { name: RESOLVER, version, peerDependencies: { 'eslint-plugin-import': '*' } };
    assert.throws(
      () => readPackage(pkg),
      new RegExp(
        `checked for 3\\.10\\.1, but this install resolves ${version.replaceAll('.', '\\.')}\\. Re-check`,
      ),
    );
  }
});

/** Every manifest in node_modules/.pnpm, scoped packages included. */
function installedManifests() {
  const store = new URL('../node_modules/.pnpm/', import.meta.url);
  const manifests = [];
  for (const entry of readdirSync(store, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    const modules = new URL(`${entry.name}/node_modules/`, store);
    if (!existsSync(modules)) continue;
    for (const name of readdirSync(modules)) {
      const names = name.startsWith('@')
        ? readdirSync(new URL(`${name}/`, modules)).map((scoped) => `${name}/${scoped}`)
        : [name];
      for (const pkg of names) {
        const file = new URL(`${pkg}/package.json`, modules);
        if (existsSync(file)) manifests.push(JSON.parse(readFileSync(file, 'utf8')));
      }
    }
  }
  return manifests;
}

// Only what's installed on this platform: another platform's optional
// packages (@esbuild/*, @img/sharp-*) aren't in node_modules to read.
test('.pnpmfile.cjs changes no installed manifest but the resolver, and only by its two keys', () => {
  const manifests = installedManifests();
  assert.ok(manifests.length > 500, `read ${manifests.length} installed manifests`);
  let resolvers = 0;
  for (const manifest of manifests) {
    const after = readPackage(structuredClone(manifest));
    if (manifest.name !== RESOLVER) {
      assert.deepEqual(after, manifest, `${manifest.name}@${manifest.version} is unchanged`);
      continue;
    }
    resolvers += 1;
    const expected = structuredClone(manifest);
    delete expected.peerDependencies['eslint-plugin-import'];
    delete expected.peerDependenciesMeta['eslint-plugin-import'];
    assert.deepEqual(after, expected);
  }
  assert.ok(resolvers >= 1, 'the resolver is installed');
});

// .pnpmfile.cjs, byte for byte. pnpmfileChecksum only proves the lockfile
// was written with this file. This fails the tests on any edit until a
// reviewer has read the change and updates the hash in the same PR.
const PNPMFILE_SHA256 = '501635a9849145fa426bc4ee5046d03b8abe9f0a463df1fc063e66cddbd3a24b';
const PNPMFILE_SOURCE = readFileSync(new URL('../.pnpmfile.cjs', import.meta.url), 'utf8');

test('.pnpmfile.cjs is the reviewed file, by its sha256', () => {
  assert.equal(createHash('sha256').update(PNPMFILE_SOURCE).digest('hex'), PNPMFILE_SHA256);
});

/** espree, the parser eslint itself runs, resolved through the root's eslint. */
const espree = createRequire(require.resolve('eslint'))('espree');

/** Names the hook must never reach for: modules, the network, the environment, eval. */
const FORBIDDEN_NAMES = new Set([
  'require',
  'process',
  'globalThis',
  'global',
  'fetch',
  'XMLHttpRequest',
  'child_process',
  'fs',
  'net',
  'http',
  'https',
  'eval',
  'Function',
  'constructor',
  'Buffer',
  'WebAssembly',
]);
const FORBIDDEN_MODULES =
  /^(node:)?(child_process|fs|fs\/promises|net|http|https|http2|dgram|tls|os|vm|worker_threads)$/;

/** Every node under `node`, depth first. */
function* walk(node) {
  yield node;
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === 'object' && typeof child.type === 'string') yield* walk(child);
    }
  }
}

/** A value with no side effect: literals, arrays and objects of them, and Object.freeze over them. */
function inert(node) {
  switch (node.type) {
    case 'Literal':
      return true;
    case 'ArrayExpression':
      return node.elements.every((element) => element && inert(element));
    case 'ObjectExpression':
      return node.properties.every((p) => p.type === 'Property' && !p.computed && inert(p.value));
    case 'CallExpression':
      return (
        node.callee.type === 'MemberExpression' &&
        !node.callee.computed &&
        node.callee.object.name === 'Object' &&
        node.callee.property.name === 'freeze' &&
        node.arguments.length === 1 &&
        inert(node.arguments[0])
      );
    default:
      return false;
  }
}

/**
 * Why `source` isn't a script that only declares inert constants and
 * functions and then sets module.exports to an object, or [].
 */
function pnpmfileProblems(source) {
  const ast = espree.parse(source, { ecmaVersion: 'latest', sourceType: 'script', range: true });
  const problems = [];
  const at = (node) => `${node.type} at ${node.range[0]}`;
  const body = [...ast.body];
  if (body[0]?.directive === 'use strict') body.shift();
  const last = body.pop();
  const target = last?.expression?.left;
  const exportsModule =
    last?.type === 'ExpressionStatement' &&
    last.expression.type === 'AssignmentExpression' &&
    last.expression.operator === '=' &&
    target.type === 'MemberExpression' &&
    !target.computed &&
    target.object.name === 'module' &&
    target.property.name === 'exports' &&
    last.expression.right.type === 'ObjectExpression';
  if (!exportsModule) problems.push(`no module.exports = { … } at the end: ${last && at(last)}`);
  for (const statement of body) {
    const constant =
      statement.type === 'VariableDeclaration' &&
      statement.kind === 'const' &&
      statement.declarations.every((d) => d.id.type === 'Identifier' && d.init && inert(d.init));
    if (!constant && statement.type !== 'FunctionDeclaration') {
      problems.push(
        `a top-level statement that isn't an inert constant or a function: ${at(statement)}`,
      );
    }
  }
  for (const node of walk(ast)) {
    if (['ImportExpression', 'ImportDeclaration', 'MetaProperty'].includes(node.type)) {
      problems.push(`an import: ${at(node)}`);
    } else if (node.type === 'Identifier' && FORBIDDEN_NAMES.has(node.name)) {
      problems.push(`${node.name}: ${at(node)}`);
    } else if (node.type === 'Identifier' && node.name === 'module' && node !== target?.object) {
      problems.push(`module outside the export: ${at(node)}`);
    } else if (
      node.type === 'Literal' &&
      typeof node.value === 'string' &&
      FORBIDDEN_MODULES.test(node.value)
    ) {
      problems.push(`a core module's name, ${node.value}: ${at(node)}`);
    } else if (
      node.type === 'MemberExpression' &&
      node.computed &&
      node.property.type !== 'Identifier'
    ) {
      // obj['constructor'] and the like: only a variable indexes an object here.
      problems.push(`a computed member: ${at(node)}`);
    }
  }
  return problems;
}

test('.pnpmfile.cjs declares inert constants and a function and exports them: no imports, no I/O', () => {
  assert.deepEqual(pnpmfileProblems(PNPMFILE_SOURCE), []);
  // The check sees each way the file could grow.
  const exportLine = 'module.exports = { hooks: { readPackage }, DROPPED_PEERS };';
  const grown = {
    require: "const fs = require('fs');\n",
    'a dynamic import': "const loaded = import('node:fs');\n",
    'a static import': "import fs from 'node:fs';\n",
    process: 'const env = process.env;\n',
    globalThis: 'const g = globalThis;\n',
    fetch: 'const f = fetch;\n',
    XMLHttpRequest: 'const x = XMLHttpRequest;\n',
    eval: 'const e = eval;\n',
    'Function(': "const make = Function('return 1');\n",
    'a constructor chain': 'const make = readPackage.constructor;\n',
    'a computed constructor': "const make = readPackage['constr' + 'uctor'];\n",
    'a core module name': "const name = 'child_process';\n",
    'a top-level call': "console.log('loaded');\n",
    'a top-level let': 'let count = 0;\n',
    'a computed initializer': 'const now = Date.now();\n',
    'a second use of module': 'module.paths = [];\n',
  };
  for (const [name, line] of Object.entries(grown)) {
    const source = PNPMFILE_SOURCE.replace(exportLine, `${line}${exportLine}`);
    assert.notEqual(source, PNPMFILE_SOURCE, name);
    let problems;
    try {
      problems = pnpmfileProblems(source);
    } catch (error) {
      // A static import doesn't parse as a script, which fails too.
      problems = [error.message];
    }
    assert.notDeepEqual(problems, [], name);
  }
  // So do fs, net, http, and https named inside the hook.
  for (const name of ['fs', 'net', 'http', 'https']) {
    const source = PNPMFILE_SOURCE.replace(
      '  return pkg;\n}',
      `  pkg.x = '${name}';\n  return pkg;\n}`,
    );
    assert.notEqual(source, PNPMFILE_SOURCE, name);
    assert.notDeepEqual(pnpmfileProblems(source), [], name);
  }
});
