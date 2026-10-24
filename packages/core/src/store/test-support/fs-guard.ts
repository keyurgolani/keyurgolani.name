import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { recordOwnerModule } from '../../load-trace';

recordOwnerModule('core/store/test-support/fs-guard');

// The lint half of what keeps the published pointer to the
// PublicationService (#3, item 20; threat publish-3), on the TypeScript
// syntax tree. A module that can write the filesystem itself, by importing
// a write API from `fs`, `node:fs`, `fs/promises`, or `node:fs/promises`,
// or the module whole, by import, require, process.getBuiltinModule(), or
// a require createRequire() made, is one of a fixed list; and in those, every read of
// `live`, `liveTemp`, or `publication` off any object, by name or as
// `['live']`, is one the test names. An alias such as
// `const target = layout.live; await rename(staged, target)` is that read.
// A module that can't reach the filesystem, such as Studio's, may read a
// `live` field of its own.

const FS_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']);

/** The fs APIs that make, replace, open, or remove something, each also as its Sync form. */
export const WRITE_APIS = [
  'rename',
  'link',
  'symlink',
  'writeFile',
  'copyFile',
  'cp',
  'rm',
  'unlink',
  'rmdir',
  'truncate',
  'open',
  'appendFile',
  'createWriteStream',
  'mkdir',
  'chmod',
  'write',
  'writev',
  'lutimes',
  'utimes',
] as const;

const WRITES = new Set<string>(WRITE_APIS.flatMap((name) => [name, `${name}Sync`]));
/** The keys that name the pointer or its directory. */
const POINTER_KEYS = new Set(['live', 'liveTemp', 'publication']);

/** What a module takes from fs that can write: the write APIs it names, or `*` for the module whole. */
export function fsWrites(source: ts.SourceFile): string[] {
  const found: string[] = [];
  const requires = createdRequires(source);
  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      FS_MODULES.has(node.moduleSpecifier.text)
    ) {
      const clause = node.importClause;
      if (clause?.name) found.push('*');
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) found.push('*');
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const name = (element.propertyName ?? element.name).text;
          if (WRITES.has(name) || name === 'promises') found.push(name);
        }
      }
    }
    // import('node:fs') and require('fs') get the module whole, and so do
    // process.getBuiltinModule('fs') and a require createRequire() made,
    // called at once or through the name it's bound to.
    if (ts.isCallExpression(node) && loadsModule(node.expression, requires)) {
      const [specifier] = node.arguments;
      if (specifier && ts.isStringLiteralLike(specifier) && FS_MODULES.has(specifier.text)) {
        found.push('*');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Whether `node` names createRequire, by itself or off a namespace such as `module.createRequire`. */
function isCreateRequire(node: ts.Expression): boolean {
  return (
    (ts.isIdentifier(node) && node.text === 'createRequire') ||
    (ts.isPropertyAccessExpression(node) && node.name.text === 'createRequire')
  );
}

/** The names `source` binds a require to that createRequire() made. */
function createdRequires(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      isCreateRequire(node.initializer.expression)
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/** Whether a call to `callee` loads a module by its specifier: import(), require, getBuiltinModule, or a made require. */
function loadsModule(callee: ts.Expression, requires: ReadonlySet<string>): boolean {
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (ts.isIdentifier(callee)) {
    return (
      callee.text === 'require' || callee.text === 'getBuiltinModule' || requires.has(callee.text)
    );
  }
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text === 'getBuiltinModule';
  return ts.isCallExpression(callee) && isCreateRequire(callee.expression);
}

/** Each read of `live`, `liveTemp`, or `publication` off any object in `source`, as `<line>: <text>`. */
export function pointerReads(source: ts.SourceFile): string[] {
  const found: string[] = [];
  const at = (node: ts.Node) =>
    `${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${node.getText().replace(/\s+/g, ' ')}`;
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && POINTER_KEYS.has(node.name.text))
      found.push(at(node));
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      POINTER_KEYS.has(node.argumentExpression.text)
    ) {
      found.push(at(node));
    }
    // Destructuring takes one out too, whatever it binds it to.
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name;
      const name =
        ts.isIdentifier(key) || ts.isStringLiteralLike(key)
          ? key.text
          : ts.isComputedPropertyName(key) && ts.isStringLiteralLike(key.expression)
            ? key.expression.text
            : undefined;
      if (name && POINTER_KEYS.has(name)) found.push(at(node.parent.parent));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** `file`'s syntax tree. */
export function syntaxOf(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}
