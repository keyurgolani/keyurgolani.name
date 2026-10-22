import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SESSION_LIFETIME, SESSION_LIFETIME_RANGE } from '@portfolio/core/owner';
import type { AuthProviderFactory } from '../composition';
import { SESSION_LIFETIME_KEYS, type Env } from '../config';
import { runStartup, type StartupResult } from '../startup';

// The data.directory startup requirement (#2): owner needs a data directory
// the server can write, and makes its auth and audit directories there. A
// provider double stands in for the real one, which the login slice
// registers, so the data directory alone decides whether owner starts.

const EXAMPLES = {
  portfolio: fileURLToPath(new URL('../../../../../portfolio.example.yml', import.meta.url)),
  site: fileURLToPath(new URL('../../../../../site.example.yml', import.meta.url)),
};
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

test('owner startup makes the auth and audit directories in the data directory, 0700', async (t) => {
  const { root, env } = workspace(t);
  const dataDir = path.join(root, 'data');
  mkdirSync(dataDir);
  const result = await start({ ...env, PORTFOLIO_DATA_DIR: dataDir });
  assert.ok(result.ok, JSON.stringify(result.issues));
  for (const dir of ['ephemeral', 'ephemeral/auth', 'ephemeral/auth/sessions', 'audit']) {
    assert.equal(statSync(path.join(dataDir, dir)).mode & 0o777, 0o700, dir);
  }
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
