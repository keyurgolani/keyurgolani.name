#!/usr/bin/env node
// The container rehearsal (#3, Verification required): CI only, on Linux
// with Docker. With the shipped Dockerfile and deploy/compose.owner.yml it
// walks Slice 3's container criterion, then status, a backup into ./backups,
// a restore into an empty volume, and verify.
//
//   1. The image, built from a temporary `git worktree` of HEAD with #5's
//      reference variant (tests/external-variant) installed from its tarball,
//      so the fixture pair, which selects it, can go live: until #13 no
//      composition but the fallback is registered, and a publish refuses an
//      unregistered variant.
//   2. The owner stack: compose.owner.yml as shipped, with an override that
//      names that image, the fixture pair in ../config, a password hash made
//      by the image's own hash-password, and ./backups, owned by uid 1001.
//   3. A non-root container that imported the mounted pair as revision 1 at
//      its first start; an edit to the mounted file that changes nothing live,
//      though `status` says the source drifted, until a second
//      `portfolio-store import`; the container recreated, serving the same
//      live revision; and startup stopped, with a named diagnostic, by a data
//      directory that is missing or can't be written.
//   4. `status`, `backup --out /backups/b1`, the volume removed, `restore`
//      into the empty volume a new run gets, `verify`, and the stack started
//      on it, serving the same live revision and unitHash.
//
// Everything it starts listens on 127.0.0.1 only, as compose.owner.yml
// publishes, and reaches no other host. The stack, its volume, the image,
// the worktree, and every temporary file go, pass or fail. Reports go to
// reports/rehearsal.
//
// Environment:
//   CONTAINER_CLI          docker (default)
//   REHEARSAL_TIMEOUT_MS   how long to wait for /api/health (default 180000)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort, getText, waitFor } from '../tests/harness/net.mjs';
import {
  currentGate,
  REPO_ROOT,
  reportError,
  reportsDir,
  writeFailureRecord,
} from './lib/reports.mjs';

const cli = process.env.CONTAINER_CLI || 'docker';
const timeoutMs = Number(process.env.REHEARSAL_TIMEOUT_MS || 180_000);
const IMAGE = 'portfolio:rehearsal';
const PROJECT = `portfolio-rehearsal-${process.pid}`;
const VOLUME = `${PROJECT}_portfolio-data`;
const REFERENCE = path.join(REPO_ROOT, 'tests', 'external-variant');
/** What the reference variant's build reads. */
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
const REPORTS = path.join(reportsDir(), 'rehearsal');
/** What `status` says of a mounted pair the last import brought in. */
const UNCHANGED = 'the mounted pair is what the last import brought in.';
const PNPM = process.env.npm_execpath ? [process.execPath, process.env.npm_execpath] : ['pnpm'];

class RehearsalFailure extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.fields = fields;
  }
}

function run(command, args, { cwd = REPO_ROOT, input, env = {}, timeout } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    input,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...(timeout ? { timeout } : {}),
  });
  if (result.error && result.error.code !== 'ETIMEDOUT') throw result.error;
  return { code: result.status, out: result.stdout ?? '', err: result.stderr ?? '' };
}

/** Runs a command that must succeed, and returns its stdout. */
function must(command, args, options) {
  const result = run(command, args, options);
  if (result.code !== 0) {
    throw new RehearsalFailure(`${[command, ...args].join(' ')} exited ${result.code}`, {
      test: 'rehearsal setup',
      actual: `${result.out}${result.err}`.slice(-2000),
    });
  }
  return result.out;
}

const pnpm = (args, options) => must(PNPM[0], [...PNPM.slice(1), ...args], options);
const git = (args, cwd = REPO_ROOT) => must('git', args, { cwd });

let started = Date.now();
function step(title) {
  console.log(`\n[rehearsal] ${title} (${((Date.now() - started) / 1000).toFixed(0)}s in)`);
}

/** The value of a `label: value` line portfolio-store printed. */
export function field(text, label) {
  const prefix = `${label}: `;
  return text
    .split('\n')
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length);
}

/** The live revision and seq in a `live revision: rev_x (seq n)` line. */
export function liveOf(text) {
  const match = /^(rev_[0-9a-f]{32}) \(seq (\d+)\)$/.exec(field(text, 'live revision') ?? '');
  return match ? { revisionId: match[1], seq: Number(match[2]) } : null;
}

