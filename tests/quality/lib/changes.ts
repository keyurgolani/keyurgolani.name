// The owner's [37] change-directed rule (#11, 11-4, and #20 on every pack
// axis): a PR that changes a variant runs it against every stable design
// language, and one that changes a pack, a design language, a color scheme,
// or a typography profile, runs it against every registered variant. This
// module reads which paths a run changes and maps them to the variants and
// packs they belong to; cells.ts plans the cells.
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
// A pack manifest whose change is metadata alone (#20) directs nothing: its
// name, description, version, provenance, accessibility evidence, declared
// cost, mode list, fallbacks and caveats change no pixel and no gate a cell
// runs. Declared cost and modes are checked against what the pack ships by
// check:appearance (pack-gates.ts, validate-pack.ts), and the registry reads
// a scheme's modes from its sets. Every other key, and a manifest new at the
// merge base or unreadable there, still directs the pack.
//
// A path maps by package: a file under a registered variant's package maps
// to that variant, a file under a pack's own directory (`packs/<dir>/`,
// whose manifest names its id) to that pack, and any other file of a pack
// package but its Research records to every pack it ships.
// Shared code (the kit, the appearance core, the primitives, the harness)
// maps to no cell here: mapping it to every cell is the PR cap's work,
// which waits in the backlog with the 40-cell cap.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../../../ci/lib/reports.mjs';
import { AXIS_BY_KIND, PACK_AXES, type PackAxis } from '../../../packages/appearance/src/index';
import type { BuildMeta } from '../cells';

/** The axes the [37] rule directs: the variant, and since #20 every pack axis. */
export type ChangeAxis = 'variant' | PackAxis;

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
  const files = out.split('\0').filter((file) => file !== '');
  const metadata = metadataOnlyManifests(files, base, root);
  return {
    source: `git diff ${base}...HEAD${metadata.length > 0 ? `, less ${metadata.length} manifest(s) whose change is metadata alone` : ''}`,
    files: files.filter((file) => !metadata.includes(file)),
  };
}

/** Manifest keys no cell reads, so a change to them alone directs nothing. */
export const METADATA_KEYS: ReadonlySet<string> = new Set([
  'name',
  'description',
  'version',
  'provenance',
  'accessibility',
  'cost',
  'modes',
  'fallbacks',
  'caveats',
]);

const PACK_MANIFEST = /^packages\/[^/]+\/packs\/[^/]+\/manifest\.json$/;

/** A manifest's keys a cell can read, as one canonical string, or null when it isn't JSON. */
export function renderedKeys(text: string): string | null {
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) return null;
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : typeof value === 'object' && value !== null
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
          )
        : value;
  const kept = Object.fromEntries(
    Object.entries(manifest).filter(([key]) => !METADATA_KEYS.has(key)),
  );
  return JSON.stringify(canonical(kept));
}

/** The pack manifests among `files` whose change from the merge base is metadata alone. */
function metadataOnlyManifests(files: readonly string[], base: string, root: string): string[] {
  const candidates = files.filter((file) => PACK_MANIFEST.test(file));
  if (candidates.length === 0) return [];
  const git = (...args: string[]): string | null => {
    try {
      return execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 << 20,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      return null;
    }
  };
  const mergeBase = git('merge-base', base, 'HEAD')?.trim();
  if (!mergeBase) return [];
  return candidates.filter((file) => {
    const before = git('show', `${mergeBase}:${file}`);
    const after = git('show', `HEAD:${file}`);
    if (before === null || after === null) return false;
    const keys = renderedKeys(before);
    return keys !== null && keys === renderedKeys(after);
  });
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
  const packs = meta.PACKS ?? [];
  const packPackages = [...new Set(packs.map((pack) => pack.packageName))].flatMap((name) => {
    const dir = packages.get(name);
    if (!dir) return [];
    const own = packs.filter((pack) => pack.packageName === name);
    const axis = AXIS_BY_KIND[own[0]!.kind];
    return [{ dir, axis, ids: own.map((p) => p.manifest.id), packs: packDirs(root, dir) }];
  });

  for (const file of files) {
    for (const variant of variants) if (under(file, variant.dir)) add('variant', variant.id, file);
    for (const { dir, axis, ids, packs: dirs } of packPackages) {
      if (!under(file, dir)) continue;
      const own = [...dirs].find(([, packDir]) => under(file, packDir));
      if (own) {
        if (ids.includes(own[0])) add(axis, own[0], file);
      } else if (
        !under(file, `${dir}/packs`) &&
        !under(file, `${dir}/research`) &&
        !under(file, `${dir}/held`)
      ) {
        // A package-level file, such as its package.json, reaches every pack it ships.
        for (const id of ids) add(axis, id, file);
      }
      // A file under packs/ in no registered pack's directory is a pack this
      // build doesn't register, and a Research record never registers.
    }
  }
  // Variants first, then each pack axis in axis order, each by id.
  const rank = (axis: ChangeAxis) => (axis === 'variant' ? 0 : 1 + PACK_AXES.indexOf(axis));
  const order = (change: Change) => `${rank(change.axis)} ${change.id}`;
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
