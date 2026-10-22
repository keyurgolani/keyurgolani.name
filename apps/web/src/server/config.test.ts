import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { builtWithFixtures } from './capabilities';
import {
  DEPLOYMENT_KEYS,
  issueLogLine,
  PROFILES,
  readDeploymentConfig,
  type ConfigIssue,
  type Env,
  type ReadConfigResult,
} from './config';

// The rows of the startup matrix that the configuration owns. Each case also
// checks that no finding repeats the configured value.

const BASE = {
  NODE_ENV: 'production',
  PORTFOLIO_PROFILE: 'read-only',
  PORTFOLIO_ORIGIN: 'https://jane.test',
  PORTFOLIO_SOURCE_DIR: '/srv/config',
} as const;

const noFiles = (file: string): string => {
  throw new Error(`no such file: ${file}`);
};

/** What the stat double says of a file: a regular one, mode 0400, unless a test says otherwise. */
interface FakeStat {
  readonly regular?: boolean;
  readonly mode?: number;
}

function read(
  env: Env,
  files: Record<string, string> = {},
  stats: Record<string, FakeStat> = {},
): ReadConfigResult {
  return readDeploymentConfig(env, {
    cwd: '/srv/app',
    readFile: (file) => (file in files ? files[file]! : noFiles(file)),
    statFile: (file) => {
      if (!(file in files) && !(file in stats)) noFiles(file);
      const { regular = true, mode = 0o400 } = stats[file] ?? {};
      return { isFile: () => regular, mode: (regular ? 0o100000 : 0o040000) | mode };
    },
  });
}

function findings(result: ReadConfigResult, severity: ConfigIssue['severity'] = 'fatal') {
  return result.issues
    .filter((issue) => issue.severity === severity)
    .map((i) => `${i.key}:${i.code}`);
}

function assertSilentAbout(result: ReadConfigResult, ...values: string[]) {
  const text = JSON.stringify(result.issues);
  for (const value of values) assert.ok(!text.includes(value), `a finding repeats ${value}`);
}