/**
 * The fixture pair: the harness's, with its site selecting the reference
 * variant, and `marker` in the portfolio's meta description, which every
 * page's <head> carries.
 */
export function fixturePair(variant, marker) {
  const site = readFileSync(path.join(REPO_ROOT, 'tests', 'fixtures', 'site.yml'), 'utf8');
  assert.ok(
    site.includes('\n  variant: missing-variant\n'),
    'the fixture site selects missing-variant',
  );
  const portfolio = readFileSync(
    path.join(REPO_ROOT, 'tests', 'fixtures', 'portfolio.yml'),
    'utf8',
  );
  const description = '  description: Fixture portfolio for the browser harness.\n';
  assert.ok(portfolio.includes(description), 'the fixture portfolio has its meta description');
  return {
    portfolio: portfolio.replace(description, `  description: Fixture portfolio, ${marker}.\n`),
    site: site.replace('\n  variant: missing-variant\n', `\n  variant: ${variant}\n`),
  };
}

/** Builds the reference variant outside the worktree and packs it, returning the tarball. */
function packReference(host, work) {
  const dir = path.join(work, 'reference');
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
  must(process.execPath, [tsc, '-p', path.join(dir, 'tsconfig.json')], { cwd: dir });
  const out = path.join(work, 'pack');
  mkdirSync(out);
  pnpm(['pack', '--pack-destination', out], { cwd: dir });
  const [tarball] = readdirSync(out).filter((name) => name.endsWith('.tgz'));
  assert.ok(tarball, 'pnpm pack writes the tarball');
  return path.join(out, tarball);
}

