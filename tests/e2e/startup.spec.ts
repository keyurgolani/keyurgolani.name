import {
  chmodSync,
  copyFileSync,
  existsSync,
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
  checkWarnings,
  fatalFields,
  HEAD,
  mentions,
  neverValues,
  ORIGIN,
  remediates,
  rowDocuments,
  STARTUP_ROWS,
  WARNING_ROWS,
  type RowPaths,
  type StartupRow,
  type WarningRow,
} from '../harness/startup-rows.mjs';

// Every startup-matrix row without an issue tag (#1, item 2), and the
// document pair's (#4, items 4 to 6), against the built standalone server.
// The rows live in tests/harness/startup-rows.mjs, which `pnpm
// smoke:profiles` runs against the image too. Each refusal must stop the
// process with exit 1 before it serves a request, log a config.fatal line
// naming the key, and never print the configured value. Each warning row
// starts and serves, and logs its config.warning lines without the value.
// Then every shared invalid pair: a blocking one stops the server, and a
// warning one starts it. No browser: these only start the server and read
// what it answers.

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
function place(row: StartupRow | WarningRow): RowPaths {
  const source = test.info().outputPath('config');
  mkdirSync(source, { recursive: true });
  const documents = 'fatal' in row ? rowDocuments(row) : row.documents;
  for (const [name, text] of Object.entries(documents)) {
    // A name may sit in a directory beside the documents, such as snapshots/github.json.
    mkdirSync(path.dirname(path.join(source, name)), { recursive: true });
    writeFileSync(path.join(source, name), text);
  }
  const beside = (name: string) => test.info().outputPath(name);
  const files = 'fatal' in row ? (row.files ?? {}) : {};
  for (const [name, text] of Object.entries(files)) writeFileSync(beside(name), text);
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

test.describe('rows that start', () => {
  for (const row of WARNING_ROWS) {
    test(`${row.group}: ${row.name}`, async () => {
      const paths = place(row);
      // The row's own source directory, so the harness copies no document.
      const app = await startApp({ env: row.env(paths), portfolio: null, site: null });
      try {
        await expect.poll(() => checkWarnings(row, readFileSync(app.log, 'utf8'))).toEqual([]);
        // The fallback composition serves the page, and the health check says so.
        const page = await fetch(`${app.origin}/`);
        expect(page.status).toBe(200);
        const html = await page.text();
        expect(html).toMatch(
          /<div data-appearance-boundary="document" data-variant="fallback" [^>]*data-requested-variant="canary-variant"/,
        );
        const ready = await fetch(`${app.origin}/api/ready`);
        expect(ready.status).toBe(200);
        const body = (await ready.json()) as { status: string; checks: object[] };
        expect(body.status).toBe('degraded');
        expect(body.checks).toContainEqual({ id: 'packs', status: 'degraded' });
        expect(app.egress()).toEqual([]);
      } finally {
        await app.stop();
      }
    });
  }
});

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

/** The snapshots and media document a pair keeps beside its documents (#10), for the harness to copy too. */
function unitFiles(dir: string): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const folder of ['snapshots', 'media']) {
    const at = path.join(dir, folder);
    if (!existsSync(at)) continue;
    for (const name of readdirSync(at)) {
      files[`${folder}/${name}`] = readFileSync(path.join(at, name));
    }
  }
  return files;
}

test.describe('the shared fixtures', () => {
  // @portfolio/schema's pair for each diagnostic code and its startup cases
  // (#4, item 21). The invalid pairs link to https://rowan.name, their own
  // origin. A blocking pair stops the server with its code alone; a warning
  // one starts it and logs its code. Each pair selects missing-variant, so
  // one that starts also warns that the fallback composition renders in its
  // place (#5).
  const FIXTURES = fileURLToPath(
    new URL('../../packages/schema/src/__fixtures__/', import.meta.url),
  );
  const WARNINGS = [
    'extension.unregistered',
    'image.alt-missing',
    'metric.duplicate',
    'origin.sample',
    'origin.stale',
    // #10: a reference to a private record, a section with nothing public,
    // and a file in snapshots/ that is no snapshot.
    'ref.private',
    'section.empty',
    'snapshot.ignored',
  ];
  // Live, a color scheme this build doesn't register is the appearance's
  // own warning, appearance.unavailable, and its axis falls back (#19, Slice
  // 4): the pair starts, as with the fallback composition's.
  const LIVE_CODES: Readonly<Record<string, string>> = {
    'appearance.unknown': 'appearance.unavailable',
  };
  // Startup can't raise the two that compare a draft with the live revision
  // (#10), which publish and import check.
  const UNCHECKED = ['id.reused', 'urls.vanished'];
  const UNAVAILABLE = 'variant.unavailable';
  const RECORD_ORIGIN = 'https://rowan.name';
  const invalid = readdirSync(path.join(FIXTURES, 'invalid')).sort();
  const readOnly = (source: string, origin = ORIGIN) => ({
    PORTFOLIO_PROFILE: 'read-only',
    PORTFOLIO_ORIGIN: origin,
    PORTFOLIO_SOURCE_DIR: source,
  });

  const STARTS = [...WARNINGS, ...Object.keys(LIVE_CODES), ...UNCHECKED];
  for (const code of invalid.filter((name) => !STARTS.includes(name))) {
    test(`invalid/${code} stops the server with that code alone`, async () => {
      const dir = path.join(FIXTURES, 'invalid', code);
      const fatal = await expectRefusal(readOnly(dir, RECORD_ORIGIN));
      expect([...new Set(fatal.map((entry) => entry.code))]).toEqual([code]);
    });
  }

  for (const code of STARTS) {
    const live = WARNINGS.includes(code) ? code : LIVE_CODES[code];
    const warned = live ? [live, UNAVAILABLE] : [UNAVAILABLE];
    test(`invalid/${code} warns ${warned.join(' and ')}, and the server starts`, async () => {
      expect(invalid).toContain(code);
      const dir = path.join(FIXTURES, 'invalid', code);
      const app = await startApp({
        env: { PORTFOLIO_ORIGIN: RECORD_ORIGIN },
        portfolio: path.join(dir, 'portfolio.yml'),
        site: path.join(dir, 'site.yml'),
        sourceFiles: unitFiles(dir),
      });
      try {
        const logged = (event: string) =>
          readFileSync(app.log, 'utf8')
            .split('\n')
            .filter((line) => line.startsWith('{'))
            .map((line) => JSON.parse(line) as Fatal)
            .filter((entry) => entry.event === event)
            .map((entry) => entry.code);
        await expect
          .poll(() => [...new Set(logged('config.warning'))].sort())
          .toEqual([...warned].sort());
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

  test('an old one-file portfolio stops the server with a remediation that names the appearance ids this build registers (#19, Slice 4)', async () => {
    const fatal = await expectRefusal(readOnly(path.join(FIXTURES, 'startup', 'legacy-only')));
    const [legacy] = fatal.filter((entry) => entry.code === 'legacy.document');
    expect(legacy, 'a legacy.document record').toBeTruthy();
    const remediation = (legacy as unknown as { remediation?: string }).remediation ?? '';
    for (const id of ['platform-neutral', 'warm-parchment', 'humanist-ui']) {
      expect(remediation, id).toContain(id);
    }
  });
});
