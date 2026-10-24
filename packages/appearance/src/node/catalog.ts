// The catalog's governance files (#20): the lock that pins each first-party
// pack's version and content digest, the third-party notices generated from
// the packs' provenance, and the Research records, which live beside the
// packs and never become one. `pnpm catalog:lock` writes the lock and the
// notices; `pnpm check:appearance` fails when either is stale, when a pack's
// content changed without a version bump, or when a Research record is
// malformed or takes an id something else has.
//
// Every file here is written the same way from the same input, so a
// rerun with nothing changed writes nothing new.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import path from 'node:path';
import { AXIS_NAMES, type PackAxis, type PackKind } from '../axes';
import { isUpstreamLicense } from '../governance';
import { ResearchRecordSchema, type ResearchRecord } from '../manifests';
import { AXIS_BY_KIND } from '../validate-pack';

/** The lock, beside this package's source. */
export const LOCK_FILE = 'packages/appearance/appearance-catalog.lock.json';
/** The notices the image ships, beside the site's other public files. */
export const NOTICES_FILE = 'apps/web/public/third-party-notices.txt';
/** The lock's own format version. */
export const LOCK_VERSION = 1;

const PACK_KINDS: ReadonlySet<string> = new Set(['design-language', 'color-scheme', 'typography']);

/** A workspace package that holds packs, as its package.json declares them. */
export interface PackPackage {
  readonly name: string;
  /** Relative to the repository root, with `/` separators. */
  readonly dir: string;
  readonly kind: PackKind;
  /** Its `portfolio.fixture`: a test package, which no production registry ships. */
  readonly fixture: boolean;
  /** Its packs directory, relative to the root, or null when it names none. */
  readonly packs: string | null;
}

/** One pack in a workspace package's packs directory, read as it is on disk. */
export interface CatalogPack {
  readonly id: string;
  readonly axis: PackAxis;
  readonly packageName: string;
  /** Relative to the repository root. */
  readonly dir: string;
  /** Its manifest.json, parsed, or null when it doesn't parse. */
  readonly manifest: Record<string, unknown> | null;
  /** The content digest of every file in its directory. */
  readonly digest: string;
}

const posix = (file: string) => file.split(path.sep).join('/');

/** Every workspace package under packages/ that declares a pack kind, sorted by name. */
export function packPackages(root: string): PackPackage[] {
  const found: PackPackage[] = [];
  const base = path.join(root, 'packages');
  const walk = (dir: string, depth: number) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.'))
        continue;
      const full = path.join(dir, entry.name);
      const manifest = path.join(full, 'package.json');
      if (existsSync(manifest)) {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
          name?: string;
          portfolio?: { kind?: string; packs?: string; fixture?: boolean };
        };
        const kind = pkg.portfolio?.kind;
        if (typeof pkg.name === 'string' && typeof kind === 'string' && PACK_KINDS.has(kind)) {
          const packs = typeof pkg.portfolio?.packs === 'string' ? pkg.portfolio.packs : null;
          found.push({
            name: pkg.name,
            dir: posix(path.relative(root, full)),
            kind: kind as PackKind,
            fixture: pkg.portfolio?.fixture === true,
            packs: packs ? posix(path.relative(root, path.resolve(full, packs))) : null,
          });
        }
      }
      // Fixture packages nest one level, such as packages/budget-fixtures/<fixture>.
      if (depth < 1) walk(full, depth + 1);
    }
  };
  walk(base, 0);
  return found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Every file under `dir`, relative to it with `/` separators, sorted. */
function filesUnder(dir: string): string[] {
  const files: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(posix(path.relative(dir, full)));
    }
  };
  walk(dir);
  return files.sort();
}

/**
 * A pack directory's content digest: SHA-256 over each file's path and the
 * SHA-256 of its bytes, in path order, so a rename, an added file, or one
 * changed byte changes it, and nothing else does.
 */
export function packDigest(dir: string): string {
  const hash = createHash('sha256');
  for (const file of filesUnder(dir)) {
    const bytes = readFileSync(path.join(dir, file));
    hash.update(`${file}\0${createHash('sha256').update(bytes).digest('hex')}\n`);
  }
  return `sha256-${hash.digest('hex')}`;
}

