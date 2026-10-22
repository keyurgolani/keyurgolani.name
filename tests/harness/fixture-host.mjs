// A host with test-only variants installed, built once, for specs that need
// variants this build doesn't register (#5, Slice 4): the route specs need
// path views, and the fallback composition declares none.
//
// It copies the workspace, the root files, apps/, and packages/, as the
// checkout has them, with what sits beside the bundled sample pair (#10), into
// a temporary directory. Each fixture package from
// tests/fixtures/variants/ goes inside the copy's apps/web, under
// fixture-variants/, and becomes a `link:` dependency of its @portfolio/web,
// the way `pnpm --filter @portfolio/web add link:<dir>` adds one. A fixture
// declares no dependencies: inside apps/web, its imports of @portfolio/kit,
// @portfolio/variant-contract, and React's types resolve from the host's own
// node_modules, so pnpm has nothing to look up. pnpm links the copy with
// --offline from the store the checkout's install filled, named outright:
// pnpm keeps a store per disk, and the temporary directory can be on another
// one, such as a container's /tmp or a tmpfs. Files a spec names go into the
// copy's apps/web/public, where an owner's assets go. The copy builds with the
// app's own `pnpm build`. Nothing in the checkout changes, and nothing reaches
// the network.
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURE_VARIANTS = path.join(REPO_ROOT, 'tests', 'fixtures', 'variants');

/** Where the route specs' global setup leaves the fixture host's apps/web for the workers. */
export const FIXTURE_HOST_ENV = 'PORTFOLIO_FIXTURE_HOST_WEB';

/** The fixture host's apps/web, which tests/routes/fixture-host.setup.ts built. */
export function fixtureHostWeb() {
  const web = process.env[FIXTURE_HOST_ENV];
  if (!web) throw new Error('No fixture host was built. Run these specs with pnpm test:routes.');
  return web;
}

/** What pnpm install and the build read at the root. */
const ROOT_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
  'tsconfig.base.json',
  'portfolio.example.yml',
  'site.example.yml',
];
/** What sits beside the bundled sample pair (#10): its snapshots, and its media sources. */
const ROOT_DIRS = ['snapshots', 'example-media'];
/** Directories never copied, wherever they are: installs and build output. */
const SKIPPED_DIRS = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage']);
/** What registry generation writes, which the copy's build writes again. */
const GENERATED = path.join('apps', 'web', 'src', 'lib', 'generated');

/** pnpm as the script running this was started with, else from PATH. */
const PNPM = process.env.npm_execpath ? [process.execPath, process.env.npm_execpath] : ['pnpm'];

/** Copies `from` to `to`, skipping installs, build output, and generated files. */
function copyTree(from, to, relative = '') {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const rel = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name) || rel === GENERATED) continue;
      copyTree(path.join(from, entry.name), path.join(to, entry.name), rel);
    } else if (entry.isFile() && !entry.name.endsWith('.tsbuildinfo')) {
      copyFileSync(path.join(from, entry.name), path.join(to, entry.name));
    }
  }
}

/**
 * Runs pnpm in `cwd`, its output appended to `log`, and returns its stdout;
 * throws with the log's path when it fails.
 */
function pnpm(args, cwd, log) {
  appendFileSync(log, `\n$ pnpm ${args.join(' ')}\n`);
  const [command, ...prefix] = PNPM;
  const result = spawnSync(command, [...prefix, ...args], {
    cwd,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  appendFileSync(log, `${result.stdout ?? ''}${result.stderr ?? ''}`);
  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(' ')} failed in the fixture host (log: ${log})`);
  }
  return result.stdout ?? '';
}

/**
 * Builds a host whose @portfolio/web also depends on each named fixture
 * variant, by its directory under tests/fixtures/variants/.
 *
 * @param {object} options
 * @param {readonly string[]} options.variants fixture directories, such as `chapters`
 * @param {Record<string, string>} [options.publicFiles] files to add to the copy's
 *   apps/web/public, by name, with their text
 * @param {string} options.log where pnpm's output goes
 * @returns {{ root: string, web: string, packages: string[], remove: () => void }}
 *   `web` is the copy's apps/web, for startApp's `web` option
 */
export function buildFixtureHost({ variants, publicFiles = {}, log }) {
  const root = mkdtempSync(path.join(tmpdir(), 'portfolio-fixture-host-'));
  const remove = () => rmSync(root, { recursive: true, force: true });
  try {
    mkdirSync(path.dirname(log), { recursive: true });
    writeFileSync(log, `[fixture-host] ${root}\n`);
    for (const file of ROOT_FILES) {
      if (existsSync(path.join(REPO_ROOT, file))) {
        copyFileSync(path.join(REPO_ROOT, file), path.join(root, file));
      }
    }
    for (const dir of ['apps', 'packages']) {
      copyTree(path.join(REPO_ROOT, dir), path.join(root, dir), dir);
    }
    for (const dir of ROOT_DIRS) {
      if (existsSync(path.join(REPO_ROOT, dir))) {
        copyTree(path.join(REPO_ROOT, dir), path.join(root, dir), dir);
      }
    }
    const web = path.join(root, 'apps', 'web');
    const host = JSON.parse(readFileSync(path.join(web, 'package.json'), 'utf8'));
    const lockfile = parseDocument(readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8'));
    const packages = [];
    for (const name of variants) {
      const source = path.join(FIXTURE_VARIANTS, name);
      const { name: packageName } = JSON.parse(
        readFileSync(path.join(source, 'package.json'), 'utf8'),
      );
      cpSync(source, path.join(web, 'fixture-variants', name), { recursive: true });
      host.dependencies[packageName] = `link:./fixture-variants/${name}`;
      // What `pnpm add` writes for it, so the install stays frozen: a link
      // needs no lookup, and a frozen install fetches no metadata.
      lockfile.setIn(['importers', 'apps/web', 'dependencies', packageName], {
        specifier: `link:./fixture-variants/${name}`,
        version: `link:fixture-variants/${name}`,
      });
      packages.push(packageName);
    }
    for (const [name, text] of Object.entries(publicFiles)) {
      writeFileSync(path.join(web, 'public', name), text);
    }
    writeFileSync(path.join(web, 'package.json'), `${JSON.stringify(host, null, 2)}\n`);
    writeFileSync(path.join(root, 'pnpm-lock.yaml'), lockfile.toString({ lineWidth: 0 }));
    // The checkout's store, which pnpm would not pick on another disk.
    const store = pnpm(['store', 'path'], REPO_ROOT, log).trim();
    pnpm(
      ['install', '--offline', '--frozen-lockfile', '--ignore-scripts', '--store-dir', store],
      root,
      log,
    );
    pnpm(['--filter', '@portfolio/web', 'build'], root, log);
    return { root, web, packages, remove };
  } catch (error) {
    remove();
    throw error;
  }
}
