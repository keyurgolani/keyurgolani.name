import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { DEFAULT_SITE, runAppToExit, startApp } from '../harness/app-server.mjs';
import {
  fatalFields,
  HEAD,
  mentions,
  neverValues,
  ORIGIN,
  remediates,
  rowDocuments,
  STARTUP_ROWS,
  type RowPaths,
  type StartupRow,
} from '../harness/startup-rows.mjs';

// Every startup-matrix row without an issue tag (#1, item 2), and the
// document pair's (#4, items 4 to 6), against the built standalone server.
// The rows live in tests/harness/startup-rows.mjs, which `pnpm
// smoke:profiles` runs against the image too. Each must stop the process with
// exit 1 before it serves a request, log a config.fatal line naming the key,
// and never print the configured value. Then every shared invalid pair: a
// blocking one stops the server, and a warning one starts it. No browser:
// these only start and stop the server.

interface Fatal {
  event: string;
  key: string;
  code: string;
  file?: string;
  document?: 'portfolio' | 'site';
  path?: string;
  line?: number;
  column?: number;
  stableId?: string;
  message: string;
  remediation?: string;
}

type Env = Record<string, string>;

/** Starts the server, expects it to stop with exit 1, and returns its config.fatal lines. */
async function expectRefusal(
  env: Env,
  { never = [], readDelayMs }: { never?: string[]; readDelayMs?: number } = {},
) {
  // Well inside the test timeout, so a server that wrongly keeps running is
  // killed and reported rather than left behind.
  const run = await runAppToExit({ env, timeoutMs: 15_000, readDelayMs });
  expect(run.exited, `the server kept running:\n${run.output}`).toBe(true);
  expect(run.code, run.output).toBe(1);
  expect(run.egress, 'requests the server tried to send out').toEqual([]);
  for (const value of never) expect(run.output).not.toContain(value);
  const fatal = run.output
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Fatal)
    .filter((entry) => entry.event === 'config.fatal');
  expect(fatal.length, run.output).toBeGreaterThan(0);
  return fatal;
}

/** Writes the row's documents and files under the test's output directory. */
function place(row: StartupRow): RowPaths {
  const source = test.info().outputPath('config');
  mkdirSync(source, { recursive: true });
  for (const [name, text] of Object.entries(rowDocuments(row))) {
    writeFileSync(path.join(source, name), text);
  }
  const beside = (name: string) => test.info().outputPath(name);
  for (const [name, text] of Object.entries(row.files ?? {})) writeFileSync(beside(name), text);
  return { source, beside };
}

for (const group of new Set(STARTUP_ROWS.map((row) => row.group))) {
  test.describe(group, () => {
    for (const row of STARTUP_ROWS.filter((entry) => entry.group === group)) {
      test(row.name, async () => {
        test.skip(Boolean(row.unreadable) && process.getuid?.() === 0, 'root reads any directory');
        const paths = place(row);
        if (row.unreadable) chmodSync(paths.source, 0o000);
        try {
          const fatal = await expectRefusal(row.env(paths), { never: neverValues(row, paths) });
          expect(fatalFields(row, fatal)).toEqual(row.fatal);
          for (const text of mentions(row)) expect(fatal[0]!.message).toContain(text);
          for (const text of remediates(row)) expect(fatal[0]!.remediation).toContain(text);
        } finally {
          if (row.unreadable) chmodSync(paths.source, 0o700);
        }
      });
    }
  });
}

test.describe('the refusal log', () => {
  test('reaches a slow reader in full before the server exits', async () => {
    // Over 300 KB of config.fatal lines: more than the pipe and the reader's
    // buffer hold while nothing reads, so the server must wait to write them.
    const count = 1000;
    const source = test.info().outputPath('config');
    mkdirSync(source, { recursive: true });
    writeFileSync(
      path.join(source, 'portfolio.yml'),
      `${HEAD}identity:\n  name: Rowan Fixture\nsections:\n${'  - kind: canary-kind\n'.repeat(count)}`,
    );
    copyFileSync(DEFAULT_SITE, path.join(source, 'site.yml'));
    const fatal = await expectRefusal(
      { PORTFOLIO_PROFILE: 'read-only', PORTFOLIO_ORIGIN: ORIGIN, PORTFOLIO_SOURCE_DIR: source },
      { readDelayMs: 2_000 },
    );
    expect(fatal.map((entry) => entry.path)).toEqual(
      Array.from({ length: count }, (_, index) => `/sections/${index}/kind`),
    );
  });
});

test.describe('the shared fixtures', () => {
  // @portfolio/schema's pair for each diagnostic code and its startup cases
  // (#4, item 21). The invalid pairs link to https://rowan.name, their own
  // origin. A blocking pair stops the server with its code alone; a warning
  // one starts it and logs its code.
  const FIXTURES = fileURLToPath(
    new URL('../../packages/schema/src/__fixtures__/', import.meta.url),
  );
  const WARNINGS = ['extension.unregistered', 'metric.duplicate', 'origin.sample', 'origin.stale'];
  const RECORD_ORIGIN = 'https://rowan.name';
  const invalid = readdirSync(path.join(FIXTURES, 'invalid')).sort();
  const readOnly = (source: string, origin = ORIGIN) => ({
    PORTFOLIO_PROFILE: 'read-only',
    PORTFOLIO_ORIGIN: origin,
    PORTFOLIO_SOURCE_DIR: source,
  });

  for (const code of invalid.filter((name) => !WARNINGS.includes(name))) {
    test(`invalid/${code} stops the server with that code alone`, async () => {
      const dir = path.join(FIXTURES, 'invalid', code);
      const fatal = await expectRefusal(readOnly(dir, RECORD_ORIGIN));
      expect([...new Set(fatal.map((entry) => entry.code))]).toEqual([code]);
    });
  }

  for (const code of WARNINGS) {
    test(`invalid/${code} only warns, and the server starts`, async () => {
      expect(invalid).toContain(code);
      const dir = path.join(FIXTURES, 'invalid', code);
      const app = await startApp({
        env: { PORTFOLIO_ORIGIN: RECORD_ORIGIN },
        portfolio: path.join(dir, 'portfolio.yml'),
        site: path.join(dir, 'site.yml'),
      });
      try {
        const logged = (event: string) =>
          readFileSync(app.log, 'utf8')
            .split('\n')
            .filter((line) => line.startsWith('{'))
            .map((line) => JSON.parse(line) as Fatal)
            .filter((entry) => entry.event === event)
            .map((entry) => entry.code);
        await expect.poll(() => [...new Set(logged('config.warning'))]).toEqual([code]);
        expect(logged('config.fatal')).toEqual([]);
      } finally {
        await app.stop();
      }
    });
  }

  const STARTUP: Record<string, [string, string | undefined][]> = {
    empty: [
      ['source.missing', 'portfolio'],
      ['source.missing', 'site'],
    ],
    // An old one-file portfolio with no site.yml, as an upgrade finds it.
    'legacy-only': [['legacy.document', 'portfolio']],
    'site-only': [['source.missing', 'portfolio']],
    toml: [['legacy.document', 'portfolio']],
  };

  test('every startup fixture has its records here', () => {
    expect(Object.keys(STARTUP).sort()).toEqual(readdirSync(path.join(FIXTURES, 'startup')).sort());
  });

  for (const [name, records] of Object.entries(STARTUP)) {
    test(`startup/${name} stops the server`, async () => {
      const dir = path.join(FIXTURES, 'startup', name);
      const fatal = await expectRefusal(readOnly(dir));
      expect(fatal.map((entry) => [entry.code, entry.document])).toEqual(records);
    });
  }
});
