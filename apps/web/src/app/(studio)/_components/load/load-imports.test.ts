import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// /studio's load modules (row 88c) are in the page's entry, which both
// profiles' pages load, so they reach no owner code: not studioFetch, the
// journal, or the sign-out, whose code would then ship to Demo Studio too
// (#9). Read statically, from the source: every module the load modules
// import, however deep, by a relative or ~/ path.

const LOAD = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(LOAD, '..', '..', '..', '..');

/** The modules a page's entry takes from this folder. */
const LOAD_MODULES = ['load-boundary.tsx', 'late-alert.tsx'].map((file) => path.join(LOAD, file));

/** Owner Studio's modules, which no load module may reach. */
const OWNER_ONLY = ['lib/studio-fetch.ts', 'lib/studio/journal.ts', 'lib/studio/sign-out.ts'].map(
  (file) => path.join(SRC, file),
);

/** The source file `specifier` names from `from`, or null for a package. */
function resolve(specifier: string, from: string): string | null {
  const base = specifier.startsWith('~/')
    ? path.join(SRC, specifier.slice(2))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(from), specifier)
      : null;
  if (base === null) return null;
  const candidates = [base, ...['.ts', '.tsx', '/index.ts', '/index.tsx'].map((end) => base + end)];
  const found = candidates.find((each) => existsSync(each) && statSync(each).isFile());
  assert.ok(found, `${path.relative(SRC, from)} imports ${specifier}, which names no source file`);
  return found;
}

/** Every source module `entries` import, however deep, `entries` included. */
function reached(entries: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || /\.css$/.test(file)) continue;
    seen.add(file);
    const { importedFiles } = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
    for (const { fileName } of importedFiles) {
      const next = resolve(fileName, file);
      if (next) queue.push(next);
    }
  }
  return seen;
}

test("/studio's load modules import nothing of Owner Studio's: not studioFetch, the journal, or the sign-out (row 88c, #9)", () => {
  const modules = reached(LOAD_MODULES);
  assert.ok(modules.size >= LOAD_MODULES.length, 'the load modules were read');
  const owner = OWNER_ONLY.filter((file) => modules.has(file)).map((file) =>
    path.relative(SRC, file),
  );
  assert.deepEqual(owner, []);
  // And no other load module, as the profiles' boundaries were, sits beside them.
  assert.ok(!existsSync(path.join(LOAD, 'owner-load-boundary.tsx')), 'owner-load-boundary.tsx');
});

test('the import-graph read follows ~/ and relative imports, type imports included, so an owner module a load module reached would be found (row 88c)', () => {
  // The owner adapter reaches the sign-out by a relative import, and studioFetch by a ~/ one.
  const adapter = reached([path.join(SRC, 'lib', 'studio', 'owner-backend.ts')]);
  assert.ok(adapter.has(path.join(SRC, 'lib', 'studio', 'sign-out.ts')), 'lib/studio/sign-out.ts');
  assert.ok(adapter.has(path.join(SRC, 'lib', 'studio-fetch.ts')), 'lib/studio-fetch.ts');
});
