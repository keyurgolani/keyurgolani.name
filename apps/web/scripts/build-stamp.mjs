// Stamps the standalone build (the distinct guard's hang, 2026-10-26; the
// lows review's A-H1 and A-M1): `pnpm build`'s postbuild writes
// .next/portfolio-build.json, the sha256 of every build input's content and
// of the registry the build served, so the test harness can refuse a build
// that's stale against what the tests read in about a second, instead of
// serving it for 5 to 16 minutes (tests/harness/app-server.mjs).
//
// The stamp reads content, never git: a fresh build of a dirty tree, such as
// the external-variant host after its `pnpm add`, matches itself, a copy with
// no git stamps and checks the same way, and a changed input fails whether
// git tracks it or not. The inputs are every file under apps/web and
// packages, and the root files and directories pnpm install and the build
// read (BUILD_ROOT_FILES, BUILD_ROOT_DIRS, the ones the fixture host copies),
// less installs, build output, caches, and tests. A build that fails runs no
// postbuild, so it writes no stamp.
//
// The inputs are read twice (the K-5 round 7 review's B-L1): prebuild, once
// build:registry has written the registry, lists them in
// .next/cache/portfolio-build-inputs.json (`next build` empties .next but its
// cache/), and postbuild reads them again. A file saved while `next build`
// ran would otherwise be stamped as built, though the build read it before
// the edit; so where the two listings differ, postbuild refuses to stamp,
// naming the files, and `pnpm build` fails.
//
// The walk follows a symbolic link (B-L2), since the bundler and tsc read
// through one: a linked file counts as its target's content, and a linked
// directory inside the checkout is walked. A link it can't follow, one that
// dangles, leads out of the checkout, or loops back to a directory it sits
// in, counts as where it points, and the stamp warns, naming it. Nothing
// else drops out unsaid: a directory it can't read, or an entry that's
// neither a file nor a directory, warns too.
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the stamp goes, under apps/web. */
export const BUILD_STAMP = path.join('.next', 'portfolio-build.json');
/** Where prebuild lists the inputs, under apps/web: `next build` empties .next but its cache/. */
export const BUILD_INPUTS = path.join('.next', 'cache', 'portfolio-build-inputs.json');
/** The registry the tests read, which the build must have served. */
export const REGISTRY_META = path.join('src', 'lib', 'generated', 'registry.meta.ts');

/** What pnpm install and the build read at the root. */
export const BUILD_ROOT_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
  // The lockfile records its checksum: a frozen install without it fails.
  '.pnpmfile.cjs',
  'tsconfig.base.json',
  'portfolio.example.yml',
  'site.example.yml',
];
/**
 * The root directories the build reads: what sits beside the bundled sample
 * pair (#10), its snapshots and media sources, and quality/, whose
 * thresholds apps/web/scripts/appearance-targets.ts imports (#11), so the
 * build type-checks it. fixture-host.test.mjs fails when a build source
 * imports a root directory this list leaves out.
 */
export const BUILD_ROOT_DIRS = ['snapshots', 'example-media', 'quality'];
/** The directories under the root whose every file is an input. */
const INPUT_DIRS = [path.join('apps', 'web'), 'packages', ...BUILD_ROOT_DIRS];
/**
 * Directories that are no input wherever they are: installs, build output, and caches, as
 * .gitignore has them at any depth, and a test suite's own directory.
 */
const SKIPPED_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
  '__tests__',
]);
/**
 * Directories that are no input beside a package's package.json, or at an input directory's
 * top: its tests and reports. Deeper, such a name is a module or a route, as
 * src/components/test/ or studio/reports/ would be, so it counts (B-L2).
 */
const PACKAGE_SKIPPED_DIRS = new Set(['test', 'tests', 'reports']);
/** Files that are no input: what a type check, an editor, or `next build` itself writes, logs, and tests. */
const SKIPPED_FILE =
  /(?:\.tsbuildinfo|\.log|^next-env\.d\.ts|^\.DS_Store|^\.eslintcache|\.(?:test|spec)\.[cm]?[jt]sx?)$/;

