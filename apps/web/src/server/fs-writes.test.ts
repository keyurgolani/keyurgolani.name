import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// App code never writes through node:fs (#3, item 20). The revision store
// and #2's session files, in @portfolio/core, make every write the server
// makes, so a file under apps/web/src that calls a node:fs write API fails
// here. So does one that imports the store's write-capable FsPort, which
// would do the same without naming node:fs, or gets node:fs in a way this
// can't follow: a re-export, `import x = require()`, import(), require(),
// process.getBuiltinModule(), createRequire(), or a module object used for
// anything but a read, as when it's destructured, indexed, or passed on.
// Tests are exempt: they make their own temporary directories.

const SRC = fileURLToPath(new URL('../', import.meta.url));
const FS_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']);
const CORE_MODULES = new Set(['@portfolio/core', '@portfolio/core/owner']);

/** node:fs's calls that write, or can: open creates and truncates. */
const WRITES = new Set(
  [
    'appendFile',
    'chmod',
    'chown',
    'copyFile',
    'cp',
    'createWriteStream',
    'fchmod',
    'fchown',
    'fdatasync',
    'fsync',
    'ftruncate',
    'futimes',
    'lchmod',
    'lchown',
    'link',
    'lutimes',
    'mkdir',
    'mkdtemp',
    'open',
    'rename',
    'rm',
    'rmdir',
    'symlink',
    'truncate',
    'unlink',
    'utimes',
    'write',
    'writeFile',
    'writev',
  ].flatMap((name) => [name, `${name}Sync`]),
);

/** Each place `source` writes through node:fs, or could: `line: what`. */
function fsWrites(source: string, file = 'source.ts'): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const at = (node: ts.Node, what: string) =>
    found.push(`${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${what}`);
  // The names node:fs, or its promises, is bound to here.
  const modules = new Set<string>();

  for (const statement of tree.statements) {
    // A re-export hands node:fs on to a module this file can't see.
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      FS_MODULES.has(statement.moduleSpecifier.text)
    ) {
      at(statement, `re-exports from ${statement.moduleSpecifier.text}`);
      continue;
    }
    if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      ts.isStringLiteral(statement.moduleReference.expression) &&
      FS_MODULES.has(statement.moduleReference.expression.text)
    ) {
      at(statement, `loads ${statement.moduleReference.expression.text} with import = require()`);
      modules.add(statement.name.text);
      continue;
    }
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const from = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause) continue;
    if (FS_MODULES.has(from)) {
      if (clause.name) modules.add(clause.name.text);
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) modules.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (WRITES.has(imported)) at(element, `imports ${imported} from ${from}`);
          if (imported === 'promises') modules.add(element.name.text);
        }
      }
    }
    if (CORE_MODULES.has(from)) {
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if ((element.propertyName ?? element.name).text === 'nodeFs') {
            at(element, `imports the store's nodeFs from ${from}`);
          }
        }
      }
    }
  }

  /** The import that binds `name` here, not a use of it. */
  const declares = (name: ts.Identifier) =>
    ts.isImportClause(name.parent) ||
    ts.isNamespaceImport(name.parent) ||
    ts.isImportSpecifier(name.parent) ||
    ts.isImportEqualsDeclaration(name.parent);

  /** A use of a bound node:fs module: only `x.<read>`, or `x.promises.<read>`, passes. */
  const used = (name: ts.Identifier) => {
    const parent = name.parent;
    if (!ts.isPropertyAccessExpression(parent) || parent.expression !== name) {
      at(name, `uses ${name.text} other than to call a read`);
      return;
    }
    if (parent.name.text !== 'promises') {
      if (WRITES.has(parent.name.text)) at(parent, `calls ${parent.getText()}`);
      return;
    }
    const outer = parent.parent;
    if (!ts.isPropertyAccessExpression(outer) || outer.expression !== parent) {
      at(parent, `uses ${parent.getText()} other than to call a read`);
      return;
    }
    if (WRITES.has(outer.name.text)) at(outer, `calls ${outer.getText()}`);
  };

  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && modules.has(node.text) && !declares(node)) used(node);
    // Both hand out node:fs where no import names it.
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'getBuiltinModule') {
      at(node, 'loads a builtin through getBuiltinModule()');
    }
    if (ts.isIdentifier(node) && node.text === 'createRequire') {
      at(node, 'uses createRequire');
    }
    // import('node:fs') and require('fs') bind names this can't follow.
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const [first] = node.arguments;
      const dynamic =
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require');
      if (dynamic && first && ts.isStringLiteral(first) && FS_MODULES.has(first.text)) {
        at(node, `loads ${first.text} dynamically`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

function sources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sources(file));
    else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name) && !/\.test\.[cm]?[jt]sx?$/.test(entry.name)) {
      files.push(file);
    }
  }
  return files;
}

