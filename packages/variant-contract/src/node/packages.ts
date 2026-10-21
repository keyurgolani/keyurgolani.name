// Reading installed packages for registry generation (#5, Slice 3): where a
// dependency is installed, its package.json, and what its exports point at.

import fs from 'node:fs';
import path from 'node:path';

/** What a package.json holds that generation reads. */
export interface PackageJson {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly main?: unknown;
  readonly exports?: unknown;
  readonly dependencies?: unknown;
  readonly portfolio?: unknown;
}

/**
 * The directory `name` is installed in, as Node finds it from `fromDir`:
 * `node_modules/<name>` there or in a directory above, up to the repository
 * root (lookupRoot()), never past it: a package in ~/node_modules isn't the
 * host's. It's the path through node_modules, not the link target, so it
 * reads as the host sees it.
 */
export function findInstalled(
  name: string,
  fromDir: string,
  root = lookupRoot(fromDir),
): string | undefined {
  let dir = path.resolve(fromDir);
  for (;;) {
    const candidate = path.join(dir, 'node_modules', ...name.split('/'));
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (dir === root || parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Where a lookup from `fromDir` stops: the nearest directory at or above it
 * with a pnpm-workspace.yaml or a .git, the repository's root, else `fromDir`
 * itself.
 */
export function lookupRoot(fromDir: string): string {
  const start = path.resolve(fromDir);
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (
      fs.existsSync(path.join(dir, 'pnpm-workspace.yaml')) ||
      fs.existsSync(path.join(dir, '.git'))
    ) {
      return dir;
    }
    if (path.dirname(dir) === dir) return start;
  }
}

export type ReadJson = { ok: true; value: unknown } | { ok: false; reason: 'missing' | 'syntax' };

/** A JSON file's value, or why there's none. */
export function readJson(file: string): ReadJson {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { ok: false, reason: 'missing' };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: 'syntax' };
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The keys of a package's exports: `.` for a bare string or a conditions object. */
export function exportKeys(exports: unknown): string[] {
  if (typeof exports === 'string' || Array.isArray(exports)) return ['.'];
  if (!isRecord(exports)) return [];
  const keys = Object.keys(exports);
  return keys.length > 0 && keys.every((key) => key.startsWith('.')) ? keys : ['.'];
}

/**
 * The file a package's export `key` points at, relative to the package, or
 * undefined when it has none. Conditions resolve as a bundler would for the
 * browser and the server alike: import, then default, then node.
 */
export function exportTarget(pkg: PackageJson, key: string): string | undefined {
  const { exports } = pkg;
  if (exports === undefined) {
    return key === '.' && typeof pkg.main === 'string' ? pkg.main : undefined;
  }
  let entry: unknown;
  if (isRecord(exports) && Object.keys(exports).every((name) => name.startsWith('.'))) {
    entry = Object.hasOwn(exports, key) ? exports[key] : undefined;
  } else {
    entry = key === '.' ? exports : undefined;
  }
  return condition(entry);
}

function condition(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry)) {
    for (const item of entry) {
      const found = condition(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(entry)) return undefined;
  for (const name of ['import', 'default', 'node']) {
    if (Object.hasOwn(entry, name)) {
      const found = condition(entry[name]);
      if (found) return found;
    }
  }
  return undefined;
}

/** `target` inside `dir`, or undefined when it would leave it. */
export function inside(dir: string, target: string): string | undefined {
  const resolved = path.resolve(dir, target);
  const relative = path.relative(dir, resolved);
  return relative.startsWith('..') || path.isAbsolute(relative) ? undefined : resolved;
}

export { isRecord };
