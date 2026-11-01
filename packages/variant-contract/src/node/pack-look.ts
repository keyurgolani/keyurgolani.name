// A pack's look as a digest (LANG-2): what a retired pack's record pins its
// survivor to at the merge, so the alias's notice can say whether the
// survivor still looks as it did then. A survivor may evolve; its aliases
// follow it, and the notice stops claiming they look the same.
//
// The look is the manifest without what only describes the pack (its id,
// name, words, version, tier, family, provenance, checks, cost, budgets,
// fallbacks, and caveats), plus the bytes of every other file in the pack's
// directory but dotfiles, such as its stylesheet. Keys are sorted, so a
// manifest's key order never changes it.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** The manifest fields that describe a pack and never change how it renders. */
export const DESCRIPTIVE_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'name',
  'description',
  'version',
  'tier',
  'family',
  'provenance',
  'accessibility',
  'cost',
  'budgets',
  'fallbacks',
  'caveats',
]);

/** How a digest is spelled: sha256- and 64 lowercase hex digits. */
export const LOOK_DIGEST = /^sha256-[0-9a-f]{64}$/;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * The look digest of a pack whose manifest is `manifest` and whose other
 * files are `files`, by path in its directory.
 */
export function packLookDigest(
  manifest: Readonly<Record<string, unknown>>,
  files: Readonly<Record<string, string | Uint8Array>> = {},
): string {
  const look = Object.fromEntries(
    Object.entries(manifest).filter(([key]) => !DESCRIPTIVE_FIELDS.has(key)),
  );
  const contents = Object.fromEntries(
    Object.entries(files).map(([file, bytes]) => [file, sha256(bytes)]),
  );
  return `sha256-${sha256(JSON.stringify(stable({ look, files: contents })))}`;
}

/** The look digest of the pack in `dir`: its manifest.json and every other file under it. */
export function packDirLookDigest(dir: string): string {
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  const files: Record<string, Uint8Array> = {};
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      // A dotfile, such as .DS_Store, is no part of the pack.
      if (entry.name.startsWith('.')) continue;
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const relative = path.relative(dir, full).split(path.sep).join('/');
        if (relative !== 'manifest.json') files[relative] = readFileSync(full);
      }
    }
  };
  walk(dir);
  return packLookDigest(manifest, files);
}
