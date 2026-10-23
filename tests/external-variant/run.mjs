#!/usr/bin/env node
// `pnpm test:external-variant` (#5, Slice 6): the reference third-party
// variant in this directory, installed the way an owner installs a variant
// from its tarball, checked, and removed, in a temporary `git worktree` of
// HEAD. Nothing in this checkout changes. Packages come from the store this
// checkout's install filled; the add and the remove may fetch registry
// metadata, which a frozen install never reads, and the servers it starts
// reach no host outside the machine.
//
//   1. The worktree, installed offline from the store this checkout's
//      install filled. git status is clean.
//   2. The package built outside it, its peers linked from the worktree's
//      install as a published package's devDependencies would be: tsc writes
//      ESM and .d.ts into dist/, and `pnpm pack` makes the tarball, which
//      holds no source, script, or public/ file.
//   3. `pnpm --filter @portfolio/web add <tarball>`. git status shows
//      apps/web/package.json and pnpm-lock.yaml, and the dependency is the
//      one change to the host's package.json: no host edit.
//   4. `pnpm build`. Discovery: registry generation lists acme-reference and
//      its badge enhancement, and `pnpm check:variants` audits it clean.
//      Compatibility: the host's compatibility test runs every registered
//      composition, the reference included, against every contract fixture,
//      and `pnpm config:validate --json` reports what its manifest earns:
//      kind.unsupported, slot.recommended-empty, and direction.unsupported.
//   5. The variant specs for acme-reference alone: the six modes on every
//      contract fixture and the sample, the hidden canary, and render parity.
//      Then the reference's own checks: the colophon view, the compact
//      control, and the badge's lazy load.
//   6. `pnpm --filter @portfolio/web remove @acme/reference`: git status is
//      clean again. After `pnpm build`, a site selecting acme-reference gets
//      the fallback composition with 200, a variant.unavailable warning at
//      startup and from config:validate, and degraded readiness.
//
// The worktree and every temporary file go, pass or fail. It tests HEAD, so
// commit first: an uncommitted change in this checkout isn't in it. Reports
// go to reports/variants and reports/external-variant, as CI uploads them.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reportsDir } from '../../ci/lib/reports.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const HOST_PACKAGE = '@portfolio/web';
const { name: PACKAGE, version: VERSION } = JSON.parse(
  readFileSync(path.join(HERE, 'package.json'), 'utf8'),
);
const { id: ID } = JSON.parse(readFileSync(path.join(HERE, 'manifest.json'), 'utf8'));
/** What the package's build reads. */
const PACKAGE_FILES = ['package.json', 'manifest.json', 'styles.css', 'tsconfig.json', 'src'];
/** What its build resolves, as a published variant's devDependencies would install them. */
const BUILD_DEPENDENCIES = [
  '@portfolio/kit',
  '@portfolio/schema',
  '@portfolio/variant-contract',
  '@types/react',
  '@types/react-dom',
  'react',
  'react-dom',
];
/** Everything the tarball holds. */
const TARBALL_FILES = [
  'dist/enhancements/badge.d.ts',
  'dist/enhancements/badge.js',
  'dist/index.d.ts',
  'dist/index.js',
  'manifest.json',
  'package.json',
  'styles.css',
];
/** A fixture, and what the reference's manifest earns on it. */
const EXPECTED_FINDINGS = [
  ['complete', 'kind.unsupported'],
  ['identity-only', 'slot.recommended-empty'],
  ['rtl', 'direction.unsupported'],
];
const SELECTION = '\n  variant: missing-variant\n';
/** The sentences every compatibility finding ends with. */
const CONSEQUENCE = /It blocks (?:publishing, not preview|neither preview nor publishing)\.$/;

/** pnpm as the script running this was started with, else from PATH. */
const PNPM = process.env.npm_execpath ? [process.execPath, process.env.npm_execpath] : ['pnpm'];

/** Set by Ctrl-C, which reaches the step running too: no step starts after it. */
let interrupted = false;

function run(command, args, { cwd, env = {}, capture = false }) {
  if (interrupted) throw new Error('Interrupted.');
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...env },
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const why = result.signal ? `stopped by ${result.signal}` : `exited with ${result.status}`;
    throw new Error(`${[command, ...args].join(' ')} ${why} (in ${cwd})`);
  }
  return capture ? result.stdout : '';
}

const pnpm = (args, options) => run(PNPM[0], [...PNPM.slice(1), ...args], options);
const git = (args, cwd) => run('git', args, { cwd, capture: true });