test('a complete read-only configuration loads and freezes', () => {
  const result = read({ ...BASE, PORTFOLIO_SOURCE_DIR: '../../config' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  if (!result.ok) return;
  assert.deepEqual(result.config, {
    profile: 'read-only',
    mode: 'production',
    origin: 'https://jane.test',
    trustedProxyHops: 0,
    sourceDir: '/config',
    secrets: {},
  });
  assert.ok(Object.isFrozen(result.config));
  assert.ok(Object.isFrozen(result.config.secrets));
});

test('the profile is required', () => {
  for (const env of [
    { ...BASE, PORTFOLIO_PROFILE: undefined },
    { ...BASE, PORTFOLIO_PROFILE: '' },
  ]) {
    const result = read(env);
    assert.equal(result.ok, false);
    assert.deepEqual(findings(result), ['PORTFOLIO_PROFILE:required']);
  }
});

test('the profile must match exactly, with no case folding, trimming, or aliases', () => {
  for (const value of [
    'Read-only',
    'READ-ONLY',
    ' read-only',
    'read-only ',
    'readonly',
    'ro',
    'prod',
  ]) {
    const result = read({ ...BASE, PORTFOLIO_PROFILE: value });
    assert.equal(result.ok, false, value);
    assert.deepEqual(findings(result), ['PORTFOLIO_PROFILE:invalid'], value);
  }
  for (const profile of PROFILES) {
    const env = profile === 'demo' ? { ...BASE, PORTFOLIO_SOURCE_DIR: undefined } : { ...BASE };
    assert.equal(read({ ...env, PORTFOLIO_PROFILE: profile }).ok, true, profile);
  }
});

test('the origin is required', () => {
  const result = read({ ...BASE, PORTFOLIO_ORIGIN: undefined });
  assert.equal(result.ok, false);
  assert.deepEqual(findings(result), ['PORTFOLIO_ORIGIN:required']);
});

test('the origin must be a bare, serialized http or https origin', () => {
  for (const value of [
    'https://jane.test/',
    'https://jane.test/blog',
    'https://jane.test?ref=1',
    'https://jane.test#top',
    'https://user:pass@jane.test',
    'https://Jane.test',
    'https://jane.test:443',
    'http://jane.test:80',
    'ftp://jane.test',
    'jane.test',
    'not a url',
  ]) {
    const result = read({ ...BASE, PORTFOLIO_ORIGIN: value });
    assert.equal(result.ok, false, value);
    assert.deepEqual(findings(result), ['PORTFOLIO_ORIGIN:invalid'], value);
    assertSilentAbout(result, value);
  }
  for (const value of ['https://jane.test', 'https://jane.test:8443', 'http://[::1]:3000']) {
    assert.equal(read({ ...BASE, PORTFOLIO_ORIGIN: value }).ok, true, value);
  }
});

test('owner needs https unless the host is loopback', () => {
  const owner = { ...BASE, PORTFOLIO_PROFILE: 'owner' };
  const insecure = read({ ...owner, PORTFOLIO_ORIGIN: 'http://jane.test' });
  assert.equal(insecure.ok, false);
  assert.deepEqual(findings(insecure), ['PORTFOLIO_ORIGIN:insecure']);
  for (const origin of [
    'http://localhost:3000',
    'http://studio.localhost',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
    'https://jane.test',
  ]) {
    assert.equal(read({ ...owner, PORTFOLIO_ORIGIN: origin }).ok, true, origin);
  }
  // Only owner: read-only and demo may serve plain http behind a TLS proxy.
  assert.equal(read({ ...BASE, PORTFOLIO_ORIGIN: 'http://jane.test' }).ok, true);
});

test('a reserved example domain is fatal for owner and read-only in production', () => {
  for (const origin of [
    'https://example.com',
    'https://www.example.net',
    'https://jane.example.org',
    'https://jane.example',
    'https://jane.invalid',
  ]) {
    const result = read({ ...BASE, PORTFOLIO_ORIGIN: origin });
    assert.equal(result.ok, false, origin);
    assert.deepEqual(findings(result), ['PORTFOLIO_ORIGIN:reserved_domain'], origin);
  }
  assert.equal(read({ ...BASE, PORTFOLIO_ORIGIN: 'https://myexample.com' }).ok, true);
  // demo expects the sample's own domain.
  const demo = read({
    ...BASE,
    PORTFOLIO_PROFILE: 'demo',
    PORTFOLIO_SOURCE_DIR: undefined,
    PORTFOLIO_ORIGIN: 'https://demo.example.com',
  });
  assert.equal(demo.ok, true);
  // next dev only warns.
  const dev = read({ ...BASE, NODE_ENV: 'development', PORTFOLIO_ORIGIN: 'https://example.com' });
  assert.equal(dev.ok, true);
  assert.deepEqual(findings(dev, 'warning'), ['PORTFOLIO_ORIGIN:reserved_domain']);
});

test('a key and its _FILE set together are fatal', () => {
  const result = read(
    { ...BASE, PORTFOLIO_ORIGIN_FILE: '/run/secrets/origin' },
    { '/run/secrets/origin': 'https://jane.test\n' },
  );
  assert.equal(result.ok, false);
  assert.deepEqual(findings(result), ['PORTFOLIO_ORIGIN:value_and_file']);
  assertSilentAbout(result, '/run/secrets/origin');
});

test('an unreadable _FILE is fatal and named by its _FILE key', () => {
  const result = read({
    ...BASE,
    PORTFOLIO_PROFILE: 'owner',
    PORTFOLIO_AUTH_PASSWORD_HASH_FILE: '/run/secrets/canary-missing-hash',
  });
  assert.equal(result.ok, false);
  assert.deepEqual(findings(result), ['PORTFOLIO_AUTH_PASSWORD_HASH_FILE:file_unreadable']);
  assertSilentAbout(result, 'canary-missing-hash');
});

test('a password hash file that is not a regular file, or that group or others can write, is fatal and never read', () => {
  const owner = {
    ...BASE,
    PORTFOLIO_PROFILE: 'owner',
    PORTFOLIO_AUTH_PASSWORD_HASH_FILE: '/run/secrets/canary-hash',
  };
  const cases: [FakeStat, string][] = [
    [{ regular: false, mode: 0o700 }, 'file_not_regular'],
    [{ mode: 0o620 }, 'file_writable'],
    [{ mode: 0o602 }, 'file_writable'],
    [{ mode: 0o666 }, 'file_writable'],
  ];
  for (const [stat, code] of cases) {
    const result = readDeploymentConfig(owner, {
      cwd: '/srv/app',
      readFile: () => assert.fail('a refused hash file is never read'),
      statFile: () => ({
        isFile: () => stat.regular ?? true,
        mode: (stat.regular === false ? 0o040000 : 0o100000) | (stat.mode ?? 0o400),
      }),
    });
    assert.equal(result.ok, false);
    assert.deepEqual(findings(result), [`PORTFOLIO_AUTH_PASSWORD_HASH_FILE:${code}`]);
    assertSilentAbout(result, 'canary-hash');
  }
  // Owner read and owner read-write are fine, and so is a group that only reads.
  for (const mode of [0o400, 0o600, 0o440, 0o444]) {
    const result = read(
      owner,
      { '/run/secrets/canary-hash': 'h\n' },
      { '/run/secrets/canary-hash': { mode } },
    );
    assert.equal(result.ok, true, mode.toString(8));
  }
  // Other keys' files take any mode.
  const hops = read(
    { ...BASE, PORTFOLIO_TRUSTED_PROXY_HOPS_FILE: '/run/hops' },
    { '/run/hops': '1' },
    { '/run/hops': { mode: 0o666 } },
  );
  assert.equal(hops.ok, true);
});

test('owner session lifetimes default to 60 idle minutes and 12 hours, and take whole numbers in range', () => {
  const owner = { ...BASE, PORTFOLIO_PROFILE: 'owner' };
  const defaults = read(owner);
  assert.ok(defaults.ok);
  assert.deepEqual(defaults.config.sessionLifetime, { idleMinutes: 60, maxHours: 12 });
  const set = read(
    {
      ...owner,
      PORTFOLIO_AUTH_SESSION_IDLE_MINUTES: '5',
      PORTFOLIO_AUTH_SESSION_MAX_HOURS_FILE: '/run/hours',
    },
    { '/run/hours': '24\n' },
  );
  assert.ok(set.ok);
  assert.deepEqual(set.config.sessionLifetime, { idleMinutes: 5, maxHours: 24 });
  const readOnly = read({ ...BASE });
  assert.ok(readOnly.ok);
  assert.equal(readOnly.config.sessionLifetime, undefined);

  const cases: [Env, string[]][] = [
    [
      { PORTFOLIO_AUTH_SESSION_IDLE_MINUTES: '4' },
      ['PORTFOLIO_AUTH_SESSION_IDLE_MINUTES:out_of_range'],
    ],
    [
      { PORTFOLIO_AUTH_SESSION_IDLE_MINUTES: '121' },
      ['PORTFOLIO_AUTH_SESSION_IDLE_MINUTES:out_of_range'],
    ],
    [{ PORTFOLIO_AUTH_SESSION_MAX_HOURS: '0' }, ['PORTFOLIO_AUTH_SESSION_MAX_HOURS:out_of_range']],
    [{ PORTFOLIO_AUTH_SESSION_MAX_HOURS: '25' }, ['PORTFOLIO_AUTH_SESSION_MAX_HOURS:out_of_range']],
    [
      { PORTFOLIO_AUTH_SESSION_IDLE_MINUTES: '30.5' },
      ['PORTFOLIO_AUTH_SESSION_IDLE_MINUTES:invalid'],
    ],
    [{ PORTFOLIO_AUTH_SESSION_MAX_HOURS: ' 12' }, ['PORTFOLIO_AUTH_SESSION_MAX_HOURS:invalid']],
    [
      { PORTFOLIO_AUTH_SESSION_IDLE_MINUTES: 'sixty', PORTFOLIO_AUTH_SESSION_MAX_HOURS: '48' },
      [
        'PORTFOLIO_AUTH_SESSION_IDLE_MINUTES:invalid',
        'PORTFOLIO_AUTH_SESSION_MAX_HOURS:out_of_range',
      ],
    ],
  ];
  for (const [extra, expected] of cases) {
    const result = read({ ...owner, ...extra });
    assert.equal(result.ok, false, JSON.stringify(extra));
    assert.deepEqual(findings(result), expected, JSON.stringify(extra));
    assertSilentAbout(
      result,
      ...Object.values(extra).filter(
        (value): value is string => value !== undefined && value.trim().length > 1,
      ),
    );
  }
});

test('owner preview grant lifetimes default to 900 idle seconds and 7200 in all, take whole numbers in range, and keep idle under the cap (#7)', () => {
  const owner = { ...BASE, PORTFOLIO_PROFILE: 'owner' };
  const defaults = read(owner);
  assert.ok(defaults.ok);
  assert.deepEqual(defaults.config.previewGrantLifetime, { idleSeconds: 900, maxSeconds: 7200 });
  const set = read(
    {
      ...owner,
      PORTFOLIO_PREVIEW_GRANT_IDLE_TTL_SECONDS: '60',
      PORTFOLIO_PREVIEW_GRANT_MAX_TTL_SECONDS_FILE: '/run/grant-max',
    },
    { '/run/grant-max': '43200\n' },
  );
  assert.ok(set.ok);
  assert.deepEqual(set.config.previewGrantLifetime, { idleSeconds: 60, maxSeconds: 43200 });
  const readOnly = read({ ...BASE });
  assert.ok(readOnly.ok);
  assert.equal(readOnly.config.previewGrantLifetime, undefined);

  const IDLE = 'PORTFOLIO_PREVIEW_GRANT_IDLE_TTL_SECONDS';
  const MAX = 'PORTFOLIO_PREVIEW_GRANT_MAX_TTL_SECONDS';
  const cases: [Env, string[]][] = [
    [{ [IDLE]: '59' }, [`${IDLE}:out_of_range`]],
    [{ [IDLE]: '3601' }, [`${IDLE}:out_of_range`]],
    [{ [MAX]: '299' }, [`${MAX}:out_of_range`]],
    [{ [MAX]: '43201' }, [`${MAX}:out_of_range`]],
    [{ [IDLE]: '90.5' }, [`${IDLE}:invalid`]],
    [{ [MAX]: ' 7200' }, [`${MAX}:invalid`]],
    [{ [IDLE]: '1800', [MAX]: '600' }, [`${IDLE}:exceeds_max`]],
    [{ [IDLE]: 'fifteen', [MAX]: '120' }, [`${IDLE}:invalid`, `${MAX}:out_of_range`]],
  ];
  for (const [extra, expected] of cases) {
    const result = read({ ...owner, ...extra });
    assert.equal(result.ok, false, JSON.stringify(extra));
    assert.deepEqual(findings(result), expected, JSON.stringify(extra));
    assertSilentAbout(
      result,
      ...Object.values(extra).filter(
        (value): value is string => value !== undefined && value.trim().length > 2,
      ),
    );
  }
  // Outside owner either key stops production, as every owner row does.
  for (const profile of ['read-only', 'demo']) {
    const result = read({
      ...BASE,
      PORTFOLIO_PROFILE: profile,
      ...(profile === 'demo' ? { PORTFOLIO_SOURCE_DIR: '' } : {}),
      [IDLE]: '900',
    });
    assert.equal(result.ok, false, profile);
    assert.deepEqual(findings(result), [`${IDLE}:not_in_profile`], profile);
  }
});

test('the config records which variable supplied the password hash', () => {
  const owner = { ...BASE, PORTFOLIO_PROFILE: 'owner' };
  const direct = read({ ...owner, PORTFOLIO_AUTH_PASSWORD_HASH: 'h' });
  assert.ok(direct.ok);
  assert.deepEqual(direct.config.secretKeys, { authPasswordHash: 'PORTFOLIO_AUTH_PASSWORD_HASH' });
  const file = read(
    { ...owner, PORTFOLIO_AUTH_PASSWORD_HASH_FILE: '/run/secrets/hash' },
    { '/run/secrets/hash': 'h\n' },
  );
  assert.ok(file.ok);
  assert.equal(file.config.secrets.authPasswordHash, 'h');
  assert.deepEqual(file.config.secretKeys, {
    authPasswordHash: 'PORTFOLIO_AUTH_PASSWORD_HASH_FILE',
  });
  const none = read(owner);
  assert.ok(none.ok);
  assert.equal(none.config.secretKeys, undefined);
});

test('a _FILE that is not a regular file is fatal for any key, and never read', () => {
  const cases = [
    'PORTFOLIO_ORIGIN_FILE',
    'PORTFOLIO_TRUSTED_PROXY_HOPS_FILE',
    'PORTFOLIO_SOURCE_DIR_FILE',
  ];
  for (const fileKey of cases) {
    const result = readDeploymentConfig(
      { ...BASE, [fileKey.replace(/_FILE$/, '')]: undefined, [fileKey]: '/run/canary-dir' },
      {
        cwd: '/srv/app',
        readFile: () => assert.fail('a file that is not regular is never read'),
        statFile: () => ({ isFile: () => false, mode: 0o040755 }),
      },
    );
    assert.equal(result.ok, false, fileKey);
    assert.ok(findings(result).includes(`${fileKey}:file_not_regular`), fileKey);
    assertSilentAbout(result, 'canary-dir');
  }
});

test('a FIFO named by a _FILE stops startup rather than hanging it', (t) => {
  if (process.platform === 'win32') return t.skip('no mkfifo');
  const dir = mkdtempSync(path.join(tmpdir(), 'config-fifo-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fifo = path.join(dir, 'hops');
  assert.equal(spawnSync('mkfifo', [fifo]).status, 0, 'mkfifo');
  // A read of the FIFO would block until a writer came, which none does.
  const result = readDeploymentConfig(
    { ...BASE, PORTFOLIO_TRUSTED_PROXY_HOPS_FILE: fifo },
    {
      cwd: '/srv/app',
    },
  );
  assert.deepEqual(findings(result), ['PORTFOLIO_TRUSTED_PROXY_HOPS_FILE:file_not_regular']);
});

test('a _FILE supplies the value with one trailing newline trimmed', () => {
  const result = read(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE_FILE: '/run/secrets/profile',
      PORTFOLIO_ORIGIN_FILE: '/run/secrets/origin',
      PORTFOLIO_SOURCE_DIR: '/srv/config',
      PORTFOLIO_TRUSTED_PROXY_HOPS_FILE: '/run/secrets/hops',
    },
    {
      '/run/secrets/profile': 'read-only\n',
      '/run/secrets/origin': 'https://jane.test\r\n',
      '/run/secrets/hops': '2',
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.config.profile, 'read-only');
  assert.equal(result.config.origin, 'https://jane.test');
  assert.equal(result.config.trustedProxyHops, 2);

  // Only one newline goes, so the profile no longer matches exactly.
  const doubled = read(
    { ...BASE, PORTFOLIO_PROFILE: undefined, PORTFOLIO_PROFILE_FILE: '/run/secrets/profile' },
    { '/run/secrets/profile': 'read-only\n\n' },
  );
  assert.deepEqual(findings(doubled), ['PORTFOLIO_PROFILE:invalid']);
});

test('an empty value or an empty _FILE counts as unset', () => {
  const result = read(
    {
      ...BASE,
      PORTFOLIO_TRUSTED_PROXY_HOPS: '',
      PORTFOLIO_PREVIEW_ORIGIN: '',
      GITHUB_TOKEN: '',
      PORTFOLIO_PATH: '',
      NEXT_PUBLIC_BASE_URL: '',
    },
    {},
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);

  const emptyFile = read(
    { ...BASE, PORTFOLIO_ORIGIN: undefined, PORTFOLIO_ORIGIN_FILE: '/run/secrets/origin' },
    { '/run/secrets/origin': '\n' },
  );
  assert.deepEqual(findings(emptyFile), ['PORTFOLIO_ORIGIN:required']);
});

test('trusted proxy hops must be a whole number', () => {
  for (const value of ['-1', '1.5', 'two', ' 1', '1e3', '0x1', '99999999999999999999']) {
    const result = read({ ...BASE, PORTFOLIO_TRUSTED_PROXY_HOPS: value });
    assert.equal(result.ok, false, value);
    assert.deepEqual(findings(result), ['PORTFOLIO_TRUSTED_PROXY_HOPS:invalid'], value);
  }
  for (const [value, hops] of [
    ['0', 0],
    ['2', 2],
  ] as const) {
    const result = read({ ...BASE, PORTFOLIO_TRUSTED_PROXY_HOPS: value });
    assert.equal(result.ok && result.config.trustedProxyHops, hops);
  }
});

test('the preview origin must be a bare origin that differs from the canonical one', () => {
  const owner = { ...BASE, PORTFOLIO_PROFILE: 'owner' };
  const invalid = read({ ...owner, PORTFOLIO_PREVIEW_ORIGIN: 'https://preview.jane.test/' });
  assert.deepEqual(findings(invalid), ['PORTFOLIO_PREVIEW_ORIGIN:invalid']);
  const same = read({ ...owner, PORTFOLIO_PREVIEW_ORIGIN: 'https://jane.test' });
  assert.deepEqual(findings(same), ['PORTFOLIO_PREVIEW_ORIGIN:same_as_origin']);
  const valid = read({ ...owner, PORTFOLIO_PREVIEW_ORIGIN: 'https://preview.jane.test' });
  assert.equal(valid.ok && valid.config.previewOrigin, 'https://preview.jane.test');
});

test('PORTFOLIO_PATH and NEXT_PUBLIC_BASE_URL are fatal and name their replacement', () => {
  const result = read({
    ...BASE,
    PORTFOLIO_PATH: '/data/canary-portfolio.yml',
    NEXT_PUBLIC_BASE_URL: 'https://canary-base.test',
  });
  assert.equal(result.ok, false);
  assert.deepEqual(findings(result), [
    'PORTFOLIO_PATH:key_replaced',
    'NEXT_PUBLIC_BASE_URL:key_replaced',
  ]);
  const messages = result.issues.map((issue) => issue.message);
  assert.match(messages[0]!, /PORTFOLIO_SOURCE_DIR/);
  assert.match(messages[1]!, /PORTFOLIO_ORIGIN/);
  assertSilentAbout(result, 'canary-portfolio', 'canary-base');
});

test('both removed settings are fatal under next dev too', () => {
  const result = read({ ...BASE, NODE_ENV: 'development', PORTFOLIO_PATH: 'portfolio.yml' });
  assert.deepEqual(findings(result), ['PORTFOLIO_PATH:key_replaced']);
});

// Every (key, profile) pair outside the profile's column.
const outside = Object.entries(DEPLOYMENT_KEYS).flatMap(([key, allowed]) =>
  PROFILES.filter((profile) => !(allowed as readonly string[]).includes(profile)).map(
    (profile) => [key, profile] as const,
  ),
);

test('a key outside the profile column is fatal in production', () => {
  assert.ok(outside.length > 0);
  for (const [key, profile] of outside) {
    const base = profile === 'demo' ? { ...BASE, PORTFOLIO_SOURCE_DIR: undefined } : BASE;
    const canary = `canary-${key.toLowerCase()}`;
    const result = read({ ...base, PORTFOLIO_PROFILE: profile, [key]: canary });
    assert.equal(result.ok, false, `${key} under ${profile}`);
    assert.deepEqual(findings(result), [`${key}:not_in_profile`], `${key} under ${profile}`);
    assertSilentAbout(result, canary);

    const viaFile = read({ ...base, PORTFOLIO_PROFILE: profile, [`${key}_FILE`]: '/run/x' });
    assert.deepEqual(findings(viaFile), [`${key}_FILE:not_in_profile`], `${key}_FILE`);
  }
});

test('a key outside the profile column is a warning under next dev, and ignored', () => {
  const result = read(
    { ...BASE, NODE_ENV: 'development', GITHUB_TOKEN_FILE: '/run/secrets/token' },
    { '/run/secrets/token': 'canary-token' },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(findings(result, 'warning'), ['GITHUB_TOKEN_FILE:not_in_profile']);
  assert.equal(result.ok && result.config.secrets.githubToken, undefined);

  const demo = read({
    ...BASE,
    NODE_ENV: 'development',
    PORTFOLIO_PROFILE: 'demo',
    PORTFOLIO_SOURCE_DIR: '../../config',
  });
  assert.equal(demo.ok, true);
  assert.deepEqual(findings(demo, 'warning'), ['PORTFOLIO_SOURCE_DIR:not_in_profile']);
  assert.equal(demo.ok && demo.config.sourceDir, undefined);
});

test('owner keeps its reserved keys and secrets', () => {
  const result = read({
    ...BASE,
    PORTFOLIO_PROFILE: 'owner',
    PORTFOLIO_DATA_DIR: '/var/lib/portfolio',
    PORTFOLIO_AUTH_PASSWORD_HASH: 'test-hash',
    GITHUB_TOKEN: 'test-token',
    PORTFOLIO_PREVIEW_ORIGIN: 'https://preview.jane.test',
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.config.dataDir, '/var/lib/portfolio');
  assert.deepEqual(result.config.secrets, {
    authPasswordHash: 'test-hash',
    githubToken: 'test-token',
  });
});

test('the source directory is required for owner and read-only, and resolves against cwd', () => {
  for (const profile of ['owner', 'read-only']) {
    const result = read({ ...BASE, PORTFOLIO_PROFILE: profile, PORTFOLIO_SOURCE_DIR: undefined });
    assert.deepEqual(findings(result), ['PORTFOLIO_SOURCE_DIR:required'], profile);
  }
  const relative = read({ ...BASE, PORTFOLIO_SOURCE_DIR: 'config' });
  assert.equal(relative.ok && relative.config.sourceDir, '/srv/app/config');
});

test('an unknown PORTFOLIO_ key is a warning', () => {
  const result = read({ ...BASE, PORTFOLIO_ORGIN: 'https://typo.test' });
  assert.equal(result.ok, true);
  assert.deepEqual(findings(result, 'warning'), ['PORTFOLIO_ORGIN:unknown_key']);
  assertSilentAbout(result, 'typo.test');
});

test('a fixture flag set when the server starts, on a build made without it, warns once and changes nothing (#19, Slice 3)', () => {
  const result = read({ ...BASE, APPEARANCE_FIXTURES: '1' });
  assert.equal(result.ok, true);
  // A build made with it has the fixtures already, and nothing to say.
  const expected = builtWithFixtures('appearance') ? [] : ['APPEARANCE_FIXTURES:build_time_only'];
  assert.deepEqual(findings(result, 'warning'), expected);
  assert.deepEqual(findings(read({ ...BASE, APPEARANCE_FIXTURES: '' }), 'warning'), []);
  // The deployment it reads is the one it reads without the flag.
  const without = read(BASE);
  assert.ok(result.ok && without.ok);
  assert.deepEqual(result.config, without.config);
});

test('one read reports every problem', () => {
  const result = read({
    NODE_ENV: 'production',
    PORTFOLIO_PATH: 'portfolio.yml',
    PORTFOLIO_TRUSTED_PROXY_HOPS: 'many',
  });
  assert.deepEqual(findings(result), [
    'PORTFOLIO_PATH:key_replaced',
    'PORTFOLIO_PROFILE:required',
    'PORTFOLIO_ORIGIN:required',
    'PORTFOLIO_TRUSTED_PROXY_HOPS:invalid',
  ]);
});

test('a log line names the event, key, and code, and drops empty fields', () => {
  const line = issueLogLine(
    { severity: 'fatal', key: 'PORTFOLIO_ORIGIN', code: 'required', message: 'm' },
    'read-only',
    new Date('2026-01-02T03:04:05.000Z'),
  );
  assert.deepEqual(JSON.parse(line), {
    ts: '2026-01-02T03:04:05.000Z',
    level: 'fatal',
    event: 'config.fatal',
    profile: 'read-only',
    key: 'PORTFOLIO_ORIGIN',
    code: 'required',
    message: 'm',
  });
  const warning = JSON.parse(
    issueLogLine({ severity: 'warning', key: 'K', code: 'c', message: 'm' }),
  );
  assert.equal(warning.event, 'config.warning');
  assert.equal(warning.level, 'warn');
  assert.equal('profile' in warning, false);
});
