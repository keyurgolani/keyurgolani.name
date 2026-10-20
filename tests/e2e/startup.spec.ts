import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { DEFAULT_PORTFOLIO, runAppToExit } from '../harness/app-server.mjs';

// Every startup-matrix row without an issue tag (#1, item 2), against the
// built standalone server. Each must stop the process with exit 1 before it
// serves a request, log a config.fatal line naming the key, and never print
// the configured value. No browser: these only start and stop the server.

interface Fatal {
  event: string;
  key: string;
  code: string;
  file?: string;
  path?: string;
  line?: number;
  column?: number;
  message: string;
}

type Env = Record<string, string>;

const ORIGIN = 'https://rowan.test';
const DEMO_ORIGIN = 'https://demo.rowan.test';

/** A source directory holding the given documents (name to text). */
function sourceDir(documents: Record<string, string>): string {
  const dir = test.info().outputPath('config');
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(documents)) writeFileSync(path.join(dir, name), text);
  return dir;
}

/** A source directory holding the harness fixture, which every browser test renders. */
function fixtureDir(): string {
  const dir = test.info().outputPath('fixture');
  mkdirSync(dir, { recursive: true });
  copyFileSync(DEFAULT_PORTFOLIO, path.join(dir, 'portfolio.yml'));
  return dir;
}

/** A read-only deployment that starts, until a test changes it. */
function readOnly(extra: Env = {}): Env {
  return {
    PORTFOLIO_PROFILE: 'read-only',
    PORTFOLIO_ORIGIN: ORIGIN,
    PORTFOLIO_SOURCE_DIR: extra.PORTFOLIO_SOURCE_DIR ?? fixtureDir(),
    ...extra,
  };
}

function without(env: Env, key: string): Env {
  return Object.fromEntries(Object.entries(env).filter(([name]) => name !== key));
}

/** Starts the server, expects it to stop with exit 1, and returns its config.fatal lines. */
async function expectRefusal(env: Env, { never = [] }: { never?: string[] } = {}) {
  // Well inside the test timeout, so a server that wrongly keeps running is
  // killed and reported rather than left behind.
  const run = await runAppToExit({ env, timeoutMs: 15_000 });
  expect(run.exited, `the server kept running:\n${run.output}`).toBe(true);
  expect(run.code, run.output).toBe(1);
  for (const value of never) expect(run.output).not.toContain(value);
  const fatal = run.output
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Fatal)
    .filter((entry) => entry.event === 'config.fatal');
  expect(fatal.length, run.output).toBeGreaterThan(0);
  return fatal;
}

const keysAndCodes = (fatal: Fatal[]) => fatal.map((entry) => `${entry.key}:${entry.code}`);

