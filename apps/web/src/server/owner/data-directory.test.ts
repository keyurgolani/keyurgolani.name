import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SESSION_LIFETIME, SESSION_LIFETIME_RANGE } from '@portfolio/core/owner';
import { storePaths } from '../../../../../packages/core/src/store/layout';
import { storeDirectories } from '../../../../../packages/core/src/store/preflight';
import type { AuthProviderFactory } from '../composition';
import { SESSION_LIFETIME_KEYS, type Env } from '../config';
import { runStartup, type StartupResult } from '../startup';

// The data.directory startup requirement (#2, #3): owner needs a data
// directory the server can write, and lays out the store there, with no
// auth directory until a writer makes one. A provider double stands in for
// the real one, which the login slice registers, so the data directory
// alone decides whether owner starts.

const EXAMPLES = {
  portfolio: fileURLToPath(new URL('../../../../../portfolio.example.yml', import.meta.url)),
  site: fileURLToPath(new URL('../../../../../site.example.yml', import.meta.url)),
};
/** An old one-file portfolio.yml, which owner refuses as legacy.document. */
const LEGACY_ONLY = fileURLToPath(
  new URL(
    '../../../../../packages/schema/src/__fixtures__/startup/legacy-only/portfolio.yml',
    import.meta.url,
  ),
);
const VALID =
  'schemaVersion: 3\nlocale: en\ndirection: ltr\nidentity:\n  name: Rowan Test\nsections:\n  - kind: lede\n    id: about\n    body: Hi.\n';
const base64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');
// auth.secret parses the hash and never derives, so a random key will do.
const HASH = `$scrypt$ln=17,r=8,p=1$${base64(randomBytes(16))}$${base64(randomBytes(32))}`;

const DOUBLE: AuthProviderFactory = {
  name: 'test-double',
  load: async () => ({
    resolveSession: async () => ({ session: null }),
    checkOrigin: async () => false,
    touchSession: async () => {},
  }),
};

function workspace(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'data-directory-canary-'));
  t.after(() => {
    chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  });
  const source = path.join(root, 'config');
  mkdirSync(source);
  writeFileSync(path.join(source, 'portfolio.yml'), VALID);
  copyFileSync(EXAMPLES.site, path.join(source, 'site.yml'));
  const env: Env = {
    NODE_ENV: 'production',
    PORTFOLIO_PROFILE: 'owner',
    PORTFOLIO_ORIGIN: 'https://rowan.test',
    PORTFOLIO_SOURCE_DIR: source,
    PORTFOLIO_AUTH_PASSWORD_HASH: HASH,
  };
  return { root, env };
}

const start = (env: Env) =>
  runStartup({
    env,
    cwd: '/srv/app',
    examples: EXAMPLES,
    report: () => {},
    authProviders: [DOUBLE],
  });

function fatalCodes(result: StartupResult): string[] {
  return result.issues
    .filter((issue) => issue.severity === 'fatal')
    .map((issue) => `${issue.key}:${issue.code}`);
}

test('owner refuses to start without a data directory it can write, naming the variable and never the path', async (t) => {
  const { root, env } = workspace(t);
  const file = path.join(root, 'a-file');
  writeFileSync(file, '');
  const loop = path.join(root, 'loop');
  symlinkSync(loop, loop);
  const cases: [what: string, dataDir: string | undefined, expected: string][] = [
    ['no data directory', undefined, 'PORTFOLIO_DATA_DIR:required'],
    ['a path with nothing there', path.join(root, 'absent'), 'PORTFOLIO_DATA_DIR:data_dir_missing'],
    ['a file', file, 'PORTFOLIO_DATA_DIR:data_dir_missing'],
    ['a link that loops', loop, 'PORTFOLIO_DATA_DIR:data_dir_unreachable'],
  ];
  // Root writes anywhere, so a read-only directory only means something otherwise.
  if (process.getuid?.() !== 0) {
    const locked = path.join(root, 'locked');
    mkdirSync(locked, { mode: 0o500 });
    cases.push([
      'a directory the server cannot write',
      locked,
      'PORTFOLIO_DATA_DIR:data_dir_not_writable',
    ]);
  }
  for (const [what, dataDir, expected] of cases) {
    const result = await start({ ...env, PORTFOLIO_DATA_DIR: dataDir });
    assert.equal(result.ok, false, what);
    assert.deepEqual(fatalCodes(result), [expected], what);
    assert.ok(
      !JSON.stringify(result.issues).includes('canary'),
      `${what}: a finding names the path`,
    );
  }
});

