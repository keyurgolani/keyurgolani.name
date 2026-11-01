import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuthProviderFactory } from '../composition';
import type { Env } from '../config';
import { runStartup, type StartupResult } from '../startup';

// The owner credential at startup (#2): config.ts checks the hash file, and
// the auth.secret requirement checks the hash. A provider double stands in
// for the real one, which the login slice registers, so the hash alone
// decides whether owner starts. No finding may print the hash.

const EXAMPLES = {
  portfolio: fileURLToPath(new URL('../../../../../portfolio.example.yml', import.meta.url)),
  site: fileURLToPath(new URL('../../../../../site.example.yml', import.meta.url)),
};
const VALID =
  'schemaVersion: 3\nlocale: en\ndirection: ltr\nidentity:\n  name: Rowan Test\nsections:\n  - kind: lede\n    id: about\n    body: Hi.\n';

const DOUBLE: AuthProviderFactory = {
  name: 'test-double',
  load: async () => ({
    resolveSession: async () => ({ session: null }),
    checkOrigin: async () => false,
    touchSession: async () => {},
  }),
};

const base64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');

/** A well-formed PHC string with these parameters. The check never derives, so the key is random. */
const shaped = (params: string) =>
  `$scrypt$${params}$${base64(randomBytes(16))}$${base64(randomBytes(32))}`;

/** A real hash at the floor. */
function floorHash(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, {
    N: 2 ** 17,
    r: 8,
    p: 1,
    maxmem: 2 * 128 * 2 ** 17 * 8,
  });
  return `$scrypt$ln=17,r=8,p=1$${base64(salt)}$${base64(key)}`;
}

function workspace(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'auth-secret-'));
  t.after(() => {
    chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  });
  const source = path.join(root, 'config');
  mkdirSync(source);
  writeFileSync(path.join(source, 'portfolio.yml'), VALID);
  copyFileSync(EXAMPLES.site, path.join(source, 'site.yml'));
  // The data.directory requirement runs beside this one, and needs one.
  const data = path.join(root, 'data');
  mkdirSync(data);
  /** Writes `text` to a file beside the source, with `mode`, and returns its path. */
  const file = (name: string, text: string, mode = 0o400) => {
    const target = path.join(root, name);
    writeFileSync(target, text);
    chmodSync(target, mode);
    return target;
  };
  const env: Env = {
    NODE_ENV: 'production',
    PORTFOLIO_PROFILE: 'owner',
    PORTFOLIO_ORIGIN: 'https://rowan.test',
    PORTFOLIO_SOURCE_DIR: source,
    PORTFOLIO_DATA_DIR: data,
  };
  return { root, env, file };
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

test('a hash below the floor, above the ceiling, or not scrypt PHC refuses owner startup without printing it', async (t) => {
  const { env, file } = workspace(t);
  const cases: [hash: string, code: string][] = [
    [shaped('ln=16,r=8,p=1'), 'below_floor'],
    [shaped('ln=17,r=4,p=1'), 'below_floor'],
    [shaped('ln=17,r=8,p=0'), 'below_floor'],
    [shaped('ln=19,r=8,p=1'), 'above_ceiling'],
    [shaped('ln=17,r=32,p=1'), 'above_ceiling'],
    [shaped('ln=17,r=8,p=5'), 'above_ceiling'],
    ['canary-plaintext-password', 'malformed'],
    [
      `$argon2id$v=19$m=65536,t=3,p=4$${base64(randomBytes(16))}$${base64(randomBytes(32))}`,
      'malformed',
    ],
  ];
  for (const [hash, code] of cases) {
    const direct = await start({ ...env, PORTFOLIO_AUTH_PASSWORD_HASH: hash });
    assert.equal(direct.ok, false, code);
    assert.deepEqual(fatalCodes(direct), [`PORTFOLIO_AUTH_PASSWORD_HASH:${code}`], hash);
    assert.ok(!JSON.stringify(direct.issues).includes(hash), 'a finding repeats the hash');

    const fromFile = await start({
      ...env,
      PORTFOLIO_AUTH_PASSWORD_HASH_FILE: file(
        `hash-${code}-${randomBytes(4).toString('hex')}`,
        `${hash}\n`,
      ),
    });
    assert.deepEqual(fatalCodes(fromFile), [`PORTFOLIO_AUTH_PASSWORD_HASH_FILE:${code}`], hash);
    assert.ok(!JSON.stringify(fromFile.issues).includes(hash), 'a finding repeats the hash');
  }
  // The floor itself, and the ceiling, start.
  assert.equal(
    (await start({ ...env, PORTFOLIO_AUTH_PASSWORD_HASH: floorHash('rowan passphrase one') })).ok,
    true,
  );
  assert.equal(
    (await start({ ...env, PORTFOLIO_AUTH_PASSWORD_HASH: shaped('ln=18,r=16,p=4') })).ok,
    true,
  );
});