/** Every pack in the packages given, by id. */
export function catalogPacks(root: string, packages: readonly PackPackage[]): CatalogPack[] {
  const packs: CatalogPack[] = [];
  for (const pkg of packages) {
    if (!pkg.packs) continue;
    const packsDir = path.join(root, pkg.packs);
    if (!existsSync(packsDir)) continue;
    for (const entry of readdirSync(packsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const dir = path.join(packsDir, entry.name);
      let manifest: Record<string, unknown> | null = null;
      try {
        manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Record<
          string,
          unknown
        >;
      } catch {
        manifest = null;
      }
      packs.push({
        id: entry.name,
        axis: AXIS_BY_KIND[pkg.kind],
        packageName: pkg.name,
        dir: posix(path.relative(root, dir)),
        manifest,
        digest: packDigest(dir),
      });
    }
  }
  return packs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The packs the lock pins: every pack in a first-party, non-fixture package. */
export function lockedPacks(root: string): CatalogPack[] {
  return catalogPacks(
    root,
    packPackages(root).filter((pkg) => !pkg.fixture && pkg.name.startsWith('@portfolio/')),
  );
}

/** One pack as the lock pins it. */
export interface LockEntry {
  readonly axis: PackAxis;
  readonly package: string;
  readonly version: string;
  readonly tier: string;
  readonly license: string;
  readonly digest: string;
}

export interface CatalogLock {
  readonly lockVersion: typeof LOCK_VERSION;
  readonly packs: Readonly<Record<string, LockEntry>>;
}

const field = (manifest: Record<string, unknown> | null, key: string): string =>
  typeof manifest?.[key] === 'string' ? (manifest[key] as string) : '';

const license = (manifest: Record<string, unknown> | null): string => {
  const provenance = manifest?.provenance as { license?: unknown } | undefined;
  return typeof provenance?.license === 'string' ? provenance.license : '';
};

/** The lock for `packs`: canonical JSON, by id, every entry's fields in one order. */
export function renderLock(packs: readonly CatalogPack[]): string {
  const entries: Record<string, LockEntry> = {};
  for (const pack of [...packs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    entries[pack.id] = {
      axis: pack.axis,
      package: pack.packageName,
      version: field(pack.manifest, 'version'),
      tier: field(pack.manifest, 'tier'),
      license: license(pack.manifest),
      digest: pack.digest,
    };
  }
  return `${JSON.stringify({ lockVersion: LOCK_VERSION, packs: entries }, null, 2)}\n`;
}

/** Semver's order: -1, 0, or 1, for major.minor.patch versions. */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) => version.split('.').map((part) => Number.parseInt(part, 10));
  const [x, y] = [parts(a), parts(b)];
  for (let index = 0; index < 3; index += 1) {
    const difference = (x[index] ?? 0) - (y[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

/** A lock problem, naming the pack it's about when it's about one. */
export interface LockProblem {
  readonly pack?: string;
  readonly axis?: PackAxis;
  readonly message: string;
}

/**
 * What's wrong with the committed lock text against the packs on disk:
 * nothing when it's what renderLock() writes. A pack whose digest changed
 * while its version didn't is its own problem, since a regenerated lock
 * would hide it; so is a version that went down.
 */
export function lockProblems(
  committed: string | null,
  packs: readonly CatalogPack[],
): LockProblem[] {
  const regenerate = 'Run pnpm catalog:lock and commit the lock.';
  if (committed === null) {
    return [{ message: `${LOCK_FILE} is missing. ${regenerate}` }];
  }
  let lock: CatalogLock;
  try {
    lock = JSON.parse(committed) as CatalogLock;
  } catch {
    return [{ message: `${LOCK_FILE} isn't valid JSON. ${regenerate}` }];
  }
  if (
    lock === null ||
    typeof lock !== 'object' ||
    lock.lockVersion !== LOCK_VERSION ||
    typeof lock.packs !== 'object' ||
    lock.packs === null
  ) {
    return [{ message: `${LOCK_FILE} isn't lock version ${LOCK_VERSION}. ${regenerate}` }];
  }
  const problems: LockProblem[] = [];
  const current = new Map(packs.map((pack) => [pack.id, pack]));
  for (const pack of packs) {
    const locked = lock.packs[pack.id];
    const version = field(pack.manifest, 'version');
    const name = `The ${AXIS_NAMES[pack.axis]} ${pack.id}`;
    if (!locked) {
      problems.push({
        pack: pack.id,
        axis: pack.axis,
        message: `${name} isn't in the lock. ${regenerate}`,
      });
      continue;
    }
    if (locked.digest !== pack.digest && locked.version === version) {
      problems.push({
        pack: pack.id,
        axis: pack.axis,
        message: `${name} changed without a version bump: its files digest to ${pack.digest}, and the lock pins ${locked.digest} at ${version}. Bump its version, then run pnpm catalog:lock.`,
      });
      continue;
    }
    if (version && locked.version && compareVersions(version, locked.version) < 0) {
      problems.push({
        pack: pack.id,
        axis: pack.axis,
        message: `${name}'s version went down, from ${locked.version} to ${version}: a pack's version only goes up.`,
      });
      continue;
    }
    const fresh = JSON.parse(renderLock([pack])) as CatalogLock;
    if (JSON.stringify(fresh.packs[pack.id]) !== JSON.stringify(locked)) {
      problems.push({
        pack: pack.id,
        axis: pack.axis,
        message: `${name}'s lock entry is stale. ${regenerate}`,
      });
    }
  }
  for (const id of Object.keys(lock.packs)) {
    if (!current.has(id)) {
      problems.push({
        pack: id,
        message: `The lock pins ${id}, which no first-party package ships. ${regenerate}`,
      });
    }
  }
  if (problems.length === 0 && committed !== renderLock(packs)) {
    problems.push({ message: `${LOCK_FILE} isn't in its canonical form. ${regenerate}` });
  }
  return problems;
}

/**
 * The third-party notices for `packs`: one notice per pack under an
 * upstream license, OFL-1.1, Apache-2.0, or MIT, by id, with its source,
 * attribution, and license. First-party, inspired, operating-system, and
 * generated packs carry no third-party material.
 */
export function renderNotices(packs: readonly CatalogPack[]): string {
  const lines = [
    'Third-party notices for the appearance packs this platform ships',
    '',
    'Generated by pnpm catalog:lock from each pack manifest. Do not edit.',
    'Each pack below adapts material under its upstream license; the rest of the platform is MIT.',
    '',
  ];
  const upstream = [...packs]
    .filter((pack) => isUpstreamLicense(license(pack.manifest)))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (upstream.length === 0) {
    lines.push('No pack in this build ships third-party material.', '');
  }
  for (const pack of upstream) {
    const provenance = (pack.manifest?.provenance ?? {}) as {
      source?: { name?: string; url?: string };
      attribution?: string;
    };
    lines.push(
      `${pack.id} (${AXIS_NAMES[pack.axis]}, ${pack.packageName})`,
      `  Name: ${field(pack.manifest, 'name')}`,
      `  Source: ${provenance.source?.name ?? ''}, ${provenance.source?.url ?? ''}`,
      `  License: ${license(pack.manifest)}`,
      `  Attribution: ${provenance.attribution ?? ''}`,
      '',
    );
  }
  return `${lines.join('\n')}`;
}

/** A Research record as it's read from its file. */
export interface ResearchFile {
  readonly file: string;
  readonly packageName: string;
  readonly kind: PackKind;
  readonly record: ResearchRecord | null;
  readonly problems: readonly string[];
}

/** Every research/<id>.json in the packages given, checked, sorted by file. */
export function researchRecords(root: string, packages: readonly PackPackage[]): ResearchFile[] {
  const found: ResearchFile[] = [];
  for (const pkg of packages) {
    const dir = path.join(root, pkg.dir, 'research');
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      const file = posix(path.join(pkg.dir, 'research', name));
      const problems: string[] = [];
      let record: ResearchRecord | null = null;
      if (!name.endsWith('.json')) {
        found.push({
          file,
          packageName: pkg.name,
          kind: pkg.kind,
          record,
          problems: [`${file} isn't a research record: research/ holds <id>.json files alone.`],
        });
        continue;
      }
      try {
        const parsed = ResearchRecordSchema.safeParse(
          JSON.parse(readFileSync(path.join(dir, name), 'utf8')),
        );
        if (parsed.success) record = parsed.data;
        else {
          for (const issue of parsed.error.issues) {
            problems.push(`${file}: /${issue.path.join('/')} ${issue.message}`);
          }
        }
      } catch {
        problems.push(`${file} isn't valid JSON.`);
      }
      if (record && `${record.id}.json` !== name) {
        problems.push(`${file} holds the record ${record.id}: a record's file is its id.`);
      }
      if (record && record.kind !== pkg.kind) {
        problems.push(`${file} is a ${record.kind} record in a ${pkg.kind} package.`);
      }
      found.push({ file, packageName: pkg.name, kind: pkg.kind, record, problems });
    }
  }
  return found;
}

/** Every Research id in the workspace, for the build check: none may reach a build. */
export function researchIds(root: string): string[] {
  return researchRecords(root, packPackages(root))
    .flatMap(({ record }) => (record ? [record.id] : []))
    .sort();
}
