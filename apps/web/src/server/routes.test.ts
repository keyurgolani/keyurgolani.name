import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  normalizeMetadataPageToRoute,
  normalizeMetadataRoute,
} from 'next/dist/lib/metadata/get-metadata-route';
import { isMetadataRouteFile } from 'next/dist/lib/metadata/is-metadata-route';
import { normalizeAppPath } from 'next/dist/shared/lib/router/utils/app-paths';
import ts from 'typescript';
import { CAPABILITIES, PROFILES, type Profile } from './capabilities';
import type { DeploymentConfig } from './config';
import { setDeploymentState } from './config-store';
import { servedPattern } from './route-guard';
import {
  listRoutes,
  resolveRoute,
  RETIRED_PATTERNS,
  routeAccess,
  routeResolver,
  serves,
  type RouteEntry,
  type RouteKind,
  type RoutePattern,
} from './routes';

// The route table against the app directory (#1, item 13), and how the
// table decides a request. Route files map to URLs through Next's own
// helpers, so route groups, slots, and numbered metadata images land where
// the build puts them.

const WEB = fileURLToPath(new URL('../..', import.meta.url));
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
  const page = relative.replace(PAGE_FILE, '');
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

/** A concrete path for `pattern`, filling each dynamic segment. */
function instantiate(pattern: string): string {
  return pattern.replace(/\[\[?\.{0,3}[^\]]+\]\]?/g, 'sample') || '/';
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

test('every entry names a known capability, profiles, and kind, and serves some profile', () => {
  for (const entry of listRoutes()) {
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
    assert.ok(
      PROFILES.some((profile) => routeAccess(profile, entry) !== 'absent'),
      `${entry.pattern}: an entry no profile serves`,
    );
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

test('what every profile serves at the close of slice 2', () => {
  const served = (profile: Profile) =>
    PATTERNS.filter((pattern) => serves(profile, pattern as RoutePattern));
  const everywhere = [
    '/',
    '/api/health',
    '/api/studio/[name]',
    '/opengraph-image',
    '/robots.txt',
    '/sitemap.xml',
  ];
  assert.deepEqual(served('owner'), [...everywhere, '/feed.xml'].sort());
  assert.deepEqual(served('read-only'), [...everywhere, '/feed.xml'].sort());
  assert.deepEqual(served('demo'), everywhere);
});

test('each table route resolves the way its capability says, in every profile', () => {
  for (const profile of PROFILES) {
    for (const entry of listRoutes()) {
      const decision = resolveRoute(profile, instantiate(entry.pattern));
      const expected = routeAccess(profile, entry) === 'absent' ? 'absent' : 'served';
      assert.equal(decision.status, expected, `${profile} ${entry.pattern}`);
    }
  }
});

test('retired routes are absent everywhere, and only those exact paths', () => {
  for (const profile of PROFILES) {
    for (const pattern of RETIRED_PATTERNS) {
      assert.equal(resolveRoute(profile, instantiate(pattern)).status, 'absent', pattern);
      assert.equal(resolveRoute(profile, `${instantiate(pattern)}/`).status, 'absent', pattern);
    }
    // The gallery screenshots in public/variants/ stay served.
    assert.equal(
      resolveRoute(profile, '/variants/kinetic-cosmos/aurora-dark-geometric.png').status,
      'unlisted',
    );
    assert.equal(resolveRoute(profile, '/%61dmin').status, 'absent', 'an encoded retired path');
    assert.equal(resolveRoute(profile, '/admin/nested').status, 'unlisted');
  }
});

test('paths the table does not list, or that do not decode, are left to Next', () => {
  assert.equal(resolveRoute('read-only', '/does-not-exist').status, 'unlisted');
  assert.equal(resolveRoute('read-only', '/api/studio').status, 'unlisted');
  assert.equal(resolveRoute('read-only', '/%E0%A4%A').status, 'unlisted');
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
  assert.equal(resolve('read-only', '/files').status, 'unlisted');
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