test('a hash file that is missing, set twice, unreadable, not a regular file, or writable by group or others refuses owner startup', async (t) => {
  const { root, env, file } = workspace(t);
  const hash = floorHash('rowan passphrase two');
  const good = file('owner_password_hash', hash);
  const cases: [what: string, extra: Env, expected: string][] = [
    ['no hash at all', {}, 'PORTFOLIO_AUTH_PASSWORD_HASH_FILE:required'],
    [
      'the hash and its file both',
      { PORTFOLIO_AUTH_PASSWORD_HASH: hash, PORTFOLIO_AUTH_PASSWORD_HASH_FILE: good },
      'PORTFOLIO_AUTH_PASSWORD_HASH:value_and_file',
    ],
    [
      'a file that is not there',
      { PORTFOLIO_AUTH_PASSWORD_HASH_FILE: path.join(root, 'no-such-file') },
      'PORTFOLIO_AUTH_PASSWORD_HASH_FILE:file_unreadable',
    ],
    [
      'a directory',
      { PORTFOLIO_AUTH_PASSWORD_HASH_FILE: root },
      'PORTFOLIO_AUTH_PASSWORD_HASH_FILE:file_not_regular',
    ],
    [
      'a file the group can write',
      { PORTFOLIO_AUTH_PASSWORD_HASH_FILE: file('group-writable', hash, 0o660) },
      'PORTFOLIO_AUTH_PASSWORD_HASH_FILE:file_writable',
    ],
    [
      'a file anyone can write',
      { PORTFOLIO_AUTH_PASSWORD_HASH_FILE: file('world-writable', hash, 0o646) },
      'PORTFOLIO_AUTH_PASSWORD_HASH_FILE:file_writable',
    ],
  ];
  // Root reads a mode 000 file, so that case only means something otherwise.
  if (process.getuid?.() !== 0) {
    cases.push([
      'a file the server can not read',
      { PORTFOLIO_AUTH_PASSWORD_HASH_FILE: file('unreadable', hash, 0o000) },
      'PORTFOLIO_AUTH_PASSWORD_HASH_FILE:file_unreadable',
    ]);
  }
  for (const [what, extra, expected] of cases) {
    const result = await start({ ...env, ...extra });
    assert.equal(result.ok, false, what);
    assert.deepEqual(fatalCodes(result), [expected], what);
    assert.ok(!JSON.stringify(result.issues).includes(hash), `${what}: a finding repeats the hash`);
  }
  // 0400, the mode hash-password writes, starts; so does 0440 for a group that only reads.
  assert.equal((await start({ ...env, PORTFOLIO_AUTH_PASSWORD_HASH_FILE: good })).ok, true);
  const groupRead = file('group-read', hash, 0o440);
  assert.equal((await start({ ...env, PORTFOLIO_AUTH_PASSWORD_HASH_FILE: groupRead })).ok, true);
});