test('no file under apps/web/src writes through node:fs', () => {
  const files = sources(SRC);
  assert.ok(files.length > 50, 'the walk found the app');
  const found = files.flatMap((file) =>
    fsWrites(readFileSync(file, 'utf8'), file).map(
      (place) => `${path.relative(SRC, file)}:${place}`,
    ),
  );
  assert.deepEqual(found, []);
});

test('the check finds each way a file could write, and passes reads', () => {
  assert.deepEqual(
    fsWrites("import fs from 'node:fs';\nfs.readFileSync('a');\nfs.statSync('a');"),
    [],
  );
  assert.deepEqual(
    fsWrites("import { readFile } from 'node:fs/promises';\nawait readFile('a');"),
    [],
  );
  assert.deepEqual(
    fsWrites("import fs from 'node:fs';\nawait fs.promises.readFile('a');\nfs.constants;"),
    [],
  );
  const cases: Array<[string, string]> = [
    ["import fs from 'node:fs';\nfs.writeFileSync('a', 'b');", 'calls fs.writeFileSync'],
    ["import * as fs from 'fs';\nfs.renameSync('a', 'b');", 'calls fs.renameSync'],
    ["import fs from 'node:fs';\nawait fs.promises.rm('a');", 'calls fs.promises.rm'],
    ["import { promises as p } from 'node:fs';\nawait p.mkdir('a');", 'calls p.mkdir'],
    [
      "import { writeFile as w } from 'node:fs/promises';",
      'imports writeFile from node:fs/promises',
    ],
    ["import { openSync } from 'fs';", 'imports openSync from fs'],
    ["const fs = await import('node:fs');", 'loads node:fs dynamically'],
    ["const fs = require('fs');", 'loads fs dynamically'],
    [
      "import { nodeFs } from '@portfolio/core/owner';",
      "imports the store's nodeFs from @portfolio/core/owner",
    ],
    // The review of #60's FW1 to FW6: a re-export, a destructuring, an
    // element access, a rebinding, getBuiltinModule(), import = require().
    ["export { writeFileSync as put } from 'node:fs';", 're-exports from node:fs'],
    [
      "import fs from 'node:fs';\nconst { writeFileSync: put } = fs;",
      'uses fs other than to call a read',
    ],
    [
      "import fs from 'node:fs';\nfs['writeFileSync']('a', 'b');",
      'uses fs other than to call a read',
    ],
    ["import * as fs from 'node:fs';\nconst disk = fs;", 'uses fs other than to call a read'],
    [
      "const fs = process.getBuiltinModule('node:fs');",
      'loads a builtin through getBuiltinModule()',
    ],
    ["import fs = require('node:fs');", 'loads node:fs with import = require()'],
    ["import { createRequire } from 'node:module';", 'uses createRequire'],
    [
      "import { promises } from 'node:fs';\nconst { rm } = promises;",
      'uses promises other than to call a read',
    ],
  ];
  for (const [source, what] of cases) {
    const found = fsWrites(source);
    assert.equal(found.length, 1, source);
    assert.match(
      found[0]!,
      new RegExp(`^\\d+: ${what.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      source,
    );
  }
});