test.describe('in every mode', () => {
  test('a missing profile', async () => {
    const fatal = await expectRefusal(without(readOnly(), 'PORTFOLIO_PROFILE'));
    expect(keysAndCodes(fatal)).toEqual(['PORTFOLIO_PROFILE:required']);
  });

  test('an inexact profile', async () => {
    const fatal = await expectRefusal(readOnly({ PORTFOLIO_PROFILE: 'Readonly-Canary' }), {
      never: ['Readonly-Canary'],
    });
    expect(keysAndCodes(fatal)).toEqual(['PORTFOLIO_PROFILE:invalid']);
  });

  test('a missing origin', async () => {
    const fatal = await expectRefusal(without(readOnly(), 'PORTFOLIO_ORIGIN'));
    expect(keysAndCodes(fatal)).toEqual(['PORTFOLIO_ORIGIN:required']);
  });

  test('an origin that is not bare', async () => {
    const fatal = await expectRefusal(
      readOnly({ PORTFOLIO_ORIGIN: 'https://canary-origin.test/blog' }),
      { never: ['canary-origin'] },
    );
    expect(keysAndCodes(fatal)).toEqual(['PORTFOLIO_ORIGIN:invalid']);
  });

  test('an http origin on a non-loopback owner host', async () => {
    const fatal = await expectRefusal(
      readOnly({ PORTFOLIO_PROFILE: 'owner', PORTFOLIO_ORIGIN: 'http://canary-owner.test' }),
      { never: ['canary-owner'] },
    );
    expect(keysAndCodes(fatal)).toEqual(['PORTFOLIO_ORIGIN:insecure']);
  });

  test('a key and its _FILE both set', async () => {
    const file = test.info().outputPath('origin.txt');
    writeFileSync(file, `${ORIGIN}\n`);
    const fatal = await expectRefusal(readOnly({ PORTFOLIO_ORIGIN_FILE: file }));
    expect(keysAndCodes(fatal)).toEqual(['PORTFOLIO_ORIGIN:value_and_file']);
  });

  test('an unreadable _FILE', async () => {
    const env = readOnly({ PORTFOLIO_ORIGIN_FILE: test.info().outputPath('canary-missing-file') });
    const fatal = await expectRefusal(without(env, 'PORTFOLIO_ORIGIN'), {
      never: ['canary-missing-file'],
    });
    expect(keysAndCodes(fatal)).toEqual(['PORTFOLIO_ORIGIN_FILE:file_unreadable']);
  });

  test('non-integer trusted proxy hops', async () => {
    const fatal = await expectRefusal(readOnly({ PORTFOLIO_TRUSTED_PROXY_HOPS: 'canary-hops' }), {
      never: ['canary-hops'],
    });
    expect(keysAndCodes(fatal)).toEqual(['PORTFOLIO_TRUSTED_PROXY_HOPS:invalid']);
  });

  test('an invalid preview origin', async () => {
    const fatal = await expectRefusal(
      {
        PORTFOLIO_PROFILE: 'demo',
        PORTFOLIO_ORIGIN: DEMO_ORIGIN,
        PORTFOLIO_PREVIEW_ORIGIN: 'canary-preview',
      },
      { never: ['canary-preview'] },
    );
    expect(keysAndCodes(fatal)).toEqual(['PORTFOLIO_PREVIEW_ORIGIN:invalid']);
  });

  test('a preview origin equal to the canonical origin', async () => {
    const fatal = await expectRefusal({
      PORTFOLIO_PROFILE: 'demo',
      PORTFOLIO_ORIGIN: DEMO_ORIGIN,
      PORTFOLIO_PREVIEW_ORIGIN: DEMO_ORIGIN,
    });
    expect(keysAndCodes(fatal)).toEqual(['PORTFOLIO_PREVIEW_ORIGIN:same_as_origin']);
  });

  test('PORTFOLIO_PATH set, naming its replacement', async () => {
    const fatal = await expectRefusal(readOnly({ PORTFOLIO_PATH: '/data/canary-portfolio.yml' }), {
      never: ['canary-portfolio'],
    });
    expect(keysAndCodes(fatal)).toEqual(['PORTFOLIO_PATH:key_replaced']);
    expect(fatal[0]!.message).toContain('PORTFOLIO_SOURCE_DIR');
  });

  test('NEXT_PUBLIC_BASE_URL set, naming its replacement', async () => {
    const fatal = await expectRefusal(
      readOnly({ NEXT_PUBLIC_BASE_URL: 'https://canary-base.test' }),
      {
        never: ['canary-base'],
      },
    );
    expect(keysAndCodes(fatal)).toEqual(['NEXT_PUBLIC_BASE_URL:key_replaced']);
    expect(fatal[0]!.message).toContain('PORTFOLIO_ORIGIN');
  });
});

test.describe('in production', () => {
  test('GITHUB_TOKEN under demo, a key outside the profile column', async () => {
    const fatal = await expectRefusal(
      { PORTFOLIO_PROFILE: 'demo', PORTFOLIO_ORIGIN: DEMO_ORIGIN, GITHUB_TOKEN: 'canary-token' },
      { never: ['canary-token'] },
    );
    expect(keysAndCodes(fatal)).toEqual(['GITHUB_TOKEN:not_in_profile']);
  });

  test('GITHUB_TOKEN under read-only', async () => {
    const fatal = await expectRefusal(readOnly({ GITHUB_TOKEN: 'canary-token' }), {
      never: ['canary-token'],
    });
    expect(keysAndCodes(fatal)).toEqual(['GITHUB_TOKEN:not_in_profile']);
  });

  test('an origin on a reserved example domain', async () => {
    const fatal = await expectRefusal(readOnly({ PORTFOLIO_ORIGIN: 'https://jane.example.com' }));
    expect(keysAndCodes(fatal)).toEqual(['PORTFOLIO_ORIGIN:reserved_domain']);
  });

  test('the bundled sample identity', async () => {
    const dir = sourceDir({ 'portfolio.yml': 'identity:\n  name: Anamika Devi\n' });
    const fatal = await expectRefusal(readOnly({ PORTFOLIO_SOURCE_DIR: dir }));
    expect(fatal.map((entry) => [entry.code, entry.file, entry.path, entry.line])).toEqual([
      ['sample_identity', 'portfolio.yml', '/identity/name', 2],
    ]);
  });
});

