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
// would do the same without naming node:fs, or loads node:fs in a way this
// can't follow. Tests are exempt: they make their own temporary directories.

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

  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && WRITES.has(node.name.text)) {
      // fs.writeFileSync, or fs.promises.writeFile.
      let target: ts.Expression = node.expression;
      if (ts.isPropertyAccessExpression(target) && target.name.text === 'promises') {
        target = target.expression;
      }
      if (ts.isIdentifier(target) && modules.has(target.text)) at(node, `calls ${node.getText()}`);
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
