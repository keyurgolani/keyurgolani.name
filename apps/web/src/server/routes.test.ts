import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  normalizeMetadataPageToRoute,
  normalizeMetadataRoute,
} from 'next/dist/lib/metadata/get-metadata-route';
import { isMetadataRouteFile } from 'next/dist/lib/metadata/is-metadata-route';
import { normalizeAppPath } from 'next/dist/shared/lib/router/utils/app-paths';
import ts from 'typescript';
import { parse as parseYaml } from 'yaml';
import { isReservedSegment, validateManifest } from '@portfolio/variant-contract';
import { LITERAL_SEGMENT } from '@portfolio/variant-contract/segments';
import {
  builtWithFixtures,
  CAPABILITIES,
  FIXTURE_CAPABILITIES,
  PROFILES,
  type Profile,
} from './capabilities';
import type { DeploymentConfig } from './config';
import { setDeploymentState } from './config-store';
import { servedPattern } from './route-guard';
import {
  devPreviewRoute,
  encodesFixedSegment,
  listRoutes,
  ownedFirstSegments,
  PREVIEW_DEV,
  resolveRoute,
  RETIRED_PATTERNS,
  routeAccess,
  routeResolver,
  serves,
  spellsRouteFile,
  type Installed,
  type RouteEntry,
  type RouteKind,
  type RoutePattern,
} from './routes';

// The route table against the app directory (#1, item 13), and how the
// table decides a request. Route files map to URLs through Next's own
// helpers, so route groups, slots, and numbered metadata images land where
// the build puts them.

const WEB = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURES = new URL('../../../../tests/fixtures/variants/', import.meta.url);
const SRC = path.join(WEB, 'src');
const APP = path.join(SRC, 'app');
const PACKAGES = path.join(WEB, '..', '..', 'packages');

// Next's default page extensions. The first test checks next.config.ts keeps them.
const PAGE_EXTENSIONS = ['tsx', 'ts', 'jsx', 'js'];
const PAGE_FILE = /\.(tsx|ts|jsx|js)$/;
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

interface RouteFile {
  readonly pattern: string;
  readonly kind: RouteKind;
  readonly file: string;
}

/**
 * The URL Next serves an app file at, as `next build` maps it, or null when
 * the file is no route. `relative` starts with a slash, from the app
 * directory. `dynamic` is a metadata file that exports generateImageMetadata
 * or generateSitemaps.
 */
function nextRoute(relative: string, dynamic = false): Omit<RouteFile, 'file'> | null {
  const name = path.posix.basename(relative);
  // next build reads %5F in an app path as an underscore (createPagesMapping),
  // so a %5F folder serves a segment that starts with one.
  const page = relative.replace(PAGE_FILE, '').replace(/%5F/g, '_');
  if (/^page\.(tsx|ts|jsx|js)$/.test(name)) {
    return { kind: 'page', pattern: normalizeAppPath(page) };
  }
  if (/^route\.(tsx|ts|jsx|js)$/.test(name)) {
    return { kind: 'handler', pattern: normalizeAppPath(page) };
  }
  if (!isMetadataRouteFile(relative, PAGE_EXTENSIONS, true)) return null;
  const route = normalizeMetadataPageToRoute(normalizeMetadataRoute(page), dynamic);
  return { kind: 'metadata', pattern: normalizeAppPath(route) };
}

function parse(file: string, text = readFileSync(file, 'utf8')): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/** The names a module exports through declarations. */
function exportedNames(source: ts.SourceFile): string[] {
  return source.statements.flatMap((statement) => {
    if (!isExported(statement)) return [];
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.flatMap((declaration) =>
        ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
      );
    }
    const name = (statement as ts.DeclarationStatement).name;
    return name && ts.isIdentifier(name) ? [name.text] : [];
  });
}

/** Every file in the app directory that Next serves at a URL. */
function routeFiles(dir = APP): RouteFile[] {
  const found: RouteFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Private folders never route.
      if (entry.name.startsWith('_')) continue;
      assert.ok(
        !/^\(\.{1,3}\)/.test(entry.name),
        `intercepting routes need table support: ${file}`,
      );
      found.push(...routeFiles(file));
      continue;
    }
    const relative = `/${path.relative(APP, file).split(path.sep).join('/')}`;
    const dynamic =
      PAGE_FILE.test(entry.name) &&
      exportedNames(parse(file)).some((name) =>
        ['generateImageMetadata', 'generateSitemaps'].includes(name),
      );
    const route = nextRoute(relative, dynamic);
    if (route) found.push({ ...route, file });
  }
  return found;
}

/** Every source file under `dir`, skipping dependencies and build output. */
function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(file));
    else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(entry.name)) found.push(file);
  }
  return found;
}

/**
 * A concrete path for `pattern`, filling each dynamic segment with a word no
 * route starts with, so the root catch-all's path is its own.
 */
function instantiate(pattern: string): string {
  return pattern.replace(/\[\[?\.{0,3}[^\]]+\]\]?/g, 'probe') || '/';
}

const PATTERNS = [...new Set(listRoutes().map((entry) => entry.pattern))].sort();

test('Next finds routes only in apps/web/src/app', async () => {
  // Next prefers apps/web/app to src/app, and serves a Pages Router
  // directory beside either, so a file there would skip the table.
  for (const dir of ['app', 'pages', 'src/pages']) {
    assert.ok(!existsSync(path.join(WEB, dir)), `apps/web/${dir} would route around the table`);
  }
  assert.ok(existsSync(APP));
  const { default: config } = await import('../../next.config');
  assert.equal(config.pageExtensions, undefined, "the mapping assumes Next's page extensions");
});

test("route files map to URLs as next build maps them, with Next's own helpers", () => {
  const cases: Array<[string, string | null]> = [
    ['/page.tsx', '/'],
    ['/(site)/work/[slug]/page.tsx', '/work/[slug]'],
    ['/@modal/page.tsx', '/'],
    ['/api/health/route.ts', '/api/health'],
    ['/robots.ts', '/robots.txt'],
    ['/(site)/sitemap.ts', '/sitemap.xml'],
    ['/opengraph-image.tsx', '/opengraph-image'],
    // Under a group or a slot, a metadata route gets a hash of the parent path.
    ['/(site)/opengraph-image.tsx', '/opengraph-image-12o0cb'],
    ['/@slot/icon.png', '/icon-xxgbpy.png'],
    // A %5F folder serves an underscore, where a _ folder is private.
    ['/(fixtures)/%5Ffixtures/appearance/page.tsx', '/_fixtures/appearance'],
    // Numbered images keep their number, and static ones their extension.
    ['/icon2.tsx', '/icon2'],
    ['/icon2.png', '/icon2.png'],
    ['/(site)/twitter-image2.jpg', '/twitter-image2-12o0cb.jpg'],
    ['/icon12.png', null],
    ['/layout.tsx', null],
    ['/feed.xml/route.test.ts', null],
  ];
  for (const [relative, url] of cases) {
    assert.equal(nextRoute(relative)?.pattern ?? null, url, relative);
  }
  assert.equal(
    nextRoute('/opengraph-image.tsx', true)?.pattern,
    '/opengraph-image/[__metadata_id__]',
  );
});

test('every route file has an entry of its kind, and every entry has a route file', () => {
  const files = routeFiles();
  assert.deepEqual(
    [...new Set(files.map((route) => route.pattern))].sort(),
    PATTERNS,
    'apps/web/src/app and server/routes.ts list different routes',
  );
  for (const route of files) {
    for (const entry of listRoutes().filter((candidate) => candidate.pattern === route.pattern)) {
      assert.equal(entry.kind, route.kind, `${path.relative(SRC, route.file)} is a ${route.kind}`);
    }
  }
});

