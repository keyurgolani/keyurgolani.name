import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITIES, PROFILES } from './capabilities';
import {
  listRoutes,
  resolveRoute,
  RETIRED_PATTERNS,
  routeAccess,
  routeResolver,
  serves,
  type RouteEntry,
  type RoutePattern,
} from './routes';

// The route table against the app directory (#1, item 13), and how the
// table decides a request.

const SRC = fileURLToPath(new URL('..', import.meta.url));
const APP = path.join(SRC, 'app');
const PACKAGES = fileURLToPath(new URL('../../../../packages', import.meta.url));

/** The URL Next serves a metadata file at, or null when `name` is no metadata file. */
function metadataRoute(name: string, dir: string): string | null {
  if (/^robots\.(ts|js|txt)$/.test(name)) return '/robots.txt';
  if (/^sitemap\.(ts|js|xml)$/.test(name)) return `${dir}/sitemap.xml`;
  if (/^manifest\.(ts|js|json|webmanifest)$/.test(name)) return '/manifest.webmanifest';
  if (name === 'favicon.ico') return '/favicon.ico';
  const image =
    /^(icon|apple-icon|opengraph-image|twitter-image)\d*\.(ico|jpe?g|png|svg|gif|[jt]sx?)$/.exec(
      name,
    );
  return image ? `${dir}/${image[1]}` : null;
}

interface RouteFile {
  readonly pattern: string;
  readonly file: string;
}

/** Every file in the app directory that Next serves at a URL. */
function routeFiles(dir = APP, urlDir = ''): RouteFile[] {
  const found: RouteFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Private folders never route; groups and slots add no URL segment.
      if (entry.name.startsWith('_')) continue;
      assert.ok(
        !/^\(\.{1,3}\)/.test(entry.name),
        `intercepting routes need table support: ${file}`,
      );
      const silent = /^\(.*\)$/.test(entry.name) || entry.name.startsWith('@');
      found.push(...routeFiles(file, silent ? urlDir : `${urlDir}/${entry.name}`));
      continue;
    }
    if (/\.test\.[jt]sx?$/.test(entry.name)) continue;
    if (/^(page|route)\.(tsx|ts|jsx|js|mdx)$/.test(entry.name)) {
      found.push({ pattern: urlDir || '/', file });
      continue;
    }
    const metadata = metadataRoute(entry.name, urlDir);
    if (metadata) found.push({ pattern: metadata, file });
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

test('every route file has an entry, and every entry has a route file', () => {
  const files = routeFiles();
  assert.deepEqual(
    [...new Set(files.map((route) => route.pattern))].sort(),
    PATTERNS,
    'apps/web/src/app and server/routes.ts list different routes',
  );
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

test('every route file checks its own pattern against the profile', () => {
  for (const route of routeFiles()) {
    const source = readFileSync(route.file, 'utf8');
    // Handlers return notServed()'s 404; pages and metadata routes call requireServed().
    const guard = /\/route\.[jt]s$/.test(route.file) ? 'notServed' : 'requireServed';
    assert.ok(
      source.includes(`${guard}('${route.pattern}')`),
      `${path.relative(SRC, route.file)} must call ${guard}('${route.pattern}')`,
    );
  }
});

test("no module in apps/web/src or packages/*/src is a 'use server' module", () => {
  const roots = [SRC, ...readdirSync(PACKAGES).map((name) => path.join(PACKAGES, name, 'src'))];
  const directive = /^\s*(['"])use server\1/m;
  const offenders = roots
    .flatMap((root) => {
      try {
        return sources(root);
      } catch {
        return [];
      }
    })
    .filter((file) => directive.test(readFileSync(file, 'utf8')));
  assert.deepEqual(
    offenders,
    [],
    'Server Functions bypass the dispatcher; add an operation instead',
  );
});

test('every entry names a known capability, profiles, and kind', () => {
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
  }
});

test('the Studio transport is served in every profile', () => {
  for (const profile of PROFILES) assert.equal(serves(profile, '/api/studio/[name]'), true);
});

test('what every profile serves at the close of slice 2', () => {
  const served = (profile: (typeof PROFILES)[number]) =>
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
