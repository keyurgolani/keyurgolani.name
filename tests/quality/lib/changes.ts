// The owner's [37] change-directed rule (#11, 11-4): a PR that changes a
// variant runs it against every stable design language, and one that
// changes a design language runs it against every stable variant. This
// module reads which paths a run changes and maps them to the variants and
// languages they belong to; cells.ts plans the cells.
//
// The paths come from QUALITY_CHANGED_FILES (a JSON array, which run.ts
// sets once so every Playwright process plans the same cells), else from
// `git diff --name-only --no-renames <QUALITY_CHANGED_BASE>...HEAD`: from
// the merge base, so a base branch that has moved on adds nothing, and a
// rename as its old path and its new one, so a file moved out of a variant
// still directs it. CI's quality-pr job sets the base to HEAD^1, the base
// branch's tip under the PR's merge commit, its own merge base. With neither set, nothing is change-directed and the plan is the
// sentinels alone. A base git can't read fails the plan, so a run that was
// asked for change-directed cells never quietly runs without them.
//
// A path maps by package: a file under a registered variant's package maps
// to that variant, a file under a design-language pack's own directory
// (`packs/<dir>/`, whose manifest names its id) to that language, and any
// other file of a design-language package to every language it ships.
// Shared code (the kit, the appearance core, the primitives, the harness)
// maps to no cell here: mapping it to every cell is the PR cap's work,
// which waits in the backlog with the 40-cell cap.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../../../ci/lib/reports.mjs';
import type { BuildMeta } from '../cells';

/** The two axes the [37] rule directs. */
export type ChangeAxis = 'variant' | 'designLanguage';

/** One changed variant or language, and the paths that changed it. */
export interface Change {
  readonly axis: ChangeAxis;
  readonly id: string;
  readonly paths: readonly string[];
}

/** What a run changes, as the plan reads it. */
export interface ChangeSet {
  /** Where the paths came from, for the run's log. */
  readonly source: string;
  readonly files: readonly string[];
  readonly changes: readonly Change[];
}

export const NO_CHANGES: ChangeSet = { source: 'none', files: [], changes: [] };

/** The changed paths a run names, or null when it names none. */
export function changedFiles(
  env: NodeJS.ProcessEnv = process.env,
  root: string = REPO_ROOT,
): { source: string; files: readonly string[] } | null {
  if (env.QUALITY_CHANGED_FILES !== undefined) {
    let files: unknown;
    try {
      files = JSON.parse(env.QUALITY_CHANGED_FILES);
    } catch {
      throw new Error('QUALITY_CHANGED_FILES is not a JSON array of paths.');
    }
    if (!Array.isArray(files) || !files.every((file) => typeof file === 'string')) {
      throw new Error('QUALITY_CHANGED_FILES is not a JSON array of paths.');
    }
    return { source: 'QUALITY_CHANGED_FILES', files };
  }
  const base = env.QUALITY_CHANGED_BASE;
  if (!base) return null;
  let out: string;
  try {
    out = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', `${base}...HEAD`], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 << 20,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim();
    throw new Error(
      `QUALITY_CHANGED_BASE is ${base}, and git can't diff it against HEAD${stderr ? `: ${stderr.split('\n')[0]}` : ''}. Fetch it (CI's quality-pr checks out with fetch-depth: 2), or unset it to plan the sentinels alone.`,
    );
  }
  return {
    source: `git diff ${base}...HEAD`,
    files: out.split('\0').filter((file) => file !== ''),
  };
}

/** Every workspace package under packages/, by name, with its directory relative to `root`. */
export function workspacePackages(root: string = REPO_ROOT): ReadonlyMap<string, string> {
  const packages = new Map<string, string>();
  const dir = path.join(root, 'packages');
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = path.join(dir, entry.name, 'package.json');
    if (!existsSync(manifest)) continue;
    const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };
    if (name) packages.set(name, `packages/${entry.name}`);
  }
  return packages;
}

/** The pack directories under a pack package's `packs/`, by the id each manifest names. */
function packDirs(root: string, dir: string): ReadonlyMap<string, string> {
  const dirs = new Map<string, string>();
  const packs = path.join(root, dir, 'packs');
  if (!existsSync(packs)) return dirs;
  for (const entry of readdirSync(packs, { withFileTypes: true })) {
    const manifest = path.join(packs, entry.name, 'manifest.json');
    if (!entry.isDirectory() || !existsSync(manifest)) continue;
    const { id } = JSON.parse(readFileSync(manifest, 'utf8')) as { id?: string };
    if (id) dirs.set(id, `${dir}/packs/${entry.name}`);
  }
  return dirs;
}

const under = (file: string, dir: string) => file === dir || file.startsWith(`${dir}/`);

/**
 * The variants and design languages `files` change, among those `meta`
 * registers. A variant installed from outside the workspace, such as the
 * reference variant's tarball, has no directory here and maps from nothing.
 */
export function mapChanges(
  files: readonly string[],
  meta: Pick<BuildMeta, 'VARIANTS' | 'PACKS'>,
  root: string = REPO_ROOT,
): Change[] {
  const packages = workspacePackages(root);
  const changes = new Map<string, Change>();
  const add = (axis: ChangeAxis, id: string, file: string) => {
    const key = `${axis}:${id}`;
    const existing = changes.get(key);
    changes.set(key, { axis, id, paths: [...(existing?.paths ?? []), file] });
  };

  const variants = meta.VARIANTS.flatMap(({ packageName, manifest }) => {
    const dir = packages.get(packageName);
    return dir ? [{ id: manifest.id, dir }] : [];
  });
  const languages = (meta.PACKS ?? []).filter((pack) => pack.kind === 'design-language');
  const languagePackages = [...new Set(languages.map((pack) => pack.packageName))].flatMap(
    (name) => {
      const dir = packages.get(name);
      if (!dir) return [];
      const own = languages.filter((pack) => pack.packageName === name).map((p) => p.manifest.id);
      return [{ dir, ids: own, packs: packDirs(root, dir) }];
    },
  );

  for (const file of files) {
    for (const variant of variants) if (under(file, variant.dir)) add('variant', variant.id, file);
    for (const { dir, ids, packs } of languagePackages) {
      if (!under(file, dir)) continue;
      const own = [...packs].find(([, packDir]) => under(file, packDir));
      if (own) {
        if (ids.includes(own[0])) add('designLanguage', own[0], file);
      } else if (!under(file, `${dir}/packs`)) {
        // A package-level file, such as its package.json, reaches every pack it ships.
        for (const id of ids) add('designLanguage', id, file);
      }
      // A file under packs/ in no registered pack's directory is a pack this build doesn't register.
    }
  }
  // Variants first, then languages, each by id.
  const order = (change: Change) => `${change.axis === 'variant' ? 0 : 1} ${change.id}`;
  return [...changes.values()].sort((a, b) => (order(a) < order(b) ? -1 : 1));
}

/** The run's change set: its changed paths, mapped. */
export function readChanges(
  meta: Pick<BuildMeta, 'VARIANTS' | 'PACKS'>,
  env: NodeJS.ProcessEnv = process.env,
  root: string = REPO_ROOT,
): ChangeSet {
  const changed = changedFiles(env, root);
  if (!changed) return NO_CHANGES;
  return { ...changed, changes: mapChanges(changed.files, meta, root) };
}
