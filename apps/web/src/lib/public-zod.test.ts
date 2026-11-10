import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A visitor's page validates nothing in the browser, so no client module a
// public page loads at once reaches zod (row 134). Studio, Demo Studio and
// the preview frames do validate, and keep it. The walk follows every static
// import and export that isn't type-only, through ~/, relative paths and each
// workspace package's exports, as proxy-imports.test.ts's does: a reachable
// rule in dependency-cruiser follows type-only imports, which bring no code.
// A dynamic import() is a chunk of its own, loaded on demand, so the walk
// doesn't follow one: the sample's frame agent loads that way, only framed.

const SRC = fileURLToPath(new URL('../', import.meta.url));
const ROOT = path.resolve(SRC, '..', '..', '..');
const ZOD = path.join(ROOT, 'packages/schema/src/zod.ts');

/** Where a public page's client modules come from: the packages a page renders, and the site's own. */
const PUBLIC_DIRS = [
  'packages/appearance/src',
  'packages/kit/src',
  'packages/fallback-composition/src',
  ...readdirSync(path.join(ROOT, 'packages'))
    .filter((name) => name.startsWith('variant-') && name !== 'variant-contract')
    .map((name) => `packages/${name}/src`),
  'apps/web/src/lib',
  'apps/web/src/app/(site)',
];
/** Inside those, what only Studio, Demo Studio, a frame or Node loads. */
const NOT_PUBLIC = [
  /^packages\/appearance\/src\/(?:node|studio)\//,
  /^apps\/web\/src\/lib\/(?:demo|studio)\//,
  /\.test\.tsx?$/,
  /\/test-support\//,
  /\/__fixtures__\//,
];

function workspaceExport(name: string, subpath: string): string | null {
  const dir = path.join(ROOT, 'packages', name);
  const manifest = path.join(dir, 'package.json');
  if (!existsSync(manifest)) return null;
  const exports = (
    JSON.parse(readFileSync(manifest, 'utf8')) as {
      exports?: Record<string, string | Record<string, string>>;
    }
  ).exports;
  const entry = exports?.[subpath];
  // A conditional export: the browser build takes `browser`, then `import`, then `default`.
  const target =
    typeof entry === 'object' ? (entry.browser ?? entry.import ?? entry.default) : entry;
  return target ? path.join(dir, target) : null;
}

function resolve(file: string, specifier: string, base: string): string {
  const found = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
    .map((suffix) => `${base}${suffix}`)
    .find((candidate) => /\.(?:m?tsx?|m?js|json)$/.test(candidate) && existsSync(candidate));
  if (!found)
    throw new Error(`${relative(file)} imports ${specifier}, which the walk can't resolve`);
  return found;
}

/** The files `file` loads at once: static imports and exports that aren't type-only. */
function staticImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const files: string[] = [];
  for (const [, specifier] of text.matchAll(
    /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/gm,
  )) {
    let base: string | null = null;
    if (specifier!.startsWith('~/')) base = path.join(SRC, specifier!.slice(2));
    else if (specifier!.startsWith('.')) base = path.resolve(path.dirname(file), specifier!);
    else if (specifier!.startsWith('@portfolio/')) {
      const [, name, ...rest] = specifier!.split('/');
      base = workspaceExport(name!, rest.length > 0 ? `./${rest.join('/')}` : '.');
      if (!base)
        throw new Error(`${relative(file)} imports ${specifier}, which no package exports`);
    }
    if (base) files.push(resolve(file, specifier!, base));
  }
  return files;
}

/** The chain from `entry` to zod's module, or null when it never gets there. */
function chainToZod(entry: string): string[] | null {
  const previous = new Map<string, string | null>([[entry, null]]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (file === ZOD) {
      const chain: string[] = [];
      for (let at: string | null = file; at; at = previous.get(at) ?? null)
        chain.unshift(relative(at));
      return chain;
    }
    for (const next of staticImports(file)) {
      if (!previous.has(next)) {
        previous.set(next, file);
        queue.push(next);
      }
    }
  }
  return null;
}

const relative = (file: string) => path.relative(ROOT, file);

function clientModules(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (name === 'node_modules') continue;
      if (statSync(file).isDirectory()) walk(file);
      else if (/\.tsx?$/.test(name) && !NOT_PUBLIC.some((rule) => rule.test(relative(file)))) {
        if (/^\s*['"]use client['"]/.test(readFileSync(file, 'utf8'))) found.push(file);
      }
    }
  };
  for (const dir of PUBLIC_DIRS) walk(path.join(ROOT, dir));
  return found;
}

test('no client module a public page loads at once reaches zod (row 134)', () => {
  const modules = clientModules();
  // The walk reaches the kit's runtime, the appearance boundary, and every variant's client code.
  assert.ok(modules.length > 40, `only ${modules.length} client modules found`);
  const reaching = modules
    .map((file) => chainToZod(file))
    .filter((chain): chain is string[] => chain !== null)
    .map((chain) => chain.join(' -> '));
  assert.deepEqual(reaching, [], `public client modules that load zod:\n${reaching.join('\n')}`);
});

test('the walk finds zod where it is: the preview protocol and the schema root reach it', () => {
  assert.ok(chainToZod(path.join(SRC, 'preview/protocol.ts')));
  assert.ok(chainToZod(path.join(ROOT, 'packages/schema/src/index.ts')));
  // And it leaves a dynamic import alone: the sample frame loads its agent on demand.
  assert.equal(chainToZod(path.join(SRC, 'lib/sample-frame.tsx')), null);
});