test('no route file sits where a retired route was', () => {
  const retired = routeResolver([], RETIRED_PATTERNS);
  for (const route of routeFiles()) {
    assert.notEqual(
      retired('owner', instantiate(route.pattern)).status,
      'absent',
      `${path.relative(SRC, route.file)} is at a route #1 retired`,
    );
  }
});

/** Exports Next reads as configuration, and an image route's metadata. */
const CONFIG_EXPORTS = new Set([
  'dynamic',
  'dynamicParams',
  'revalidate',
  'fetchCache',
  'runtime',
  'preferredRegion',
  'maxDuration',
  'alt',
  'size',
  'contentType',
]);

/** Static metadata a page may export, as an object literal. */
const STATIC_EXPORTS = new Set(['metadata', 'viewport']);

/** Whether `node` is `guard('<pattern>', handler)`. */
function isGuard(node: ts.Expression | undefined, guard: string, pattern: string): boolean {
  if (!node || !ts.isCallExpression(node)) return false;
  const [first] = node.arguments;
  return (
    ts.isIdentifier(node.expression) &&
    node.expression.text === guard &&
    node.arguments.length === 2 &&
    first !== undefined &&
    ts.isStringLiteral(first) &&
    first.text === pattern
  );
}

/** What is wrong with how `route` exports what Next serves; nothing when every export is guarded. */
function guardProblems(route: RouteFile, text?: string): string[] {
  const source = parse(route.file, text);
  const handlers = route.kind === 'handler';
  const [guard, from] = handlers
    ? ['served', '~/server/route-guard']
    : ['servedPage', '~/server/page-guard'];
  const wrapped = handlers
    ? `export const <METHOD> = served('${route.pattern}', handler)`
    : `export default servedPage('${route.pattern}', render)`;
  const problems: string[] = [];

  const imported = source.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      return false;
    }
    const bindings = statement.importClause?.namedBindings;
    return (
      statement.moduleSpecifier.text === from &&
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((item) => item.name.text === guard && !item.propertyName)
    );
  });
  if (!imported) problems.push(`import { ${guard} } from '${from}'`);

  let guarded = 0;
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement)) {
      if (!handlers && isGuard(statement.expression, guard, route.pattern)) guarded++;
      else problems.push(`the default export must be ${wrapped}`);
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      if (!statement.isTypeOnly) problems.push(`no export lists: ${wrapped}`);
      continue;
    }
    if (!isExported(statement)) continue;
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) continue;
    if (!ts.isVariableStatement(statement)) {
      const name = (statement as ts.DeclarationStatement).name;
      problems.push(`${name && ts.isIdentifier(name) ? name.text : 'default'}: ${wrapped}`);
      continue;
    }
    const constant = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    for (const declaration of statement.declarationList.declarations) {
      const name = ts.isIdentifier(declaration.name) ? declaration.name.text : '(pattern)';
      if (handlers && METHODS.includes(name)) {
        if (constant && isGuard(declaration.initializer, guard, route.pattern)) guarded++;
        else problems.push(`${name}: ${wrapped}`);
      } else if (STATIC_EXPORTS.has(name)) {
        const value = declaration.initializer;
        if (!value || !ts.isObjectLiteralExpression(value)) {
          problems.push(`${name} must be an object literal`);
        }
      } else if (!CONFIG_EXPORTS.has(name)) {
        problems.push(`unexpected export ${name}: Next serves only what ${guard}() wraps`);
      }
    }
  }
  if (guarded === 0) problems.push(wrapped);
  return problems;
}

test('every route file exports only what its guard wraps, with its own pattern', () => {
  for (const route of routeFiles()) {
    assert.deepEqual(guardProblems(route), [], path.relative(SRC, route.file));
  }
});

test('the guard check refuses a skipped guard, a bare method, and a second unguarded one', () => {
  const check = (text: string, kind: RouteKind = 'handler') =>
    guardProblems({ kind, pattern: '/feed.xml', file: 'probe.ts' }, text);
  const handler = "import { served } from '~/server/route-guard';\n";
  assert.deepEqual(check(`${handler}export const GET = served('/feed.xml', feed);\n`), []);
  const refused = [
    `${handler}// served('/feed.xml')\nexport async function GET() { return feed(); }\n`,
    `${handler}export const GET = served('/feed.xml', feed);\nexport async function POST() {}\n`,
    `${handler}export const GET = served('/api/health', feed);\n`,
    `${handler}export let GET = served('/feed.xml', feed);\n`,
    `${handler}const GET = served('/feed.xml', feed);\nexport { GET };\n`,
    `${handler}export const GET = feed;\n`,
    "import { served as guard } from '~/server/route-guard';\nexport const GET = guard('/feed.xml', feed);\n",
  ];
  for (const text of refused) assert.notDeepEqual(check(text), [], text);

  const page = "import { servedPage } from '~/server/page-guard';\n";
  assert.deepEqual(check(`${page}export default servedPage('/feed.xml', render);\n`, 'page'), []);
  assert.deepEqual(
    check(
      `${page}export const metadata = { title: 'x' };\nexport default servedPage('/feed.xml', render);\n`,
      'page',
    ),
    [],
  );
  for (const text of [
    `${page}export default async function Page() {}\n`,
    `${page}export default servedPage('/feed.xml', render);\nexport async function generateMetadata() {}\n`,
    `${page}export default servedPage('/feed.xml', render);\nexport const metadata = load();\n`,
    `${page}export default render;\n`,
  ]) {
    assert.notDeepEqual(check(text, 'page'), [], text);
  }
});

/** The guard each profile's Studio pages call (#2), from studio-guard.ts. */
const STUDIO_GUARDS: Readonly<Partial<Record<Profile, string>>> = {
  owner: 'requireOwnerPage',
  demo: 'requireDemoPage',
};
/** The guards that return a promise, which must be awaited before anything renders. */
const AWAITED_GUARDS = new Set(['requireOwnerPage']);
const STUDIO_GUARD_MODULE = '~/server/studio-guard';
/** The one Studio page that needs no guard: where a page without a session goes. */
const SIGN_IN = '/studio/sign-in';
/** Studio's route group, every file of which this checks. */
const STUDIO_GROUP = path.join(APP, '(studio)');

const isStudioPage = (pattern: string) => /^\/studio(?:\/|$)/.test(pattern);

type FunctionNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

const isFunctionNode = (node: ts.Node): node is FunctionNode =>
  ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);

/** The function `name` refers to at the top of `source`: a declaration, or a const set to one. */
function functionNamed(source: ts.SourceFile, name: string): FunctionNode | undefined {
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      const value = declaration.initializer;
      if (value && isFunctionNode(value)) return value;
    }
  }
  return undefined;
}

/** A function given inline or by name. */
function functionOf(
  source: ts.SourceFile,
  node: ts.Expression | undefined,
): FunctionNode | undefined {
  if (!node) return undefined;
  if (isFunctionNode(node)) return node;
  return ts.isIdentifier(node) ? functionNamed(source, node.text) : undefined;
}

/** What a page's or a metadata route's default export renders with: servedPage(pattern, render). */
function servedRender(source: ts.SourceFile): FunctionNode | undefined {
  for (const statement of source.statements) {
    if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;
    const call = statement.expression;
    return ts.isCallExpression(call) ? functionOf(source, call.arguments[1]) : undefined;
  }
  return undefined;
}