/** git status --porcelain, as lines. */
const status = (host) => git(['status', '--porcelain'], host).split('\n').filter(Boolean);

/**
 * Asserts git status is `expected`, and when it isn't, prints the diff of
 * what changed first, so a failure shows what the step wrote.
 */
function expectStatus(host, expected, message) {
  const actual = status(host);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const diff = git(['diff', '--', ...actual.map((line) => line.slice(3))], host);
    console.error(`[external-variant] ${message}, but git status shows:\n${actual.join('\n')}`);
    console.error(diff.split('\n').slice(0, 120).join('\n'));
  }
  assert.deepEqual(actual, expected, message);
}

let started = Date.now();
function step(title) {
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`\n[external-variant] ${title} (${seconds}s in)`);
}

/** A contract fixture's pair in its own directory, its site selecting `variant`. */
function fixturePair(host, work, fixture, variant) {
  const from = path.join(host, 'packages', 'variant-contract', 'fixtures', fixture);
  const dir = path.join(work, 'fixtures', `${fixture}-${variant}`);
  mkdirSync(dir, { recursive: true });
  const site = readFileSync(path.join(from, 'site.yml'), 'utf8');
  assert.ok(site.includes(SELECTION), `${fixture}'s site no longer selects missing-variant`);
  writeFileSync(path.join(dir, 'site.yml'), site.replace(SELECTION, `\n  variant: ${variant}\n`));
  cpSync(path.join(from, 'portfolio.yml'), path.join(dir, 'portfolio.yml'));
  return dir;
}

/**
 * `pnpm config:validate <dir> --json` in the worktree. Each finding this run
 * expects says what it blocks and what to do about it.
 */
function validate(host, dir) {
  const report = JSON.parse(
    pnpm(['--silent', 'config:validate', dir, '--json'], { cwd: host, capture: true }),
  );
  const expected = new Set(['variant.unavailable', ...EXPECTED_FINDINGS.map(([, code]) => code)]);
  for (const { code, message, remediation } of report.diagnostics) {
    if (!expected.has(code)) continue;
    assert.match(message, CONSEQUENCE, `${code} says what it blocks`);
    assert.ok(remediation, `${code} says what to do`);
  }
  return report;
}