/** The sha256 of `bytes`. */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Whether the real path `real` is `bound` or under it. */
const within = (real, bound) => real === bound || real.startsWith(`${bound}${path.sep}`);

/** The sha256 of `web`'s registry, or '' where it has none. */
export function registryHash(web) {
  try {
    return sha256(readFileSync(path.join(web, REGISTRY_META)));
  } catch {
    return '';
  }
}

/**
 * The sha256 of each build input's content, by its path from the root `web` sits in
 * (`web/../..`), `/`-separated and sorted. Tracked and untracked files count alike. A link the
 * walk can't follow counts as its target's text, `link:<target>`, so a re-pointed link counts,
 * and `warn` hears it by its path, as it hears a directory it can't read or an entry that's
 * neither a file nor a directory.
 */
export function buildInputFiles(web, { warn = () => {} } = {}) {
  const root = path.resolve(web, '..', '..');
  const slash = (relative) => relative.split(path.sep).join('/');
  const files = {};
  const add = (relative) => {
    try {
      files[slash(relative)] = sha256(readFileSync(path.join(root, relative)));
    } catch {
      // A file that went between the listing and the read is no input.
    }
  };
  const addLink = (relative, why) => {
    let target = '';
    try {
      target = readlinkSync(path.join(root, relative));
    } catch {
      // A link that went between the listing and the read: its target's text is ''.
    }
    files[slash(relative)] = sha256(`link:${target}`);
    warn(
      `${slash(relative)} -> ${target}: ${why}, so the stamp holds where it points, not its content`,
    );
  };
  let rootReal = root;
  try {
    rootReal = realpathSync(root);
  } catch {
    // No root: every input directory is missing, and the walk reads nothing.
  }
  // `real` is the directory's real path and `ancestors` those of the directories it sits in, so
  // a link back to one of them is a loop; `bounds` are where a linked directory may lead.
  const walk = (relative, real, ancestors, bounds, top) => {
    let entries;
    try {
      entries = readdirSync(path.join(root, relative), { withFileTypes: true });
    } catch (error) {
      // An input directory a checkout doesn't have, as a bare one has no example-media/, is no input.
      if (!(top && error?.code === 'ENOENT')) {
        warn(`${slash(relative)}/: not read (${error?.code ?? error}), so none of it is stamped`);
      }
      return;
    }
    const packageRoot = top || entries.some((entry) => entry.name === 'package.json');
    const lineage = new Set([...ancestors, real]);
    for (const entry of entries) {
      const child = path.join(relative, entry.name);
      const link = entry.isSymbolicLink();
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (link) {
        try {
          const target = statSync(path.join(root, child));
          isDirectory = target.isDirectory();
          isFile = target.isFile();
        } catch {
          addLink(child, 'it dangles');
          continue;
        }
      }
      if (isDirectory) {
        // A dot-directory is a cache or build output: .next, .turbo, .cache, .git.
        if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue;
        if (packageRoot && PACKAGE_SKIPPED_DIRS.has(entry.name)) continue;
        let childReal = path.join(real, entry.name);
        if (link) {
          childReal = realpathSync(path.join(root, child));
          if (!bounds.some((bound) => within(childReal, bound))) {
            addLink(child, 'it leads out of the checkout');
            continue;
          }
          if (lineage.has(childReal)) {
            addLink(child, 'it loops back to a directory it sits in');
            continue;
          }
        }
        walk(child, childReal, lineage, bounds, false);
      } else if (isFile) {
        if (!SKIPPED_FILE.test(entry.name)) add(child);
      } else {
        warn(`${slash(child)}: neither a file nor a directory, so it isn't stamped`);
      }
    }
  };
  for (const file of BUILD_ROOT_FILES) add(file);
  for (const dir of INPUT_DIRS) {
    let real = path.join(rootReal, dir);
    try {
      // An input directory may itself be a link, as a host's packages/ could be.
      real = realpathSync(path.join(root, dir));
    } catch {
      // Missing: the walk says so, or not, as it reads it.
    }
    walk(dir, real, [], [rootReal, real], true);
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** One sha256 over every input's path and content hash. */
export function inputsHash(files) {
  const hash = createHash('sha256');
  for (const [file, sha] of Object.entries(files)) hash.update(`${file}\0${sha}\n`);
  return hash.digest('hex');
}

/** The inputs that differ between two listings: changed, added, then removed, each sorted. */
export function changedInputs(built, now) {
  const changed = [];
  const added = [];
  for (const [file, sha] of Object.entries(now)) {
    if (!(file in built)) added.push(file);
    else if (built[file] !== sha) changed.push(file);
  }
  const removed = Object.keys(built).filter((file) => !(file in now));
  return [
    ...changed,
    ...added.map((file) => `${file} (new)`),
    ...removed.map((file) => `${file} (gone)`),
  ];
}

/** How many changed inputs a message names. */
const NAMED_CHANGES = 5;

/** The first NAMED_CHANGES of `changed`, and how many more there are. */
export function namedChanges(changed) {
  const named = changed.slice(0, NAMED_CHANGES).join(', ');
  const more = changed.length > NAMED_CHANGES ? `, and ${changed.length - NAMED_CHANGES} more` : '';
  return `${named}${more}`;
}

/** Lists `web`'s inputs as the build is about to read them, for its stamp (prebuild). */
export function writeBuildInputs(web) {
  const listing = { registry: registryHash(web), files: buildInputFiles(web) };
  mkdirSync(path.dirname(path.join(web, BUILD_INPUTS)), { recursive: true });
  writeFileSync(path.join(web, BUILD_INPUTS), `${JSON.stringify(listing)}\n`);
  return listing;
}

/**
 * Writes `web`'s stamp (postbuild) from its inputs as they are now, which must be the ones
 * prebuild listed before the build read them. Where an input changed while the build ran, or
 * prebuild listed none, it throws, naming the files, and writes no stamp. `warn` hears each
 * entry the walk can't stamp by its content.
 */
export function writeBuildStamp(
  web,
  now = new Date(),
  { warn = (message) => process.stderr.write(`[build-stamp] warning: ${message}\n`) } = {},
) {
  let before;
  try {
    before = JSON.parse(readFileSync(path.join(web, BUILD_INPUTS), 'utf8'));
  } catch {
    before = null;
  }
  if (typeof before?.files !== 'object' || !before.files) {
    throw new Error(
      `[build-stamp] refusing to stamp: there's no ${BUILD_INPUTS}, the inputs as the build was about to read them, which pnpm build's prebuild writes; run pnpm build`,
    );
  }
  const files = buildInputFiles(web, { warn });
  const registry = registryHash(web);
  const changed = changedInputs(before.files, files);
  if (changed.length > 0 || before.registry !== registry) {
    throw new Error(
      `[build-stamp] refusing to stamp: inputs changed while the build ran (${namedChanges(changed) || 'the registry'}), so it may hold their earlier content; run pnpm build again`,
    );
  }
  const stamp = { inputs: inputsHash(files), registry, builtAt: now.toISOString(), files };
  writeFileSync(path.join(web, BUILD_STAMP), `${JSON.stringify(stamp)}\n`);
  return stamp;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (process.argv[2] === '--before') {
    const listing = writeBuildInputs(web);
    process.stdout.write(
      `[build-stamp] ${BUILD_INPUTS}: ${Object.keys(listing.files).length} inputs, before the build\n`,
    );
  } else {
    try {
      const stamp = writeBuildStamp(web);
      process.stdout.write(
        `[build-stamp] ${BUILD_STAMP}: ${Object.keys(stamp.files).length} inputs ${stamp.inputs.slice(0, 12)}, registry ${stamp.registry.slice(0, 12)}\n`,
      );
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