/** The function a module exports under `name`, by a declaration or a const. */
function exportedFunction(source: ts.SourceFile, name: string): FunctionNode | undefined {
  const named = functionNamed(source, name);
  if (!named) return undefined;
  const statement = ts.isFunctionDeclaration(named) ? named : named.parent?.parent?.parent;
  return statement && isExported(statement) ? named : undefined;
}

/** Each method a route handler exports, `export const GET = served(pattern, answer)`, with its answer. */
function handlerFunctions(source: ts.SourceFile): [method: string, fn: FunctionNode | undefined][] {
  const found: [string, FunctionNode | undefined][] = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !isExported(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !METHODS.includes(declaration.name.text)) continue;
      const call = declaration.initializer;
      const answer = call && ts.isCallExpression(call) ? call.arguments[1] : undefined;
      found.push([declaration.name.text, functionOf(source, answer)]);
    }
  }
  return found;
}

/** The function a layout's or a boundary's default export is: a declaration, or a name for one. */
function defaultFunction(source: ts.SourceFile): FunctionNode | undefined {
  for (const statement of source.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
    ) {
      return statement;
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      return functionOf(source, statement.expression);
    }
  }
  return undefined;
}

/** Each node under `node`, in source order, without going into a nested function. */
function* inline(node: ts.Node): Generator<ts.Node> {
  for (const child of node.getChildren()) {
    yield child;
    if (!isFunctionNode(child)) yield* inline(child);
  }
}

/** `guard('capability')`, when `node` calls a guard by its own name with one string. */
function guardCall(node: ts.Node): string | null {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return null;
  if (!Object.values(STUDIO_GUARDS).includes(node.expression.text)) return null;
  const [first] = node.arguments;
  if (node.arguments.length !== 1 || !first || !ts.isStringLiteral(first)) return null;
  return `${node.expression.text}('${first.text}')`;
}

/**
 * What `fn` lacks to be guarded: its first statement calls each guard in
 * `calls`, awaiting the ones that return a promise, and awaits nothing else,
 * so nothing renders, reads, or answers before the guard has decided.
 */
function guardedFirstProblems(
  fn: FunctionNode | undefined,
  calls: readonly string[],
  what: string,
) {
  if (!fn) return [`${what}: no function to check`];
  const body = fn.body;
  if (!body || !ts.isBlock(body) || body.statements.length === 0) {
    return [`${what}: no statements, so no guard first`];
  }
  const [first] = body.statements;
  const made = new Map<string, boolean>();
  let awaitsElse = false;
  for (const node of inline(first!)) {
    const call = guardCall(node);
    if (call) made.set(call, made.get(call) || ts.isAwaitExpression(node.parent));
    if (ts.isAwaitExpression(node) && !guardCall(node.expression)) awaitsElse = true;
  }
  const problems: string[] = [];
  for (const call of calls) {
    if (!made.has(call)) problems.push(`${what}: its first statement doesn't call ${call}`);
    else if (AWAITED_GUARDS.has(call.slice(0, call.indexOf('('))) && !made.get(call)) {
      problems.push(`${what}: ${call} isn't awaited`);
    }
  }
  if (awaitsElse) problems.push(`${what}: awaits something else in its first statement`);
  return problems;
}

/**
 * What `route`, a Studio page, route handler, or metadata route, lacks: for
 * each profile its entries serve, its guard, imported by name from
 * studio-guard.ts, called on the capability the entry serves there as the
 * first statement of what it renders or answers with, and of its
 * generateMetadata and the like. read-only serves no Studio route at all.
 */
function studioGuardProblems(
  route: RouteFile,
  entries: readonly RouteEntry[],
  text?: string,
): string[] {
  const source = parse(route.file, text);
  const imported = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (statement.moduleSpecifier.text !== STUDIO_GUARD_MODULE) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const item of bindings.elements) if (!item.propertyName) imported.add(item.name.text);
  }
  const problems = new Set<string>();
  const calls: string[] = [];
  for (const entry of entries) {
    for (const profile of PROFILES) {
      if (routeAccess(profile, entry) === 'absent') continue;
      const guard = STUDIO_GUARDS[profile];
      if (!guard) {
        problems.add(`${profile} serves no Studio page`);
        continue;
      }
      if (!imported.has(guard)) problems.add(`import { ${guard} } from '${STUDIO_GUARD_MODULE}'`);
      calls.push(`${guard}('${entry.capability}')`);
    }
  }
  const unique = [...new Set(calls)];
  // What answers: a page's or metadata route's render, or each handler method.
  const answering: [what: string, fn: FunctionNode | undefined][] =
    route.kind === 'handler'
      ? handlerFunctions(source)
      : [['the default export', servedRender(source)]];
  for (const name of [
    'generateMetadata',
    'generateViewport',
    'generateImageMetadata',
    'generateSitemaps',
  ]) {
    const fn = exportedFunction(source, name);
    if (fn) answering.push([name, fn]);
  }
  for (const [what, fn] of answering) {
    for (const problem of guardedFirstProblems(fn, unique, what)) problems.add(problem);
  }
  return [...problems];
}

/** Every module Next loads as part of a segment under app/(studio), but its private folders. */
function studioGroupFiles(dir = STUDIO_GROUP): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...studioGroupFiles(file));
    else if (PAGE_FILE.test(entry.name)) found.push(file);
  }
  return found;
}

/** The files around Studio's pages: their layouts, templates, and boundaries. */
const SEGMENT_FILE =
  /^(layout|template|not-found|error|global-error|loading|default|forbidden|unauthorized)\.(tsx|ts|jsx|js)$/;

/** Each node under `node`, nested functions included. */
function* everyNode(node: ts.Node): Generator<ts.Node> {
  for (const child of node.getChildren()) {
    yield child;
    yield* everyNode(child);
  }
}

/** Whether a module's first statement is the 'use client' directive. */
function isClientModule(source: ts.SourceFile): boolean {
  const [first] = source.statements;
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use client'
  );
}

/** The file a relative or `~/` specifier names from `file`, with its extension found, or null. */
function resolveImport(file: string, specifier: string): string | null {
  const base = specifier.startsWith('~/')
    ? path.join(SRC, specifier.slice(2))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(file), specifier)
      : null;
  if (base === null) return null;
  const candidates = [
    base,
    ...['.tsx', '.ts', '.jsx', '.js', '.mjs'].map((extension) => `${base}${extension}`),
    ...['index.tsx', 'index.ts', 'index.js'].map((name) => path.join(base, name)),
  ];
  return (
    candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null
  );
}

/**
 * Every module `source` loads at run time, by its specifier: imports and
 * re-exports that aren't type-only, import() and require(). A dynamic one
 * whose specifier isn't a string comes back as null.
 */
function runtimeImports(source: ts.SourceFile): (string | null)[] {
  const found: (string | null)[] = [];
  const named = (node: ts.Expression | undefined) =>
    node && ts.isStringLiteralLike(node) ? node.text : null;
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const typeOnly =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (clause.name === undefined &&
            clause.namedBindings !== undefined &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.every((element) => element.isTypeOnly)));
      if (!typeOnly) found.push(named(statement.moduleSpecifier));
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      if (!statement.isTypeOnly) found.push(named(statement.moduleSpecifier));
    } else if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference)
    ) {
      found.push(named(statement.moduleReference.expression));
    }
  }
  for (const node of everyNode(source)) {
    if (!ts.isCallExpression(node)) continue;
    const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const required = ts.isIdentifier(node.expression) && node.expression.text === 'require';
    if (dynamic || required) found.push(named(node.arguments[0]));
  }
  return found;
}