/** Builds the package outside the worktree and packs it, returning the tarball. */
function packReference(host, work) {
  const dir = path.join(work, 'build', 'reference');
  for (const name of PACKAGE_FILES) {
    cpSync(path.join(host, 'tests', 'external-variant', name), path.join(dir, name), {
      recursive: true,
    });
  }
  for (const name of BUILD_DEPENDENCIES) {
    const link = path.join(dir, 'node_modules', name);
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(realpathSync(path.join(host, 'apps', 'web', 'node_modules', name)), link, 'dir');
  }
  const tsc = path.join(host, 'node_modules', 'typescript', 'bin', 'tsc');
  run(process.execPath, [tsc, '-p', path.join(dir, 'tsconfig.json')], { cwd: dir });
  assert.match(
    readFileSync(path.join(dir, 'dist', 'enhancements', 'badge.js'), 'utf8'),
    /^['"]use client['"];/,
    'the enhancement stays a client module',
  );
  const out = path.join(work, 'pack');
  mkdirSync(out);
  pnpm(['pack', '--pack-destination', out], { cwd: dir, capture: true });
  const tarballs = readdirSync(out).filter((name) => name.endsWith('.tgz'));
  assert.equal(tarballs.length, 1, 'pnpm pack writes one tarball');
  const tarball = path.join(out, tarballs[0]);
  const files = run('tar', ['-tzf', tarball], { cwd: out, capture: true })
    .split('\n')
    .filter(Boolean)
    .map((name) => name.replace(/^package\//, ''))
    .sort();
  assert.deepEqual(files, TARBALL_FILES, 'the tarball holds the built package alone');
  const packed = JSON.parse(
    run('tar', ['-xzOf', tarball, 'package/package.json'], { cwd: out, capture: true }),
  );
  assert.equal(packed.scripts, undefined, 'the package runs no script on install');
  return tarball;
}

/** The host's package.json in the worktree, against HEAD's: what `pnpm add` changed in it. */
function addedDependencies(host) {
  const before = JSON.parse(git(['show', 'HEAD:apps/web/package.json'], host));
  const after = JSON.parse(readFileSync(path.join(host, 'apps', 'web', 'package.json'), 'utf8'));
  const { [PACKAGE]: added, ...dependencies } = after.dependencies ?? {};
  assert.ok(added, `apps/web/package.json depends on ${PACKAGE}`);
  assert.deepEqual({ ...after, dependencies }, before, `${PACKAGE} is the one change to it`);
}

/** The removed variant's selection, served: the fallback composition, the warning, and degraded readiness. */
async function checkRemoved(host, work) {
  const { startApp } = await import(
    pathToFileURL(path.join(host, 'tests', 'harness', 'app-server.mjs')).href
  );
  const dir = fixturePair(host, work, 'complete', ID);
  const app = await startApp({
    web: path.join(host, 'apps', 'web'),
    portfolio: path.join(dir, 'portfolio.yml'),
    siteText: readFileSync(path.join(dir, 'site.yml'), 'utf8'),
  });
  try {
    const warned = () =>
      readFileSync(app.log, 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line))
        .some(({ event, code }) => event === 'config.warning' && code === 'variant.unavailable');
    const deadline = Date.now() + 10_000;
    while (!warned() && Date.now() < deadline) await new Promise((done) => setTimeout(done, 200));
    assert.ok(warned(), 'startup warns variant.unavailable');
    const page = await fetch(`${app.origin}/`);
    assert.equal(page.status, 200, 'GET / answers 200');
    assert.ok(
      (await page.text()).includes(`<div data-variant="fallback" data-requested-variant="${ID}"`),
      'the fallback composition renders in its place',
    );
    const ready = await fetch(`${app.origin}/api/ready`);
    const body = await ready.json();
    assert.equal(body.status, 'degraded', 'readiness is degraded');
    assert.ok(
      body.checks.some(({ id, status: state }) => id === 'packs' && state === 'degraded'),
      'the packs check is degraded',
    );
    const view = await fetch(`${app.origin}/colophon`, { redirect: 'manual' });
    assert.equal(view.status, 404, 'no installed variant declares /colophon now');
    assert.deepEqual(app.egress(), [], 'the server reached no outside host');
  } finally {
    await app.stop();
  }
}

/**
 * Steps 1 to 3: a worktree of HEAD in `work`/host, installed offline from
 * the store this checkout's install filled, with the reference variant
 * packed outside it and added from its tarball, as an owner installs one.
 * Returns the worktree and the store. #11's close and scheduled quality runs
 * install it this way too (tests/quality/run.ts --external-variant).
 *
 * @param {string} work an empty temporary directory
 * @param {{ onAdded?: () => void }} [hooks] onAdded runs as soon as the add
 *   succeeds, before the checks after it, so a failure there still knows
 *   the variant is installed
 * @returns {{ host: string, store: string }}
 */
export function installReference(work, { onAdded } = {}) {
  const host = path.join(work, 'host');
  const head = git(['rev-parse', 'HEAD'], REPO_ROOT).trim();
  step(`A worktree of HEAD (${head.slice(0, 12)}) in ${host}`);
  if (status(REPO_ROOT).length > 0) {
    console.log(
      '[external-variant] This checkout has uncommitted changes, which the run leaves out.',
    );
  }
  git(['worktree', 'add', '--detach', host, head], REPO_ROOT);
  const store = pnpm(['store', 'path'], { cwd: REPO_ROOT, capture: true }).trim();
  pnpm(['install', '--offline', '--frozen-lockfile', '--ignore-scripts', '--store-dir', store], {
    cwd: host,
  });
  expectStatus(host, [], 'the installed worktree is clean');

  step(`Building and packing ${PACKAGE}`);
  const tarball = packReference(host, work);

  step(`pnpm --filter ${HOST_PACKAGE} add ${path.basename(tarball)}`);
  // Prefer-offline, not offline: with no package metadata cached, as after
  // a frozen install, an offline add resolves the workspace without the
  // other platforms' optional packages and drops them from the lockfile.
  pnpm(['--filter', HOST_PACKAGE, 'add', tarball, '--prefer-offline', '--store-dir', store], {
    cwd: host,
  });
  onAdded?.();
  expectStatus(
    host,
    [' M apps/web/package.json', ' M pnpm-lock.yaml'],
    'the add changes the dependency and the lockfile, and no host file',
  );
  addedDependencies(host);
  return { host, store };
}

/** Removes the worktree installReference() made in `work`, and `work` itself. */
export function removeReference(work) {
  const host = path.join(work, 'host');
  try {
    if (existsSync(host)) git(['worktree', 'remove', '--force', host], REPO_ROOT);
  } catch (error) {
    console.error(`[external-variant] git worktree remove failed: ${error.message}`);
  }
  rmSync(work, { recursive: true, force: true });
  git(['worktree', 'prune'], REPO_ROOT);
}

/** Builds the worktree's host, under `env`'s build-time flags, such as #11's quality flags. */
export function buildReferenceHost(host, env = {}) {
  step('pnpm build');
  pnpm(['build'], { cwd: host, env });
}

async function main() {
  const work = mkdtempSync(path.join(tmpdir(), 'portfolio-external-variant-'));
  const host = path.join(work, 'host');
  const reports = reportsDir();
  const env = { CI_REPORTS_DIR: reports, PORTFOLIO_VARIANTS_WEB: path.join(host, 'apps', 'web') };
  // Ctrl-C fails the step running and starts no other, so the cleanup still runs.
  process.on('SIGINT', () => {
    interrupted = true;
  });
  let added = false;
  try {
    const { store } = installReference(work, {
      onAdded: () => {
        added = true;
      },
    });

    buildReferenceHost(host);

    step('Discovery: the registry and the audit');
    const registry = JSON.parse(
      pnpm(
        ['--silent', '--filter', HOST_PACKAGE, 'build:registry', '--check', '--format', 'json'],
        {
          cwd: host,
          capture: true,
        },
      ),
    );
    assert.deepEqual(registry.diagnostics, [], 'registry generation reports nothing');
    assert.deepEqual(
      registry.variants.find(({ id }) => id === ID),
      { id: ID, package: PACKAGE, version: VERSION },
      `registry generation registers ${ID}`,
    );
    const enhancements = readFileSync(
      path.join(host, 'apps', 'web', 'src', 'lib', 'generated', 'registry.enhancements.ts'),
      'utf8',
    );
    assert.ok(
      enhancements.includes(`"${ID}/badge": () => import("${PACKAGE}/enhancements/badge")`),
      'the badge enhancement loads through its own import()',
    );
    pnpm(['--filter', HOST_PACKAGE, 'check:variants', '--package', PACKAGE], { cwd: host });

    step('Compatibility: every registered composition on every contract fixture');
    pnpm(
      [
        '--filter',
        HOST_PACKAGE,
        'exec',
        'tsx',
        '--conditions=react-server',
        '--test',
        'src/lib/compatibility.test.ts',
      ],
      { cwd: host },
    );
    for (const [fixture, code] of EXPECTED_FINDINGS) {
      const report = validate(host, fixturePair(host, work, fixture, ID));
      const codes = report.diagnostics.map((record) => record.code);
      assert.ok(report.ok, `${fixture} validates`);
      assert.ok(codes.includes(code), `${fixture} in ${ID} reports ${code}: ${codes}`);
      assert.ok(!codes.includes('variant.unavailable'), `${ID} is registered`);
      console.log(`[external-variant] config:validate ${fixture}: ${codes.join(', ')}`);
    }

    step(`The variant specs for ${ID}`);
    pnpm(['test:variants'], { cwd: host, env: { ...env, PORTFOLIO_VARIANTS_ONLY: ID } });

    step(`The reference's checks: its view, its control, and its enhancement`);
    pnpm(
      ['exec', 'playwright', 'test', '--config', 'tests/external-variant/playwright.config.ts'],
      {
        cwd: host,
        env,
      },
    );

    step(`pnpm --filter ${HOST_PACKAGE} remove ${PACKAGE}`);
    // remove takes no --prefer-offline flag, so the setting goes in as config.
    pnpm(
      [
        '--filter',
        HOST_PACKAGE,
        'remove',
        PACKAGE,
        '--config.prefer-offline=true',
        '--store-dir',
        store,
      ],
      {
        cwd: host,
      },
    );
    added = false;
    expectStatus(host, [], 'the remove leaves nothing changed');

    step('pnpm build, without it');
    pnpm(['build'], { cwd: host });

    step(`A site selecting ${ID}, now unavailable`);
    const unavailable = validate(host, fixturePair(host, work, 'complete', ID));
    assert.ok(
      unavailable.diagnostics.some(({ code }) => code === 'variant.unavailable'),
      'config:validate reports variant.unavailable',
    );
    await checkRemoved(host, work);
    step('Passed');
  } finally {
    if (added)
      console.log(`[external-variant] ${PACKAGE} was still installed when the run stopped.`);
    interrupted = false;
    removeReference(work);
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  started = Date.now();
  main().catch((error) => {
    console.error(`\n[external-variant] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
