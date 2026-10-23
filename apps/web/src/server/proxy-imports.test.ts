import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// What the proxy loads at run time (#7, preview hardening item 3). The
// proxy runs on every request, so proxy.ts and the route table load no zod,
// no yaml, and neither the schema's root nor the variant contract's: what
// they need from those packages comes through subpaths that import nothing
// heavier, such as @portfolio/schema/ids, @portfolio/variant-contract/segments,
// and @portfolio/variant-contract/fixture-names. dependency-cruiser's
// reachable rules follow type-only imports, which bring no code, and the
// proxy's modules have some, so this walk reads the source instead: every
// import and export that isn't type-only, through ~/, relative paths, and
// each workspace package's exports, to the packages outside the workspace
// it names.

const SRC = fileURLToPath(new URL('../', import.meta.url));
const ROOT = path.resolve(SRC, '..', '..', '..');

/** A workspace package's exports, by subpath, as files: `@portfolio/schema` and `./ids` give packages/schema/src/ids.ts. */
function workspaceExport(name: string, subpath: string): string | null {
  const dir = path.join(ROOT, 'packages', name);
  const manifest = path.join(dir, 'package.json');
  if (!existsSync(manifest)) return null;
  const exports = (
    JSON.parse(readFileSync(manifest, 'utf8')) as { exports?: Record<string, string> }
  ).exports;
  const target = exports?.[subpath];
  return target ? path.join(dir, target) : null;
}

/** What `file` imports at run time: the files it loads, and the outside packages it names. */
function runtimeImports(file: string): { files: string[]; packages: string[] } {
  const text = readFileSync(file, 'utf8');
  const specifiers = [
    ...text.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/gm),
    ...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map(([, specifier]) => specifier!);
  const files: string[] = [];
  const packages: string[] = [];
  for (const specifier of specifiers) {
    let base: string | null;
    if (specifier.startsWith('~/')) base = path.join(SRC, specifier.slice(2));
    else if (specifier.startsWith('.')) base = path.resolve(path.dirname(file), specifier);
    else if (specifier.startsWith('@portfolio/')) {
      const [, name, ...rest] = specifier.split('/');
      base = workspaceExport(name!, rest.length > 0 ? `./${rest.join('/')}` : '.');
      if (!base) packages.push(specifier);
    } else {
      packages.push(specifier.startsWith('@') ? specifier : specifier.split('/')[0]!);
      base = null;
    }
    if (!base) continue;
    const resolved = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
      .map((suffix) => `${base}${suffix}`)
      .find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate));
    if (resolved) files.push(resolved);
  }
  return { files, packages };
}

/** Every file `entry` loads at run time, itself included, and every outside package they name. */
function reached(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    const found = runtimeImports(file);
    queue.push(...found.files);
    for (const name of found.packages) packages.add(name);
  }
  return { files, packages };
}

const relative = (file: string) => path.relative(ROOT, file);

test('the proxy and the route table load no zod, no yaml, and neither the schema root nor the variant contract root at run time (#7)', () => {
  const heavy = [
    'packages/schema/src/index.ts',
    'packages/variant-contract/src/index.ts',
    'packages/schema/src/site.ts',
  ];
  for (const entry of ['proxy.ts', 'server/routes.ts']) {
    const { files, packages } = reached(path.join(SRC, entry));
    const loaded = [...files].map(relative);
    assert.ok(loaded.includes('packages/variant-contract/src/segments.ts'), entry);
    for (const file of heavy) assert.ok(!loaded.includes(file), `${entry} loads ${file}`);
    // Next, and server-only, the marker the registry's metadata module
    // imports (#6), which holds no code.
    assert.deepEqual(
      [...packages].filter((name) => name !== 'next' && name !== 'server-only'),
      [],
      `${entry} names outside packages`,
    );
  }
});

test('the walk sees what a root import loads: the variant contract root reaches zod, yaml, and the schema root (#7)', () => {
  const { files, packages } = reached(path.join(ROOT, 'packages/variant-contract/src/index.ts'));
  assert.ok([...files].map(relative).includes('packages/schema/src/index.ts'));
  assert.ok(packages.has('zod'));
  assert.ok(packages.has('yaml'));
});