/**
 * What a layout, template, or boundary under the Studio group does that it
 * mustn't. A layout doesn't run again on client navigation, and the sign-in
 * page sits under the same ones, so none of them can be the guard: Studio's
 * data comes through pages, after their guard. And what they render goes
 * out with a page's redirect to sign-in too, in its body and its RSC
 * payload. So one rendered on the server is markup only: nothing in it is
 * async or awaits, it exports no metadata made from data, and it imports
 * only CSS, types, react, next/*, and modules that start with 'use client',
 * which render no server component of their own.
 *
 * It's a lint against an accident, not a bar to a deliberate bypass: a
 * synchronous read through process.getBuiltinModule() gets past it. What
 * holds either way is owner.spec's scan of every Studio page's redirect,
 * with no cookie and with one that names no session, for state of any kind.
 */
function studioSegmentProblems(file: string, text?: string): string[] {
  const source = parse(file, text);
  const problems: string[] = [];
  if (!defaultFunction(source)) problems.push('no default export function to check');
  if (!isClientModule(source)) {
    const nodes = [...everyNode(source)];
    if (
      nodes.some(
        (node) =>
          ts.canHaveModifiers(node) &&
          (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword),
      )
    ) {
      problems.push('it has an async function');
    }
    if (
      nodes.some(
        (node) => ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier),
      )
    ) {
      problems.push('it awaits');
    }
  }
  for (const name of ['generateMetadata', 'generateViewport']) {
    if (exportedNames(source).includes(name)) problems.push(`it exports ${name}`);
  }
  for (const specifier of runtimeImports(source)) {
    if (specifier === null) {
      problems.push('it imports a module it names only at run time');
      continue;
    }
    if (specifier.endsWith('.css')) continue;
    if (specifier === 'react' || specifier === 'next' || specifier.startsWith('next/')) continue;
    const target = resolveImport(file, specifier);
    if (target !== null && isClientModule(parse(target))) continue;
    problems.push(
      `it imports ${specifier}, which is neither CSS, types, react, next/*, nor 'use client'`,
    );
  }
  return problems;
}

test("every Studio page but /studio/sign-in, and every Studio route handler, metadata route, and generateMetadata, calls its profile's guard first", () => {
  let checked = 0;
  for (const route of routeFiles()) {
    const inGroup = !path.relative(STUDIO_GROUP, route.file).startsWith('..');
    if (!inGroup && !isStudioPage(route.pattern)) continue;
    if (route.pattern === SIGN_IN) continue;
    const entries = listRoutes().filter((entry) => entry.pattern === route.pattern);
    assert.ok(entries.length > 0, `${path.relative(SRC, route.file)} has no route table entry`);
    assert.deepEqual(studioGuardProblems(route, entries), [], path.relative(SRC, route.file));
    checked++;
  }
  assert.ok(checked > 0, 'the /studio placeholder, at least');
});

test("Studio's layouts, templates, and boundaries render markup only: nothing async or awaited, no metadata, and no import but CSS, types, react, next/*, and 'use client' modules", () => {
  const files = studioGroupFiles().filter((file) => SEGMENT_FILE.test(path.basename(file)));
  assert.ok(
    files.some((file) => path.basename(file).startsWith('layout.')),
    "Studio's layout",
  );
  for (const file of files) {
    assert.deepEqual(studioSegmentProblems(file), [], path.relative(SRC, file));
  }
  // Every file in the group is a route file, one of these, or in a private folder.
  const routes = new Set(routeFiles().map((route) => route.file));
  for (const file of studioGroupFiles()) {
    assert.ok(
      routes.has(file) || SEGMENT_FILE.test(path.basename(file)),
      `${path.relative(SRC, file)} is neither a route file nor a segment file`,
    );
  }
  // What the check refuses.
  const probe = path.join(STUDIO_GROUP, 'probe', 'layout.tsx');
  assert.deepEqual(
    studioSegmentProblems(
      probe,
      'export default function Layout({ children }) {\n  return children;\n}\n',
    ),
    [],
  );
  for (const text of [
    'export default async function Layout({ children }) {\n  return children;\n}\n',
    'export default function Layout({ children }) {\n  const data = await load();\n  return children;\n}\n',
    'async function Layout() {}\nexport default Layout;\n',
    'export default function Layout() {}\nexport async function generateMetadata() {}\n',
    'export default load;\n',
    // An async component of its own, rendered from a plain layout.
    'async function Draft() {\n  return null;\n}\nexport default function Layout({ children }) {\n  return children;\n}\n',
  ]) {
    assert.notDeepEqual(studioSegmentProblems(probe, text), [], text);
  }
  // What it may import, from where Studio's own layout sits: CSS, types,
  // react, next/*, and a module that starts with 'use client'.
  const layout = path.join(STUDIO_GROUP, 'layout.tsx');
  const rendering = (imports: string) =>
    `${imports}\nexport default function Layout({ children }) {\n  return children;\n}\n`;
  for (const imports of [
    "import './studio.css';",
    "import type { ReactNode } from 'react';",
    "import { type Metadata } from 'next';",
    "import { Fragment } from 'react';",
    "import Link from 'next/link';",
    "import { SignInForm as Shown } from './_components/sign-in-form';",
    "import { type Site } from '~/server/config-store';",
  ]) {
    assert.deepEqual(studioSegmentProblems(layout, rendering(imports)), [], imports);
  }
  // A server component, or any module that isn't a client one, is refused:
  // what it renders would go out with a redirect to sign-in.
  for (const imports of [
    "import { NotFoundBody as Shown } from '../_chrome/not-found-body';",
    "import { getDeploymentState } from '~/server/config-store';",
    "import { type Site, getDeploymentState } from '~/server/config-store';",
    "export { getDeploymentState } from '~/server/config-store';",
    "import Shown from './_components/no-such-file';",
    "import { load } from 'some-package';",
    "const { load } = require('~/server/config-store');",
  ]) {
    assert.notDeepEqual(studioSegmentProblems(layout, rendering(imports)), [], imports);
  }
  for (const loader of [
    "const Shown = (await import('../_chrome/not-found-body')).NotFoundBody;",
    "const Shown = import(['..', '_chrome', 'not-found-body'].join('/'));",
  ]) {
    assert.notDeepEqual(studioSegmentProblems(layout, rendering(loader)), [], loader);
  }
});

