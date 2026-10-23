// For the tests that check what a module reaches: the run-time imports of a
// TypeScript or .mjs module by relative path, a .cjs one among them, `import()` included, followed
// the way Node and tsx resolve them. `import type` and `export type` load
// nothing, so they don't count. A bare specifier, such as @portfolio/schema,
// isn't followed, and neither is apps/web's generated registry, which only
// its build:registry writes, so a clean checkout reads the same as a built one.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { recordOwnerModule } from '../../load-trace';

recordOwnerModule('core/store/test-support/imports');

const STATEMENT =
  /^\s*(import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm;
/**
 * `import('./x')`, or a template with nothing in it, `import(\`./x\`)`, which
 * loads code at run time as a static import does. One whose specifier is
 * computed can't be followed; pointer-moves.test.ts refuses it.
 */
const DYNAMIC = /\bimport\(\s*(['"`])(\.{1,2}\/[^'"`$]+)\1\s*\)/g;
/** A file's text without its comments, where an `import()` loads nothing. */
const uncommented = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
/** apps/web's registry, gitignored until build:registry writes it. */
const GENERATED = /[\\/]apps[\\/]web[\\/]src[\\/]lib[\\/]generated[\\/]/;

/**
 * The modules `file` imports by a relative path, resolved to files: at run
 * time, or with `types`, by `import type` and `export type` too.
 */
export function relativeImports(file: string, { types = false } = {}): string[] {
  const text = readFileSync(file, 'utf8');
  const specifiers = [
    ...[...text.matchAll(STATEMENT)]
      .filter((match) => types || !match[2])
      .map((match) => match[3]!),
    ...[...uncommented(text).matchAll(DYNAMIC)].map((match) => match[2]!),
  ];
  const found: string[] = [];
  for (const specifier of specifiers) {
    const base = path.resolve(path.dirname(file), specifier);
    // A stylesheet or JSON loads no code.
    if (/\.(?:css|json)$/.test(base)) continue;
    const resolved = [
      base,
      ...['.ts', '.tsx', '.mjs', '.js'].map((extension) => `${base}${extension}`),
      path.join(base, 'index.ts'),
      path.join(base, 'index.tsx'),
    ].find((candidate) => /\.(?:tsx?|[cm]?js)$/.test(candidate) && existsSync(candidate));
    if (!resolved && GENERATED.test(base)) continue;
    if (!resolved) throw new Error(`${file}: can't resolve ${specifier}`);
    found.push(resolved);
  }
  return found;
}

/** Every module `entry` reaches through relative imports, itself included, as relativeImports() counts them. */
export function closure(entry: string, options: { readonly types?: boolean } = {}): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const next of relativeImports(file, options)) visit(next);
  };
  visit(entry);
  return seen;
}

/** The bare specifiers `file` imports at run time, such as node:fs or @portfolio/schema, with what it names. */
export function bareImports(file: string): { specifier: string; names: string[] }[] {
  const text = readFileSync(file, 'utf8');
  const found: { specifier: string; names: string[] }[] = [];
  const statement = /^\s*import\s+(type\s+)?([^'";]*?)\s*from\s+['"]([^.'"][^'"]*)['"]/gm;
  for (const match of text.matchAll(statement)) {
    if (match[1]) continue;
    const clause = match[2]!;
    const named = /\{([^}]*)\}/.exec(clause)?.[1] ?? '';
    const names = named
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part && !part.startsWith('type '))
      .map((part) => part.split(/\s+as\s+/)[0]!.trim());
    const binding = clause
      .replace(/\{[^}]*\}/, '')
      .replace(/,/g, ' ')
      .trim();
    if (binding) names.push(binding.startsWith('* as') ? '*' : `default:${binding}`);
    found.push({ specifier: match[3]!, names });
  }
  for (const match of text.matchAll(/^\s*import\s+['"]([^.'"][^'"]*)['"]/gm)) {
    found.push({ specifier: match[1]!, names: [] });
  }
  return found;
}