/** Every entry under `dir`, relative to it, a directory's with a trailing slash, sorted. */
function tree(dir: string): string[] {
  const found: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      const name = path.relative(dir, full);
      if (entry.isDirectory()) {
        found.push(`${name}/`);
        walk(full);
      } else {
        found.push(name);
      }
    }
  };
  walk(dir);
  return found.sort();
}

/**
 * The valid empty store, from the store's own layout: store.json, the
 * server's claim, and each store directory with those above it.
 */
function emptyStore(dataDir: string): string[] {
  const paths = storePaths(dataDir);
  const entries = new Set([
    path.relative(paths.root, paths.storeFile),
    path.relative(paths.root, paths.server),
  ]);
  for (const dir of storeDirectories(paths)) {
    for (let at = dir; at !== paths.root; at = path.dirname(at)) {
      entries.add(`${path.relative(paths.root, at)}/`);
    }
  }
  return [...entries].sort();
}

test("owner refusing the old one-file config leaves the data directory a valid empty store and nothing more, the auth state's directories included", async (t) => {
  const { root, env } = workspace(t);
  // The rehearsal's image-old-config row (#12): an old-shape portfolio.yml
  // alone, refused by documents.shape after data.directory has run.
  const source = path.join(root, 'old-config');
  mkdirSync(source);
  copyFileSync(LEGACY_ONLY, path.join(source, 'portfolio.yml'));
  const dataDir = path.join(root, 'data');
  mkdirSync(dataDir, { mode: 0o700 });
  // The build's own auth provider, as the image runs it.
  const result = await runStartup({
    env: { ...env, PORTFOLIO_SOURCE_DIR: source, PORTFOLIO_DATA_DIR: dataDir },
    cwd: '/srv/app',
    examples: EXAMPLES,
    report: () => {},
  });
  assert.equal(result.ok, false);
  assert.deepEqual(fatalCodes(result), ['PORTFOLIO_SOURCE_DIR:legacy.document']);
  const expected = emptyStore(dataDir);
  // What the store defines, named, so a change to it shows here too.
  assert.deepEqual(expected, [
    'assets/',
    'assets/sha256/',
    'audit/',
    'drafts/',
    'ephemeral/',
    'publication/',
    'publication/events/',
    'publication/server.json',
    'revisions/',
    'store.json',
  ]);
  // The refused start lets its claim go as it returns, so the server's
  // claim is the one entry of the empty store that's gone.
  const claim = path.relative(dataDir, storePaths(dataDir).server);
  assert.deepEqual(
    tree(dataDir),
    expected.filter((entry) => entry !== claim),
  );
});

test('a start that succeeds makes the store, and no auth directory until a writer needs one', async (t) => {
  const { root, env } = workspace(t);
  const dataDir = path.join(root, 'data');
  mkdirSync(dataDir, { mode: 0o700 });
  const result = await start({ ...env, PORTFOLIO_DATA_DIR: dataDir });
  assert.ok(result.ok, JSON.stringify(result.issues));
  if (result.ok) result.state.release?.();
  for (const dir of ['ephemeral', 'audit']) {
    assert.equal(statSync(path.join(dataDir, dir)).mode & 0o777, 0o700, dir);
  }
  // The provider double writes nothing, so nothing is below ephemeral/.
  assert.deepEqual(readdirSync(path.join(dataDir, 'ephemeral')), []);
  assert.ok(!tree(dataDir).some((entry) => entry.startsWith('.probe-')), 'a probe was left');
});