test('the Studio guard check refuses a missing guard, another capability, a guard from elsewhere, a profile left out, and anything that runs first', () => {
  const route: RouteFile = { kind: 'page', pattern: '/studio/preview', file: 'probe.tsx' };
  const entry = (capability: RouteEntry['capability']): RouteEntry => ({
    pattern: '/studio/preview',
    kind: 'page',
    capability,
  });
  const owner = [entry('studio.view')];
  const both = [entry('studio.view'), entry('sandbox.view')];
  const from = (names: string) => `import { ${names} } from '~/server/studio-guard';\n`;
  const served = "export default servedPage('/studio/preview', Page);\n";
  const page = (body: string, names = 'requireOwnerPage') =>
    `${from(names)}async function Page() {\n${body}}\n${served}`;
  const guarded = page(
    "  const { csrfToken } = await requireOwnerPage('studio.view');\n  return csrfToken;\n",
  );
  assert.deepEqual(studioGuardProblems(route, owner, guarded), []);
  assert.deepEqual(
    studioGuardProblems(route, owner, page("  await requireOwnerPage('studio.view');\n")),
    [],
  );
  for (const text of [
    `async function Page() {}\n${served}`,
    page(''),
    page("  await requireOwnerPage('draft.read');\n"),
    "import { requireOwnerPage } from './guard';\nasync function Page() {\n  await requireOwnerPage('studio.view');\n}\n" +
      served,
    `${from('requireOwnerPage as guard')}async function Page() {\n  await guard('studio.view');\n}\n${served}`,
    // Not first, not awaited, or after something else awaited.
    page("  const draft = await readDraft();\n  await requireOwnerPage('studio.view');\n"),
    page("  requireOwnerPage('studio.view');\n"),
    page("  const [draft] = await Promise.all([readDraft(), requireOwnerPage('studio.view')]);\n"),
    page("  log('in');\n  await requireOwnerPage('studio.view');\n"),
    // In a function the page doesn't render with.
    `${from('requireOwnerPage')}async function Other() {\n  await requireOwnerPage('studio.view');\n}\nasync function Page() {}\n${served}`,
    // generateMetadata, which renders before the page decides, unguarded.
    `${guarded}export async function generateMetadata() {\n  return { title: await readTitle() };\n}\n`,
  ]) {
    assert.notDeepEqual(studioGuardProblems(route, owner, text), [], text);
  }
  assert.deepEqual(
    studioGuardProblems(
      route,
      owner,
      `${guarded}export async function generateMetadata() {\n  await requireOwnerPage('studio.view');\n  return { title: 'x' };\n}\n`,
    ),
    [],
  );
  // A page both profiles serve at one path calls each one's guard, first.
  const shared = page(
    "  if (owner) await requireOwnerPage('studio.view');\n  else requireDemoPage('sandbox.view');\n",
    'requireDemoPage, requireOwnerPage',
  );
  assert.deepEqual(studioGuardProblems(route, both, shared), []);
  assert.deepEqual(studioGuardProblems(route, both, guarded), [
    "import { requireDemoPage } from '~/server/studio-guard'",
    "the default export: its first statement doesn't call requireDemoPage('sandbox.view')",
  ]);
  // read-only serves no Studio page, so an entry it would serve is refused.
  assert.deepEqual(
    studioGuardProblems(route, [entry('catalog.read')], shared).at(0),
    'read-only serves no Studio page',
  );
  // A route handler: each method it exports, guarded first.
  const handler: RouteFile = { kind: 'handler', pattern: '/studio/preview', file: 'probe.ts' };
  const answer = (body: string) =>
    `${from('requireOwnerPage')}async function answer() {\n${body}}\nexport const GET = served('/studio/preview', answer);\n`;
  assert.deepEqual(
    studioGuardProblems(handler, owner, answer("  await requireOwnerPage('studio.view');\n")),
    [],
  );
  assert.notDeepEqual(studioGuardProblems(handler, owner, answer('  return draft();\n')), []);
});

/** Stores a deployment of `profile` for the test, as register() would. */
function deploy(t: TestContext, profile: Profile) {
  setDeploymentState({
    config: { profile } as DeploymentConfig,
    catalog: { getLive: () => assert.fail('an unserved route reads no catalog') },
    dispatch: () => assert.fail('an unserved route runs no operation'),
    degraded: [],
  });
  t.after(() => setDeploymentState(undefined));
}

test("every method a route handler exports is 404 in each profile that doesn't serve it", async (t) => {
  let checked = 0;
  for (const route of routeFiles().filter((file) => file.kind === 'handler')) {
    const exports = (await import(pathToFileURL(route.file).href)) as Record<string, unknown>;
    const methods = METHODS.filter((method) => method in exports);
    assert.ok(methods.length > 0, route.file);
    for (const method of methods) {
      assert.equal(servedPattern(exports[method]), route.pattern, `${route.pattern} ${method}`);
    }
    for (const profile of PROFILES.filter((name) => !serves(name, route.pattern as RoutePattern))) {
      await t.test(`${profile} ${route.pattern}`, async (t) => {
        deploy(t, profile);
        for (const method of methods) {
          const run = exports[method] as (request: Request, context: unknown) => Promise<Response>;
          const url = `https://rowan.test${instantiate(route.pattern)}`;
          const response = await run(new Request(url, { method }), { params: Promise.resolve({}) });
          assert.equal(response.status, 404, method);
          assert.equal(response.headers.get('cache-control'), 'no-store');
          checked++;
        }
      });
    }
  }
  // The feed, which demo doesn't serve, at least.
  assert.ok(checked > 0);
});

/** Whether `statements` open with the 'use server' directive. */
function opensWithUseServer(statements: readonly ts.Statement[]): boolean {
  for (const statement of statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) {
      return false;
    }
    if (statement.expression.text === 'use server') return true;
  }
  return false;
}

