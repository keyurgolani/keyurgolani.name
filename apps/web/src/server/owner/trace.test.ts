import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { loadedOwnerModules } from '../load-trace';

// Every module under server/owner/ records itself in the owner load trace
// (#1, item 14) as it loads, so readiness can report the trace empty under
// demo and read-only, and a module can't load there unseen.

const OWNER = fileURLToPath(new URL('.', import.meta.url));
const SERVER = path.dirname(OWNER);

function ownerModules(dir = OWNER): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return ownerModules(file);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [file] : [];
  });
}

/** The trace name for `file`, such as `server/owner/index`. */
function traceName(file: string): string {
  const relative = path.relative(path.dirname(SERVER), file).replace(/\.tsx?$/, '');
  return relative.split(path.sep).join('/');
}

/** Whether `file` imports recordOwnerModule from server/load-trace.ts and calls it at the top level with its own name. */
function recordsItself(file: string): boolean {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const imported = source.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      return false;
    }
    const target = path.resolve(path.dirname(file), statement.moduleSpecifier.text);
    const bindings = statement.importClause?.namedBindings;
    return (
      target === path.join(SERVER, 'load-trace') &&
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((item) => item.name.text === 'recordOwnerModule' && !item.propertyName)
    );
  });
  const called = source.statements.some((statement) => {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
      return false;
    }
    const { expression: callee, arguments: args } = statement.expression;
    const [name] = args;
    return (
      ts.isIdentifier(callee) &&
      callee.text === 'recordOwnerModule' &&
      args.length === 1 &&
      name !== undefined &&
      ts.isStringLiteral(name) &&
      name.text === traceName(file)
    );
  });
  return imported && called;
}

test('every owner module calls recordOwnerModule() with its own name as it loads', () => {
  const modules = ownerModules();
  assert.ok(modules.length > 0);
  for (const file of modules) {
    assert.ok(
      recordsItself(file),
      `${traceName(file)} must call recordOwnerModule('${traceName(file)}')`,
    );
  }
});

test('loading each owner module adds it to the trace', async () => {
  for (const file of ownerModules()) {
    await import(pathToFileURL(file).href);
    assert.ok(loadedOwnerModules().includes(traceName(file)), traceName(file));
  }
});