/** The image under test: HEAD's Dockerfile, with the reference variant a dependency of the host. */
function buildImage(work) {
  const host = path.join(work, 'host');
  git(['worktree', 'add', '--detach', host, git(['rev-parse', 'HEAD']).trim()]);
  const store = pnpm(['store', 'path']).trim();
  pnpm(['install', '--offline', '--frozen-lockfile', '--ignore-scripts', '--store-dir', store], {
    cwd: host,
  });
  const tarball = packReference(host, work);
  // Inside the build context, so the image's frozen install finds it.
  const vendor = path.join(host, 'apps', 'web', 'vendor');
  mkdirSync(vendor);
  cpSync(tarball, path.join(vendor, path.basename(tarball)));
  // The add tests/external-variant/run.mjs makes (#5), from the store this
  // job's install filled. pnpm resolves a relative tarball from apps/web
  // and records file:vendor/..., which the image's install finds; an
  // absolute one, as run.mjs passes, would record the runner's path.
  pnpm(
    [
      '--filter',
      '@portfolio/web',
      'add',
      `./vendor/${path.basename(tarball)}`,
      '--prefer-offline',
      '--store-dir',
      store,
    ],
    { cwd: host },
  );
  const { name } = JSON.parse(readFileSync(path.join(REFERENCE, 'package.json'), 'utf8'));
  const added = JSON.parse(readFileSync(path.join(host, 'apps', 'web', 'package.json'), 'utf8'))
    .dependencies?.[name];
  assert.match(added ?? '', /^file:vendor\//, `${name} is a dependency from the build context`);
  must(cli, ['build', '-t', IMAGE, '.'], { cwd: host });
  return host;
}

function compose(site, args, options = {}) {
  return run(
    cli,
    [
      'compose',
      '-p',
      PROJECT,
      '-f',
      'compose.owner.yml',
      '-f',
      'compose.rehearsal.yml',
      '--env-file',
      '.env',
      ...args,
    ],
    { cwd: path.join(site.root, 'deploy'), ...options },
  );
}

/**
 * A run of its own, as docs/deployment.md runs the store's CLI beside the
 * server: named, so it never takes the service's fixed container name.
 */
const oneOff = (site, args, mounts = []) =>
  compose(site, [
    'run',
    '--rm',
    '--no-deps',
    '--name',
    `${PROJECT}-cli`,
    ...mounts.flatMap((mount) => ['-v', mount]),
    'web',
    ...args,
  ]);

/** portfolio-store in the running server's container, or in a run of its own when `stopped`. */
function store(site, args, { stopped = false, mounts = [] } = {}) {
  const command = ['node', 'bin/portfolio-store.mjs', ...args];
  return stopped ? oneOff(site, command, mounts) : compose(site, ['exec', '-T', 'web', ...command]);
}

/** The deploy/ layout compose.owner.yml expects, beside config/, assets/, and backups/. */
function stack(work, port, marker, variant) {
  const root = path.join(work, 'site');
  const deploy = path.join(root, 'deploy');
  for (const dir of ['deploy/secrets', 'config', 'assets', 'backups']) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  cpSync(
    path.join(REPO_ROOT, 'deploy', 'compose.owner.yml'),
    path.join(deploy, 'compose.owner.yml'),
  );
  // The shipped file names portfolio:latest and how to build it; this names the image built above.
  writeFileSync(
    path.join(deploy, 'compose.rehearsal.yml'),
    `services:\n  web:\n    image: ${IMAGE}\n    pull_policy: never\n`,
  );
  writeFileSync(
    path.join(deploy, '.env'),
    `PORTFOLIO_ORIGIN=http://127.0.0.1:${port}\nPORT=${port}\n`,
  );
  const pair = fixturePair(variant, marker);
  writeFileSync(path.join(root, 'config', 'portfolio.yml'), pair.portfolio);
  writeFileSync(path.join(root, 'config', 'site.yml'), pair.site);
  // The image's own hash-password, given a password made for this run twice.
  const password = `rehearsal-${randomBytes(12).toString('hex')}`;
  const hash = must(
    cli,
    ['run', '--rm', '-i', IMAGE, 'node', 'apps/web/bin/owner.mjs', 'hash-password', '--stdin'],
    {
      input: `${password}\n${password}\n`,
    },
  ).replace(/\n$/, '');
  assert.match(hash, /^\$scrypt\$/, 'hash-password prints a PHC string');
  // 0400, as docs/deployment.md asks. CI's runner is uid 1001, the server's user.
  writeFileSync(path.join(deploy, 'secrets', 'owner_password_hash'), hash, { mode: 0o400 });
  return { root, port, origin: `http://127.0.0.1:${port}` };
}

async function waitHealthy(site) {
  await waitFor(
    async () => {
      const response = await getText(`${site.origin}/api/health`);
      return response.status === 200 ? response : undefined;
    },
    { timeoutMs, intervalMs: 1000, what: 'GET /api/health to answer 200' },
  ).catch((error) => {
    throw new RehearsalFailure(error.message, {
      test: 'the owner server starts',
      route: '/api/health',
    });
  });
}

async function home(site) {
  const response = await getText(`${site.origin}/`);
  if (response.status !== 200) {
    throw new RehearsalFailure(`GET / answered ${response.status}`, { test: 'GET /', route: '/' });
  }
  return response.body;
}

function expectStore(result, what, code = 0) {
  if (result.code !== code) {
    throw new RehearsalFailure(`${what}: portfolio-store exited ${result.code}, not ${code}`, {
      test: what,
      actual: `${result.out}${result.err}`.slice(-2000),
    });
  }
  console.log(result.out.trimEnd().replace(/^/gm, '  '));
  return result.out;
}

/** The fatal startup line a data directory problem logs, by its code. */
function fatalFor(site, dataDir, code) {
  // A server that started anyway is stopped, not waited for.
  const name = `${PROJECT}-startup`;
  const result = compose(
    site,
    ['run', '--rm', '--no-deps', '--name', name, '-e', `PORTFOLIO_DATA_DIR=${dataDir}`, 'web'],
    { timeout: 120_000 },
  );
  run(cli, ['rm', '-f', name]);
  const lines = result.out.split('\n').flatMap((line) => {
    try {
      return line.startsWith('{') ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });
  const fatal = lines.find(
    (line) =>
      line.event === 'config.fatal' && line.key === 'PORTFOLIO_DATA_DIR' && line.code === code,
  );
  if (result.code === 0 || !fatal) {
    throw new RehearsalFailure(`a data directory at ${dataDir} didn't stop startup with ${code}`, {
      test: 'a missing or unwritable data directory stops owner startup',
      expected: code,
      actual: `exit ${result.code}`,
    });
  }
  console.log(`  ${dataDir}: exit ${result.code}, config.fatal ${code}`);
}

async function walk(work) {
  const { id: variant } = JSON.parse(readFileSync(path.join(REFERENCE, 'manifest.json'), 'utf8'));
  const port = await freePort();
  const first = `rehearsal one ${randomBytes(4).toString('hex')}`;
  const second = `rehearsal two ${randomBytes(4).toString('hex')}`;
  const site = stack(work, port, first, variant);
  assert.equal(
    statSync(path.join(site.root, 'backups')).uid,
    1001,
    './backups is owned by uid 1001',
  );

  step('The owner stack, from compose.owner.yml as shipped');
  const up = compose(site, ['up', '-d', '--no-build']);
  if (up.code !== 0)
    throw new RehearsalFailure(`compose up exited ${up.code}`, {
      test: 'compose up',
      actual: up.err.slice(-2000),
    });
  await waitHealthy(site);
  const uid = compose(site, ['exec', '-T', 'web', 'id', '-u']).out.trim();
  assert.equal(uid, '1001', 'the server runs as uid 1001, not root');
  console.log('  the server runs as uid 1001');

  step('The first start imported the mounted pair as revision 1');
  const imported = expectStore(store(site, ['status']), 'status after the first start');
  const one = liveOf(imported);
  assert.equal(one?.seq, 1, 'revision 1 is live');
  assert.match(field(imported, 'last event') ?? '', /^1 {2}import {2}/, 'by an import event');
  assert.equal(field(imported, 'source'), UNCHANGED, 'and the mounted pair is what it imported');
  assert.match(
    compose(site, ['logs', '--no-color', 'web']).out,
    /"event":"store\.import\.first_start"/,
    'startup logged the import',
  );
  assert.ok((await home(site)).includes(first), 'GET / serves it');

  step('An edit to the mounted file changes nothing live');
  const portfolio = path.join(site.root, 'config', 'portfolio.yml');
  writeFileSync(portfolio, readFileSync(portfolio, 'utf8').replace(first, second));
  const drifted = expectStore(store(site, ['status']), 'status after the edit');
  assert.deepEqual(liveOf(drifted), one, 'the live revision is the same');
  assert.match(
    field(drifted, 'source') ?? '',
    /^Source files changed since the live revision\. /,
    'status says the mounted pair drifted',
  );
  const page = await home(site);
  assert.ok(page.includes(first) && !page.includes(second), 'GET / serves the live revision still');

  step('A second import takes the edit');
  const again = expectStore(store(site, ['import']), 'the second import');
  const two = liveOf(again);
  assert.equal(two?.seq, 2);
  assert.notEqual(two?.revisionId, one?.revisionId, 'a new revision is live');
  assert.equal(
    field(expectStore(store(site, ['status']), 'status after the second import'), 'source'),
    UNCHANGED,
    'and the mounted pair is what it imported',
  );
  await waitFor(async () => ((await home(site)).includes(second) ? true : undefined), {
    timeoutMs: 30_000,
    what: 'GET / to serve the second import',
  });

  step('Recreated, the container serves the same live revision');
  const recreate = compose(site, ['up', '-d', '--no-build', '--force-recreate']);
  if (recreate.code !== 0)
    throw new RehearsalFailure(`compose up --force-recreate exited ${recreate.code}`, {
      test: 'recreate',
    });
  await waitHealthy(site);
  assert.deepEqual(liveOf(expectStore(store(site, ['status']), 'status after the recreate')), two);
  assert.ok((await home(site)).includes(second), 'GET / serves it');

  step('A missing or unwritable data directory stops owner startup');
  fatalFor(site, '/var/lib/portfolio/missing', 'data_dir_missing');
  fatalFor(site, '/app', 'data_dir_not_writable');

  step('status, then backup --out /backups/b1');
  const status = expectStore(store(site, ['status']), 'status');
  const unitHash = field(status, 'unit hash');
  const backups = `${path.join(site.root, 'backups')}:/backups`;
  const backup = expectStore(
    store(site, ['backup', '--out', '/backups/b1'], { stopped: true, mounts: [backups] }),
    'backup',
  );
  assert.deepEqual(liveOf(backup), two);
  assert.equal(field(backup, 'unit hash'), unitHash);
  const manifest = JSON.parse(
    readFileSync(path.join(site.root, 'backups', 'b1', 'backup-manifest.json'), 'utf8'),
  );
  assert.ok(
    manifest.files.every((file) => !file.path.startsWith('ephemeral/')),
    'no ephemeral/ in it',
  );
  assert.equal(manifest.files.at(-1).path, 'publication/live.json', 'live.json last');

  step('restore into an empty volume, then verify');
  if (compose(site, ['down']).code !== 0)
    throw new RehearsalFailure('compose down failed', { test: 'compose down' });
  must(cli, ['volume', 'rm', VOLUME]);
  // The run gets a new volume, made from the image's empty /var/lib/portfolio: uid 1001, 0700.
  const restore = expectStore(
    store(site, ['restore', '--from', '/backups/b1', '--into', '/var/lib/portfolio'], {
      stopped: true,
      mounts: [`${backups}:ro`],
    }),
    'restore',
  );
  assert.deepEqual(liveOf(restore), two, 'the same live revision');
  assert.equal(field(restore, 'unit hash'), unitHash, 'and unitHash');
  assert.match(restore, /^The restore brings back no session/m);
  expectStore(store(site, ['verify'], { stopped: true }), 'verify');
  const ephemeral = oneOff(site, [
    'node',
    '-e',
    "process.exit(require('node:fs').existsSync('/var/lib/portfolio/ephemeral') ? 1 : 0)",
  ]);
  assert.equal(ephemeral.code, 0, 'restore created no ephemeral/');

  step('The stack on the restored volume');
  const restored = compose(site, ['up', '-d', '--no-build']);
  if (restored.code !== 0)
    throw new RehearsalFailure(`compose up exited ${restored.code}`, {
      test: 'compose up on the restored volume',
    });
  await waitHealthy(site);
  const after = expectStore(store(site, ['status']), 'status on the restored volume');
  assert.deepEqual(liveOf(after), two);
  assert.equal(field(after, 'unit hash'), unitHash);
  assert.ok((await home(site)).includes(second), 'GET / serves it');
  return site;
}

function saveLogs(site) {
  if (!site) return;
  mkdirSync(REPORTS, { recursive: true });
  const logs = compose(site, ['logs', '--no-color']);
  writeFileSync(path.join(REPORTS, 'compose.log'), `${logs.out}${logs.err}`);
}

async function main() {
  mkdirSync(path.join(REPO_ROOT, 'test-results'), { recursive: true });
  const work = mkdtempSync(path.join(REPO_ROOT, 'test-results', 'rehearsal-'));
  let site;
  let exitCode = 0;
  try {
    if (!existsSync(path.join(REFERENCE, 'manifest.json'))) {
      throw new RehearsalFailure(
        "tests/external-variant isn't in this checkout: it lands with #5's slice 6",
        {
          test: 'the reference variant',
        },
      );
    }
    step('The image, with the reference variant installed');
    buildImage(work);
    site = await walk(work);
    step('Passed');
  } catch (error) {
    exitCode = 1;
    reportError(`container rehearsal: ${error.message}`, { title: 'container rehearsal' });
    const gate = currentGate();
    if (gate) {
      writeFailureRecord({
        ...gate,
        ...(error.fields ?? { test: 'container rehearsal' }),
        asset: IMAGE,
        artifacts: ['rehearsal/compose.log'],
      });
    }
  } finally {
    // The stack, whether walk() got far enough to return it or not.
    const stackSite = site ?? { root: path.join(work, 'site') };
    if (existsSync(path.join(stackSite.root, 'deploy', 'compose.rehearsal.yml'))) {
      if (exitCode !== 0) saveLogs(stackSite);
      compose(stackSite, ['down', '-v', '--remove-orphans']);
      run(cli, ['volume', 'rm', '-f', VOLUME]);
    }
    run(cli, ['image', 'rm', '-f', IMAGE]);
    const host = path.join(work, 'host');
    if (existsSync(host)) run('git', ['worktree', 'remove', '--force', host]);
    run('git', ['worktree', 'prune']);
    rmSync(work, { recursive: true, force: true });
  }
  return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  started = Date.now();
  process.exitCode = await main();
}