/** Whether the file, or any function in it, is a Server Function by directive. */
function usesServer(file: string, text?: string): boolean {
  const source = parse(file, text);
  let found = opensWithUseServer(source.statements);
  const visit = (node: ts.Node): void => {
    if (found) return;
    const body = ts.isFunctionLike(node) ? (node as ts.FunctionLikeDeclaration).body : undefined;
    if (body && ts.isBlock(body) && opensWithUseServer(body.statements)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test('no module in apps/web/src or packages/*/src declares a Server Function', () => {
  const roots = [SRC, ...readdirSync(PACKAGES).map((name) => path.join(PACKAGES, name, 'src'))];
  const offenders = roots
    .flatMap((root) => (existsSync(root) ? sources(root) : []))
    .filter((file) => usesServer(file));
  assert.deepEqual(
    offenders,
    [],
    'Server Functions bypass the dispatcher; add an operation instead',
  );
});

test("the 'use server' check finds the directive however it is written", () => {
  const found = [
    "'use server';\nexport async function save() {}\n",
    '"use server"\nexport async function save() {}\n',
    "/* why */ 'use server';\nexport async function save() {}\n",
    "'use strict';\n'use server';\n",
    "export async function save() {\n  // a note\n  'use server';\n}\n",
    "export const save = async () => { /* x */ 'use server'; };\n",
    "class Store { async save() { 'use server'; } }\n",
  ];
  for (const text of found) assert.equal(usesServer('probe.ts', text), true, text);
  const not = [
    "const label = 'use server';\n",
    "export function f() { return 1; 'use server'; }\n",
    '// use server\n',
  ];
  for (const text of not) assert.equal(usesServer('probe.ts', text), false, text);
});

/** The table with the dev fixture route as `next dev` has it (#7, Slice 1, item 8). */
const DEV_ROUTE = devPreviewRoute(true);
const UNDER_NEXT_DEV: readonly RouteEntry[] = [
  ...listRoutes().filter(({ pattern }) => pattern !== DEV_ROUTE.pattern),
  DEV_ROUTE,
];

test('every entry names a known capability, profiles, and kind, and serves some profile', () => {
  // Off, as outside `next dev`, the dev fixture route serves none on purpose.
  for (const entry of UNDER_NEXT_DEV) {
    assert.ok(
      entry.capability === 'operations' || CAPABILITIES.includes(entry.capability),
      entry.pattern,
    );
    for (const profile of entry.profiles ?? [])
      assert.ok(PROFILES.includes(profile), entry.pattern);
    assert.ok(['page', 'handler', 'metadata'].includes(entry.kind), entry.pattern);
    if (entry.nav !== undefined) {
      assert.equal(entry.kind, 'page', `${entry.pattern}: only pages are navigation`);
      assert.ok(!entry.pattern.includes('['), `${entry.pattern}: navigation needs a static path`);
    }
    // A test fixture's route serves no profile of a build made without its
    // flag, and every profile of one made with it (#19, Slice 3).
    const fixtures: Readonly<Record<string, { readonly key: string }>> = FIXTURE_CAPABILITIES;
    const fixture = entry.capability === 'operations' ? undefined : fixtures[entry.capability];
    assert.ok(
      PROFILES.some((profile) => routeAccess(profile, entry) !== 'absent') ||
        (fixture !== undefined && !builtWithFixtures(fixture.key)),
      `${entry.pattern}: an entry no profile serves`,
    );
  }
});

test('the dev fixture route serves a registered variant, a contract fixture, and the environment its query names under next dev alone, and is absent in every profile of a production build (#7, Slice 1, item 8)', () => {
  // Next writes NODE_ENV in as it compiles, and this process isn't next dev.
  assert.equal(PREVIEW_DEV, process.env.NODE_ENV === 'development');
  const off = routeResolver(
    [...UNDER_NEXT_DEV.filter((entry) => entry !== DEV_ROUTE), devPreviewRoute(false)],
    RETIRED_PATTERNS,
  );
  const on = routeResolver(UNDER_NEXT_DEV, RETIRED_PATTERNS);
  const fixture = '/preview/dev/fallback/complete';
  const environment = new URLSearchParams('displayMode=dark&contrast=more&motion=reduce');
  for (const profile of PROFILES) {
    assert.equal(off(profile, fixture).status, 'absent', profile);
    assert.equal(off(profile, fixture, environment).status, 'absent', profile);
    assert.equal(on(profile, fixture).status, 'served', profile);
    assert.equal(on(profile, fixture, environment).status, 'served', profile);
    assert.equal(on(profile, '/preview/dev/fallback/hidden-canary').status, 'served', profile);
    // A variant, fixture, or environment value that names nothing is missing, on or off.
    for (const [pathname, query] of [
      ['/preview/dev/no-such-variant/complete', ''],
      ['/preview/dev/fallback/no-such-fixture', ''],
      ['/preview/dev/fallback/complete', 'motion=fast'],
      ['/preview/dev/fallback/complete', 'displayMode=dark&displayMode=light'],
      ['/preview/dev/fallback', ''],
      ['/preview/dev/fallback/complete/about', ''],
    ] as const) {
      const what = `${profile} ${pathname}?${query}`;
      assert.equal(on(profile, pathname, new URLSearchParams(query)).status, 'missing', what);
      assert.equal(off(profile, pathname, new URLSearchParams(query)).status, 'missing', what);
    }
  }
});

test('no visitor route sits under /preview, since the outage 503 carries none of the preview headers (#7)', () => {
  // proxy.ts answers a visitor route with its static 503 while the catalog
  // can't serve, and that answer has only the baseline headers.
  for (const entry of UNDER_NEXT_DEV) {
    if (/^\/preview(?:-assets)?(?:\/|$)/i.test(entry.pattern)) {
      assert.ok(!entry.visitor, `${entry.pattern} is a visitor route`);
    }
  }
});

test('at most one entry serves each pattern in each profile', () => {
  for (const profile of PROFILES) {
    const seen = new Set<string>();
    for (const entry of listRoutes()) {
      if (routeAccess(profile, entry) === 'absent') continue;
      assert.ok(!seen.has(entry.pattern), `${profile} has two entries for ${entry.pattern}`);
      seen.add(entry.pattern);
    }
  }
});

test('the Studio transport is served in every profile', () => {
  for (const profile of PROFILES) assert.equal(serves(profile, '/api/studio/[name]'), true);
});

test("what every profile serves, with #2's Studio pages under owner alone", () => {
  const served = (profile: Profile) =>
    PATTERNS.filter((pattern) => serves(profile, pattern as RoutePattern));
  const everywhere = [
    '/',
    '/api/health',
    '/api/ready',
    '/api/studio/[name]',
    '/opengraph-image-12o0cb',
    '/robots.txt',
    '/sitemap.xml',
    // The appearance fixtures, in a build made with APPEARANCE_FIXTURES=1 (#19, Slice 3).
    ...(builtWithFixtures('appearance') ? ['/_fixtures/appearance'] : []),
  ];
  // The site's own routes (#5, Slice 4): a variant's path views, and work.
  const site = ['/[...view]', '/feed.xml', '/work/[slug]', '/work/[slug]/[...view]'];
  // A preview grant's frame and its draft-only assets (#7, Slice 2): owner alone mints grants.
  const grants = ['/preview/[grant]/[[...route]]', '/preview-assets/[grant]/[...path]'];
  assert.deepEqual(
    served('owner'),
    [...everywhere, ...site, '/studio', '/studio/sign-in', ...grants].sort(),
  );
  assert.deepEqual(served('read-only'), [...everywhere, ...site].sort());
  // The bundled sample, and every route under it.
  assert.deepEqual(served('demo'), [...everywhere, '/sample/[[...path]]'].sort());
});

test('each table route resolves the way its capability says, in every profile', () => {
  for (const profile of PROFILES) {
    for (const entry of listRoutes()) {
      const pathname = instantiate(entry.pattern);
      // No installed variant declares a view at /probe, and no slug names a work until #10.
      const expected =
        entry.kind === 'page' && pathname.includes('probe')
          ? 'missing'
          : routeAccess(profile, entry) === 'absent'
            ? 'absent'
            : 'served';
      assert.equal(resolveRoute(profile, pathname).status, expected, `${profile} ${entry.pattern}`);
    }
  }
});

test('a table route no profile of this build serves is absent there and unknown, in every profile (#19, Slice 3)', () => {
  const table: RouteEntry[] = [
    { pattern: '/unbuilt', kind: 'page', capability: 'catalog.read', profiles: [] },
    { pattern: '/studio', kind: 'page', capability: 'studio.view' },
  ];
  const resolve = routeResolver(table, ['/retired']);
  for (const profile of PROFILES) {
    // proxy.ts answers it as a path no route matches.
    assert.deepEqual(resolve(profile, '/unbuilt'), { status: 'absent', unknown: true }, profile);
    assert.deepEqual(resolve(profile, '/%75nbuilt'), { status: 'absent', unknown: true }, profile);
    // A retired route is absent, with the plain 404 it always had.
    assert.deepEqual(resolve(profile, '/retired'), { status: 'absent' }, profile);
  }
  // A route another profile serves is only absent.
  assert.deepEqual(resolve('demo', '/studio'), { status: 'absent' });
  // The appearance fixtures: served everywhere in a build made with
  // APPEARANCE_FIXTURES=1, and unknown everywhere in any other.
  const built = builtWithFixtures('appearance');
  for (const profile of PROFILES) {
    const decision = resolveRoute(profile, '/_fixtures/appearance');
    assert.deepEqual(
      decision.status === 'served' ? [decision.entry.pattern, decision.access] : decision,
      built ? ['/_fixtures/appearance', 'public'] : { status: 'absent', unknown: true },
      profile,
    );
  }
});

test('retired routes are absent everywhere, and only those exact paths', () => {
  for (const profile of PROFILES) {
    for (const pattern of RETIRED_PATTERNS) {
      assert.equal(resolveRoute(profile, instantiate(pattern)).status, 'absent', pattern);
      assert.equal(resolveRoute(profile, `${instantiate(pattern)}/`).status, 'absent', pattern);
    }
    // A path below one names nothing, and the app's 404 page answers it.
    assert.equal(
      resolveRoute(profile, '/variants/kinetic-cosmos/aurora-dark-geometric.png').status,
      'missing',
    );
    assert.equal(resolveRoute(profile, '/%61dmin').status, 'absent', 'an encoded retired path');
    assert.equal(resolveRoute(profile, '/admin/nested').status, 'missing');
  }
});

test("Next's build assets and paths that don't decode are Next's; anything else unlisted is missing", () => {
  for (const profile of PROFILES) {
    assert.equal(resolveRoute(profile, '/_next/static/chunks/main.js').status, 'unlisted');
    assert.equal(resolveRoute(profile, '/%E0%A4%A').status, 'unlisted');
    assert.equal(resolveRoute(profile, '/api/studio').status, 'missing');
  }
});

/** The pattern of the entry `profile` serves `pathname` through, or its status. */
function entryFor(profile: Profile, pathname: string): string {
  const decision = resolveRoute(profile, pathname);
  return decision.status === 'served' ? decision.entry.pattern : decision.status;
}

test('a path that spells a fixed segment percent-encoded is told apart from the route it decodes to (#5, Slice 4)', () => {
  // The table reads each one decoded, so it matches the route all the same,
  // but Next matches a fixed segment as sent, and proxy.ts answers these as
  // paths no route matches.
  assert.equal(entryFor('owner', '/%66eed.xml'), '/feed.xml');
  assert.equal(entryFor('read-only', '/api/%68ealth'), '/api/health');
  for (const [pattern, pathname] of [
    ['/feed.xml', '/%66eed.xml'],
    ['/robots.txt', '/robots.tx%74'],
    ['/opengraph-image-12o0cb', '/opengraph-image-12o0c%62'],
    ['/api/health', '/%61pi/health'],
    ['/api/health', '/api/%68ealth'],
    ['/studio/sign-in', '/studio/%73ign-in'],
    ['/studio/sign-in', '/%73tudio/sign-in'],
    ['/sample/[[...path]]', '/%73ample'],
    ['/api/studio/[name]', '/%61pi/studio/config.status'],
    ['/_fixtures/appearance', '/%5Ffixtures/appearance'],
    ['/_fixtures/appearance', '/_fixtures/%61ppearance'],
  ] as const) {
    assert.equal(encodesFixedSegment(pattern, pathname), true, pathname);
  }
  // As sent, or with only a dynamic segment encoded, which Next decodes for
  // the route, the path is the route's own.
  for (const [pattern, pathname] of [
    ['/', '/'],
    ['/feed.xml', '/feed.xml'],
    ['/api/studio/[name]', '/api/studio/%63onfig.status'],
    ['/sample/[[...path]]', '/sample/%61bout'],
    ['/[...view]', '/%63hapters/one'],
  ] as const) {
    assert.equal(encodesFixedSegment(pattern, pathname), false, pathname);
  }
});

test("a path that is a route file's own, as sent or decoded whole, names nothing to the table but is told apart (#5, Slice 4)", () => {
  // Read segment by segment, each one names nothing, but Next's file check
  // finds a route file for it before the afterFiles rewrite runs.
  for (const pathname of [
    '/studio%2Fsign-in',
    '/studio%2fsign-in',
    '/%73tudio%2Fsign-in',
    '/api%2Fhealth',
    '/api%2Fready',
    '/work/[slug]',
    '/work/%5Bslug%5D',
    '/work/[slug]/[...view]',
    '/[...view]',
    '/%5B...view%5D',
    '/sample/[[...path]]',
    '/_not-found',
    '/%5Fnot-found',
    '/_fixtures%2Fappearance',
    '/%5Ffixtures%2Fappearance',
  ]) {
    assert.equal(spellsRouteFile(pathname), true, pathname);
    for (const profile of PROFILES) {
      assert.equal(resolveRoute(profile, pathname).status, 'missing', `${profile} ${pathname}`);
    }
  }
  // Paths no route file has, and one that doesn't decode.
  for (const pathname of [
    '/no-such-page',
    '/work/x',
    '/work%2Fx',
    '/studio/sign-in/x',
    '/api/studio/[name]x',
    '/%E0%A4%A',
  ]) {
    assert.equal(spellsRouteFile(pathname), false, pathname);
  }
});

/** A test-only variant's registry entry, from tests/fixtures/variants/<name>. */
function fixture(name: string) {
  const read = (file: string) =>
    JSON.parse(readFileSync(new URL(`${name}/${file}`, FIXTURES), 'utf8'));
  const result = validateManifest(read('manifest.json'), {
    packageName: read('package.json').name,
  });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return { manifest: result.manifest };
}

/**
 * The route specs' build (#5, Slice 4): the fallback composition, which
 * declares no view; fixture-chapters, chapters/{chapter} under home and
 * credits under work; and fixture-notes, notes under home.
 */
const FIXTURE_BUILD: Installed = [
  { manifest: { id: 'fallback', routes: { views: [] } } },
  fixture('chapters'),
  fixture('notes'),
];
const fixtureRoutes = routeResolver(listRoutes(), RETIRED_PATTERNS, FIXTURE_BUILD);

/** The pattern of the entry `profile` serves `pathname` through on the fixture build, or its status. */
function fixtureEntry(profile: Profile, pathname: string): string {
  const [path, query = ''] = pathname.split('?');
  const decision = fixtureRoutes(profile, path!, new URLSearchParams(query));
  return decision.status === 'served' ? decision.entry.pattern : decision.status;
}

test('a root path names a view only when an installed variant declares it (#5, Slice 4)', () => {
  for (const profile of ['owner', 'read-only'] as const) {
    // Each renders or redirects, whichever variant the live site selects.
    for (const pathname of ['/chapters/one', `/chapters/${'a'.repeat(64)}`, '/notes']) {
      assert.equal(fixtureEntry(profile, pathname), '/[...view]', `${profile} ${pathname}`);
    }
    for (const pathname of [
      '/does-not-exist',
      '/chapters',
      '/chapters/one/two',
      '/chapters/Selected-Work',
      // Longer than a content id: no placeholder value.
      `/chapters/${'a'.repeat(65)}`,
      `/chapters/${'a'.repeat(8000)}`,
      '/credits',
      // A reserved first segment is never a view, and no route lists these.
      '/favicon.ico',
      '/api/nope',
      '/studio/nowhere',
      '/work',
      // No slug names a work until #10, its views included.
      '/work/tide-tables',
      '/work/tide-tables/credits',
    ]) {
      assert.equal(fixtureEntry(profile, pathname), 'missing', `${profile} ${pathname}`);
    }
    assert.equal(fixtureEntry(profile, '/sample'), 'absent');
    assert.equal(fixtureEntry(profile, '/sample/chapters/one'), 'absent');
    assert.equal(fixtureEntry(profile, '/sample/nowhere'), 'missing');
  }
  // Demo serves no view at the root: a declared one is absent there, and anything else missing.
  for (const pathname of ['/chapters/one', '/notes', '/feed.xml']) {
    assert.equal(fixtureEntry('demo', pathname), 'absent', pathname);
  }
  for (const pathname of ['/does-not-exist', '/chapters', '/work/tide-tables', '/favicon.ico']) {
    assert.equal(fixtureEntry('demo', pathname), 'missing', pathname);
  }
});

test('/sample serves what the page renders: a registered variant, at home or a declared view', () => {
  for (const pathname of [
    '/sample',
    '/sample?variant=fixture-chapters',
    '/sample/chapters/one?variant=fixture-chapters',
    // Declared by another variant, or under the site's own selection: the page redirects.
    '/sample/notes?variant=fixture-chapters',
    '/sample/chapters/one',
    '/sample?variant=fixture-notes&utm=x',
  ]) {
    assert.equal(fixtureEntry('demo', pathname), '/sample/[[...path]]', pathname);
  }
  for (const pathname of [
    '/sample?variant=fallback',
    '/sample?variant=canary-variant',
    '/sample?variant=',
    '/sample?variant=fixture-notes&variant=fixture-notes',
    '/sample/nowhere?variant=fixture-chapters',
    '/sample/chapters?variant=fixture-chapters',
    '/sample/work/tide-tables?variant=fixture-chapters',
    '/sample/api/ready',
  ]) {
    assert.equal(fixtureEntry('demo', pathname), 'missing', pathname);
  }
  // Under the other profiles a /sample path that names something is absent, as the entry is.
  assert.equal(fixtureEntry('owner', '/sample?variant=fixture-chapters'), 'absent');
  assert.equal(fixtureEntry('owner', '/sample?variant=canary-variant'), 'missing');
});

test('every top-level public/ entry is a name no view or route takes, so a file there is served', () => {
  // A view's first segment is a literal segment the contract doesn't reserve,
  // so it never meets a file named outside that grammar, such as me.jpg, or
  // one the contract reserves, such as favicon.ico. .gitkeep keeps the
  // directory in git.
  const owned = ownedFirstSegments();
  for (const entry of readdirSync(path.join(WEB, 'public'))) {
    if (entry === '.gitkeep') continue;
    assert.ok(
      isReservedSegment(entry) || !LITERAL_SEGMENT.test(entry),
      `a view could take public/${entry}: name it like a file, or reserve it`,
    );
    assert.ok(!owned.has(entry), `a route answers before public/${entry}`);
  }
  // Such a path is missing, so it reaches Next, which serves the file before
  // next.config.ts's rewrite sends anything else to the 404 page.
  for (const profile of PROFILES) {
    for (const pathname of ['/me.jpg', '/resume.pdf', '/favicon.ico', '/.gitkeep']) {
      assert.equal(fixtureEntry(profile, pathname), 'missing', `${profile} ${pathname}`);
    }
  }
});

/** Where each Compose file mounts something into the app's public/, by the name it takes there. */
function composePublicMounts(): { file: string; name: string }[] {
  const root = path.join(WEB, '..', '..');
  const files = [
    'docker-compose.yml',
    ...readdirSync(path.join(root, 'deploy'))
      .filter((name) => /^compose\..+\.ya?ml$/.test(name))
      .map((name) => `deploy/${name}`),
  ];
  const mounts: { file: string; name: string }[] = [];
  for (const file of files) {
    const doc = parseYaml(readFileSync(path.join(root, file), 'utf8')) as {
      services?: Record<string, { volumes?: (string | { target?: string })[] }>;
    };
    for (const service of Object.values(doc.services ?? {})) {
      for (const volume of service.volumes ?? []) {
        const target = typeof volume === 'string' ? volume.split(':')[1] : volume.target;
        const name = /^\/app\/apps\/web\/public\/([^/]+)/.exec(target ?? '')?.[1];
        if (name) mounts.push({ file, name });
      }
    }
  }
  return mounts;
}

test('every directory a Compose file mounts into public/ is a name no view or route takes', () => {
  const mounts = composePublicMounts();
  // The owner's assets, which docker-compose.yml and compose.owner.yml mount.
  assert.ok(
    mounts.some(({ name }) => name === 'assets'),
    JSON.stringify(mounts),
  );
  const owned = ownedFirstSegments();
  for (const { file, name } of mounts) {
    assert.ok(isReservedSegment(name), `${file} mounts public/${name}, which a view could take`);
    assert.ok(!owned.has(name), `a route answers before ${file}'s public/${name}`);
  }
  // A file there, extension or not, is missing, so Next serves it.
  for (const profile of PROFILES) {
    for (const pathname of ['/assets/me.jpg', '/assets/notes', '/assets']) {
      assert.equal(fixtureEntry(profile, pathname), 'missing', `${profile} ${pathname}`);
    }
  }
});

test('the catch-all shadows no API, metadata, or build path, in any profile (#5, Slice 4)', () => {
  for (const profile of PROFILES) {
    // Each answers through its own entry, whatever the catch-all could match.
    for (const pattern of PATTERNS.filter((each) => !each.includes('['))) {
      const decision = resolveRoute(profile, pattern);
      if (decision.status === 'served') assert.equal(decision.entry.pattern, pattern, pattern);
    }
    assert.equal(entryFor(profile, '/api/studio/config.status'), '/api/studio/[name]');
    // Next's own build assets stay its to answer.
    for (const pathname of ['/_next/static/chunks/main.js', '/_next/image']) {
      assert.equal(entryFor(profile, pathname), 'unlisted', `${profile} ${pathname}`);
    }
    // What no entry lists under a route's first segment is missing: a missing
    // API route, or a path beside a retired one.
    for (const pathname of [
      '/api/no-such-route',
      '/api',
      '/work',
      '/preview/grant/chapters',
      '/robots.txt/x',
    ]) {
      assert.equal(entryFor(profile, pathname), 'missing', `${profile} ${pathname}`);
    }
  }
});

test('the contract reserves every first segment the table owns, so no view is ever shadowed', () => {
  const owned = [...ownedFirstSegments()].sort();
  assert.deepEqual(
    owned.filter((segment) => !isReservedSegment(segment)),
    [],
    'a view could start with a segment a route answers first',
  );
  // The table's own first segments are all there, the share image's group suffix included.
  for (const segment of [
    '_next',
    'api',
    'sample',
    'work',
    'studio',
    'robots.txt',
    'feed.xml',
    'opengraph-image-12o0cb',
    'admin',
    '_fixtures',
  ]) {
    assert.ok(owned.includes(segment), segment);
  }
});

test('a pattern can serve each profile under its own capability', () => {
  // Owner and demo both serve a Studio page, each by its own capability.
  const table: RouteEntry[] = [
    { pattern: '/studio', kind: 'page', capability: 'studio.view' },
    { pattern: '/studio', kind: 'page', capability: 'sandbox.view' },
  ];
  const resolve = routeResolver(table, []);
  const owner = resolve('owner', '/studio');
  const demo = resolve('demo', '/studio');
  assert.deepEqual(owner.status === 'served' && [owner.entry.capability, owner.access], [
    'studio.view',
    'session',
  ]);
  assert.deepEqual(demo.status === 'served' && [demo.entry.capability, demo.access], [
    'sandbox.view',
    'public',
  ]);
  assert.equal(resolve('read-only', '/studio').status, 'absent');
});

test('a static segment wins over a dynamic one, as in Next', () => {
  const table: RouteEntry[] = [
    { pattern: '/work/[slug]', kind: 'page', capability: 'catalog.read' },
    { pattern: '/work/new', kind: 'page', capability: 'draft.write' },
    { pattern: '/files/[...path]', kind: 'handler', capability: 'catalog.read' },
  ];
  const resolve = routeResolver(table, []);
  assert.equal(resolve('read-only', '/work/new').status, 'absent');
  assert.equal(resolve('read-only', '/work/rowan').status, 'served');
  assert.equal(resolve('read-only', '/files/a/b/c').status, 'served');
  assert.equal(resolve('read-only', '/files').status, 'missing');
});

test('an entry can serve fewer profiles than its capability allows', () => {
  const resolve = routeResolver(
    [{ pattern: '/archive', kind: 'page', capability: 'catalog.read', profiles: ['owner'] }],
    [],
  );
  assert.equal(resolve('owner', '/archive').status, 'served');
  assert.equal(resolve('read-only', '/archive').status, 'absent');
  assert.equal(resolve('demo', '/archive').status, 'absent');
});