test.describe('the source directory', () => {
  test('missing', async () => {
    const dir = test.info().outputPath('canary-absent-dir');
    const fatal = await expectRefusal(readOnly({ PORTFOLIO_SOURCE_DIR: dir }), {
      never: ['canary-absent-dir'],
    });
    expect(keysAndCodes(fatal)).toEqual(['PORTFOLIO_SOURCE_DIR:source_missing']);
  });

  test('naming the document instead, as PORTFOLIO_PATH did', async () => {
    const file = path.join(fixtureDir(), 'portfolio.yml');
    const fatal = await expectRefusal(readOnly({ PORTFOLIO_SOURCE_DIR: file }), { never: [file] });
    expect(keysAndCodes(fatal)).toEqual(['PORTFOLIO_SOURCE_DIR:source_not_directory']);
    expect(fatal[0]!.message).toContain('directory that holds portfolio.yml');
  });

  test('unreadable', async () => {
    test.skip(process.getuid?.() === 0, 'root reads any directory');
    const dir = fixtureDir();
    chmodSync(dir, 0o000);
    try {
      const fatal = await expectRefusal(readOnly({ PORTFOLIO_SOURCE_DIR: dir }));
      expect(keysAndCodes(fatal)).toEqual(['PORTFOLIO_SOURCE_DIR:source_unreadable']);
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  test('holding no portfolio document', async () => {
    const dir = sourceDir({ 'notes.md': 'not a portfolio' });
    const fatal = await expectRefusal(readOnly({ PORTFOLIO_SOURCE_DIR: dir }));
    expect(keysAndCodes(fatal)).toEqual(['PORTFOLIO_SOURCE_DIR:source_empty']);
  });

  test('holding several portfolio documents', async () => {
    const dir = fixtureDir();
    writeFileSync(path.join(dir, 'portfolio.json'), '{"identity":{"name":"Rowan Fixture"}}');
    const fatal = await expectRefusal(readOnly({ PORTFOLIO_SOURCE_DIR: dir }));
    expect(keysAndCodes(fatal)).toEqual(['PORTFOLIO_SOURCE_DIR:source_several']);
  });
});

test.describe('the document', () => {
  test('invalid YAML, located by line and column', async () => {
    const dir = sourceDir({
      'portfolio.yml': 'identity:\n  name: Rowan Fixture\nsections:\n  - kind: canary-kind\n',
    });
    const fatal = await expectRefusal(readOnly({ PORTFOLIO_SOURCE_DIR: dir }), {
      never: ['canary-kind'],
    });
    expect(fatal.map((e) => [e.code, e.file, e.path, e.line, e.column])).toEqual([
      ['document_invalid', 'portfolio.yml', '/sections/0/kind', 4, 11],
    ]);
  });

  test('invalid JSON, located by line and column', async () => {
    const dir = sourceDir({ 'portfolio.json': '{\n  "identity": {\n    "name": 42\n  }\n}\n' });
    const fatal = await expectRefusal(readOnly({ PORTFOLIO_SOURCE_DIR: dir }));
    expect(fatal.map((e) => [e.code, e.file, e.path, e.line, e.column])).toEqual([
      ['document_invalid', 'portfolio.json', '/identity/name', 3, 13],
    ]);
  });

  test('invalid TOML, with the key path', async () => {
    const dir = sourceDir({ 'portfolio.toml': '[identity]\nname = 42\n' });
    const fatal = await expectRefusal(readOnly({ PORTFOLIO_SOURCE_DIR: dir }));
    expect(fatal.map((e) => [e.code, e.file, e.path])).toEqual([
      ['document_invalid', 'portfolio.toml', '/identity/name'],
    ]);
  });

  test('an unresolved variant', async () => {
    const dir = sourceDir({
      'portfolio.yml': 'identity:\n  name: Rowan Fixture\nvariant: canary-variant\n',
    });
    const fatal = await expectRefusal(readOnly({ PORTFOLIO_SOURCE_DIR: dir }), {
      never: ['canary-variant'],
    });
    expect(fatal.map((e) => [e.code, e.path, e.line])).toEqual([
      ['variant_unresolved', '/variant', 3],
    ]);
  });
});

test.describe('profiles this build cannot start', () => {
  test('owner, with no authentication provider registered', async () => {
    const fatal = await expectRefusal(readOnly({ PORTFOLIO_PROFILE: 'owner' }));
    expect(keysAndCodes(fatal)).toEqual(['PORTFOLIO_PROFILE:auth_provider_missing']);
  });

  test('demo, until its bundled-sample catalog ships', async () => {
    const fatal = await expectRefusal({ PORTFOLIO_PROFILE: 'demo', PORTFOLIO_ORIGIN: DEMO_ORIGIN });
    expect(keysAndCodes(fatal)).toEqual(['PORTFOLIO_PROFILE:profile_unavailable']);
  });
});