test('a data directory that already holds the auth directories and a session keeps them, and starts', async (t) => {
  const { root, env } = workspace(t);
  const dataDir = path.join(root, 'data');
  const sessions = path.join(dataDir, 'ephemeral', 'auth', 'sessions');
  mkdirSync(sessions, { recursive: true, mode: 0o700 });
  mkdirSync(path.join(dataDir, 'audit'), { mode: 0o700 });
  const record = path.join(sessions, `${'a'.repeat(64)}.json`);
  writeFileSync(record, '{}\n', { mode: 0o600 });
  writeFileSync(path.join(dataDir, 'ephemeral', 'auth', 'fingerprint'), 'kept\n', { mode: 0o600 });
  const result = await start({ ...env, PORTFOLIO_DATA_DIR: dataDir });
  assert.ok(result.ok, JSON.stringify(result.issues));
  if (result.ok) result.state.release?.();
  assert.deepEqual(readdirSync(sessions), [path.basename(record)]);
  assert.deepEqual(readdirSync(path.join(dataDir, 'ephemeral', 'auth')).sort(), [
    'fingerprint',
    'sessions',
  ]);
});

test('a link at ephemeral/ or audit/ refuses startup, and nothing is made through it', async (t) => {
  for (const linked of ['ephemeral', 'audit']) {
    const { root, env } = workspace(t);
    const dataDir = path.join(root, 'data');
    mkdirSync(dataDir, { mode: 0o700 });
    const elsewhere = path.join(root, 'elsewhere');
    mkdirSync(elsewhere, { mode: 0o700 });
    symlinkSync(elsewhere, path.join(dataDir, linked));
    const result = await start({ ...env, PORTFOLIO_DATA_DIR: dataDir });
    assert.equal(result.ok, false, linked);
    assert.deepEqual(fatalCodes(result), ['PORTFOLIO_DATA_DIR:data_dir_linked'], linked);
    assert.deepEqual(readdirSync(elsewhere), [], `${linked}: something was made through the link`);
  }
});

test('under next dev an unset data directory is .data, made at 0700 whatever the umask, or put back to 0700', async (t) => {
  const { root, env } = workspace(t);
  // A umask that would leave a plain mkdir group-writable, which the store's
  // preflight refuses.
  const umask = process.umask(0o002);
  t.after(() => process.umask(umask));
  const dev = async (devDataDir: string) => {
    const result = await runStartup({
      env: { ...env, NODE_ENV: 'development' },
      cwd: '/srv/app',
      examples: EXAMPLES,
      report: () => {},
      authProviders: [DOUBLE],
      devDataDir,
    });
    assert.ok(result.ok, JSON.stringify(result.issues));
    if (result.ok) result.state.release?.();
  };
  const fresh = path.join(root, '.data');
  await dev(fresh);
  assert.equal(statSync(fresh).mode & 0o777, 0o700);
  // One an older run left group-writable.
  const loose = path.join(root, 'loose', '.data');
  mkdirSync(loose, { recursive: true });
  chmodSync(loose, 0o775);
  await dev(loose);
  assert.equal(statSync(loose).mode & 0o777, 0o700);
});

test("the config's session lifetimes are the ones @portfolio/core enforces", () => {
  const { PORTFOLIO_AUTH_SESSION_IDLE_MINUTES: idle, PORTFOLIO_AUTH_SESSION_MAX_HOURS: max } =
    SESSION_LIFETIME_KEYS;
  assert.deepEqual({ idleMinutes: idle.default, maxHours: max.default }, { ...SESSION_LIFETIME });
  assert.deepEqual(
    {
      idleMinutes: { min: idle.min, max: idle.max },
      maxHours: { min: max.min, max: max.max },
    },
    JSON.parse(JSON.stringify(SESSION_LIFETIME_RANGE)),
  );
});
